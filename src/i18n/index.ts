import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";

export type TranslationKey = keyof typeof en;
export type Translations = Record<TranslationKey, string>;

export const locales: Record<string, Partial<Translations>> = {
  en,
  es,
  fr,
};

/**
 * Resolve the best matching locale from an Accept-Language header value.
 * Falls back to "en".
 */
export function resolveLocale(acceptLanguage?: string): string {
  if (!acceptLanguage) return "en";
  for (const part of acceptLanguage.split(",")) {
    const lang = part.trim().split(/[-;]/)[0].toLowerCase();
    if (locales[lang]) return lang;
  }
  return "en";
}

/**
 * Return translations for the resolved Accept-Language locale,
 * falling back to English for any missing keys.
 */
export function getTranslations(acceptLanguage?: string): Translations {
  const locale = locales[resolveLocale(acceptLanguage)];
  if (!locale || locale === en) return en;

  const resolved: Record<string, string> = { ...en };
  for (const [key, value] of Object.entries(locale)) {
    if (typeof value === "string" && value.length > 0) {
      resolved[key] = value;
    }
  }
  return resolved as Translations;
}
