// Supported locales for UI internationalization
export const locales = [
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "ru",
  "zh",
  "ja",
  "ko",
  "ar",
  "hi",
  "nl",
  "pl",
  "tr",
  "vi",
  "th",
  "sv",
  "uk",
  "id",
  "cs",
  "da",
  "fi",
  "el",
  "he",
  "hu",
  "no",
  "ro",
  "sk",
  "bg",
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

// RTL languages
export const rtlLocales: Locale[] = ["ar", "he"];

export function isRtlLocale(locale: Locale): boolean {
  return rtlLocales.includes(locale);
}
