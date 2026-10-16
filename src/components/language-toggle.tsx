"use client";

import { useTransition } from "react";
import { setLocale } from "@/app/actions/locale";
import type { Locale } from "@/i18n";
import { useI18n } from "@/i18n/client";

const OPTIONS: Locale[] = ["en", "zh"];

/** Segmented ENG / CN switch (英 / 华 in Chinese mode); the active language is highlighted. */
export function LanguageToggle() {
  const { locale, t } = useI18n();
  const [pending, startTransition] = useTransition();
  return (
    <div
      role="group"
      aria-label={t.language.label}
      className={`flex rounded-xl border border-[var(--border)] bg-white p-0.5 text-sm font-semibold ${pending ? "opacity-60" : ""}`}
    >
      {OPTIONS.map((option, i) => (
        <span key={option} className="flex items-center">
          {i > 0 && <span className="px-0.5 text-[var(--muted)]">/</span>}
          <button
            type="button"
            disabled={pending}
            aria-pressed={locale === option}
            onClick={() => locale !== option && startTransition(() => setLocale(option))}
            className={`min-w-11 rounded-lg px-2.5 py-1.5 ${
              locale === option ? "bg-[var(--primary)] text-white" : "text-[var(--muted)] hover:bg-slate-100"
            }`}
          >
            {t.language[option]}
          </button>
        </span>
      ))}
    </div>
  );
}
