// src/pages/FolderScreen.tsx — all photos of one person (member or guest) in a group,
// plus guest management: rename, identify as a member, merge with another guest.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Merge, Pencil, Trash2, UserCheck } from 'lucide-react';
import { EventGuest, Photo } from '@/api/entities';
import { usePaged } from '@/hooks/usePaged';
import { useGroupData } from '@/hooks/useGroupData';
import PhotoGrid from '@/components/PhotoGrid';
import PhotoViewer from '@/components/PhotoViewer';
import { Avatar, Badge, Button, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Spinner } from '@/components/ui';
import type { AppError } from '@/lib/result';
import { useI18n } from '@/i18n/I18nProvider';
import type { PersonRef, Photo as PhotoRow } from '@/types';

export default function FolderScreen() {
  const { groupId = '', kind, personId = '' } = useParams();
  const navigate = useNavigate();
  const isGuest = kind === 'guest';
  const { t } = useI18n();
  const person: PersonRef = isGuest ? { guestId: personId } : { userId: personId };
  const { group, members, guests, viewerContext, isAdmin } = useGroupData(groupId);
  const photos = usePaged<PhotoRow>((page) => Photo.listByPerson(groupId, person, page), [groupId, kind, personId]);
  const list = photos.items;
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [dialog, setDialog] = useState<'rename' | 'identify' | 'merge' | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const guest = useMemo(() => guests.data?.find((g) => g.id === personId) ?? null, [guests.data, personId]);
  const member = useMemo(() => members.data?.find((m) => m.user_id === personId) ?? null, [members.data, personId]);
  const name = isGuest
    ? guest?.display_name || (guest ? t.common.guestName(guest.guest_number) : t.common.guest)
    : member?.user?.full_name || t.common.member;

  const backTo = `/groups/${groupId}?tab=people`;

  const doAction = async (fn: () => Promise<{ error: AppError | null }>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res.error) return setError(res.error);
    setDialog(null);
    after?.();
  };

  if (group.loading || (isGuest && guests.loading) || (!isGuest && members.loading)) return <Spinner />;
  if (group.error) return <ErrorBanner error={group.error} />;
  if (isGuest && !guest) {
    return (
      <div className="space-y-4">
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-600"><ArrowLeft size={16} className="rtl:-scale-x-100" /> {t.people.backToPeople}</Link>
        <EmptyState title={t.people.guestGone}>{t.people.guestGoneBody}</EmptyState>
      </div>
    );
  }

  return (
    <div>
      <Link to={backTo} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-600">
        <ArrowLeft size={16} className="rtl:-scale-x-100" /> {group.data?.name ?? t.groups.backToGroups} · {t.people.backToPeople}
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {!isGuest && <Avatar name={name} avatarKey={member?.user?.avatar_key} size={44} />}
            {name}
            {isGuest && <Badge tone="amber">{t.people.guestBadge}</Badge>}
          </span>
        }
        subtitle={t.common.photos(list.length)}
        actions={
          isGuest && (
            <>
              <Button variant="secondary" onClick={() => setDialog('rename')}><Pencil size={15} /> {t.people.nameAction}</Button>
              <Button variant="secondary" onClick={() => setDialog('identify')}><UserCheck size={15} /> {t.people.isMember}</Button>
              <Button variant="secondary" onClick={() => setDialog('merge')}><Merge size={15} /> {t.people.sameAs}</Button>
              {isAdmin && (
                <Button
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() =>
                    window.confirm(t.people.deleteGuestConfirm) &&
                    void doAction(() => EventGuest.remove(personId), () => navigate(backTo, { replace: true }))
                  }
                >
                  <Trash2 size={15} />
                </Button>
              )}
            </>
          )
        }
      />
      <ErrorBanner error={error || photos.error} />

      {photos.loading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState title={t.people.noPhotos} />
      ) : (
        <>
          <PhotoGrid photos={list} onOpen={(_, i) => setViewIndex(i)} />
          {photos.hasMore && (
            <div className="mt-5 flex justify-center">
              <Button variant="secondary" loading={photos.loadingMore} onClick={() => void photos.loadMore()}>{t.common.loadMore}</Button>
            </div>
          )}
        </>
      )}

      {viewerContext && (
        <PhotoViewer
          photos={list}
          index={viewIndex}
          onIndexChange={setViewIndex}
          onClose={() => setViewIndex(null)}
          context={viewerContext}
          onChanged={(k, photoId) => {
            if (k === 'deleted') {
              photos.removeWhere((p) => p.id === photoId);
              setViewIndex(null);
            }
            void guests.reload();
          }}
        />
      )}

      {isGuest && guest && (
        <>
          <RenameDialog
            key={guest.display_name ?? ''}
            open={dialog === 'rename'}
            initial={guest.display_name ?? ''}
            busy={busy}
            onClose={() => setDialog(null)}
            onSave={(value) => doAction(() => EventGuest.rename(personId, value), () => void guests.reload())}
          />
          <Modal open={dialog === 'identify'} onClose={() => setDialog(null)} title={t.people.whoIsThis}>
            <p className="mb-4 text-sm text-slate-600">{t.people.identifyBody(list.length)}</p>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {(members.data ?? []).map((m) => (
                <button
                  key={m.user_id}
                  disabled={busy}
                  onClick={() =>
                    void doAction(
                      () => EventGuest.merge(personId, { userId: m.user_id }),
                      () => navigate(`/groups/${groupId}/people/member/${m.user_id}`, { replace: true }),
                    )
                  }
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start hover:bg-teal-50"
                >
                  <Avatar name={m.user?.full_name ?? ''} avatarKey={m.user?.avatar_key} size={32} />
                  <span className="text-sm font-medium">{m.user?.full_name || t.common.member}</span>
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-500">{t.people.identifyTip}</p>
          </Modal>
          <Modal open={dialog === 'merge'} onClose={() => setDialog(null)} title={t.people.mergeTitle}>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {(guests.data ?? [])
                .filter((g) => g.id !== personId)
                .map((g) => (
                  <button
                    key={g.id}
                    disabled={busy}
                    onClick={() =>
                      void doAction(
                        () => EventGuest.merge(personId, { guestId: g.id }),
                        () => navigate(`/groups/${groupId}/people/guest/${g.id}`, { replace: true }),
                      )
                    }
                    className="w-full rounded-xl px-3 py-2 text-start text-sm font-medium hover:bg-teal-50"
                  >
                    {g.display_name || t.common.guestName(g.guest_number)}
                  </button>
                ))}
              {(guests.data ?? []).length <= 1 && <p className="text-sm text-slate-500">{t.people.noOtherGuests}</p>}
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

function RenameDialog({
  open,
  initial,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: string;
  busy: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={t.people.renameTitle}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value);
        }}
        className="space-y-4"
      >
        <Field label={t.common.name} hint={t.people.renameHint}>
          <Input autoFocus maxLength={100} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button type="submit" loading={busy} className="w-full">{t.common.save}</Button>
      </form>
    </Modal>
  );
}
