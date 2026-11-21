// src/lib/faceRecognition.ts — client-side face detection & embeddings.
//
// One of only two modules (with guestResolution.ts) allowed to touch
// biometric data. Embeddings are computed in the browser; matching against
// other people happens inside Postgres (SECURITY DEFINER RPCs), so this
// browser never receives anyone else's face vector.
//
// Model: @vladmandic/face-api — SSD MobileNet v1 detector + 68-point
// landmarks (alignment) + FaceRecognitionNet -> 128-d descriptor.

import { supabase } from '@/lib/supabaseClient';
import { attempt, type Result } from '@/lib/result';
import type { FaceBox } from '@/types';

type FaceApi = typeof import('@vladmandic/face-api');

export const EMBEDDING_DIMENSIONS = 128;
/** Same value as public.face_match_threshold() in SQL. */
export const FACE_MATCH_THRESHOLD = 0.5;

const MODELS_URL = `${import.meta.env.BASE_URL}models`;
/** Longest side used for detection; bigger images are downscaled (faster, less memory). */
const MAX_DETECTION_SIDE = 1600;
const MIN_DETECTION_CONFIDENCE = 0.5;
/** Faces smaller than this (px, after downscale) give unreliable descriptors. */
const MIN_FACE_SIDE = 40;
const MAX_FACES_PER_PHOTO = 100;

export interface DetectedFace {
  box: FaceBox;
  score: number;
  embedding: number[];
}

export type ImageSource = File | Blob | string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

// -----------------------------------------------------------------------------
// Model loading (lazy, once per page load)
// -----------------------------------------------------------------------------
let modelsPromise: Promise<FaceApi> | null = null;

export function loadFaceModels(): Promise<FaceApi> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      // The bundled tfjs exposes these at runtime but face-api's typings omit them.
      const tf = faceapi.tf as unknown as {
        setBackend(name: string): Promise<boolean>;
        ready(): Promise<void>;
      };
      // setBackend resolves false (does not throw) when a backend can't start.
      const webgl = await tf.setBackend('webgl').catch(() => false);
      if (!webgl) await tf.setBackend('cpu');
      await tf.ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
      ]);
      return faceapi;
    })().catch((err) => {
      modelsPromise = null; // allow retry
      throw Object.assign(new Error(`Could not load face recognition models: ${err?.message ?? err}`), {
        code: 'MODELS',
      });
    });
  }
  return modelsPromise;
}

// -----------------------------------------------------------------------------
// Image preparation
// -----------------------------------------------------------------------------
function loadImageElement(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous'; // R2 bucket must allow GET via CORS
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(crossOrigin ? 'Could not load the image (check the R2 bucket CORS policy)' : 'Could not read the image'));
    img.src = src;
  });
}

/** Draw the source into a canvas no larger than MAX_DETECTION_SIDE. EXIF orientation is applied by the browser. */
async function toDetectionCanvas(source: ImageSource): Promise<HTMLCanvasElement> {
  let drawable: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;
  let width: number;
  let height: number;
  let revoke: string | null = null;

  try {
    if (source instanceof Blob) {
      revoke = URL.createObjectURL(source);
      drawable = await loadImageElement(revoke, false);
    } else if (typeof source === 'string') {
      drawable = await loadImageElement(source, true);
    } else {
      drawable = source;
    }

    if (drawable instanceof HTMLVideoElement) {
      width = drawable.videoWidth;
      height = drawable.videoHeight;
    } else if (drawable instanceof HTMLImageElement) {
      width = drawable.naturalWidth;
      height = drawable.naturalHeight;
    } else {
      width = drawable.width;
      height = drawable.height;
    }
    if (!width || !height) throw new Error('The image has no pixels');

    const scale = Math.min(1, MAX_DETECTION_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser');
    ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    if (revoke) URL.revokeObjectURL(revoke);
  }
}

const round = (n: number, digits = 6) => Math.round(n * 10 ** digits) / 10 ** digits;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// -----------------------------------------------------------------------------
// Detection
// -----------------------------------------------------------------------------

/** Detect every face in an image and compute a 128-d descriptor for each. */
export async function detectFaces(source: ImageSource): Promise<DetectedFace[]> {
  const faceapi = await loadFaceModels();
  const canvas = await toDetectionCanvas(source);

  const results = await faceapi
    .detectAllFaces(
      canvas,
      new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_DETECTION_CONFIDENCE, maxResults: MAX_FACES_PER_PHOTO }),
    )
    .withFaceLandmarks()
    .withFaceDescriptors();

  return results
    .filter((r) => Math.min(r.detection.box.width, r.detection.box.height) >= MIN_FACE_SIDE)
    .map((r) => {
      const b = r.detection.box;
      return {
        box: {
          x: round(clamp01(b.x / canvas.width), 5),
          y: round(clamp01(b.y / canvas.height), 5),
          w: round(clamp01(b.width / canvas.width), 5),
          h: round(clamp01(b.height / canvas.height), 5),
        },
        score: round(r.detection.score, 4),
        embedding: Array.from(r.descriptor, (v) => round(v)),
      };
    });
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

