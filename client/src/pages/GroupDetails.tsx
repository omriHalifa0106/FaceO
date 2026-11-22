// src/pages/GroupDetails.tsx — one group/event: photos, people, members, invite, settings
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, Images, Link2, LogOut, RefreshCw, ScanFace, Share2, Trash2, Upload, UserCircle, Users } from 'lucide-react';
import { Group, Photo } from '@/api/entities';
import { processPendingPhotos, type BatchProgress } from '@/lib/guestResolution';
import { useAsync } from '@/hooks/useAsync';
import { usePaged } from '@/hooks/usePaged';
import { useGroupData } from '@/hooks/useGroupData';
import { useAuth } from '@/context/AuthContext';
import PhotoGrid from '@/components/PhotoGrid';
import PhotoViewer from '@/components/PhotoViewer';
import UploadPanel from '@/components/UploadPanel';
import FaceThumb from '@/components/FaceThumb';
import DownloadPhotosButton from '@/components/DownloadPhotosButton';
import { collectAllPages } from '@/lib/download';
import { GroupForm } from '@/pages/Groups';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBanner, Modal, PageHeader, Spinner, SuccessBanner, cn, formatDate } from '@/components/ui';
import type { AppError } from '@/lib/result';
import { useI18n } from '@/i18n/I18nProvider';
import type { MemberRole, Photo as PhotoRow, PhotoFilter, UUID } from '@/types';

const PAGE_SIZE = 60;
const TABS = [
  { id: 'photos', icon: Images },
  { id: 'people', icon: UserCircle },
  { id: 'members', icon: Users },
  { id: 'invite', icon: Link2 },
] as const;
type TabId = (typeof TABS)[number]['id'] | 'settings';

const FILTERS: PhotoFilter[] = ['all', 'mine', 'with_others', 'no_faces'];
/** Only uploaders/admins can see others' removal requests; admins get a dedicated filter. */
const ADMIN_FILTERS: PhotoFilter[] = ['removal_requests'];

