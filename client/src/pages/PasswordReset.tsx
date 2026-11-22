// src/pages/PasswordReset.tsx — "forgot password" request + "set new password" from the email link
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import AuthShell from '@/components/AuthShell';
import { Button, ErrorBanner, Field, Input, SuccessBanner, Spinner } from '@/components/ui';
import type { AppError } from '@/lib/result';
import { useI18n } from '@/i18n/I18nProvider';

export function ForgotPassword() {
  const { sendPasswordReset } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const res = await sendPasswordReset(email);
    setSubmitting(false);
    if (res.error) setError(res.error);
    else setSent(true);
  };

  return (
    <AuthShell title={t.auth.resetTitle} subtitle={t.auth.resetSubtitle}>
      {sent ? (
        <SuccessBanner>{t.auth.resetSent(email)}</SuccessBanner>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <ErrorBanner error={error} />
          <Field label={t.common.email}>
            <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" loading={submitting} className="w-full py-3">{t.auth.sendResetLink}</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="font-semibold text-teal-600 hover:underline">{t.auth.backToSignIn}</Link>
      </p>
    </AuthShell>
  );
}

/** Reached from the recovery email; Supabase signs the user in from the URL first. */
export function ResetPassword() {
  const { updatePassword, isAuthenticated, isLoadingAuth } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AppError | string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoadingAuth) return <Spinner />;

  if (!isAuthenticated) {
    return (
      <AuthShell title={t.auth.linkExpiredTitle}>
        <p className="text-sm text-slate-600">{t.auth.linkExpiredBody}</p>
        <Link to="/forgot-password" className="mt-4 inline-block font-semibold text-teal-600 hover:underline">{t.auth.requestNewLink}</Link>
      </AuthShell>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError(t.common.passwordTooShort(8));
    setSubmitting(true);
    const res = await updatePassword(password);
    setSubmitting(false);
    if (res.error) setError(res.error);
    else navigate('/', { replace: true });
  };

  return (
    <AuthShell title={t.auth.newPasswordTitle}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner error={error} />
        <Field label={t.auth.newPassword} hint={t.common.minPassword(8)}>
          <Input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" loading={submitting} className="w-full py-3">{t.auth.savePassword}</Button>
      </form>
    </AuthShell>
  );
}
