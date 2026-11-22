// src/components/FaceEnrollment.tsx — capture 1-3 selfies (camera or files) and enroll.
// Images never leave the device: only the computed 128-number descriptor is saved.
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, ScanFace, ShieldCheck, Trash2, X } from 'lucide-react';
import { enrollMyFace, giveFaceConsent, withdrawFaceConsent } from '@/lib/faceRecognition';
import { useAuth } from '@/context/AuthContext';
import { Button, ErrorBanner, SuccessBanner, formatDate } from '@/components/ui';
import type { AppError } from '@/lib/result';
import { useI18n } from '@/i18n/I18nProvider';

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
  const { t } = useI18n();
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
      setError(t.face.cameraError);
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
      t.face.saved(res.data.linkedPhotos),
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
    if (!window.confirm(t.face.withdrawConfirm)) return;
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
      setSuccess(t.face.withdrawn);
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
            <p className="font-semibold text-slate-800">{t.face.consentTitle}</p>
            <ul className="list-disc space-y-1 ps-5">
              {t.face.consentPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          {t.face.consentCheckbox}
        </label>
        <Button onClick={() => void consent()} disabled={!agreed} loading={busy === 'consent'}>
          <ShieldCheck size={16} /> {t.face.consentButton}
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
              <span className="font-semibold text-teal-700">{t.face.active}</span> {t.face.activeRest}
            </p>
          ) : (
            <p>{t.face.intro}</p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {t.face.privacyNote} {t.face.consentGiven(formatDate(profile.face_consent_at))}
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
              <Camera size={16} /> {t.face.capture(samples.length, MAX_SAMPLES)}
            </Button>
            <Button variant="secondary" onClick={stopCamera}>
              {t.face.closeCamera}
            </Button>
          </div>
        </div>
      )}

      {samples.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {samples.map((s) => (
            <div key={s.id} className="relative">
              <img src={s.url} alt={t.face.sampleAlt} className="h-24 w-24 rounded-xl object-cover" />
              <button
                onClick={() => removeSample(s.id)}
                className="absolute -end-2 -top-2 rounded-full bg-white p-1 shadow"
                aria-label={t.face.removeSample}
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
            <Camera size={16} /> {t.face.useCamera}
          </Button>
        )}
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={samples.length >= MAX_SAMPLES}>
          <ImagePlus size={16} /> {t.face.chooseSelfies}
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
          <ScanFace size={16} /> {profile?.face_enrolled_at ? t.face.replace : t.face.save}
        </Button>
        <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => void withdraw()} loading={busy === 'delete'}>
          <Trash2 size={16} /> {t.face.withdraw}
        </Button>
      </div>
    </div>
  );
}
