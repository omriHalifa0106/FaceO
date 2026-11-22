// src/components/FaceEnrollment.tsx — capture 1-3 selfies (camera or files) and enroll.
// Images never leave the device: only the computed 128-number descriptor is saved.
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, ScanFace, ShieldCheck, Trash2, X } from 'lucide-react';
import { enrollMyFace, giveFaceConsent, withdrawFaceConsent } from '@/lib/faceRecognition';
import { useAuth } from '@/context/AuthContext';
import { Button, ErrorBanner, SuccessBanner, formatDate } from '@/components/ui';
import type { AppError } from '@/lib/result';

const MAX_SAMPLES = 3;

interface Sample {
  id: number;
  blob: Blob;
  url: string;
}

export default function FaceEnrollment() {
  const { profile, refreshProfile } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [busy, setBusy] = useState<'enroll' | 'delete' | 'consent' | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<AppError | string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  // Object URLs are revoked when a sample is removed, and all of them on unmount.
  const samplesRef = useRef<Sample[]>([]);
  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      samplesRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    },
    [],
  );

  const removeSample = (id: number) =>
    setSamples((prev) => {
      prev.filter((p) => p.id === id).forEach((p) => URL.revokeObjectURL(p.url));
      return prev.filter((p) => p.id !== id);
    });

  const clearSamples = () =>
    setSamples((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError('Could not open the camera. Allow camera access or upload photos instead.');
    }
  };

  const addSample = (blob: Blob) =>
    setSamples((prev) =>
      prev.length >= MAX_SAMPLES ? prev : [...prev, { id: nextId.current++, blob, url: URL.createObjectURL(blob) }],
    );

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && addSample(blob), 'image/jpeg', 0.92);
  };

  const enroll = async () => {
    setBusy('enroll');
    setError(null);
    setSuccess(null);
    const res = await enrollMyFace(samples.map((s) => s.blob));
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    stopCamera();
    clearSamples();
    await refreshProfile();
    setSuccess(
      res.data.linkedPhotos > 0
        ? `Face saved. We found you in ${res.data.linkedPhotos} existing photo(s).`
        : 'Face saved. New photos of you will be recognised automatically.',
    );
  };

  const consent = async () => {
    setBusy('consent');
    setError(null);
    const res = await giveFaceConsent();
    setBusy(null);
    if (res.error) setError(res.error);
    else await refreshProfile();
  };

  const withdraw = async () => {
    if (!window.confirm('Withdraw consent and delete your face data? New photos will no longer be matched to you.')) return;
    setBusy('delete');
    setError(null);
    setSuccess(null);
    const res = await withdrawFaceConsent();
    setBusy(null);
    if (res.error) setError(res.error);
    else {
      stopCamera();
      clearSamples();
      setAgreed(false);
      await refreshProfile();
      setSuccess('Consent withdrawn and your face data deleted.');
    }
  };

  // Explicit, informed consent is required before any biometric processing.
  if (!profile?.face_consent_at) {
    return (
      <div className="space-y-4">
        <ErrorBanner error={error} />
        {success && <SuccessBanner>{success}</SuccessBanner>}
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-teal-600" />
          <div className="space-y-2 text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Face recognition is optional and needs your consent.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Your selfies are processed on this device and are <strong>not uploaded</strong>.</li>
              <li>We store only a numeric face signature (biometric data). Only you can read it; matching happens on our server without showing it to anyone.</li>
              <li>It is used only to find you in photos of groups you belong to.</li>
              <li>You can withdraw at any time here; your face signature is then deleted immediately.</li>
              <li>You can also remove yourself from any single photo with "Hide me".</li>
            </ul>
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I agree that FaceO processes my face signature for recognising me in group photos, as described above.
        </label>
        <Button onClick={() => void consent()} disabled={!agreed} loading={busy === 'consent'}>
          <ShieldCheck size={16} /> I agree, continue
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ScanFace className="mt-0.5 shrink-0 text-teal-600" />
        <div className="text-sm text-slate-600">
          {profile?.face_enrolled_at ? (
            <p>
              <span className="font-semibold text-teal-700">Face profile active.</span> You can replace it with new selfies at any time.
            </p>
          ) : (
            <p>Add 1–3 clear selfies (only you, facing the camera, good light) so FaceO can find you in group photos.</p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            The photos are processed on this device and are not uploaded. Only a numeric face signature is stored, and only you can access it.
            {' '}Consent given {formatDate(profile.face_consent_at)}.
          </p>
        </div>
      </div>

      <ErrorBanner error={error} />
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {cameraOn && (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} playsInline muted className="mx-auto max-h-80 -scale-x-100" />
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
            <Button onClick={capture} disabled={samples.length >= MAX_SAMPLES}>
              <Camera size={16} /> Capture ({samples.length}/{MAX_SAMPLES})
            </Button>
            <Button variant="secondary" onClick={stopCamera}>
              Close camera
            </Button>
          </div>
        </div>
      )}

      {samples.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {samples.map((s) => (
            <div key={s.id} className="relative">
              <img src={s.url} alt="Selfie sample" className="h-24 w-24 rounded-xl object-cover" />
              <button
                onClick={() => removeSample(s.id)}
                className="absolute -right-2 -top-2 rounded-full bg-white p-1 shadow"
                aria-label="Remove sample"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!cameraOn && (
          <Button variant="secondary" onClick={() => void startCamera()} disabled={samples.length >= MAX_SAMPLES}>
            <Camera size={16} /> Use camera
          </Button>
        )}
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={samples.length >= MAX_SAMPLES}>
          <ImagePlus size={16} /> Choose selfies
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            Array.from(e.target.files ?? []).slice(0, MAX_SAMPLES).forEach(addSample);
            e.target.value = '';
          }}
        />
        <Button onClick={() => void enroll()} disabled={samples.length === 0} loading={busy === 'enroll'}>
          <ScanFace size={16} /> {profile?.face_enrolled_at ? 'Replace face profile' : 'Save face profile'}
        </Button>
        <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => void withdraw()} loading={busy === 'delete'}>
          <Trash2 size={16} /> Withdraw consent & delete face data
        </Button>
      </div>
    </div>
  );
}
