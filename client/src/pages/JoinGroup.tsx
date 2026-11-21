// src/pages/JoinGroup.tsx — /join/:token (invite link)
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Calendar, Users } from 'lucide-react';
import { Group } from '@/api/entities';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import AuthShell from '@/components/AuthShell';
import { Button, ErrorBanner, Spinner, formatDate } from '@/components/ui';
import type { AppError } from '@/lib/result';

export default function JoinGroup() {
  const { token = '' } = useParams();
  const { isAuthenticated, isLoadingAuth, profile } = useAuth();
  const navigate = useNavigate();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const preview = useAsync(
    () => (isAuthenticated ? Group.invitePreview(token) : Promise.resolve({ data: null, error: null })),
    [token, isAuthenticated],
  );

  if (isLoadingAuth) return <Spinner />;
  // Sign in / sign up first, then come back here.
  if (!isAuthenticated) return <Navigate to="/register" replace state={{ from: `/join/${token}` }} />;

  if (preview.loading) return <Spinner />;
  if (preview.data?.is_member) return <Navigate to={`/groups/${preview.data.group_id}`} replace />;

  const join = async () => {
    setJoining(true);
    const res = await Group.join(token);
    setJoining(false);
    if (res.error) return setError(res.error);
    navigate(`/groups/${res.data}`, { replace: true });
  };

  if (!preview.data) {
    return (
      <AuthShell title="Invite link not valid">
        <ErrorBanner error={preview.error} />
        <p className="text-sm text-slate-600">This link is invalid or was reset by the group admin. Ask them for a new one.</p>
        <Link to="/" className="mt-4 inline-block font-semibold text-teal-600 hover:underline">Go home</Link>
      </AuthShell>
    );
  }

  const g = preview.data;
  return (
    <AuthShell title={`Join ${g.name}`} subtitle="You've been invited to share photos.">
      <div className="mb-6 flex flex-wrap gap-4 text-sm text-slate-600">
        {g.event_date && <span className="flex items-center gap-1"><Calendar size={15} /> {formatDate(g.event_date)}</span>}
        <span className="flex items-center gap-1"><Users size={15} /> {g.member_count} member{g.member_count === 1 ? '' : 's'}</span>
      </div>
      <ErrorBanner error={error} />
      <Button className="mt-2 w-full py-3" loading={joining} onClick={() => void join()}>Join</Button>
      <p className="mt-4 text-xs text-slate-500">
        {profile?.face_enrolled_at
          ? 'Photos you already appear in will be linked to you when you join.'
          : 'Tip: after joining, add a selfie in your profile so FaceO can find the photos you are in.'}
      </p>
    </AuthShell>
  );
}
