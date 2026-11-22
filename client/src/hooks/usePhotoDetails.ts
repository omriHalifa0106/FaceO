// src/hooks/usePhotoDetails.ts — tags + removal requests per photo, cached by
// photo id and prefetched for the neighbouring photos, so flipping through the
// viewer shows the right face boxes immediately (never the previous photo's).
import { useCallback, useEffect, useRef, useState } from 'react';
import { PhotoHide, Tag as TagApi } from '@/api/entities';
import type { AppError } from '@/lib/result';
import type { PhotoHideRequest, TagWithPerson, UUID } from '@/types';

export interface PhotoDetails {
  tags: TagWithPerson[];
  requests: PhotoHideRequest[];
}

export function usePhotoDetails(currentId: UUID | null, neighborIds: Array<UUID | null | undefined>) {
  const [cache, setCache] = useState<Record<UUID, PhotoDetails>>({});
  const [errors, setErrors] = useState<Record<UUID, AppError>>({});
  const inflight = useRef(new Map<UUID, Promise<void>>());
  const generation = useRef(0);

  const load = useCallback((id: UUID): Promise<void> => {
    const existing = inflight.current.get(id);
    if (existing) return existing;
    const gen = generation.current;
    // Assigned right after the IIFE starts; only read after its first await.
    let promise: Promise<void> | undefined = undefined;
    promise = (async () => {
      const [tags, requests] = await Promise.all([TagApi.listByPhoto(id), PhotoHide.listByPhoto(id)]);
      if (inflight.current.get(id) === promise) inflight.current.delete(id);
      if (gen !== generation.current) return; // cache was invalidated while loading
      const error = tags.error ?? requests.error;
      if (error) {
        setErrors((e) => ({ ...e, [id]: error }));
        return;
      }
      setCache((c) => ({ ...c, [id]: { tags: tags.data ?? [], requests: requests.data ?? [] } }));
    })();
    inflight.current.set(id, promise);
    return promise;
  }, []);

  const neighborsKey = neighborIds.filter(Boolean).join(',');
  useEffect(() => {
    const ids = [currentId, ...(neighborsKey ? neighborsKey.split(',') : [])];
    for (const id of ids) if (id && !cache[id] && !errors[id]) void load(id);
  }, [currentId, neighborsKey, cache, errors, load]);

  /** Drop everything (an action can change tags on other photos too) and reload the current photo. */
  const refresh = useCallback(async () => {
    generation.current++;
    inflight.current.clear();
    // Keep showing the current photo's (slightly stale) data until the fresh copy lands.
    setCache((c) => (currentId && c[currentId] ? { [currentId]: c[currentId] } : {}));
    setErrors({});
    if (currentId) await load(currentId);
  }, [currentId, load]);

  return {
    data: currentId ? (cache[currentId] ?? null) : null,
    error: currentId ? (errors[currentId] ?? null) : null,
    refresh,
  };
}
