// src/pages/PasswordReset.tsx — "forgot password" request + "set new password" from the email link
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import AuthShell from '@/components/AuthShell';
import { Button, ErrorBanner, Field, Input, SuccessBanner, Spinner } from '@/components/ui';
import type { AppError } from '@/lib/result';

export function ForgotPassword() {
  const { sendPasswordReset } = useAuth();
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
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new password.">
      {sent ? (
        <SuccessBanner>If an account exists for {email}, a reset link is on its way.</SuccessBanner>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <ErrorBanner error={error} />
          <Field label="Email">
            <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" loading={submitting} className="w-full py-3">Send reset link</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="font-semibold text-teal-600 hover:underline">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}

/** Reached from the recovery email; Supabase signs the user in from the URL first. */
export function ResetPassword() {
  const { updatePassword, isAuthenticated, isLoadingAuth } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AppError | string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoadingAuth) return <Spinner />;

  if (!isAuthenticated) {
    return (
      <AuthShell title="Link expired">
        <p className="text-sm text-slate-600">This reset link is invalid or has expired.</p>
        <Link to="/forgot-password" className="mt-4 inline-block font-semibold text-teal-600 hover:underline">Request a new link</Link>
      </AuthShell>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setSubmitting(true);
    const res = await updatePassword(password);
    setSubmitting(false);
    if (res.error) setError(res.error);
    else navigate('/', { replace: true });
  };

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner error={error} />
        <Field label="New password" hint="At least 8 characters">
          <Input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" loading={submitting} className="w-full py-3">Save password</Button>
      </form>
    </AuthShell>
  );
}
