// src/pages/Profile.tsx — profile details, avatar, face enrollment, password
import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Camera } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { uploadAvatar } from '@/lib/storage';
import FaceEnrollment from '@/components/FaceEnrollment';
import { Avatar, Button, Card, ErrorBanner, Field, Input, PageHeader, SuccessBanner } from '@/components/ui';
import type { AppError } from '@/lib/result';

export default function Profile() {
  const { profile, user, updateProfile, updatePassword, setProfile } = useAuth();
  const [params] = useSearchParams();
  const welcome = params.get('welcome') === '1';

  const [details, setDetails] = useState({ full_name: profile?.full_name ?? '', phone: profile?.phone ?? '' });
  const [detailsMsg, setDetailsMsg] = useState<string | null>(null);
  const [detailsErr, setDetailsErr] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);

  const avatarInput = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarErr, setAvatarErr] = useState<AppError | null>(null);

  const [password, setPassword] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<AppError | string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const saveDetails = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setDetailsMsg(null);
    const res = await updateProfile({ full_name: details.full_name, phone: details.phone });
    setSaving(false);
    if (res.error) setDetailsErr(res.error);
    else {
      setDetailsErr(null);
      setDetailsMsg('Saved.');
    }
  };

  const changeAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    setAvatarErr(null);
    const res = await uploadAvatar(file);
    setAvatarBusy(false);
    if (res.error) setAvatarErr(res.error);
    else setProfile(res.data);
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (password.length < 8) return setPwErr('Password must be at least 8 characters.');
    setPwSaving(true);
    const res = await updatePassword(password);
    setPwSaving(false);
    if (res.error) setPwErr(res.error);
    else {
      setPwErr(null);
      setPassword('');
      setPwMsg('Password updated.');
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Profile & face" />

      {welcome && !profile?.face_enrolled_at && (
        <SuccessBanner>Welcome to FaceO! One last step: add a selfie below so we can find you in group photos.</SuccessBanner>
      )}

      <Card>
        <h2 className="mb-4 font-semibold text-slate-900">Face recognition</h2>
        <FaceEnrollment />
      </Card>

      <Card>
        <h2 className="mb-4 font-semibold text-slate-900">Your details</h2>
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={profile?.full_name ?? ''} avatarKey={profile?.avatar_key} size={72} />
          <div>
            <Button variant="secondary" loading={avatarBusy} onClick={() => avatarInput.current?.click()}>
              <Camera size={16} /> Change picture
            </Button>
            <p className="mt-1 text-xs text-slate-500">Shown to members of your groups. Not used for face recognition.</p>
            <input
              ref={avatarInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                void changeAvatar(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <ErrorBanner error={avatarErr} />
        <form onSubmit={saveDetails} className="mt-4 space-y-4">
          <ErrorBanner error={detailsErr} />
          {detailsMsg && <SuccessBanner>{detailsMsg}</SuccessBanner>}
          <Field label="Email">
            <Input value={user?.email ?? ''} disabled className="bg-slate-50 text-slate-500" />
          </Field>
          <Field label="Full name">
            <Input required maxLength={100} value={details.full_name} onChange={(e) => setDetails((d) => ({ ...d, full_name: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <Input type="tel" maxLength={32} value={details.phone} onChange={(e) => setDetails((d) => ({ ...d, phone: e.target.value }))} />
          </Field>
          <Button type="submit" loading={saving}>Save</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-4 font-semibold text-slate-900">Change password</h2>
        <form onSubmit={savePassword} className="space-y-4">
          <ErrorBanner error={pwErr} />
          {pwMsg && <SuccessBanner>{pwMsg}</SuccessBanner>}
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" loading={pwSaving}>Update password</Button>
        </form>
      </Card>
    </div>
  );
}
