"use client";

import { useRouter, usePathname } from "next/navigation";
import { locales, type Locale } from "@/lib/i18n";
import { useLocale } from "./I18nProvider";

const LOCALE_COOKIE = "NEXT_LOCALE";

// Language names in their native script
const localeNames: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  it: "Italiano",
  ru: "Русский",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  ar: "العربية",
  hi: "हिन्दी",
  nl: "Nederlands",
  pl: "Polski",
  tr: "Türkçe",
  vi: "Tiếng Việt",
  th: "ไทย",
  sv: "Svenska",
  uk: "Українська",
  id: "Bahasa Indonesia",
  cs: "Čeština",
  da: "Dansk",
  fi: "Suomi",
  el: "Ελληνικά",
  he: "עברית",
  hu: "Magyar",
  no: "Norsk",
  ro: "Română",
  sk: "Slovenčina",
  bg: "Български",
};

export function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale();

  const switchLocale = (newLocale: Locale) => {
    if (newLocale === currentLocale) return;

    // Set cookie for persistence
    document.cookie = `${LOCALE_COOKIE}=${newLocale};path=/;max-age=${60 * 60 * 24 * 365}`;

    // Replace current locale in pathname with new locale
    const segments = pathname.split("/");
    segments[1] = newLocale;
    const newPath = segments.join("/");

    router.push(newPath);
  };

  return (
    <select
      value={currentLocale}
      onChange={(e) => switchLocale(e.target.value as Locale)}
      className="sketch-select text-sm"
      aria-label="Select language"
    >
      {locales.map((locale) => (
        <option key={locale} value={locale}>
          {localeNames[locale]}
        </option>
      ))}
    </select>
  );
}
