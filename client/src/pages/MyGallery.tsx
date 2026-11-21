// src/pages/MyGallery.tsx — every photo (all groups) where the current user was recognised
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Images, ScanFace } from 'lucide-react';
import { Photo, type PhotoWithGroup } from '@/api/entities';
import { resolveMyGuestTags } from '@/lib/guestResolution';
import { useAuth } from '@/context/AuthContext';
import { usePaged } from '@/hooks/usePaged';
import PhotoGrid from '@/components/PhotoGrid';
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner, SuccessBanner } from '@/components/ui';
import { r2PublicUrl } from '@/lib/supabaseClient';
import type { AppError } from '@/lib/result';

const PAGE_SIZE = 60;

export default function MyGallery() {
  const { profile } = useAuth();
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
    setMessage(res.data > 0 ? `Found you in ${res.data} more photo(s).` : 'No new photos of you were found.');
    if (res.data > 0) void list.reload();
  };

  return (
    <div>
      <PageHeader
        title="Photos of me"
        subtitle="Every photo, across all your groups, in which you were recognised."
        actions={
          profile?.face_enrolled_at && (
            <Button variant="secondary" loading={searching} onClick={() => void searchAgain()}>
              <ScanFace size={16} /> Search again
            </Button>
          )
        }
      />
      {!profile?.face_enrolled_at && (
        <div className="mb-5">
          <EmptyState icon={<ScanFace size={40} />} title="Face recognition isn't set up">
            <Link to="/profile" className="font-semibold text-teal-600 hover:underline">Add a selfie</Link> so FaceO can recognise you.
          </EmptyState>
        </div>
      )}
      <ErrorBanner error={error || list.error} />
      {message && <div className="mb-4"><SuccessBanner>{message}</SuccessBanner></div>}

      {list.loading ? (
        <Spinner />
      ) : photos.length === 0 ? (
        profile?.face_enrolled_at && (
          <EmptyState icon={<Images size={40} />} title="No photos of you yet">
            When someone uploads a photo you're in, it shows up here automatically.
          </EmptyState>
        )
      ) : (
        <>
          <PhotoGrid photos={photos} caption={(p) => p.group?.name ?? null} onOpen={(p) => setPreview(r2PublicUrl(p.storage_key))} />
          {list.hasMore && (
            <div className="mt-5 flex justify-center">
              <Button variant="secondary" loading={list.loadingMore} onClick={() => void list.loadMore()}>Load more</Button>
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
