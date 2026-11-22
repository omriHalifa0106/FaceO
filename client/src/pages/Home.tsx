// src/pages/Home.tsx — dashboard
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Images, Plus, ScanFace, Upload, Users } from 'lucide-react';
import { Photo } from '@/api/entities';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import PhotoGrid from '@/components/PhotoGrid';
import { EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import { r2PublicUrl } from '@/lib/supabaseClient';
import { useI18n } from '@/i18n/I18nProvider';

export default function Home() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const recent = useAsync(() => Photo.listRecent(12), []);
  const mine = useAsync(() => Photo.listMine({ limit: 1 }), []);
  const [preview, setPreview] = useState<string | null>(null);

  const actions = [
    { to: '/groups?create=1', label: t.home.newEvent, icon: Plus, primary: true },
    { to: '/groups', label: t.home.myGroups, icon: Users },
    { to: '/upload', label: t.home.uploadPhotos, icon: Upload },
    { to: '/me/photos', label: t.home.photosOfMe, icon: Images },
  ];

  return (
    <div>
      <PageHeader
        title={t.home.greeting(profile?.full_name?.split(' ')[0] ?? '')}
        subtitle={t.home.subtitle}
      />

      {profile && !profile.face_enrolled_at && (
        <Link
          to="/profile"
          className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 transition hover:border-amber-300"
        >
          <ScanFace className="shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">{t.home.setUpFaceTitle}</p>
            <p>{t.home.setUpFaceBody}</p>
          </div>
        </Link>
      )}

      <div className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4">
        {actions.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className={
              a.primary
                ? 'flex flex-col items-center gap-2 rounded-2xl bg-teal-600 px-4 py-5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-700'
                : 'flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal-400'
            }
          >
            <a.icon size={22} />
            {a.label}
          </Link>
        ))}
      </div>

      {mine.data && mine.data.length > 0 && (
        <Link to="/me/photos" className="mb-8 block text-sm font-medium text-teal-700 hover:underline">
          {t.home.recognisedLink}
        </Link>
      )}

      <h2 className="mb-4 text-xl font-bold text-slate-900">{t.home.recentPhotos}</h2>
      <ErrorBanner error={recent.error} onRetry={() => void recent.reload()} />
      {recent.loading ? (
        <Spinner />
      ) : !recent.data?.length ? (
        <EmptyState icon={<Images size={40} />} title={t.home.noPhotosTitle}>
          {t.home.noPhotosBody}
        </EmptyState>
      ) : (
        <PhotoGrid
          photos={recent.data}
          caption={(p) => p.group?.name ?? null}
          onOpen={(p) => setPreview(r2PublicUrl(p.storage_key))}
        />
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          <img src={preview} alt="" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </div>
  );
}
