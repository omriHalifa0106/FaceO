// src/pages/Groups.tsx — list of my groups/events + create
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, Images, MapPin, Plus, Users } from 'lucide-react';
import { Group } from '@/api/entities';
import { useAsync } from '@/hooks/useAsync';
import { Badge, Button, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Spinner, TextArea, formatDate } from '@/components/ui';
import type { AppError } from '@/lib/result';
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
            {k === 'event' ? 'One-time event' : 'Ongoing group'}
          </button>
        ))}
      </div>
      <Field label="Name">
        <Input required maxLength={120} value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} placeholder="Dana & Avi's wedding" />
      </Field>
      {values.kind === 'event' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">
            <Input type="date" value={values.event_date} onChange={(e) => setValues((v) => ({ ...v, event_date: e.target.value }))} />
          </Field>
          <Field label="Location">
            <Input maxLength={200} value={values.location} onChange={(e) => setValues((v) => ({ ...v, location: e.target.value }))} />
          </Field>
        </div>
      )}
      <Field label="Description (optional)">
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
  const creating = params.get('create') === '1';
  const closeCreate = () => setParams({}, { replace: true });

  return (
    <div>
      <PageHeader
        title="Groups & events"
        subtitle="Everyone in a group sees its photos. Invite people with a link."
        actions={
          <Button onClick={() => setParams({ create: '1' })}>
            <Plus size={16} /> New
          </Button>
        }
      />
      <ErrorBanner error={groups.error} onRetry={() => void groups.reload()} />

      {groups.loading ? (
        <Spinner />
      ) : !groups.data?.length ? (
        <EmptyState icon={<Users size={40} />} title="You're not in any group yet">
          Create one, or open an invite link someone sent you.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.data.map((g) => (
            <Link key={g.id} to={`/groups/${g.id}`} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:border-teal-300 hover:shadow">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="line-clamp-2 font-semibold text-slate-900">{g.name}</h3>
                <Badge tone={g.kind === 'event' ? 'teal' : 'slate'}>{g.kind}</Badge>
              </div>
              {g.description && <p className="mb-3 line-clamp-2 text-sm text-slate-500">{g.description}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {g.event_date && (
                  <span className="flex items-center gap-1"><Calendar size={13} /> {formatDate(g.event_date)}</span>
                )}
                {g.location && (
                  <span className="flex items-center gap-1"><MapPin size={13} /> {g.location}</span>
                )}
                <span className="flex items-center gap-1"><Users size={13} /> {g.member_count}</span>
                <span className="flex items-center gap-1"><Images size={13} /> {g.photo_count}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={closeCreate} title="New group or event">
        <GroupForm
          submitLabel="Create"
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
