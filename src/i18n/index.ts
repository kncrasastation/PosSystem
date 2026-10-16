import { en, type Dictionary } from "./en";
import { zh } from "./zh";

export type { Dictionary, ErrorKey } from "./en";

export type Locale = "en" | "zh";
export const LOCALE_COOKIE = "fcpos_lang";
export const DEFAULT_LOCALE: Locale = "en";

const dictionaries: Record<Locale, Dictionary> = { en, zh };

export const isLocale = (v: unknown): v is Locale => v === "en" || v === "zh";
export const getDictionary = (locale: Locale): Dictionary => dictionaries[locale];

/** Name in the active language, falling back to English when no Chinese name is set. */
export function localName(locale: Locale, item: { name: string; nameZh: string | null }): string {
  return locale === "zh" && item.nameZh ? item.nameZh : item.name;
}

/** The other language's name, shown smaller underneath; null if it would just repeat. */
export function secondaryName(locale: Locale, item: { name: string; nameZh: string | null }): string | null {
  if (!item.nameZh) return null;
  return locale === "zh" ? item.name : item.nameZh;
}
