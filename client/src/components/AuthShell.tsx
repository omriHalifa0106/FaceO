// src/components/AuthShell.tsx — centered card used by the public auth pages
import type { ReactNode } from 'react';
import LanguageSwitcher from '@/i18n/LanguageSwitcher';

export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <p className="mb-6 text-center text-3xl font-bold text-slate-900" dir="ltr">
          Face<span className="text-teal-500">O</span>
        </p>
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