export default function GroupDetails() {
  const { groupId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabId) || 'photos';
  const { group, members, guests, viewerContext, isAdmin } = useGroupData(groupId);
  const { t } = useI18n();
  const back = (
    <Link to="/groups" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-600">
      <ArrowLeft size={16} className="rtl:-scale-x-100" /> {t.groups.backToGroups}
    </Link>
  );

  if (group.loading && !group.data) return <Spinner />;
  if (group.error || !group.data) {
    return (
      <div className="space-y-4">
        {back}
        <ErrorBanner error={group.error ?? t.groups.notFound} />
      </div>
    );
  }
  const g = group.data;

  const refreshCounts = () => {
    void group.reload();
    void guests.reload();
  };

  return (
    <div>
      {back}
      <PageHeader
        title={g.name}
        subtitle={
          <span className="flex flex-wrap gap-x-3">
            {g.event_date && <span>{formatDate(g.event_date)}</span>}
            {g.location && <span>{g.location}</span>}
            <span>{t.groups.stats(g.member_count, g.photo_count)}</span>
          </span>
        }
        actions={isAdmin && <Button variant="secondary" onClick={() => setParams({ tab: 'settings' })}>{t.groups.settings}</Button>}
      />
      {g.description && <p className="-mt-3 mb-5 max-w-3xl whitespace-pre-line text-sm text-slate-600">{g.description}</p>}

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((tabDef) => (
          <button
            key={tabDef.id}
            onClick={() => setParams({ tab: tabDef.id }, { replace: true })}
            className={cn(
              '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium',
              tab === tabDef.id ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <tabDef.icon size={16} /> {t.groups.tabs[tabDef.id]}
          </button>
        ))}
      </div>

      {tab === 'photos' && viewerContext && <PhotosTab groupId={groupId} groupName={g.name} context={viewerContext} onChanged={refreshCounts} />}
      {tab === 'people' && <PeopleTab groupId={groupId} />}
      {tab === 'members' && (
        <MembersTab groupId={groupId} myRole={g.my_role} members={members.data ?? []} error={members.error} onChanged={() => { void members.reload(); void group.reload(); }} />
      )}
      {tab === 'invite' && <InviteTab groupId={groupId} token={g.invite_token} isAdmin={isAdmin} onReset={() => void group.reload()} />}
      {tab === 'settings' && isAdmin && <SettingsTab groupId={groupId} myRole={g.my_role} initial={g} onSaved={() => void group.reload()} />}
    </div>
  );
}

// =============================================================================
function PhotosTab({
  groupId,
  groupName,
  context,
  onChanged,
}: {
  groupId: UUID;
  groupName: string;
  context: NonNullable<ReturnType<typeof useGroupData>['viewerContext']>;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<PhotoFilter>('all');
  const list = usePaged<PhotoRow>((page) => Photo.listByGroup(groupId, filter, page), [groupId, filter], PAGE_SIZE);
  const photos = list.items;
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scan, setScan] = useState<BatchProgress | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanError, setScanError] = useState<AppError | null>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const { t } = useI18n();

  const pending = useAsync(() => Photo.listUnprocessed(groupId, 500), [groupId]);

  useEffect(() => () => scanAbort.current?.abort(), []);

  const refresh = () => {
    void list.reload();
    void pending.reload();
    onChanged();
  };

  const runScan = async () => {
    const controller = new AbortController();
    scanAbort.current = controller;
    setScanError(null);
    setScanMessage(null);
    const res = await processPendingPhotos(groupId, { onProgress: setScan, signal: controller.signal });
    setScan(null);
    if (res.error) setScanError(res.error);
    else {
      const { processed, failed } = res.data;
      const scanned = processed.filter((p) => p.faces !== null);
      const faces = scanned.reduce((s, p) => s + (p.faces ?? 0), 0);
      const thumbs = processed.filter((p) => p.thumbnail === 'created').length;
      const parts = [
        scanned.length ? t.photos.scanPartScanned(scanned.length, faces) : null,
        thumbs ? t.photos.scanPartThumbs(thumbs) : null,
        failed.length ? t.photos.scanPartFailed(failed.length) : null,
      ].filter((x): x is string => !!x);
      setScanMessage(t.photos.scanDone(parts));
    }
    refresh();
  };

  const pendingCount = pending.data?.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {[...FILTERS, ...(context.myRole === 'member' ? [] : ADMIN_FILTERS)].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-sm font-medium transition',
                filter === f ? 'bg-teal-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-teal-400',
              )}
            >
              {t.photos.filters[f]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {filter !== 'removal_requests' && (
            <DownloadPhotosButton
              key={filter}
              label={t.download.groupButton[filter]}
              zipName={t.download.groupZip(groupName, filter)}
              load={() => collectAllPages((page) => Photo.listByGroup(groupId, filter, page))}
            />
          )}
          <Button onClick={() => setUploadOpen(true)}><Upload size={16} /> {t.photos.upload}</Button>
        </div>
      </div>

      {pendingCount > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-100 bg-amber-50/60">
          <div className="flex items-center gap-2 text-sm text-amber-900">
            <ScanFace size={18} />
            {scan ? t.photos.scanning(scan.done, scan.total) : t.photos.pending(pendingCount)}
          </div>
          {scan ? (
            <Button variant="secondary" onClick={() => scanAbort.current?.abort()}>{t.photos.stop}</Button>
          ) : (
            <Button variant="secondary" onClick={() => void runScan()}><RefreshCw size={15} /> {t.photos.scanNow}</Button>
          )}
        </Card>
      )}
      {scan && (
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-teal-500 transition-all" style={{ width: `${scan.total ? (scan.done / scan.total) * 100 : 0}%` }} />
        </div>
      )}
      <ErrorBanner error={scanError || list.error} onRetry={list.error ? () => void list.reload() : undefined} />
      {scanMessage && <SuccessBanner>{scanMessage}</SuccessBanner>}

      {list.loading && photos.length === 0 ? (
        <Spinner />
      ) : photos.length === 0 ? (
        <EmptyState icon={<Images size={40} />} title={filter === 'all' ? t.photos.emptyAll : t.photos.emptyFiltered}>
          {filter === 'mine' || filter === 'with_others'
            ? t.photos.emptyMineHint
            : t.photos.emptyUploadHint}
        </EmptyState>
      ) : (
        <>
          <PhotoGrid photos={photos} onOpen={(_, i) => setViewIndex(i)} />
          {list.hasMore && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={list.loadingMore} onClick={() => void list.loadMore()}>{t.common.loadMore}</Button>
            </div>
          )}
        </>
      )}

      <PhotoViewer
        photos={photos}
        index={viewIndex}
        onIndexChange={setViewIndex}
        onClose={() => setViewIndex(null)}
        context={context}
        onChanged={(kind, photoId) => {
          if (kind === 'deleted') {
            list.removeWhere((p) => p.id === photoId);
            setViewIndex(null);
          }
          onChanged();
          void pending.reload();
        }}
      />

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title={t.photos.uploadTitle}>
        <UploadPanel groupId={groupId} onUploaded={refresh} />
      </Modal>
    </div>
  );
}

