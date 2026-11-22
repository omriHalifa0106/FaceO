// src/pages/Groups.tsx — list of my groups/events + create
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, Images, MapPin, Plus, Users } from 'lucide-react';
import { Group } from '@/api/entities';
import { useAsync } from '@/hooks/useAsync';
import { Badge, Button, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Spinner, TextArea, formatDate } from '@/components/ui';
import type { AppError } from '@/lib/result';
import GroupCover from '@/components/GroupCover';
import { useI18n } from '@/i18n/I18nProvider';
import type { GroupKind } from '@/types';

export function GroupForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: { name: string; description: string | null; kind: GroupKind; event_date: string | null; location: string | null };
  submitLabel: string;
  onSubmit: (values: { name: string; description: string; kind: GroupKind; event_date: string; location: string }) => Promise<AppError | null>;
}) {
  const [values, setValues] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    kind: initial?.kind ?? ('event' as GroupKind),
    event_date: initial?.event_date ?? '',
    location: initial?.location ?? '',
  });
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const err = await onSubmit(values);
    setSaving(false);
    setError(err);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner error={error} />
      <div className="grid grid-cols-2 gap-2">
        {(['event', 'group'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setValues((v) => ({ ...v, kind: k }))}
            className={`rounded-xl border px-3 py-2 text-sm font-medium ${values.kind === k ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600'}`}
          >
            {k === 'event' ? t.groups.kindEvent : t.groups.kindGroup}
          </button>
        ))}
      </div>
      <Field label={t.common.name}>
        <Input required maxLength={120} value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} placeholder={t.groups.namePlaceholder} />
      </Field>
      {values.kind === 'event' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.groups.date}>
            <Input type="date" value={values.event_date} onChange={(e) => setValues((v) => ({ ...v, event_date: e.target.value }))} />
          </Field>
          <Field label={t.groups.location}>
            <Input maxLength={200} value={values.location} onChange={(e) => setValues((v) => ({ ...v, location: e.target.value }))} />
          </Field>
        </div>
      )}
      <Field label={t.groups.descriptionOptional}>
        <TextArea rows={3} maxLength={2000} value={values.description} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} />
      </Field>
      <Button type="submit" loading={saving} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}

export default function Groups() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const groups = useAsync(() => Group.list(), []);
  const { t } = useI18n();
  const creating = params.get('create') === '1';
  const closeCreate = () => setParams({}, { replace: true });

  return (
    <div>
      <PageHeader
        title={t.groups.title}
        subtitle={t.groups.subtitle}
        actions={
          <Button onClick={() => setParams({ create: '1' })}>
            <Plus size={16} /> {t.groups.new}
          </Button>
        }
      />
      <ErrorBanner error={groups.error} onRetry={() => void groups.reload()} />

      {groups.loading ? (
        <Spinner />
      ) : !groups.data?.length ? (
        <EmptyState icon={<Users size={40} />} title={t.groups.emptyTitle}>
          {t.groups.emptyBody}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.data.map((g) => (
            <Link
              key={g.id}
              to={`/groups/${g.id}`}
              className="group overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:border-teal-300 hover:shadow-md"
            >
              <div className="relative aspect-[16/9] overflow-hidden bg-slate-100">
                <div className="h-full w-full transition duration-300 group-hover:scale-[1.03]">
                  <GroupCover id={g.id} name={g.name} keys={g.cover_keys} />
                </div>
                <span className="absolute start-3 top-3">
                  <Badge tone={g.kind === 'event' ? 'teal' : 'slate'}>{t.groups.kindBadge(g.kind)}</Badge>
                </span>
              </div>
              <div className="p-4">
                <h3 className="mb-1 line-clamp-1 font-semibold text-slate-900">{g.name}</h3>
                {g.description && <p className="mb-2 line-clamp-2 text-sm text-slate-500">{g.description}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  {g.event_date && (
                    <span className="flex items-center gap-1"><Calendar size={13} /> {formatDate(g.event_date)}</span>
                  )}
                  {g.location && (
                    <span className="flex items-center gap-1"><MapPin size={13} /> {g.location}</span>
                  )}
                  <span className="flex items-center gap-1"><Users size={13} /> {t.common.members(g.member_count)}</span>
                  <span className="flex items-center gap-1"><Images size={13} /> {t.common.photos(g.photo_count)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={closeCreate} title={t.groups.createTitle}>
        <GroupForm
          submitLabel={t.groups.create}
          onSubmit={async (v) => {
            const res = await Group.create(v);
            if (res.error) return res.error;
            navigate(`/groups/${res.data.id}?tab=invite`, { replace: true });
            return null;
          }}
        />
      </Modal>
    </div>
  );
}
