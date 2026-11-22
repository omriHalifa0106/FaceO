// src/components/UploadPanel.tsx — multi-file upload with per-file progress + face scan
import { useRef, useState, type DragEvent } from 'react';
import { CheckCircle2, ImagePlus, Loader2, ScanFace, XCircle } from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES, uploadPhotos, type UploadProgress } from '@/lib/storage';
import { processPhoto } from '@/lib/guestResolution';
import { Button, cn } from '@/components/ui';
import type { UUID } from '@/types';

const STAGE_LABEL: Record<UploadProgress['stage'], string> = {
  queued: 'Waiting',
  uploading: 'Uploading',
  saving: 'Saving',
  processing: 'Processing',
  done: 'Done',
  error: 'Failed',
};

export default function UploadPanel({ groupId, onUploaded }: { groupId: UUID; onUploaded?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [items, setItems] = useState<UploadProgress[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [scanFaces, setScanFaces] = useState(true);

  const start = async (files: File[]) => {
    if (!files.length || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setItems(files.map((file, index) => ({ index, file, stage: 'queued', percent: 0 })));

    await uploadPhotos(groupId, files, {
      signal: controller.signal,
      onProgress: (p) => setItems((prev) => prev.map((it) => (it.index === p.index ? p : it))),
      // Always render the thumbnail; detect faces only if the box is ticked.
      afterSave: async (photo, file) => {
        const res = await processPhoto(photo, file, { skipFaces: !scanFaces });
        if (res.error) throw res.error;
      },
    });

    setRunning(false);
    abortRef.current = null;
    onUploaded?.();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void start(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/')));
  };

  const done = items.filter((i) => i.stage === 'done').length;
  const failed = items.filter((i) => i.stage === 'error').length;
  const overall = items.length ? Math.round(items.reduce((s, i) => s + (i.stage === 'error' ? 100 : i.percent), 0) / items.length) : 0;

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !running && inputRef.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition',
          dragging ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-white hover:border-teal-400',
          running && 'cursor-not-allowed opacity-60',
        )}
      >
        <ImagePlus className="mb-2 text-teal-500" size={36} />
        <p className="font-semibold text-slate-700">Drop photos here or click to choose</p>
        <p className="mt-1 text-xs text-slate-500">JPEG, PNG or WebP · up to 25 MB each · many at once</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            void start(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={scanFaces} disabled={running} onChange={(e) => setScanFaces(e.target.checked)} />
        <ScanFace size={16} /> Find faces on this device right after upload
      </label>

      {items.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">
              {done}/{items.length} uploaded{failed ? ` · ${failed} failed` : ''}
            </span>
            {running && (
              <Button variant="ghost" onClick={() => abortRef.current?.abort()} className="py-1 text-red-600">
                Cancel
              </Button>
            )}
          </div>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-teal-500 transition-all" style={{ width: `${overall}%` }} />
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {items.map((it) => (
              <li key={it.index} className="flex items-center gap-3 text-sm">
                {it.stage === 'done' ? (
                  <CheckCircle2 size={17} className="shrink-0 text-teal-500" />
                ) : it.stage === 'error' ? (
                  <XCircle size={17} className="shrink-0 text-red-500" />
                ) : (
                  <Loader2 size={17} className="shrink-0 animate-spin text-slate-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-slate-700">{it.file.name}</span>
                    <span className={cn('shrink-0 text-xs', it.stage === 'error' ? 'text-red-600' : 'text-slate-500')}>
                      {it.stage === 'uploading' ? `${it.percent}%` : STAGE_LABEL[it.stage]}
                    </span>
                  </div>
                  {it.error && <p className="truncate text-xs text-red-600">{it.error.message}</p>}
                  {it.stage === 'uploading' && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-teal-400" style={{ width: `${it.percent}%` }} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
