// src/lib/guestResolution.ts — turn detected faces into tags.
//
// The browser detects faces and computes descriptors (faceRecognition.ts);
// public.ingest_photo_faces() then matches each one, in this order:
//   1. a group member with an enrolled face      -> member tag
//   2. an existing guest in the same group       -> same guest
//   3. nobody                                    -> new "Guest N"
// When someone enrolls or joins a group, resolve_my_guest_tags() moves
// their matching guest faces over to them.

import { supabase, r2PublicUrl } from '@/lib/supabaseClient';
import { attempt, toAppError, type AppError, type Result } from '@/lib/result';
import { detectFaces, loadFaceModels, type ImageSource } from '@/lib/faceRecognition';
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
  faces: number;
  recognisedMembers: number;
  guests: number;
}

/**
 * Detect faces in one photo and store/match them. `source` should be the
 * original File when available (no re-download); otherwise the R2 URL is used.
 * On failure the photo is marked 'failed' so it can be retried later.
 */
export function processPhotoFaces(photo: Pick<Photo, 'id' | 'storage_key'>, source?: ImageSource): Promise<Result<ProcessOutcome>> {
  return attempt(async () => {
    let faces;
    try {
      const input = source ?? r2PublicUrl(photo.storage_key);
      if (!input) throw new Error('Photo has no storage key');
      faces = await detectFaces(input);
    } catch (err) {
      // Best effort: record the failure; ignore errors from this call itself.
      await supabase.rpc('mark_photo_face_failed', { p_photo_id: photo.id });
      throw err;
    }

    const { data, error } = await supabase.rpc('ingest_photo_faces', {
      p_photo_id: photo.id,
      p_faces: faces.map((f) => ({ box: f.box, score: f.score, embedding: f.embedding })),
    });
    if (error) {
      await supabase.rpc('mark_photo_face_failed', { p_photo_id: photo.id });
      throw error;
    }

    const tags = (data ?? []) as IngestedTag[];
    return {
      photoId: photo.id,
      faces: tags.length,
      recognisedMembers: tags.filter((t) => t.user_id).length,
      guests: tags.filter((t) => t.guest_id).length,
    };
  }, 'Face recognition failed for this photo');
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
 * Run face recognition on every pending/failed photo of a group
 * (e.g. photos uploaded from a device that could not run the models).
 */
export async function processPendingPhotos(
  groupId: UUID,
  opts: { onProgress?: (p: BatchProgress) => void; signal?: AbortSignal } = {},
): Promise<Result<BatchResult>> {
  const pending = await PhotoApi.listUnprocessed(groupId);
  if (pending.error) return pending;

  try {
    await loadFaceModels(); // fail fast, once, if models can't load
  } catch (err) {
    return { data: null, error: toAppError(err) };
  }

  const result: BatchResult = { processed: [], failed: [] };
  const total = pending.data.length;
  opts.onProgress?.({ done: 0, total, failed: 0 });

  for (const photo of pending.data) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.({ done: result.processed.length + result.failed.length, total, failed: result.failed.length, current: photo.id });
    const res = await processPhotoFaces(photo);
    if (res.error) result.failed.push({ photoId: photo.id, error: res.error });
    else result.processed.push(res.data);
  }

  opts.onProgress?.({ done: result.processed.length + result.failed.length, total, failed: result.failed.length });
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
