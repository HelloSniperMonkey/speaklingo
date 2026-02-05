import { notFound } from "next/navigation";
import { locales, isRtlLocale, type Locale } from "@/lib/i18n";
import { hasLocale, getDictionary } from "./dictionaries";
import { I18nProvider } from "./components/I18nProvider";
import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "WebRTC Translator | Lingo.dev Demo",
  description:
    "Real-time video chat with AI-powered live translation using Lingo.dev SDK",
};

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function LocaleLayout({ children, params }: LayoutProps) {
  const { lang } = await params;

  // Validate locale - returns 404 if not supported
  if (!hasLocale(lang)) {
    notFound();
  }

  const dictionary = await getDictionary(lang);
  const dir = isRtlLocale(lang as Locale) ? "rtl" : "ltr";

  return (
    <html lang={lang} dir={dir}>
      <body className="gradient-bg antialiased">
        <I18nProvider locale={lang} dictionary={dictionary}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
