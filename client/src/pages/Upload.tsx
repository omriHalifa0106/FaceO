// src/pages/Upload.tsx — pick a group, then upload many photos
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Group } from '@/api/entities';
import { useAsync } from '@/hooks/useAsync';
import UploadPanel from '@/components/UploadPanel';
import { useI18n } from '@/i18n/I18nProvider';
import { Card, EmptyState, ErrorBanner, Field, PageHeader, Spinner } from '@/components/ui';

export default function Upload() {
  const [params] = useSearchParams();
  const groups = useAsync(() => Group.list(), []);
  const { t } = useI18n();
  const [selected, setSelected] = useState<string>(params.get('group') ?? '');
  const groupId = selected || groups.data?.[0]?.id || '';
  const current = groups.data?.find((g) => g.id === groupId);

  return (
    <div className="max-w-3xl">
      <PageHeader title={t.upload.title} subtitle={t.upload.subtitle} />
      <ErrorBanner error={groups.error} onRetry={() => void groups.reload()} />
      {groups.loading ? (
        <Spinner />
      ) : !groups.data?.length ? (
        <EmptyState title={t.upload.joinFirst}>
          <Link to="/groups?create=1" className="font-semibold text-teal-600 hover:underline">{t.upload.createGroup}</Link>
        </EmptyState>
      ) : (
        <div className="space-y-5">
          <Card>
            <Field label={t.upload.uploadTo}>
              <select
                value={groupId}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
              >
                {groups.data.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>
          </Card>
          {groupId && <UploadPanel key={groupId} groupId={groupId} />}
          {current && (
            <Link to={`/groups/${current.id}`} className="inline-block text-sm font-medium text-teal-700 hover:underline">
              {t.upload.open(current.name)}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