// =============================================================================
function PeopleTab({ groupId }: { groupId: UUID }) {
  const people = useAsync(() => Group.people(groupId), [groupId]);
  const { t } = useI18n();
  // Unnamed guests come from SQL as "Guest N"; render them in the UI language.
  const displayName = (name: string) => {
    const m = name.match(/^Guest (\d+)$/);
    return m ? t.common.guestName(Number(m[1])) : name;
  };
  if (people.loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <ErrorBanner error={people.error} onRetry={() => void people.reload()} />
      {!people.data?.length ? (
        <EmptyState icon={<UserCircle size={40} />} title={t.people.emptyTitle}>
          {t.people.emptyBody}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {people.data.map((p) => (
            <Link
              key={p.user_id ?? p.guest_id}
              to={`/groups/${groupId}/people/${p.kind}/${p.user_id ?? p.guest_id}`}
              className="flex flex-col items-center gap-2 rounded-2xl p-3 text-center transition hover:bg-white hover:shadow-sm"
            >
              {p.kind === 'member' && p.avatar_key ? (
                <Avatar name={displayName(p.name)} avatarKey={p.avatar_key} size={96} />
              ) : (
                <FaceThumb storageKey={p.sample_storage_key} thumbKey={p.sample_thumb_key} box={p.sample_box} size={96} alt={displayName(p.name)} className="rounded-full" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{displayName(p.name)}</p>
                <p className="text-xs text-slate-500">{t.common.photos(p.photo_count)}</p>
              </div>
              {p.kind === 'guest' && <Badge tone="amber">{t.people.guestBadge}</Badge>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
function MembersTab({
  groupId,
  myRole,
  members,
  error,
  onChanged,
}: {
  groupId: UUID;
  myRole: MemberRole;
  members: ReturnType<typeof useGroupData>['members']['data'] & object;
  error: AppError | null;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const { t } = useI18n();

  const act = async (key: string, fn: () => Promise<{ error: AppError | null }>, after?: () => void) => {
    setBusy(key);
    setActionError(null);
    const res = await fn();
    setBusy(null);
    if (res.error) setActionError(res.error);
    else (after ?? onChanged)();
  };

  return (
    <div className="space-y-4">
      <ErrorBanner error={error || actionError} />
      <Card className="divide-y divide-slate-100 p-0">
        {members.map((m) => {
          const isMe = m.user_id === user?.id;
          const name = m.user?.full_name || t.common.member;
          return (
            <div key={m.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Avatar name={name} avatarKey={m.user?.avatar_key} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{name}{isMe && ` (${t.common.you})`}</p>
                <p className="text-xs text-slate-500">
                  {t.members.joined(formatDate(m.joined_at))} · {m.user?.face_enrolled_at ? t.members.faceOn : t.members.faceOff}
                </p>
              </div>
              {myRole === 'owner' && !isMe ? (
                <select
                  value={m.role}
                  disabled={busy === m.user_id}
                  onChange={(e) => void act(m.user_id, () => Group.setMemberRole(groupId, m.user_id, e.target.value as MemberRole))}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
                >
                  <option value="member">{t.members.roles.member}</option>
                  <option value="admin">{t.members.roles.admin}</option>
                  <option value="owner">{t.members.roles.owner}</option>
                </select>
              ) : (
                <Badge tone={m.role === 'member' ? 'slate' : 'teal'}>{t.members.roles[m.role]}</Badge>
              )}
              {isAdmin && !isMe && m.role !== 'owner' && (
                <button
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title={t.members.removeTitle}
                  disabled={busy === m.user_id}
                  onClick={() => window.confirm(t.members.removeConfirm(name)) && void act(m.user_id, () => Group.removeMember(groupId, m.user_id))}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          );
        })}
      </Card>
      <Button
        variant="ghost"
        className="text-red-600 hover:bg-red-50"
        loading={busy === 'leave'}
        onClick={() =>
          window.confirm(t.members.leaveConfirm) &&
          void act('leave', () => Group.leave(groupId), () => navigate('/groups', { replace: true }))
        }
      >
        <LogOut size={16} className="rtl:-scale-x-100" /> {t.members.leave}
      </Button>
    </div>
  );
}

// =============================================================================
function InviteTab({ groupId, token, isAdmin, onReset }: { groupId: UUID; token: string; isAdmin: boolean; onReset: () => void }) {
  const url = Group.inviteUrl(token);
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError({ message: t.invite.copyFailed, code: null });
    }
  };

  const reset = async () => {
    if (!window.confirm(t.invite.resetConfirm)) return;
    setBusy(true);
    const res = await Group.regenerateInvite(groupId);
    setBusy(false);
    if (res.error) setError(res.error);
    else onReset();
  };

  return (
    <Card className="max-w-2xl space-y-4">
      <p className="text-sm text-slate-600">{t.invite.body}</p>
      <ErrorBanner error={error} />
      <div className="flex gap-2">
        <input readOnly dir="ltr" value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
        <Button onClick={() => void copy()}><Copy size={16} /> {copied ? t.invite.copied : t.invite.copy}</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {'share' in navigator && (
          <Button variant="secondary" onClick={() => void navigator.share({ title: t.invite.shareTitle, url }).catch(() => {})}>
            <Share2 size={16} /> {t.invite.share}
          </Button>
        )}
        {isAdmin && (
          <Button variant="ghost" loading={busy} onClick={() => void reset()}>
            <RefreshCw size={16} /> {t.invite.reset}
          </Button>
        )}
      </div>
    </Card>
  );
}

// =============================================================================
function SettingsTab({
  groupId,
  myRole,
  initial,
  onSaved,
}: {
  groupId: UUID;
  myRole: MemberRole;
  initial: Parameters<typeof GroupForm>[0]['initial'];
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const { t } = useI18n();

  const remove = async () => {
    if (!window.confirm(t.settings.deleteConfirm)) return;
    setDeleting(true);
    const res = await Group.remove(groupId);
    setDeleting(false);
    if (res.error) setError(res.error);
    else navigate('/groups', { replace: true });
  };

  return (
    <div className="max-w-xl space-y-6">
      <Card>
        {saved && <div className="mb-4"><SuccessBanner>{t.common.saved}</SuccessBanner></div>}
        <GroupForm
          initial={initial}
          submitLabel={t.settings.saveChanges}
          onSubmit={async (v) => {
            const res = await Group.update(groupId, v);
            if (res.error) return res.error;
            setSaved(true);
            onSaved();
            return null;
          }}
        />
      </Card>
      {myRole === 'owner' && (
        <Card className="border-red-100">
          <h3 className="mb-1 font-semibold text-red-700">{t.settings.dangerZone}</h3>
          <p className="mb-4 text-sm text-slate-600">{t.settings.dangerBody}</p>
          <ErrorBanner error={error} />
          <Button variant="danger" loading={deleting} onClick={() => void remove()} className="mt-2"><Trash2 size={16} /> {t.settings.deleteGroup}</Button>
        </Card>
      )}
    </div>
  );
}
