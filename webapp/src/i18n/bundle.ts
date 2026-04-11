import { flattenMessages, interpolate } from "./flatten";
import { en } from "./locales/en";
import { zh } from "./locales/zh";
import type { Locale } from "./types";

const flatZh = flattenMessages(zh as unknown as Record<string, unknown>);
const flatEn = flattenMessages(en as unknown as Record<string, unknown>);

export const dictionaries: Record<Locale, Record<string, string>> = {
  zh: flatZh,
  en: flatEn,
};

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const primary = locale === "en" ? flatEn : flatZh;
  const fallback = locale === "en" ? flatZh : flatEn;
  const raw = primary[key] ?? fallback[key] ?? key;
  return interpolate(raw, params);
}
