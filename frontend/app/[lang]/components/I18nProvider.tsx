"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Dictionary } from "../dictionaries";
import type { Locale } from "@/lib/i18n";

interface I18nContextType {
  locale: Locale;
  dictionary: Dictionary;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

interface I18nProviderProps {
  children: ReactNode;
  locale: Locale;
  dictionary: Dictionary;
}

export function I18nProvider({ children, locale, dictionary }: I18nProviderProps) {
  // Helper function to get nested translation by dot-notation key
  const t = (key: string): string => {
    const keys = key.split(".");
    let value: unknown = dictionary;

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        console.warn(`Translation key not found: ${key}`);
        return key;
      }
    }

    return typeof value === "string" ? value : key;
  };

  return (
    <I18nContext.Provider value={{ locale, dictionary, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}

export function useTranslation() {
  const { t, dictionary } = useI18n();
  return { t, dictionary };
}

export function useLocale() {
  const { locale } = useI18n();
  return locale;
}
