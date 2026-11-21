// src/hooks/usePaged.ts — paginated list with "load more", local edits and reload
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { AppError, Result } from '@/lib/result';
import type { Page } from '@/api/entities';

export function usePaged<T>(loader: (page: Page) => Promise<Result<T[]>>, deps: DependencyList, pageSize = 60) {
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const loaderRef = useRef(loader);
  const requestId = useRef(0);
  const countRef = useRef(0);

  useEffect(() => {
    loaderRef.current = loader;
  });

  const loadFirst = useCallback(async () => {
    const id = ++requestId.current;
    const res = await loaderRef.current({ limit: pageSize, offset: 0 });
    if (id !== requestId.current) return;
    const rows = res.data ?? [];
    countRef.current = rows.length;
    setItems(rows);
    setHasMore(rows.length === pageSize);
    setError(res.error);
    setLoading(false);
  }, [pageSize]);

  useEffect(() => {
    void loadFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(async () => {
    setLoading(true);
    await loadFirst();
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    const id = requestId.current;
    setLoadingMore(true);
    const res = await loaderRef.current({ limit: pageSize, offset: countRef.current });
    setLoadingMore(false);
    if (id !== requestId.current) return; // list was reset meanwhile
    if (res.error) return setError(res.error);
    countRef.current += res.data.length;
    setItems((prev) => [...prev, ...res.data]);
    setHasMore(res.data.length === pageSize);
  }, [pageSize]);

  /** Remove an item locally (e.g. after delete) without refetching. */
  const removeWhere = useCallback((pred: (item: T) => boolean) => {
    setItems((prev) => {
      const next = prev.filter((x) => !pred(x));
      countRef.current -= prev.length - next.length;
      return next;
    });
  }, []);

  return { items, hasMore, loading, loadingMore, error, reload, loadMore, removeWhere };
}
