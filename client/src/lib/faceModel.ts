// src/lib/faceModel.ts — face detection core shared by the main thread and the
// face worker. No Supabase, no React, no DOM requirement (works in a Worker).
import type * as FaceApiModule from '@vladmandic/face-api';
import type { FaceBox } from '@/types';

export type FaceApi = typeof FaceApiModule;

export const EMBEDDING_DIMENSIONS = 128;
/** Same value as public.face_match_threshold() in SQL. */
export const FACE_MATCH_THRESHOLD = 0.5;
/** Longest side used for detection; bigger images are downscaled (faster, less memory). */
export const MAX_DETECTION_SIDE = 1600;
/** Longest side of the stored grid thumbnail. */
export const THUMB_MAX_SIDE = 480;
export const THUMB_QUALITY = 0.8;
const MIN_DETECTION_CONFIDENCE = 0.5;
/** Faces smaller than this (px, after downscale) give unreliable descriptors. */
const MIN_FACE_SIDE = 40;
const MAX_FACES_PER_PHOTO = 100;

export interface DetectedFace {
  box: FaceBox;
  score: number;
  embedding: number[];
}

const round = (n: number, digits = 6) => Math.round(n * 10 ** digits) / 10 ** digits;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Pick a tfjs backend and load the three nets.
 *
 * WASM first: WebGL has to compile its shaders on first use, which measured
 * ~33 s on a real machine before the first face came back (then ~0.4 s/photo).
 * WASM needs no warm-up and runs ~1 s/photo from the first image.
 */
export async function initFaceApi(faceapi: FaceApi, modelsUrl: string, wasmUrl: string): Promise<string> {
  // The bundled tfjs exposes these at runtime but face-api's typings omit them.
  const tf = faceapi.tf as unknown as {
    setBackend(name: string): Promise<boolean>;
    setWasmPaths(prefix: string): void;
    ready(): Promise<void>;
    getBackend(): string;
  };
  tf.setWasmPaths(wasmUrl.endsWith('/') ? wasmUrl : `${wasmUrl}/`);
  // setBackend resolves false (does not throw) when a backend can't start.
  for (const backend of ['wasm', 'webgl', 'cpu']) {
    if (await tf.setBackend(backend).catch(() => false)) break;
  }
  await tf.ready();
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(modelsUrl),
    faceapi.nets.faceLandmark68Net.loadFromUri(modelsUrl),
    faceapi.nets.faceRecognitionNet.loadFromUri(modelsUrl),
  ]);
  return tf.getBackend();
}

/** Detect all faces in raw RGBA pixels and compute a 128-d descriptor for each. */
export async function detectInPixels(faceapi: FaceApi, pixels: ImageData): Promise<DetectedFace[]> {
  // A tensor input keeps face-api off every canvas/DOM code path (worker-safe).
  const tensor = faceapi.tf.browser.fromPixels(pixels);
  try {
    const results = await faceapi
      .detectAllFaces(
        tensor as unknown as Parameters<FaceApi['detectAllFaces']>[0],
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
            x: round(clamp01(b.x / pixels.width), 5),
            y: round(clamp01(b.y / pixels.height), 5),
            w: round(clamp01(b.width / pixels.width), 5),
            h: round(clamp01(b.height / pixels.height), 5),
          },
          score: round(r.detection.score, 4),
          embedding: Array.from(r.descriptor, (v) => round(v)),
        };
      });
  } finally {
    tensor.dispose();
  }
}

// -----------------------------------------------------------------------------
// Canvas helpers (OffscreenCanvas when available, else a DOM canvas)
// -----------------------------------------------------------------------------
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Drawable = ImageBitmap | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

export function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Draw `source` scaled to fit `maxSide`. */
export function drawScaled(source: Drawable, srcWidth: number, srcHeight: number, maxSide: number): AnyCanvas {
  const { width, height } = fitWithin(srcWidth, srcHeight, maxSide);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

export function canvasPixels(canvas: AnyCanvas): ImageData {
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function canvasToJpeg(canvas: AnyCanvas, quality = THUMB_QUALITY): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode thumbnail'))), 'image/jpeg', quality),
  );
}

/** Decode a Blob or URL to an ImageBitmap with EXIF orientation applied. */
export async function decodeImage(source: Blob | string): Promise<ImageBitmap> {
  let blob: Blob;
  if (typeof source === 'string') {
    let res: Response;
    try {
      res = await fetch(source, { mode: 'cors', credentials: 'omit' });
    } catch {
      throw new Error('Could not download the image (check the R2 bucket CORS policy)');
    }
    if (!res.ok) throw new Error(`Could not download the image (HTTP ${res.status})`);
    blob = await res.blob();
  } else {
    blob = source;
  }
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Could not read the image');
  }
}

export interface AnalyzeOptions {
  detect: boolean;
  thumbnail: boolean;
}

export interface AnalyzeResult {
  faces: DetectedFace[] | null;
  thumbnail: Blob | null;
  width: number;
  height: number;
}

/** Decode once, then detect faces and/or render a thumbnail. */
export async function analyzeWith(faceapi: FaceApi | null, source: Blob | string, opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const bitmap = await decodeImage(source);
  try {
    let faces: DetectedFace[] | null = null;
    if (opts.detect) {
      if (!faceapi) throw new Error('Face models are not loaded');
      const canvas = drawScaled(bitmap, bitmap.width, bitmap.height, MAX_DETECTION_SIDE);
      faces = await detectInPixels(faceapi, canvasPixels(canvas));
    }
    const thumbnail = opts.thumbnail
      ? await canvasToJpeg(drawScaled(bitmap, bitmap.width, bitmap.height, THUMB_MAX_SIDE))
      : null;
    return { faces, thumbnail, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
