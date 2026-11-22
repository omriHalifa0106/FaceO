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
import {
  analyzeWith,
  canvasPixels,
  detectInPixels,
  drawScaled,
  EMBEDDING_DIMENSIONS,
  FACE_MATCH_THRESHOLD,
  initFaceApi,
  MAX_DETECTION_SIDE,
  type DetectedFace,
  type FaceApi,
} from '@/lib/faceModel';

export { EMBEDDING_DIMENSIONS, FACE_MATCH_THRESHOLD, type DetectedFace };

export const MODELS_URL = `${import.meta.env.BASE_URL}models`;

export type ImageSource = File | Blob | string | HTMLVideoElement | HTMLCanvasElement;

// -----------------------------------------------------------------------------
// Model loading on the main thread (lazy, once per page load). Bulk photo
// processing uses the face worker instead (lib/faceWorkerClient.ts).
// -----------------------------------------------------------------------------
let modelsPromise: Promise<FaceApi> | null = null;

export function loadFaceModels(): Promise<FaceApi> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      await initFaceApi(faceapi, MODELS_URL);
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
// Detection (main thread) — used for enrollment samples and camera frames
// -----------------------------------------------------------------------------

/** Detect every face in an image and compute a 128-d descriptor for each. */
export async function detectFaces(source: ImageSource): Promise<DetectedFace[]> {
  const faceapi = await loadFaceModels();
  if (source instanceof Blob || typeof source === 'string') {
    const { faces } = await analyzeWith(faceapi, source, { detect: true, thumbnail: false });
    return faces ?? [];
  }
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!width || !height) throw new Error('The image has no pixels');
  return detectInPixels(faceapi, canvasPixels(drawScaled(source, width, height, MAX_DETECTION_SIDE)));
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
  return { embedding: mean.map((v) => Math.round(v * 1e6) / 1e6), sampleCount: descriptors.length };
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
