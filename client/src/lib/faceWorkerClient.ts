// src/lib/faceWorkerClient.ts — analyze images in the face worker, falling back
// to the main thread when workers / OffscreenCanvas / model loading in a worker
// are unavailable.
import { analyzeWith, type AnalyzeOptions, type AnalyzeResult } from '@/lib/faceModel';
import { loadFaceModels, MODELS_URL } from '@/lib/faceRecognition';
import type { WorkerRequest, WorkerResponse } from '@/workers/face.worker';

class WorkerUnavailable extends Error {}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (r: AnalyzeResult) => void; reject: (e: Error) => void }>();

function failAll(err: Error) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function disableWorker(reason: string) {
  if (import.meta.env.DEV) console.warn('[face-worker] disabled, using main thread:', reason);
  workerBroken = true;
  worker?.terminate();
  worker = null;
  failAll(new WorkerUnavailable(reason));
}

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/face.worker.ts', import.meta.url), { type: 'module', name: 'faceo-face' });
  } catch (err) {
    disableWorker(String(err));
    return null;
  }
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else if (msg.fatal) {
      entry.reject(new WorkerUnavailable(msg.error));
      disableWorker(msg.error);
    } else entry.reject(new Error(msg.error));
  };
  worker.onerror = (e) => disableWorker(e.message || 'worker crashed');
  return worker;
}

function runInWorker(w: Worker, source: Blob | string, options: AnalyzeOptions): Promise<AnalyzeResult> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const request: WorkerRequest = { id, source, options, modelsUrl: new URL(MODELS_URL, location.href).href };
    w.postMessage(request);
  });
}

/**
 * Decode an image once and (optionally) detect faces and render a JPEG thumbnail.
 * `source` is a File/Blob (fresh upload) or a URL (already in R2).
 */
export async function analyzeImage(source: Blob | string, options: AnalyzeOptions): Promise<AnalyzeResult> {
  const w = getWorker();
  if (w) {
    try {
      return await runInWorker(w, source, options);
    } catch (err) {
      if (!(err instanceof WorkerUnavailable)) throw err;
    }
  }
  const faceapi = options.detect ? await loadFaceModels() : null;
  return analyzeWith(faceapi, source, options);
}
