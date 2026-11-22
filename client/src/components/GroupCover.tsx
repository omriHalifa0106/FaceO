// src/components/GroupCover.tsx — card cover: a collage of the newest photos,
// or a coloured placeholder with the group's initial when it has none yet.
import { r2PublicUrl } from '@/lib/supabaseClient';
import { cn } from '@/components/ui';

// Stable pleasant gradient per group (by id), so empty groups don't all look alike.
const GRADIENTS = [
  'from-teal-400 to-cyan-600',
  'from-sky-400 to-indigo-600',
  'from-amber-300 to-orange-500',
  'from-rose-400 to-fuchsia-600',
  'from-emerald-400 to-teal-700',
  'from-violet-400 to-purple-700',
];

function gradientFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

function Img({ storageKey, className }: { storageKey: string; className?: string }) {
  const src = r2PublicUrl(storageKey);
  return src ? <img src={src} alt="" loading="lazy" decoding="async" className={cn('h-full w-full object-cover', className)} /> : null;
}

export default function GroupCover({ id, name, keys }: { id: string; name: string; keys: string[] }) {
  if (keys.length === 0) {
    return (
      <div className={cn('flex h-full w-full items-center justify-center bg-gradient-to-br', gradientFor(id))}>
        <span className="text-5xl font-bold text-white/90 drop-shadow-sm">{(name.trim()[0] ?? '?').toUpperCase()}</span>
      </div>
    );
  }
  if (keys.length < 3) return <Img storageKey={keys[0]} />;
  return (
    <div className="grid h-full w-full grid-cols-3 grid-rows-2 gap-0.5 bg-white">
      <div className="col-span-2 row-span-2 overflow-hidden">
        <Img storageKey={keys[0]} />
      </div>
      <div className="overflow-hidden">
        <Img storageKey={keys[1]} />
      </div>
      <div className="overflow-hidden">
        <Img storageKey={keys[2]} />
      </div>
    </div>
  );
}
