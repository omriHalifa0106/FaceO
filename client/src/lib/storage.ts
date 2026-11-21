// src/lib/storage.ts — direct browser -> Cloudflare R2 uploads.
//
// Flow per file:
//   1. r2-presign edge function returns { key, uploadUrl } (auth + membership checked there)
//   2. PUT the bytes straight to R2 (progress via XHR)
//   3. insert the photos row in Supabase (key + metadata only)

import { supabase } from '@/lib/supabaseClient';
import { attempt, toAppError, type AppError, type Result } from '@/lib/result';
import { Photo as PhotoApi, User as UserApi, functionError } from '@/api/entities';
import type { Photo, Profile, UUID } from '@/types';

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const PRESIGN_BATCH = 50; // must match MAX_FILES_PER_REQUEST in the edge function
const UPLOAD_CONCURRENCY = 3;

interface PresignedUpload {
  key: string;
  uploadUrl: string;
  publicUrl: string;
  headers: Record<string, string>;
}

export type UploadStage = 'queued' | 'uploading' | 'saving' | 'processing' | 'done' | 'error';

export interface UploadProgress {
  index: number;
  file: File;
  stage: UploadStage;
  /** 0..100 for the byte upload */
  percent: number;
  photo?: Photo;
  error?: AppError;
}

export interface UploadOptions {
  onProgress?: (p: UploadProgress) => void;
  /**
   * Runs after the photo row exists, with the original File still in memory
   * (used to run face detection without downloading the image again).
   * Errors here do not fail the upload.
   */
  afterSave?: (photo: Photo, file: File) => Promise<void>;
  signal?: AbortSignal;
}

// -----------------------------------------------------------------------------
// Validation & metadata
// -----------------------------------------------------------------------------
export function validateImage(file: File, maxBytes = MAX_PHOTO_BYTES): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name}: only JPEG, PNG or WebP images are supported`;
  }
  if (file.size === 0) return `${file.name}: the file is empty`;
  if (file.size > maxBytes) return `${file.name}: larger than ${Math.round(maxBytes / 1048576)} MB`;
  return null;
}

async function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Edge function + R2
// -----------------------------------------------------------------------------
async function presign(body: Record<string, unknown>): Promise<PresignedUpload[]> {
  const { data, error } = await supabase.functions.invoke('r2-presign', { body: { action: 'upload', ...body } });
  if (error) throw await functionError(error);
  if (!data?.uploads) throw new Error('Upload service returned an unexpected response');
  return data.uploads as PresignedUpload[];
}

function putToR2(
  target: PresignedUpload,
  file: File,
  onPercent: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.uploadUrl);
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPercent(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(Object.assign(new Error(`Storage rejected the upload (HTTP ${xhr.status})`), { code: String(xhr.status) }));
    // A CORS misconfiguration on the bucket surfaces as a bare network error.
    xhr.onerror = () =>
      reject(new Error('Network error while uploading. If this persists, check the R2 bucket CORS policy.'));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { code: 'ABORTED' }));
    if (signal) {
      if (signal.aborted) return xhr.abort();
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

/** Run async tasks with a fixed concurrency. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift() as T);
  });
  await Promise.all(runners);
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Upload many photos to a group. Never throws: each file ends as 'done' or
 * 'error' and the final array is returned.
 */
export async function uploadPhotos(groupId: UUID, files: File[], opts: UploadOptions = {}): Promise<UploadProgress[]> {
  const states: UploadProgress[] = files.map((file, index) => ({ index, file, stage: 'queued', percent: 0 }));
  const emit = (s: UploadProgress) => opts.onProgress?.({ ...s });
  const failItem = (s: UploadProgress, err: unknown) => {
    s.stage = 'error';
    s.error = toAppError(err, 'Upload failed');
    emit(s);
  };

  // Client-side validation first (the edge function re-validates).
  const valid: UploadProgress[] = [];
  for (const s of states) {
    const problem = validateImage(s.file);
    if (problem) failItem(s, problem);
    else valid.push(s);
  }

  for (let i = 0; i < valid.length; i += PRESIGN_BATCH) {
    if (opts.signal?.aborted) break;
    const batch = valid.slice(i, i + PRESIGN_BATCH);

    let targets: PresignedUpload[];
    try {
      targets = await presign({
        purpose: 'photo',
        groupId,
        files: batch.map((s) => ({ contentType: s.file.type, size: s.file.size })),
      });
    } catch (err) {
      batch.forEach((s) => failItem(s, err));
      continue;
    }

    await pool(
      batch.map((s, j) => ({ s, target: targets[j] })),
      UPLOAD_CONCURRENCY,
      async ({ s, target }) => {
        try {
          s.stage = 'uploading';
          emit(s);
          await putToR2(target, s.file, (pct) => {
            s.percent = pct;
            emit(s);
          }, opts.signal);

          s.stage = 'saving';
          emit(s);
          const dims = await readDimensions(s.file);
          const created = await PhotoApi.create({
            group_id: groupId,
            storage_key: target.key,
            mime_type: s.file.type,
            size_bytes: s.file.size,
            width: dims?.width ?? null,
            height: dims?.height ?? null,
          });
          if (created.error) throw created.error;
          s.photo = created.data;

          if (opts.afterSave) {
            s.stage = 'processing';
            emit(s);
            try {
              await opts.afterSave(created.data, s.file);
            } catch (err) {
              // Face processing can be retried later from the group page.
              if (import.meta.env.DEV) console.warn('[upload] afterSave failed', err);
            }
          }
          s.stage = 'done';
          s.percent = 100;
          emit(s);
        } catch (err) {
          failItem(s, err);
        }
      },
    );
  }

  // Anything still queued was cancelled.
  states.filter((s) => s.stage === 'queued').forEach((s) => failItem(s, { message: 'Upload cancelled', code: 'ABORTED' }));
  return states;
}

/** Upload a profile picture and point the profile at it. */
export function uploadAvatar(file: File): Promise<Result<Profile>> {
  return attempt(async () => {
    const problem = validateImage(file, MAX_AVATAR_BYTES);
    if (problem) throw new Error(problem);
    const [target] = await presign({ purpose: 'avatar', files: [{ contentType: file.type, size: file.size }] });
    await putToR2(target, file, () => {});
    const updated = await UserApi.update({ avatar_key: target.key });
    if (updated.error) throw updated.error;
    return updated.data;
  }, 'Could not upload the picture');
}
