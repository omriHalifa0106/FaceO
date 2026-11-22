// src/lib/download.ts — download original photos (single file or a ZIP).
//
// ZIPs are built in the browser with client-zip (stored, not re-compressed:
// JPEG/PNG/WebP are already compressed). Where the File System Access API is
// available (Chrome/Edge) the ZIP streams straight to disk, so hundreds of
// photos never sit in memory; elsewhere it is assembled as a Blob first.

import { r2PublicUrl } from '@/lib/supabaseClient';
import { attempt, type Result } from '@/lib/result';
import type { Page } from '@/api/entities';
import type { Photo } from '@/types';

export type DownloadablePhoto = Pick<Photo, 'id' | 'storage_key' | 'mime_type' | 'size_bytes' | 'taken_at' | 'created_at'> & {
  group?: { name: string } | null;
};

export interface DownloadProgress {
  done: number;
  failed: number;
  total: number;
}

const PREFETCH = 4;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Minimal typing for the File System Access API (not in TS's DOM lib yet).
interface SaveFilePickerWindow {
  showSaveFilePicker(options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }): Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;
}

export type SaveTarget = { kind: 'stream'; writable: WritableStream<Uint8Array> } | { kind: 'blob'; fileName: string };

/** Whether ZIPs stream to disk in this browser (otherwise they are built in memory). */
export const canStreamToDisk = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const sanitize = (s: string) =>
  // Strip characters that are invalid in file names, including control chars.
  // eslint-disable-next-line no-control-regex
  s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'FaceO';

function fileNameFor(photo: DownloadablePhoto): string {
  const date = (photo.taken_at ?? photo.created_at).slice(0, 10);
  const name = `${date}_${photo.id.slice(0, 8)}.${EXT[photo.mime_type] ?? 'jpg'}`;
  return photo.group?.name ? `${sanitize(photo.group.name)}/${name}` : name;
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function fetchOriginal(photo: DownloadablePhoto, signal?: AbortSignal): Promise<Response> {
  const url = r2PublicUrl(photo.storage_key);
  if (!url) throw new Error('Photo has no storage key');
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal });
  if (!res.ok) throw new Error(`Could not download the image (HTTP ${res.status})`);
  // Never put an error page / HTML fallback into the ZIP as if it were a photo.
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/') && type !== 'application/octet-stream') {
    throw new Error('Could not read the image');
  }
  return res;
}

/** Fetch every page of a paginated list. */
export async function collectAllPages<T>(fetchPage: (page: Page) => Promise<Result<T[]>>, pageSize = 200): Promise<Result<T[]>> {
  const all: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetchPage({ limit: pageSize, offset });
    if (res.error) return res;
    all.push(...res.data);
    if (res.data.length < pageSize) return { data: all, error: null };
  }
}

/**
 * Ask where to save the ZIP. Must be called straight from a click handler
 * (the picker needs a fresh user gesture). Returns null if the user cancelled.
 */
export async function chooseSaveTarget(rawFileName: string): Promise<SaveTarget | null> {
  // Group names become file names: drop characters the OS / picker rejects.
  const fileName = sanitize(rawFileName);
  if (canStreamToDisk()) {
    try {
      const handle = await (window as unknown as SaveFilePickerWindow).showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
      });
      return { kind: 'stream', writable: await handle.createWritable() };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null; // user closed the dialog
      // Picker unavailable here (e.g. iframe/permissions): fall back to an in-memory ZIP.
    }
  }
  return { kind: 'blob', fileName };
}

/**
 * Download the originals into a ZIP at `target`. Photos that fail to download
 * are skipped and counted; the call fails only if none could be downloaded.
 */
export function writePhotosZip(
  target: SaveTarget,
  photos: DownloadablePhoto[],
  opts: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal } = {},
): Promise<Result<DownloadProgress>> {
  return attempt(async () => {
    const { downloadZip } = await import('client-zip');
    const progress: DownloadProgress = { done: 0, failed: 0, total: photos.length };
    const report = () => opts.onProgress?.({ ...progress });
    const used = new Set<string>();

    async function* files() {
      // Keep a few requests in flight while the ZIP writer consumes the current one.
      const inFlight: Array<{ photo: DownloadablePhoto; res: Promise<Response | null> }> = [];
      let next = 0;
      const fill = () => {
        while (inFlight.length < PREFETCH && next < photos.length) {
          const photo = photos[next++];
          inFlight.push({
            photo,
            res: fetchOriginal(photo, opts.signal).catch((err) => {
              if (opts.signal?.aborted) throw err;
              return null;
            }),
          });
        }
      };
      fill();
      while (inFlight.length) {
        const { photo, res } = inFlight.shift()!;
        const response = await res;
        fill();
        if (!response) {
          progress.failed++;
          report();
          continue;
        }
        let name = fileNameFor(photo);
        for (let i = 2; used.has(name); i++) name = name.replace(/(\.\w+)$/, `_${i}$1`);
        used.add(name);
        yield { name, input: response, lastModified: new Date(photo.taken_at ?? photo.created_at) };
        progress.done++;
        report();
      }
    }

    report();
    const zip = downloadZip(files());
    if (target.kind === 'stream') {
      await zip.body!.pipeTo(target.writable, { signal: opts.signal });
    } else {
      const blob = await zip.blob();
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (progress.done > 0) triggerBrowserDownload(blob, target.fileName);
    }
    if (progress.done === 0 && progress.total > 0) {
      throw new Error('None of the photos could be downloaded (check the R2 bucket CORS policy)');
    }
    return progress;
  }, 'Download failed');
}

/** Download one original photo. */
export function downloadSinglePhoto(photo: DownloadablePhoto): Promise<Result<true>> {
  return attempt(async () => {
    const res = await fetchOriginal(photo);
    triggerBrowserDownload(await res.blob(), fileNameFor({ ...photo, group: null }));
    return true as const;
  }, 'Download failed');
}
