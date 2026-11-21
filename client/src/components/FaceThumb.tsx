// src/components/FaceThumb.tsx — show just the face region of a photo (CSS crop, no extra requests)
import { r2PublicUrl } from '@/lib/supabaseClient';
import type { FaceBox } from '@/types';

/** Expand the detector box so the crop includes some hair/chin. */
function padBox(box: FaceBox, pad = 0.35): FaceBox {
  const w = Math.min(1, box.w * (1 + pad * 2));
  const h = Math.min(1, box.h * (1 + pad * 2));
  return {
    x: Math.min(Math.max(0, box.x - box.w * pad), 1 - w),
    y: Math.min(Math.max(0, box.y - box.h * pad), 1 - h),
    w,
    h,
  };
}

export default function FaceThumb({
  storageKey,
  box,
  size = 96,
  alt,
  className = 'rounded-2xl',
}: {
  storageKey: string | null;
  box: FaceBox | null;
  size?: number;
  alt: string;
  className?: string;
}) {
  const url = r2PublicUrl(storageKey);
  if (!url || !box) {
    return <div style={{ width: size, height: size }} className={`bg-slate-200 ${className}`} aria-label={alt} />;
  }
  const b = padBox(box);
  // background-position % formula: offset = p * (imageSize - containerSize)
  const posX = b.w >= 1 ? 0 : (b.x / (1 - b.w)) * 100;
  const posY = b.h >= 1 ? 0 : (b.y / (1 - b.h)) * 100;
  return (
    <div
      role="img"
      aria-label={alt}
      className={`shrink-0 bg-slate-200 bg-no-repeat ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${url}")`,
        backgroundSize: `${100 / b.w}% ${100 / b.h}%`,
        backgroundPosition: `${posX}% ${posY}%`,
      }}
    />
  );
}
