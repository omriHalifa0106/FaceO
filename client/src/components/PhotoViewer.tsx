// src/components/PhotoViewer.tsx — full photo with face boxes and tag management
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, EyeOff, ExternalLink, RefreshCw, Trash2, Undo2, UserMinus } from 'lucide-react';
import { Tag as TagApi, Photo as PhotoApi, PhotoHide } from '@/api/entities';
import { processPhoto } from '@/lib/guestResolution';
import { downloadSinglePhoto } from '@/lib/download';
import { r2PublicUrl } from '@/lib/supabaseClient';
import { usePhotoDetails } from '@/hooks/usePhotoDetails';
import { Badge, Button, ErrorBanner, Modal, Spinner, SuccessBanner, cn, formatDate } from '@/components/ui';
import type { AppError } from '@/lib/result';
import { useI18n } from '@/i18n/I18nProvider';
import type { Dict } from '@/i18n/en';
import type { EventGuest, GroupMember, MemberRole, Photo, TagWithPerson, UUID } from '@/types';

export interface ViewerContext {
  myUserId: UUID;
  myRole: MemberRole;
  members: GroupMember[];
  guests: EventGuest[];
}

function personLabel(tag: TagWithPerson, tr: Dict): string {
  if (tag.user) return tag.user.full_name || tr.common.member;
  if (tag.guest) return tag.guest.display_name || tr.common.guestName(tag.guest.guest_number);
  return tr.common.unknown;
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
  const [actionError, setActionErrorState] = useState<{ photoId: UUID; error: AppError } | null>(null);
  const [notice, setNoticeState] = useState<{ photoId: UUID; text: string } | null>(null);
  const { t: tr, dir } = useI18n();

  // Tags for this photo (cached; neighbours prefetched) — never the previous photo's.
  const details = usePhotoDetails(photo?.id ?? null, [
    index !== null ? photos[index - 1]?.id : null,
    index !== null ? photos[index + 1]?.id : null,
  ]);
  const tagList = details.data?.tags ?? [];
  const requestList = details.data?.requests ?? [];

  // Show face boxes only once THIS photo's image is on screen.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  // Warm the browser cache with the neighbouring originals.
  const prevKey = index !== null ? photos[index - 1]?.storage_key : undefined;
  const nextKey = index !== null ? photos[index + 1]?.storage_key : undefined;
  useEffect(() => {
    for (const key of [prevKey, nextKey]) {
      const src = r2PublicUrl(key);
      if (src) new Image().src = src;
    }
  }, [prevKey, nextKey]);

  const prev = useCallback(() => index !== null && index > 0 && onIndexChange(index - 1), [index, onIndexChange]);
  const next = useCallback(
    () => index !== null && index < photos.length - 1 && onIndexChange(index + 1),
    [index, photos.length, onIndexChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT') return;
      // In RTL the "next" photo is to the left.
      const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === back) prev();
      if (e.key === forward) next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, prev, next, dir]);

  if (!photo) return null;

  const url = r2PublicUrl(photo.storage_key) ?? '';
  const thumbUrl = r2PublicUrl(photo.thumb_key);
  const imageReady = loadedUrl === url;
  const setActionError = (error: AppError | null) => setActionErrorState(error ? { photoId: photo.id, error } : null);
  const setNotice = (text: string | null) => setNoticeState(text ? { photoId: photo.id, text } : null);
  const currentError = actionError?.photoId === photo.id ? actionError.error : null;
  const currentNotice = notice?.photoId === photo.id ? notice.text : null;
  const isAdmin = context.myRole === 'owner' || context.myRole === 'admin';
  const canDeletePhoto = isAdmin || photo.uploaded_by === context.myUserId;
  const taggedUserIds = new Set(tagList.map((t) => t.user_id).filter(Boolean));

  const run = async (key: string, action: () => Promise<{ error: AppError | null }>, after: 'tags' | 'deleted' | 'none' = 'tags') => {
    setBusy(key);
    setActionError(null);
    setNotice(null);
    const res = await action();
    setBusy(null);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    if (after === 'none') return;
    if (after === 'tags') await details.refresh();
    onChanged(after, photo.id);
  };

  const myRequest = requestList.find((r) => r.user_id === context.myUserId) ?? null;
  const otherRequests = requestList.filter((r) => r.user_id !== context.myUserId);

  const onHideMe = () => {
    if (
      !window.confirm(
        tr.viewer.hideMeConfirm,
      )
    )
      return;
    void run('hide', () => PhotoHide.hideMe(photo.id));
  };

  const onAssign = (tag: TagWithPerson, value: string) => {
    if (value === '__new') return run(tag.id, () => TagApi.splitToNewGuest(tag.id));
    if (value === '__none') return run(tag.id, () => TagApi.assign(tag.id, null));
    const [kind, id] = value.split(':');
    return run(tag.id, async () => {
      const res = await TagApi.assign(tag.id, kind === 'u' ? { userId: id } : { guestId: id });
      // Tagging yourself teaches the matcher; tell the user what it found.
      if (!res.error && kind === 'u' && id === context.myUserId) {
        setNotice(tr.viewer.learned(res.data));
      }
      return res;
    });
  };

  const onDeletePhoto = () => {
    if (!window.confirm(tr.viewer.deleteConfirm)) return;
    void run('delete', () => PhotoApi.remove(photo.id), 'deleted');
  };

  const onRescan = () => run('rescan', () => processPhoto(photo, undefined, { forceFaces: true }));

  return (
    <Modal open={open} onClose={onClose} wide title={<span className="text-sm text-slate-500">{formatDate(photo.created_at)}</span>}>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        {/* Photo with face boxes */}
        <div className="relative flex items-center justify-center rounded-xl bg-slate-900">
          <div className="relative inline-block">
            {!imageReady && thumbUrl && (
              <img src={thumbUrl} alt="" className="block h-[70vh] max-h-[70vh] max-w-full object-contain blur-[1px]" />
            )}
            <img
              key={photo.id}
              src={url}
              alt=""
              onLoad={() => setLoadedUrl(url)}
              className={cn('block max-h-[70vh] max-w-full', !imageReady && (thumbUrl ? 'hidden' : 'invisible'))}
            />
            {imageReady && tagList.map((t) => (
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
                  {personLabel(t, tr)}
                </span>
              </div>
            ))}
          </div>
          {index! > 0 && (
            <button onClick={prev} className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 hover:bg-white" aria-label={tr.common.previous}>
              <ChevronLeft size={20} className="rtl:-scale-x-100" />
            </button>
          )}
          {index! < photos.length - 1 && (
            <button onClick={next} className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 hover:bg-white" aria-label={tr.common.next}>
              <ChevronRight size={20} className="rtl:-scale-x-100" />
            </button>
          )}
        </div>

        {/* Faces / tags */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">{tr.viewer.peopleInPhoto}</h3>
            {photo.face_status !== 'done' ? <Badge tone="amber">{tr.viewer.notScanned}</Badge> : <Badge>{tr.common.faces(tagList.length)}</Badge>}
          </div>
          <ErrorBanner error={details.error || currentError} />
          {currentNotice && <SuccessBanner>{currentNotice}</SuccessBanner>}
          {!details.data && !details.error ? (
            <Spinner />
          ) : tagList.length === 0 ? (
            <p className="text-sm text-slate-500">
              {photo.face_status === 'done' ? tr.viewer.noFacesFound : tr.viewer.notDetectedYet}
            </p>
          ) : (
            <ul className="space-y-2">
              {tagList.map((t) => {
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
                        aria-label={tr.people.whoIsThis}
                      >
                        <optgroup label={tr.viewer.optMembers}>
                          {context.members
                            .filter((m) => m.user_id === t.user_id || !taggedUserIds.has(m.user_id))
                            .map((m) => (
                              <option key={m.user_id} value={`u:${m.user_id}`}>
                                {m.user?.full_name || tr.common.member}
                                {m.user_id === context.myUserId ? ` (${tr.common.me})` : ''}
                              </option>
                            ))}
                        </optgroup>
                        <optgroup label={tr.viewer.optGuests}>
                          {context.guests.map((g) => (
                            <option key={g.id} value={`g:${g.id}`}>
                              {g.display_name || tr.common.guestName(g.guest_number)}
                            </option>
                          ))}
                        </optgroup>
                        <option value="__new">{tr.viewer.optNewGuest}</option>
                        <option value="__none">{tr.viewer.optUnknown}</option>
                      </select>
                      {canRemove && (
                        <button
                          onClick={() => void run(t.id, () => TagApi.remove(t.id))}
                          disabled={busy === t.id}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title={tr.viewer.removeTag}
                        >
                          <UserMinus size={16} />
                        </button>
                      )}
                    </div>
                    {t.source === 'auto' && t.match_distance != null && (
                      <p className="mt-1 text-[11px] text-slate-400">{tr.viewer.autoMatched(t.match_distance.toFixed(2))}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Hide me / removal requests */}
          {myRequest ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <span>{tr.viewer.youAskedRemoval}</span>
              <Button variant="ghost" className="py-1" loading={busy === 'unhide'} onClick={() => void run('unhide', () => PhotoHide.unhideMe(photo.id))}>
                <Undo2 size={15} className="rtl:-scale-x-100" /> {tr.viewer.undo}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" className="w-full" loading={busy === 'hide'} onClick={onHideMe}>
              <EyeOff size={15} /> {tr.viewer.hideMe}
            </Button>
          )}
          {canDeletePhoto && otherRequests.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">{tr.viewer.removalRequested}</p>
              <p className="mt-0.5">
                {tr.viewer.removalRequestedBody(otherRequests.map((r) => r.user?.full_name || tr.viewer.aMember).join(', '))}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-teal-400">
              <ExternalLink size={15} /> {tr.viewer.original}
            </a>
            <Button variant="secondary" loading={busy === 'download'} onClick={() => void run('download', () => downloadSinglePhoto(photo), 'none')}>
              <Download size={15} /> {tr.download.single}
            </Button>
            <Button variant="secondary" onClick={() => void onRescan()} loading={busy === 'rescan'} title={tr.viewer.rescanTitle}>
              <RefreshCw size={15} /> {tr.viewer.rescan}
            </Button>
            {canDeletePhoto && (
              <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={onDeletePhoto} loading={busy === 'delete'}>
                <Trash2 size={15} /> {tr.common.delete}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
