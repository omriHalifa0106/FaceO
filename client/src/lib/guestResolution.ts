// src/lib/guestResolution.ts — turn detected faces into tags.
//
// The face worker detects faces and computes descriptors (faceWorkerClient.ts);
// public.ingest_photo_faces() then matches each one, in this order:
//   1. a group member with an enrolled face      -> member tag
//   2. an existing guest in the same group       -> same guest
//   3. nobody                                    -> new "Guest N"
// When someone enrolls or joins a group, resolve_my_guest_tags() moves
// their matching guest faces over to them.
//
// The same pass renders the grid thumbnail, so each image is decoded once.

import { supabase, r2PublicUrl } from '@/lib/supabaseClient';
import { attempt, toAppError, type AppError, type Result } from '@/lib/result';
import { analyzeImage } from '@/lib/faceWorkerClient';
import { uploadThumbnail } from '@/lib/storage';
import { Photo as PhotoApi } from '@/api/entities';
import type { FaceBox, Photo, UUID } from '@/types';

export interface IngestedTag {
  tag_id: UUID;
  user_id: UUID | null;
  guest_id: UUID | null;
  box: FaceBox;
  match_distance: number | null;
}

export interface ProcessOutcome {
  photoId: UUID;
  /** null when faces were not (re)scanned in this pass */
  faces: number | null;
  recognisedMembers: number;
  guests: number;
  thumbnail: 'created' | 'skipped' | 'failed';
}

type ProcessablePhoto = Pick<Photo, 'id' | 'storage_key' | 'thumb_key' | 'face_status'>;

/**
 * Detect faces (if not done yet, or `forceFaces`) and create the thumbnail (if
 * missing) for one photo. `source` should be the original File when available
 * (no re-download); otherwise the R2 URL is used.
 * A failed face scan marks the photo 'failed' so it can be retried later;
 * a failed thumbnail never fails the call (the grid falls back to the original).
 */
export function processPhoto(
  photo: ProcessablePhoto,
  source?: Blob,
  opts: { forceFaces?: boolean; skipFaces?: boolean } = {},
): Promise<Result<ProcessOutcome>> {
  return attempt(async () => {
    const detect = !!opts.forceFaces || (photo.face_status !== 'done' && !opts.skipFaces);
    const thumbnail = !photo.thumb_key;
    const outcome: ProcessOutcome = { photoId: photo.id, faces: null, recognisedMembers: 0, guests: 0, thumbnail: 'skipped' };
    if (!detect && !thumbnail) return outcome;

    const input = source ?? r2PublicUrl(photo.storage_key);
    if (!input) throw new Error('Photo has no storage key');

    let analysis;
    try {
      analysis = await analyzeImage(input, { detect, thumbnail });
    } catch (err) {
      if (detect) await supabase.rpc('mark_photo_face_failed', { p_photo_id: photo.id });
      throw err;
    }

    if (detect && analysis.faces) {
      const { data, error } = await supabase.rpc('ingest_photo_faces', {
        p_photo_id: photo.id,
        p_faces: analysis.faces.map((f) => ({ box: f.box, score: f.score, embedding: f.embedding })),
      });
      if (error) {
        await supabase.rpc('mark_photo_face_failed', { p_photo_id: photo.id });
        throw error;
      }
      const tags = (data ?? []) as IngestedTag[];
      outcome.faces = tags.length;
      outcome.recognisedMembers = tags.filter((t) => t.user_id).length;
      outcome.guests = tags.filter((t) => t.guest_id).length;
    }

    if (analysis.thumbnail) {
      try {
        await uploadThumbnail(photo.id, analysis.thumbnail);
        outcome.thumbnail = 'created';
      } catch (err) {
        outcome.thumbnail = 'failed';
        if (import.meta.env.DEV) console.warn('[thumbnail] upload failed', err);
      }
    }
    return outcome;
  }, 'Processing failed for this photo');
}

export interface BatchProgress {
  done: number;
  total: number;
  failed: number;
  current?: UUID;
}

export interface BatchResult {
  processed: ProcessOutcome[];
  failed: Array<{ photoId: UUID; error: AppError }>;
}

/**
 * Finish every photo of a group that still needs a face scan (pending/failed)
 * or a thumbnail — e.g. uploads from a device that couldn't run the models,
 * or photos uploaded before thumbnails existed.
 */
export async function processPendingPhotos(
  groupId: UUID,
  opts: { onProgress?: (p: BatchProgress) => void; signal?: AbortSignal } = {},
): Promise<Result<BatchResult>> {
  const pending = await PhotoApi.listUnprocessed(groupId);
  if (pending.error) return pending;

  const result: BatchResult = { processed: [], failed: [] };
  const total = pending.data.length;
  const report = (current?: UUID) =>
    opts.onProgress?.({ done: result.processed.length + result.failed.length, total, failed: result.failed.length, current });
  report();

  for (const photo of pending.data) {
    if (opts.signal?.aborted) break;
    report(photo.id);
    const res = await processPhoto(photo);
    if (res.error) {
      result.failed.push({ photoId: photo.id, error: res.error });
      // Model loading failed everywhere: no point trying the remaining photos.
      if (res.error.code === 'MODELS') return { data: null, error: toAppError(res.error) };
    } else result.processed.push(res.data);
  }

  report();
  return { data: result, error: null };
}

/**
 * Re-attribute guest faces that match the current user's enrolled face.
 * Pass a groupId to limit it to one group. Returns the number of faces linked.
 */
export function resolveMyGuestTags(groupId?: UUID): Promise<Result<number>> {
  return attempt(async () => {
    const { data, error } = await supabase.rpc('resolve_my_guest_tags', { p_group_id: groupId ?? null });
    if (error) throw error;
    return Number(data ?? 0);
  }, 'Could not look for your photos');
}
