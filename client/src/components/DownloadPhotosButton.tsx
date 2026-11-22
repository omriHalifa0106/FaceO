// src/components/DownloadPhotosButton.tsx — "download the photos I'm in" as a ZIP.
// Two steps on purpose: the first click lists the photos (count + size), the
// second click opens the save dialog, which needs a fresh user gesture.
import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import {
  canStreamToDisk,
  chooseSaveTarget,
  formatBytes,
  writePhotosZip,
  type DownloadablePhoto,
  type DownloadProgress,
} from '@/lib/download';
import { useI18n } from '@/i18n/I18nProvider';
import { Button, ErrorBanner, Modal, SuccessBanner } from '@/components/ui';
import type { AppError, Result } from '@/lib/result';

type State =
  | { step: 'idle' }
  | { step: 'listing' }
  | { step: 'ready'; photos: DownloadablePhoto[] }
  | { step: 'downloading'; photos: DownloadablePhoto[]; progress: DownloadProgress }
  | { step: 'finished'; message: string; tone: 'ok' | 'info' }
  | { step: 'error'; error: AppError };

export default function DownloadPhotosButton({
  load,
  zipName,
  label,
  variant = 'secondary',
}: {
  load: () => Promise<Result<DownloadablePhoto[]>>;
  zipName: string;
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ step: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const open = async () => {
    setState({ step: 'listing' });
    const res = await load();
    if (res.error) setState({ step: 'error', error: res.error });
    else if (res.data.length === 0) setState({ step: 'finished', message: t.download.none, tone: 'info' });
    else setState({ step: 'ready', photos: res.data });
  };

  const start = async (photos: DownloadablePhoto[]) => {
    // Straight from the click: the save dialog requires user activation.
    const target = await chooseSaveTarget(zipName);
    if (!target) return; // user closed the save dialog
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ step: 'downloading', photos, progress: { done: 0, failed: 0, total: photos.length } });

    const res = await writePhotosZip(target, photos, {
      signal: controller.signal,
      onProgress: (progress) => setState((s) => (s.step === 'downloading' ? { ...s, progress } : s)),
    });
    abortRef.current = null;
    if (controller.signal.aborted) setState({ step: 'finished', message: t.download.cancelled, tone: 'info' });
    else if (res.error) setState({ step: 'error', error: res.error });
    else setState({ step: 'finished', message: t.download.finished(res.data.done, res.data.failed), tone: 'ok' });
  };

  const close = () => {
    abortRef.current?.abort();
    setState({ step: 'idle' });
  };

  const totalBytes = (photos: DownloadablePhoto[]) => photos.reduce((sum, p) => sum + (Number(p.size_bytes) || 0), 0);

  return (
    <>
      <Button variant={variant} onClick={() => void open()} loading={state.step === 'listing'}>
        <Download size={16} /> {label}
      </Button>

      <Modal open={state.step !== 'idle' && state.step !== 'listing'} onClose={close} title={t.download.title}>
        <div className="space-y-4">
          {state.step === 'ready' && (
            <>
              <p className="text-lg font-semibold text-slate-900">
                {t.download.summary(state.photos.length, formatBytes(totalBytes(state.photos)))}
              </p>
              <p className="text-sm text-slate-500">{canStreamToDisk() ? t.download.streamNote : t.download.memoryNote}</p>
              <div className="flex gap-2">
                <Button onClick={() => void start(state.photos)}>
                  <Download size={16} /> {t.download.start}
                </Button>
                <Button variant="ghost" onClick={close}>
                  {t.common.cancel}
                </Button>
              </div>
            </>
          )}

          {state.step === 'downloading' && (
            <>
              <p className="text-sm font-medium text-slate-700">
                {t.download.progress(state.progress.done + state.progress.failed, state.progress.total)}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-teal-500 transition-all"
                  style={{ width: `${((state.progress.done + state.progress.failed) / Math.max(1, state.progress.total)) * 100}%` }}
                />
              </div>
              <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => abortRef.current?.abort()}>
                {t.common.cancel}
              </Button>
            </>
          )}

          {state.step === 'finished' &&
            (state.tone === 'ok' ? <SuccessBanner>{state.message}</SuccessBanner> : <p className="text-sm text-slate-600">{state.message}</p>)}
          {state.step === 'error' && <ErrorBanner error={state.error} />}
        </div>
      </Modal>
    </>
  );
}
