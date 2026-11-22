// src/i18n/I18nProvider.tsx — language selection, RTL, and typed translations.
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type Dict } from '@/i18n/en';
import { he } from '@/i18n/he';

export type Lang = 'en' | 'he';

export const LANGUAGES: Array<{ code: Lang; label: string; dir: 'ltr' | 'rtl' }> = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'he', label: 'עברית', dir: 'rtl' },
];

const DICTS: Record<Lang, Dict> = { en, he };
const STORAGE_KEY = 'faceo.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'he') return saved;
  } catch {
    /* storage unavailable (private mode etc.) */
  }
  const browser = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase();
  return browser.startsWith('he') || browser.startsWith('iw') ? 'he' : 'en';
}

function applyToDocument(lang: Lang) {
  const meta = LANGUAGES.find((l) => l.code === lang)!;
  document.documentElement.lang = lang;
  document.documentElement.dir = meta.dir;
}

interface I18nValue {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  t: Dict;
  setLang: (lang: Lang) => void;
  /** Translate a message that came from the server / an Error (best effort). */
  translateError: (message: string) => string;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = initialLang();
    applyToDocument(l); // before first paint, so RTL never flashes
    return l;
  });

  useEffect(() => applyToDocument(lang), [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setLangState(next);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const t = DICTS[lang];
    return {
      lang,
      dir: lang === 'he' ? 'rtl' : 'ltr',
      t,
      setLang,
      translateError: (message: string) => translateMessage(t, message),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Current UI locale for Intl formatting outside React (set by the provider on <html lang>). */
export function currentLocale(): string {
  return document.documentElement.lang === 'he' ? 'he-IL' : 'en';
}

/**
 * Map known English messages (data layer fallbacks, SQL exceptions, Supabase
 * Auth, upload validation) to the active language. Unknown messages pass through.
 */
function translateMessage(t: Dict, message: string): string {
  const exact = t.errors.exact[message as keyof typeof t.errors.exact];
  if (exact) return exact;
  for (const [pattern, render] of t.errors.patterns) {
    const m = message.match(pattern);
    if (m) return render(...m.slice(1));
  }
  return message;
}
