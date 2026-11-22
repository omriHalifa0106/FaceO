// src/workers/face.worker.ts — runs face detection + thumbnail rendering off the
// main thread so the UI stays responsive during large uploads / re-scans.
import * as faceapi from '@vladmandic/face-api';
import { analyzeWith, initFaceApi, type AnalyzeOptions, type AnalyzeResult } from '@/lib/faceModel';

export type WorkerRequest = { id: number; source: Blob | string; options: AnalyzeOptions; modelsUrl: string };
export type WorkerResponse =
  | { id: number; ok: true; result: AnalyzeResult }
  | { id: number; ok: false; error: string; fatal: boolean };

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
  fetch: typeof fetch;
}
const scope = self as unknown as WorkerScope;

// face-api only auto-detects browser/Node; give it a minimal worker environment.
// Detection uses tensor input, so the canvas/image entries are never exercised.
const unsupported = () => {
  throw new Error('Not available in a worker');
};
faceapi.env.setEnv({
  Canvas: OffscreenCanvas,
  CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D,
  Image: class {},
  ImageData,
  Video: class {},
  createCanvasElement: () => new OffscreenCanvas(1, 1),
  createImageElement: unsupported,
  createVideoElement: unsupported,
  fetch: scope.fetch.bind(scope),
  readFile: unsupported,
} as unknown as Parameters<typeof faceapi.env.setEnv>[0]);

let ready: Promise<void> | null = null;
function ensureModels(modelsUrl: string): Promise<void> {
  if (!ready) {
    ready = initFaceApi(faceapi, modelsUrl).then(() => undefined);
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

// Process one image at a time: keeps GPU/memory usage bounded.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const { id, source, options, modelsUrl } = event.data;
  queue = queue.then(async () => {
    if (options.detect) {
      try {
        await ensureModels(modelsUrl);
      } catch (err) {
        scope.postMessage({ id, ok: false, error: `Model load failed: ${(err as Error)?.message ?? err}`, fatal: true });
        return;
      }
    }
    try {
      const result = await analyzeWith(faceapi, source, options);
      scope.postMessage({ id, ok: true, result });
    } catch (err) {
      scope.postMessage({ id, ok: false, error: (err as Error)?.message ?? String(err), fatal: false });
    }
  });
};
