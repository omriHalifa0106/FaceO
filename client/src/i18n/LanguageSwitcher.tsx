// src/i18n/LanguageSwitcher.tsx — compact language picker
import { Languages } from 'lucide-react';
import { LANGUAGES, useI18n, type Lang } from '@/i18n/I18nProvider';

export default function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <label className={`flex items-center gap-2 text-sm text-slate-600 ${className}`}>
      <Languages size={16} aria-hidden />
      <span className="sr-only">{t.common.language}</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
        aria-label={t.common.language}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
