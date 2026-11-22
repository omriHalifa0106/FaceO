// src/pages/Register.tsx
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import AuthShell from '@/components/AuthShell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';

const MIN_PASSWORD = 8;

export default function Register() {
  const { signUp, authError, clearAuthError, isAuthenticated } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '' });
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  if (isAuthenticated && !confirmSent) return <Navigate to={from || '/profile?welcome=1'} replace />;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    clearAuthError();
    setLocalError(null);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password.length < MIN_PASSWORD) return setLocalError(t.common.passwordTooShort(MIN_PASSWORD));
    if (form.password !== form.confirm) return setLocalError(t.auth.passwordsDontMatch);
    setSubmitting(true);
    const res = await signUp({ email: form.email, password: form.password, fullName: form.fullName, phone: form.phone });
    setSubmitting(false);
    if (res.error) return;
    if (res.data.needsConfirmation) setConfirmSent(true);
    // New users go to their profile to set up face recognition (or back to an invite link).
    else navigate(from || '/profile?welcome=1', { replace: true });
  };

  if (confirmSent) {
    return (
      <AuthShell title={t.auth.checkEmailTitle}>
        <div className="flex flex-col items-center gap-3 text-center">
          <MailCheck size={40} className="text-teal-500" />
          <p className="text-sm text-slate-600">{t.auth.checkEmailBody(form.email)}</p>
          <Link to="/login" state={location.state} className="font-semibold text-teal-600 hover:underline">{t.auth.backToSignIn}</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t.auth.registerTitle} subtitle={t.auth.registerSubtitle}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner error={localError || authError} />
        <Field label={t.common.fullName}>
          <Input required autoComplete="name" maxLength={100} value={form.fullName} onChange={set('fullName')} />
        </Field>
        <Field label={t.common.email}>
          <Input type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label={t.auth.phoneOptional}>
          <Input type="tel" autoComplete="tel" maxLength={32} value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label={t.common.password} hint={t.common.minPassword(MIN_PASSWORD)}>
          <Input type="password" required autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
        <Field label={t.auth.confirmPassword}>
          <Input type="password" required autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </Field>
        <Button type="submit" loading={submitting} className="w-full py-3">{t.auth.createAccount}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        {t.auth.haveAccount}{' '}
        <Link to="/login" state={location.state} className="font-semibold text-teal-600 hover:underline">{t.auth.signIn}</Link>
      </p>
    </AuthShell>
  );
}