// -----------------------------------------------------------------------------
// Enrollment (the user's own reference face)
// -----------------------------------------------------------------------------
export class EnrollmentError extends Error {
  sampleIndex: number | null;

  constructor(message: string, sampleIndex: number | null = null) {
    super(message);
    this.name = 'EnrollmentError';
    this.sampleIndex = sampleIndex;
  }
}

/**
 * Build a reference descriptor from 1..5 selfies / camera frames.
 * Each sample must contain exactly one clear face, and all samples must look
 * like the same person. The result is the mean descriptor.
 */
export async function buildReferenceEmbedding(samples: ImageSource[]): Promise<{ embedding: number[]; sampleCount: number }> {
  if (samples.length === 0) throw new EnrollmentError('Add at least one photo of your face');
  if (samples.length > 5) throw new EnrollmentError('Use at most 5 photos');

  const descriptors: number[][] = [];
  for (let i = 0; i < samples.length; i++) {
    const faces = await detectFaces(samples[i]);
    if (faces.length === 0) throw new EnrollmentError(`Photo ${i + 1}: no face found. Use a well-lit, front-facing photo.`, i);
    if (faces.length > 1) throw new EnrollmentError(`Photo ${i + 1}: more than one face. Only you should be in the picture.`, i);
    if (faces[0].score < 0.8) throw new EnrollmentError(`Photo ${i + 1}: the face is not clear enough.`, i);
    descriptors.push(faces[0].embedding);
  }

  for (let i = 1; i < descriptors.length; i++) {
    if (euclideanDistance(descriptors[0], descriptors[i]) > FACE_MATCH_THRESHOLD + 0.1) {
      throw new EnrollmentError(`Photo ${i + 1} does not look like the same person as photo 1.`, i);
    }
  }

  const mean = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const d of descriptors) for (let k = 0; k < EMBEDDING_DIMENSIONS; k++) mean[k] += d[k] / descriptors.length;
  return { embedding: mean.map((v) => round(v)), sampleCount: descriptors.length };
}

/**
 * Save the current user's reference face, then let the DB re-attribute guest
 * faces in their groups that match it. Returns how many photos were linked.
 */
export function enrollMyFace(samples: ImageSource[]): Promise<Result<{ linkedPhotos: number }>> {
  return attempt(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) throw new Error('You need to sign in first.');

    const { embedding, sampleCount } = await buildReferenceEmbedding(samples);

    const { error } = await supabase.from('user_face_embeddings').upsert(
      {
        user_id: userId,
        embedding: JSON.stringify(embedding), // pgvector text format: [0.1,0.2,...]
        sample_count: sampleCount,
        model: 'face-api/faceRecognitionNet',
      },
      { onConflict: 'user_id' },
    );
    if (error) throw error;

    const { data: linked, error: rpcError } = await supabase.rpc('resolve_my_guest_tags', { p_group_id: null });
    if (rpcError) throw rpcError;
    return { linkedPhotos: Number(linked ?? 0) };
  }, 'Could not save your face profile');
}

/**
 * Remove the user's biometric reference. Existing tags stay (they are
 * group content), but no new photos will be matched to the user.
 */
export function deleteMyFaceData(): Promise<Result<true>> {
  return attempt(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) throw new Error('You need to sign in first.');
    const { error } = await supabase.from('user_face_embeddings').delete().eq('user_id', userId);
    if (error) throw error;
    return true as const;
  }, 'Could not delete your face data');
}
