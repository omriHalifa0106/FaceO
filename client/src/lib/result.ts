// src/lib/result.ts — one error/result shape for every data-layer call

export interface AppError {
  /** Human-readable message, safe to show in the UI. */
  message: string;
  /** Postgres / PostgREST / HTTP code when available (e.g. '42501', 'PGRST116', '403'). */
  code: string | null;
  /** Original error for logging. */
  cause?: unknown;
}

export type Result<T> = { data: T; error: null } | { data: null; error: AppError };

export const ok = <T>(data: T): Result<T> => ({ data, error: null });
export const fail = <T = never>(error: AppError): Result<T> => ({ data: null, error });

const FRIENDLY_BY_CODE: Record<string, string> = {
  '42501': 'You do not have permission to do that.',
  PGRST116: 'Not found.',
  '23505': 'That already exists.',
  '23514': 'Some values are invalid.',
};

/** Normalise anything thrown or returned by supabase-js / fetch into an AppError. */
export function toAppError(err: unknown, fallback = 'Something went wrong'): AppError {
  if (!err) return { message: fallback, code: null };
  if (typeof err === 'string') return { message: err, code: null };

  const e = err as { message?: string; code?: string | number; status?: number; details?: string };
  const code = e.code != null ? String(e.code) : e.status != null ? String(e.status) : null;
  // Messages raised by our SQL functions (P0001/P0002/22023/23505) are written for users.
  const raw = e.message?.trim();
  const message = raw && raw.length < 300 ? raw : (code && FRIENDLY_BY_CODE[code]) || fallback;
  return { message, code, cause: err };
}

/** Run an async operation and capture failures as a Result. */
export async function attempt<T>(fn: () => Promise<T>, fallback?: string): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (err) {
    const appErr = toAppError(err, fallback);
    if (import.meta.env.DEV) console.error('[FaceO]', appErr.message, err);
    return fail(appErr);
  }
}

/** Throw on error — for places where a Result is inconvenient (e.g. Promise.all). */
export function unwrap<T>(result: Result<T>): T {
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.data as T;
}
