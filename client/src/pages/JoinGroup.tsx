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
import { useI18n } from '@/i18n/I18nProvider';

export default function JoinGroup() {
  const { token = '' } = useParams();
  const { isAuthenticated, isLoadingAuth, profile } = useAuth();
  const { t } = useI18n();
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
      <AuthShell title={t.join.invalidTitle}>
        <ErrorBanner error={preview.error} />
        <p className="text-sm text-slate-600">{t.join.invalidBody}</p>
        <Link to="/" className="mt-4 inline-block font-semibold text-teal-600 hover:underline">{t.join.goHome}</Link>
      </AuthShell>
    );
  }

  const g = preview.data;
  return (
    <AuthShell title={t.join.title(g.name)} subtitle={t.join.subtitle}>
      <div className="mb-6 flex flex-wrap gap-4 text-sm text-slate-600">
        {g.event_date && <span className="flex items-center gap-1"><Calendar size={15} /> {formatDate(g.event_date)}</span>}
        <span className="flex items-center gap-1"><Users size={15} /> {t.common.members(g.member_count)}</span>
      </div>
      <ErrorBanner error={error} />
      <Button className="mt-2 w-full py-3" loading={joining} onClick={() => void join()}>{t.join.join}</Button>
      <p className="mt-4 text-xs text-slate-500">
        {profile?.face_enrolled_at ? t.join.tipEnrolled : t.join.tipNotEnrolled}
      </p>
    </AuthShell>
  );
}
