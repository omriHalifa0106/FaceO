// src/pages/MyGallery.tsx — every photo (all groups) where the current user was recognised
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Images, ScanFace } from 'lucide-react';
import { Photo, type PhotoWithGroup } from '@/api/entities';
import { resolveMyGuestTags } from '@/lib/guestResolution';
import { useAuth } from '@/context/AuthContext';
import { usePaged } from '@/hooks/usePaged';
import PhotoGrid from '@/components/PhotoGrid';
import DownloadPhotosButton from '@/components/DownloadPhotosButton';
import { collectAllPages } from '@/lib/download';
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner, SuccessBanner } from '@/components/ui';
import { r2PublicUrl } from '@/lib/supabaseClient';
import type { AppError } from '@/lib/result';
import { useI18n } from '@/i18n/I18nProvider';

const PAGE_SIZE = 60;

export default function MyGallery() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const list = usePaged<PhotoWithGroup>((page) => Photo.listMine(page), [], PAGE_SIZE);
  const photos = list.items;
  const [preview, setPreview] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const searchAgain = async () => {
    setSearching(true);
    setError(null);
    const res = await resolveMyGuestTags();
    setSearching(false);
    if (res.error) return setError(res.error);
    setMessage(t.gallery.foundMore(res.data));
    if (res.data > 0) void list.reload();
  };

  return (
    <div>
      <PageHeader
        title={t.gallery.title}
        subtitle={t.gallery.subtitle}
        actions={
          <>
            {profile?.face_enrolled_at && (
              <Button variant="secondary" loading={searching} onClick={() => void searchAgain()}>
                <ScanFace size={16} /> {t.gallery.searchAgain}
              </Button>
            )}
            {photos.length > 0 && (
              <DownloadPhotosButton
                variant="primary"
                label={t.download.allMyPhotos}
                zipName={t.download.zipAll}
                load={() => collectAllPages((page) => Photo.listMine(page))}
              />
            )}
          </>
        }
      />
      {!profile?.face_enrolled_at && (
        <div className="mb-5">
          <EmptyState icon={<ScanFace size={40} />} title={t.gallery.notSetUpTitle}>
            <Link to="/profile" className="font-semibold text-teal-600 hover:underline">{t.gallery.notSetUpLink}</Link> {t.gallery.notSetUpRest}
          </EmptyState>
        </div>
      )}
      <ErrorBanner error={error || list.error} />
      {message && <div className="mb-4"><SuccessBanner>{message}</SuccessBanner></div>}

      {list.loading ? (
        <Spinner />
      ) : photos.length === 0 ? (
        profile?.face_enrolled_at && (
          <EmptyState icon={<Images size={40} />} title={t.gallery.emptyTitle}>
            {t.gallery.emptyBody}
          </EmptyState>
        )
      ) : (
        <>
          <PhotoGrid photos={photos} caption={(p) => p.group?.name ?? null} onOpen={(p) => setPreview(r2PublicUrl(p.storage_key))} />
          {list.hasMore && (
            <div className="mt-5 flex justify-center">
              <Button variant="secondary" loading={list.loadingMore} onClick={() => void list.loadMore()}>{t.common.loadMore}</Button>
            </div>
          )}
        </>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          <img src={preview} alt="" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </div>
  );
}
