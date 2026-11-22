// src/pages/Login.tsx
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import AuthShell from '@/components/AuthShell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';

export default function Login() {
  const { signIn, authError, clearAuthError, isAuthenticated } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to={from} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const res = await signIn(email, password);
    setSubmitting(false);
    if (!res.error) navigate(from, { replace: true });
  };

  return (
    <AuthShell title={t.auth.signInTitle} subtitle={t.auth.signInSubtitle}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner error={authError} />
        <Field label={t.common.email}>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => { clearAuthError(); setEmail(e.target.value); }} />
        </Field>
        <Field label={t.common.password}>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => { clearAuthError(); setPassword(e.target.value); }} />
        </Field>
        <div className="text-end text-sm">
          <Link to="/forgot-password" className="text-teal-600 hover:underline">{t.auth.forgotPassword}</Link>
        </div>
        <Button type="submit" loading={submitting} className="w-full py-3">{t.auth.signIn}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        {t.auth.newHere}{' '}
        <Link to="/register" state={location.state} className="font-semibold text-teal-600 hover:underline">{t.auth.createAccountLink}</Link>
      </p>
    </AuthShell>
  );
}
