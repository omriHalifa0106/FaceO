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
import { GroupForm } from '@/pages/Groups';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBanner, Modal, PageHeader, Spinner, SuccessBanner, cn, formatDate } from '@/components/ui';
import type { AppError } from '@/lib/result';
import type { MemberRole, Photo as PhotoRow, PhotoFilter, UUID } from '@/types';

const PAGE_SIZE = 60;
const TABS = [
  { id: 'photos', label: 'Photos', icon: Images },
  { id: 'people', label: 'People', icon: UserCircle },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'invite', label: 'Invite', icon: Link2 },
] as const;
type TabId = (typeof TABS)[number]['id'] | 'settings';

const FILTERS: Array<{ id: PhotoFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: "I'm in" },
  { id: 'with_others', label: 'Me with others' },
  { id: 'no_faces', label: 'No people' },
];

export default function GroupDetails() {
  const { groupId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabId) || 'photos';
  const { group, members, guests, viewerContext, isAdmin } = useGroupData(groupId);

  if (group.loading && !group.data) return <Spinner />;
  if (group.error || !group.data) {
    return (
      <div className="space-y-4">
        <Link to="/groups" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-600"><ArrowLeft size={16} /> Groups</Link>
        <ErrorBanner error={group.error ?? 'Group not found'} />
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
      <Link to="/groups" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-600"><ArrowLeft size={16} /> Groups</Link>
      <PageHeader
        title={g.name}
        subtitle={
          <span className="flex flex-wrap gap-x-3">
            {g.event_date && <span>{formatDate(g.event_date)}</span>}
            {g.location && <span>{g.location}</span>}
            <span>{g.member_count} members · {g.photo_count} photos</span>
          </span>
        }
        actions={isAdmin && <Button variant="secondary" onClick={() => setParams({ tab: 'settings' })}>Settings</Button>}
      />
      {g.description && <p className="-mt-3 mb-5 max-w-3xl whitespace-pre-line text-sm text-slate-600">{g.description}</p>}

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
            className={cn(
              '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium',
              tab === t.id ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'photos' && viewerContext && <PhotosTab groupId={groupId} context={viewerContext} onChanged={refreshCounts} />}
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
function PhotosTab({ groupId, context, onChanged }: { groupId: UUID; context: NonNullable<ReturnType<typeof useGroupData>['viewerContext']>; onChanged: () => void }) {
  const [filter, setFilter] = useState<PhotoFilter>('all');
  const list = usePaged<PhotoRow>((page) => Photo.listByGroup(groupId, filter, page), [groupId, filter], PAGE_SIZE);
  const photos = list.items;
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scan, setScan] = useState<BatchProgress | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanError, setScanError] = useState<AppError | null>(null);
  const scanAbort = useRef<AbortController | null>(null);

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
        scanned.length ? `scanned ${scanned.length} photo(s), found ${faces} face(s)` : null,
        thumbs ? `created ${thumbs} thumbnail(s)` : null,
        failed.length ? `${failed.length} failed` : null,
      ].filter(Boolean);
      setScanMessage(parts.length ? `Done: ${parts.join(', ')}.` : 'Nothing to do.');
    }
    refresh();
  };

  const pendingCount = pending.data?.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-sm font-medium transition',
                filter === f.id ? 'bg-teal-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-teal-400',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button onClick={() => setUploadOpen(true)}><Upload size={16} /> Upload</Button>
      </div>

      {pendingCount > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-100 bg-amber-50/60">
          <div className="flex items-center gap-2 text-sm text-amber-900">
            <ScanFace size={18} />
            {scan ? `Scanning ${scan.done}/${scan.total}…` : `${pendingCount} photo(s) still need processing (face scan or thumbnail).`}
          </div>
          {scan ? (
            <Button variant="secondary" onClick={() => scanAbort.current?.abort()}>Stop</Button>
          ) : (
            <Button variant="secondary" onClick={() => void runScan()}><RefreshCw size={15} /> Scan now</Button>
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
        <EmptyState icon={<Images size={40} />} title={filter === 'all' ? 'No photos yet' : 'No photos match this filter'}>
          {filter === 'mine' || filter === 'with_others'
            ? 'Make sure your face profile is set up (Profile & face), then scan the photos.'
            : 'Upload the first photos of this event.'}
        </EmptyState>
      ) : (
        <>
          <PhotoGrid photos={photos} onOpen={(_, i) => setViewIndex(i)} />
          {list.hasMore && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={list.loadingMore} onClick={() => void list.loadMore()}>Load more</Button>
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

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload photos">
        <UploadPanel groupId={groupId} onUploaded={refresh} />
      </Modal>
    </div>
  );
}

// =============================================================================
function PeopleTab({ groupId }: { groupId: UUID }) {
  const people = useAsync(() => Group.people(groupId), [groupId]);
  if (people.loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <ErrorBanner error={people.error} onRetry={() => void people.reload()} />
      {!people.data?.length ? (
        <EmptyState icon={<UserCircle size={40} />} title="No faces found yet">
          Upload photos and scan them; everyone who appears gets a folder here.
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
                <Avatar name={p.name} avatarKey={p.avatar_key} size={96} />
              ) : (
                <FaceThumb storageKey={p.sample_storage_key} thumbKey={p.sample_thumb_key} box={p.sample_box} size={96} alt={p.name} className="rounded-full" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                <p className="text-xs text-slate-500">{p.photo_count} photo{p.photo_count === 1 ? '' : 's'}</p>
              </div>
              {p.kind === 'guest' && <Badge tone="amber">Guest</Badge>}
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
          const name = m.user?.full_name || 'Member';
          return (
            <div key={m.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Avatar name={name} avatarKey={m.user?.avatar_key} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{name}{isMe && ' (you)'}</p>
                <p className="text-xs text-slate-500">
                  Joined {formatDate(m.joined_at)} · {m.user?.face_enrolled_at ? 'face recognition on' : 'no face profile'}
                </p>
              </div>
              {myRole === 'owner' && !isMe ? (
                <select
                  value={m.role}
                  disabled={busy === m.user_id}
                  onChange={(e) => void act(m.user_id, () => Group.setMemberRole(groupId, m.user_id, e.target.value as MemberRole))}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              ) : (
                <Badge tone={m.role === 'member' ? 'slate' : 'teal'}>{m.role}</Badge>
              )}
              {isAdmin && !isMe && m.role !== 'owner' && (
                <button
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title="Remove from group"
                  disabled={busy === m.user_id}
                  onClick={() => window.confirm(`Remove ${name} from the group?`) && void act(m.user_id, () => Group.removeMember(groupId, m.user_id))}
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
          window.confirm('Leave this group? You will lose access to its photos.') &&
          void act('leave', () => Group.leave(groupId), () => navigate('/groups', { replace: true }))
        }
      >
        <LogOut size={16} /> Leave group
      </Button>
    </div>
  );
}

// =============================================================================
function InviteTab({ groupId, token, isAdmin, onReset }: { groupId: UUID; token: string; isAdmin: boolean; onReset: () => void }) {
  const url = Group.inviteUrl(token);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError({ message: 'Copy failed — select the link and copy it manually.', code: null });
    }
  };

  const reset = async () => {
    if (!window.confirm('Create a new link? The current link will stop working.')) return;
    setBusy(true);
    const res = await Group.regenerateInvite(groupId);
    setBusy(false);
    if (res.error) setError(res.error);
    else onReset();
  };

  return (
    <Card className="max-w-2xl space-y-4">
      <p className="text-sm text-slate-600">
        Anyone with this link can join and see all photos in this group. When they join, photos they already appear in are linked to them automatically.
      </p>
      <ErrorBanner error={error} />
      <div className="flex gap-2">
        <input readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" />
        <Button onClick={() => void copy()}><Copy size={16} /> {copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {'share' in navigator && (
          <Button variant="secondary" onClick={() => void navigator.share({ title: 'Join on FaceO', url }).catch(() => {})}>
            <Share2 size={16} /> Share
          </Button>
        )}
        {isAdmin && (
          <Button variant="ghost" loading={busy} onClick={() => void reset()}>
            <RefreshCw size={16} /> Reset link
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

  const remove = async () => {
    if (!window.confirm('Delete this group and ALL of its photos for everyone? This cannot be undone.')) return;
    setDeleting(true);
    const res = await Group.remove(groupId);
    setDeleting(false);
    if (res.error) setError(res.error);
    else navigate('/groups', { replace: true });
  };

  return (
    <div className="max-w-xl space-y-6">
      <Card>
        {saved && <div className="mb-4"><SuccessBanner>Saved.</SuccessBanner></div>}
        <GroupForm
          initial={initial}
          submitLabel="Save changes"
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
          <h3 className="mb-1 font-semibold text-red-700">Danger zone</h3>
          <p className="mb-4 text-sm text-slate-600">Deletes the group, all photos (including the files in storage), faces and guests.</p>
          <ErrorBanner error={error} />
          <Button variant="danger" loading={deleting} onClick={() => void remove()} className="mt-2"><Trash2 size={16} /> Delete group</Button>
        </Card>
      )}
    </div>
  );
}
