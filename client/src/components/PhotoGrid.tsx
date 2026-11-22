// src/components/PhotoGrid.tsx — responsive photo grid with status badges
import { AlertTriangle, Loader2, Users } from 'lucide-react';
import { r2PublicUrl } from '@/lib/supabaseClient';
import type { Photo } from '@/types';
import { useI18n } from '@/i18n/I18nProvider';

export default function PhotoGrid<P extends Photo>({
  photos,
  onOpen,
  caption,
}: {
  photos: P[];
  onOpen?: (photo: P, index: number) => void;
  caption?: (photo: P) => string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((photo, i) => {
        // Thumbnail when available; if it's missing in storage, fall back to the original once.
        const url = r2PublicUrl(photo.thumb_key ?? photo.storage_key);
        const original = r2PublicUrl(photo.storage_key);
        const text = caption?.(photo);
        return (
          <button
            key={photo.id}
            type="button"
            onClick={() => onOpen?.(photo, i)}
            className="group relative aspect-square overflow-hidden rounded-2xl bg-slate-200 text-start focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {url && (
              <img
                src={url}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (original && img.src !== original) img.src = original;
                }}
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
            )}
            <div className="absolute start-2 top-2 flex gap-1">
              {photo.face_status === 'pending' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                  <Loader2 size={11} className="animate-spin" /> {t.photos.badgePending}
                </span>
              )}
              {photo.face_status === 'failed' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100/95 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  <AlertTriangle size={11} /> {t.photos.badgeNotScanned}
                </span>
              )}
              {photo.face_status === 'done' && photo.face_count > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
                  <Users size={11} /> {photo.face_count}
                </span>
              )}
            </div>
            {text && (
              <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6 text-start text-xs text-white">
                {text}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
