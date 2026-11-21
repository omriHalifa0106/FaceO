// src/lib/supabaseClient.ts — the single Supabase client for the app
import { createClient } from '@supabase/supabase-js';

function requireEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy client/.env.example to client/.env and fill it in.`);
  }
  return value;
}

export const supabase = createClient(
  requireEnv('VITE_SUPABASE_URL'),
  requireEnv('VITE_SUPABASE_ANON_KEY'),
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // email confirmation / password reset links
    },
  },
);

/** Public URL for an object stored in Cloudflare R2. */
export function r2PublicUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const base = requireEnv('VITE_R2_PUBLIC_URL').replace(/\/+$/, '');
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
