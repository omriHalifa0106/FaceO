// src/context/AuthContext.tsx — session, user and (non-biometric) profile for the whole app.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User as AuthUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { attempt, toAppError, type AppError, type Result } from '@/lib/result';
import { User as UserApi } from '@/api/entities';
import type { Profile, ProfileUpdate } from '@/types';

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}

export interface AuthContextValue {
  session: Session | null;
  user: AuthUser | null;
  /** Row from public.users. Contains NO face embedding — see lib/faceRecognition.ts. */
  profile: Profile | null;
  isLoadingAuth: boolean;
  isAuthenticated: boolean;
  authError: AppError | null;
  clearAuthError: () => void;
  signIn: (email: string, password: string) => Promise<Result<true>>;
  /** needsConfirmation = true when the project requires email confirmation. */
  signUp: (input: SignUpInput) => Promise<Result<{ needsConfirmation: boolean }>>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<Result<true>>;
  updatePassword: (password: string) => Promise<Result<true>>;
  refreshProfile: () => Promise<Profile | null>;
  updateProfile: (patch: ProfileUpdate) => Promise<Result<Profile>>;
  /** Replace the cached profile after an update done elsewhere (e.g. avatar upload). */
  setProfile: (profile: Profile) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<AppError | null>(null);
  const loadedForUser = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string | null): Promise<Profile | null> => {
    if (!userId) {
      loadedForUser.current = null;
      setProfile(null);
      return null;
    }
    const res = await UserApi.me();
    if (res.error) {
      setAuthError(res.error);
      return null;
    }
    loadedForUser.current = userId;
    setProfile(res.data);
    return res.data;
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) setAuthError(toAppError(error, 'Could not restore your session'));
      setSession(data.session);
      await loadProfile(data.session?.user.id ?? null);
      if (active) setIsLoadingAuth(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      const uid = next?.user.id ?? null;
      // Calling supabase inside this callback can deadlock the auth lock; defer it.
      if (event === 'SIGNED_OUT') {
        loadedForUser.current = null;
        setProfile(null);
      } else if (uid && uid !== loadedForUser.current) {
        setTimeout(() => {
          if (active) void loadProfile(uid);
        }, 0);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback<AuthContextValue['signIn']>(async (email, password) => {
    setAuthError(null);
    const res = await attempt(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      return true as const;
    }, 'Sign in failed');
    if (res.error) setAuthError(res.error);
    return res;
  }, []);

  const signUp = useCallback<AuthContextValue['signUp']>(async ({ email, password, fullName, phone }) => {
    setAuthError(null);
    const res = await attempt(async () => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim(), phone: phone?.trim() || null },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
      return { needsConfirmation: !data.session };
    }, 'Sign up failed');
    if (res.error) setAuthError(res.error);
    return res;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(toAppError(error, 'Sign out failed'));
    setSession(null);
    setProfile(null);
    loadedForUser.current = null;
  }, []);

  const sendPasswordReset = useCallback<AuthContextValue['sendPasswordReset']>(
    (email) =>
      attempt(async () => {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        return true as const;
      }, 'Could not send the reset email'),
    [],
  );

  const updatePassword = useCallback<AuthContextValue['updatePassword']>(
    (password) =>
      attempt(async () => {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        return true as const;
      }, 'Could not update the password'),
    [],
  );

  const refreshProfile = useCallback(
    () => loadProfile(session?.user.id ?? null),
    [loadProfile, session?.user.id],
  );

  const updateProfile = useCallback<AuthContextValue['updateProfile']>(async (patch) => {
    const res = await UserApi.update(patch);
    if (res.data) setProfile(res.data);
    return res;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      isLoadingAuth,
      isAuthenticated: !!session,
      authError,
      clearAuthError: () => setAuthError(null),
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      updatePassword,
      refreshProfile,
      updateProfile,
      setProfile,
    }),
    [session, profile, isLoadingAuth, authError, signIn, signUp, signOut, sendPasswordReset, updatePassword, refreshProfile, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Convenience: the signed-in user's id, or throws if used on a public page. */
// eslint-disable-next-line react-refresh/only-export-components
export function useUserId(): string {
  const { user } = useAuth();
  if (!user) throw new Error('useUserId requires an authenticated user');
  return user.id;
}
