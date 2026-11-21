// src/components/PhotoViewer.tsx — full photo with face boxes and tag management
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Trash2, UserMinus } from 'lucide-react';
import { Tag as TagApi, Photo as PhotoApi } from '@/api/entities';
import { processPhotoFaces } from '@/lib/guestResolution';
import { r2PublicUrl } from '@/lib/supabaseClient';
import { useAsync } from '@/hooks/useAsync';
import { Badge, Button, ErrorBanner, Modal, Spinner, cn, formatDate } from '@/components/ui';
import type { AppError } from '@/lib/result';
import type { EventGuest, GroupMember, MemberRole, Photo, TagWithPerson, UUID } from '@/types';

export interface ViewerContext {
  myUserId: UUID;
  myRole: MemberRole;
  members: GroupMember[];
  guests: EventGuest[];
}

function personLabel(tag: TagWithPerson): string {
  if (tag.user) return tag.user.full_name || 'Member';
  if (tag.guest) return tag.guest.display_name || `Guest ${tag.guest.guest_number}`;
  return 'Unknown';
}

export default function PhotoViewer<P extends Photo>({
  photos,
  index,
  onIndexChange,
  onClose,
  context,
  onChanged,
}: {
  photos: P[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  context: ViewerContext;
  /** Called after tags/photo changed so the parent can refresh lists. */
  onChanged: (kind: 'tags' | 'deleted', photoId: UUID) => void;
}) {
  const photo = index !== null ? photos[index] : null;
  const open = photo !== null;
  const [hoverTag, setHoverTag] = useState<UUID | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const tags = useAsync(() => (photo ? TagApi.listByPhoto(photo.id) : Promise.resolve({ data: [], error: null })), [photo?.id]);

  const prev = useCallback(() => index !== null && index > 0 && onIndexChange(index - 1), [index, onIndexChange]);
  const next = useCallback(
    () => index !== null && index < photos.length - 1 && onIndexChange(index + 1),
    [index, photos.length, onIndexChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, prev, next]);

  if (!photo) return null;

  const url = r2PublicUrl(photo.storage_key) ?? '';
  const isAdmin = context.myRole === 'owner' || context.myRole === 'admin';
  const canDeletePhoto = isAdmin || photo.uploaded_by === context.myUserId;
  const taggedUserIds = new Set((tags.data ?? []).map((t) => t.user_id).filter(Boolean));

  const run = async (key: string, action: () => Promise<{ error: AppError | null }>, after: 'tags' | 'deleted' = 'tags') => {
    setBusy(key);
    setActionError(null);
    const res = await action();
    setBusy(null);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    if (after === 'tags') await tags.reload();
    onChanged(after, photo.id);
  };

  const onAssign = (tag: TagWithPerson, value: string) => {
    if (value === '__new') return run(tag.id, () => TagApi.splitToNewGuest(tag.id));
    if (value === '__none') return run(tag.id, () => TagApi.assign(tag.id, null));
    const [kind, id] = value.split(':');
    return run(tag.id, () => TagApi.assign(tag.id, kind === 'u' ? { userId: id } : { guestId: id }));
  };

  const onDeletePhoto = () => {
    if (!window.confirm('Delete this photo for everyone in the group?')) return;
    void run('delete', () => PhotoApi.remove(photo.id), 'deleted');
  };

  const onRescan = () => run('rescan', () => processPhotoFaces(photo));

  return (
    <Modal open={open} onClose={onClose} wide title={<span className="text-sm text-slate-500">{formatDate(photo.created_at)}</span>}>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        {/* Photo with face boxes */}
        <div className="relative flex items-center justify-center rounded-xl bg-slate-900">
          <div className="relative inline-block">
            <img src={url} alt="" className="block max-h-[70vh] max-w-full" />
            {(tags.data ?? []).map((t) => (
              <div
                key={t.id}
                onMouseEnter={() => setHoverTag(t.id)}
                onMouseLeave={() => setHoverTag(null)}
                className={cn(
                  'absolute rounded-md border-2 transition',
                  t.user_id ? 'border-teal-400' : t.guest_id ? 'border-amber-300' : 'border-white/70',
                  hoverTag === t.id && 'ring-4 ring-white/60',
                )}
                style={{ left: `${t.box.x * 100}%`, top: `${t.box.y * 100}%`, width: `${t.box.w * 100}%`, height: `${t.box.h * 100}%` }}
              >
                <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
                  {personLabel(t)}
                </span>
              </div>
            ))}
          </div>
          {index! > 0 && (
            <button onClick={prev} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 hover:bg-white" aria-label="Previous">
              <ChevronLeft size={20} />
            </button>
          )}
          {index! < photos.length - 1 && (
            <button onClick={next} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 hover:bg-white" aria-label="Next">
              <ChevronRight size={20} />
            </button>
          )}
        </div>

        {/* Faces / tags */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">People in this photo</h3>
            {photo.face_status !== 'done' ? <Badge tone="amber">Not scanned</Badge> : <Badge>{tags.data?.length ?? 0} faces</Badge>}
          </div>
          <ErrorBanner error={tags.error || actionError} />
          {tags.loading && !tags.data ? (
            <Spinner />
          ) : (tags.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">
              {photo.face_status === 'done' ? 'No faces were found in this photo.' : 'Faces have not been detected yet.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {(tags.data ?? []).map((t) => {
                const canRemove = isAdmin || t.user_id === context.myUserId || photo.uploaded_by === context.myUserId;
                const current = t.user_id ? `u:${t.user_id}` : t.guest_id ? `g:${t.guest_id}` : '__none';
                return (
                  <li
                    key={t.id}
                    onMouseEnter={() => setHoverTag(t.id)}
                    onMouseLeave={() => setHoverTag(null)}
                    className={cn('rounded-xl border p-2', hoverTag === t.id ? 'border-teal-300 bg-teal-50/50' : 'border-slate-100')}
                  >
                    <div className="flex items-center gap-2">
                      <select
                        value={current}
                        disabled={busy === t.id}
                        onChange={(e) => void onAssign(t, e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                        aria-label="Who is this?"
                      >
                        <optgroup label="Members">
                          {context.members
                            .filter((m) => m.user_id === t.user_id || !taggedUserIds.has(m.user_id))
                            .map((m) => (
                              <option key={m.user_id} value={`u:${m.user_id}`}>
                                {m.user?.full_name || 'Member'}
                                {m.user_id === context.myUserId ? ' (me)' : ''}
                              </option>
                            ))}
                        </optgroup>
                        <optgroup label="Guests">
                          {context.guests.map((g) => (
                            <option key={g.id} value={`g:${g.id}`}>
                              {g.display_name || `Guest ${g.guest_number}`}
                            </option>
                          ))}
                        </optgroup>
                        <option value="__new">+ Someone new (new guest)</option>
                        <option value="__none">Unknown</option>
                      </select>
                      {canRemove && (
                        <button
                          onClick={() => void run(t.id, () => TagApi.remove(t.id))}
                          disabled={busy === t.id}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Remove this face tag"
                        >
                          <UserMinus size={16} />
                        </button>
                      )}
                    </div>
                    {t.source === 'auto' && t.match_distance != null && (
                      <p className="mt-1 text-[11px] text-slate-400">Auto-matched · distance {t.match_distance.toFixed(2)}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-teal-400">
              <ExternalLink size={15} /> Original
            </a>
            <Button variant="secondary" onClick={() => void onRescan()} loading={busy === 'rescan'} title="Detect faces again">
              <RefreshCw size={15} /> Re-scan
            </Button>
            {canDeletePhoto && (
              <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={onDeletePhoto} loading={busy === 'delete'}>
                <Trash2 size={15} /> Delete
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
