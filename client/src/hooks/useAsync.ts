// src/hooks/useAsync.ts — load a Result<T> and expose loading / error / reload
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { AppError, Result } from '@/lib/result';

export interface AsyncState<T> {
  data: T | null;
  error: AppError | null;
  loading: boolean;
  /** Re-run the loader; resolves with the fresh result. */
  reload: () => Promise<Result<T>>;
  /** Optimistically replace the data locally. */
  setData: (updater: T | ((prev: T | null) => T)) => void;
}

export function useAsync<T>(loader: () => Promise<Result<T>>, deps: DependencyList): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  const requestId = useRef(0);

  useEffect(() => {
    loaderRef.current = loader;
  });

  const run = useCallback(async (): Promise<Result<T>> => {
    const id = ++requestId.current;
    const res = await loaderRef.current();
    if (id === requestId.current) {
      setDataState(res.data);
      setError(res.error);
      setLoading(false);
    }
    return res;
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(async () => {
    setLoading(true);
    return run();
  }, [run]);

  const setData = useCallback((updater: T | ((prev: T | null) => T)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (p: T | null) => T)(prev) : updater));
  }, []);

  return { data, error, loading, reload, setData };
}
