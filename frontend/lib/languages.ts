export interface Language {
  code: string;           // Lingo.dev/i18n code (e.g., "en", "es")
  googleLocale: string;   // Google Speech-to-Text locale (e.g., "en-US", "es-ES")
  name: string;
  nativeName: string;
}

// Supported languages for translation and transcription
// Using lingo.dev supported languages with corresponding Google STT locale codes
export const LANGUAGES: Language[] = [
  { code: "en", googleLocale: "en-US", name: "English", nativeName: "English" },
  { code: "es", googleLocale: "es-ES", name: "Spanish", nativeName: "Español" },
  { code: "fr", googleLocale: "fr-FR", name: "French", nativeName: "Français" },
  { code: "de", googleLocale: "de-DE", name: "German", nativeName: "Deutsch" },
  { code: "pt", googleLocale: "pt-BR", name: "Portuguese", nativeName: "Português" },
  { code: "it", googleLocale: "it-IT", name: "Italian", nativeName: "Italiano" },
  { code: "ru", googleLocale: "ru-RU", name: "Russian", nativeName: "Русский" },
  { code: "zh", googleLocale: "zh-CN", name: "Chinese", nativeName: "中文" },
  { code: "ja", googleLocale: "ja-JP", name: "Japanese", nativeName: "日本語" },
  { code: "ko", googleLocale: "ko-KR", name: "Korean", nativeName: "한국어" },
  { code: "ar", googleLocale: "ar-SA", name: "Arabic", nativeName: "العربية" },
  { code: "hi", googleLocale: "hi-IN", name: "Hindi", nativeName: "हिन्दी" },
  { code: "nl", googleLocale: "nl-NL", name: "Dutch", nativeName: "Nederlands" },
  { code: "pl", googleLocale: "pl-PL", name: "Polish", nativeName: "Polski" },
  { code: "tr", googleLocale: "tr-TR", name: "Turkish", nativeName: "Türkçe" },
  { code: "vi", googleLocale: "vi-VN", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "th", googleLocale: "th-TH", name: "Thai", nativeName: "ภาษาไทย" },
  { code: "sv", googleLocale: "sv-SE", name: "Swedish", nativeName: "Svenska" },
  { code: "uk", googleLocale: "uk-UA", name: "Ukrainian", nativeName: "Українська" },
  { code: "id", googleLocale: "id-ID", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "cs", googleLocale: "cs-CZ", name: "Czech", nativeName: "Čeština" },
  { code: "da", googleLocale: "da-DK", name: "Danish", nativeName: "Dansk" },
  { code: "fi", googleLocale: "fi-FI", name: "Finnish", nativeName: "Suomi" },
  { code: "el", googleLocale: "el-GR", name: "Greek", nativeName: "Ελληνικά" },
  { code: "he", googleLocale: "he-IL", name: "Hebrew", nativeName: "עברית" },
  { code: "hu", googleLocale: "hu-HU", name: "Hungarian", nativeName: "Magyar" },
  { code: "no", googleLocale: "no-NO", name: "Norwegian", nativeName: "Norsk" },
  { code: "ro", googleLocale: "ro-RO", name: "Romanian", nativeName: "Română" },
  { code: "sk", googleLocale: "sk-SK", name: "Slovak", nativeName: "Slovenčina" },
  { code: "bg", googleLocale: "bg-BG", name: "Bulgarian", nativeName: "Български" },
];

// Get language by code
export function getLanguageByCode(code: string): Language | undefined {
  return LANGUAGES.find((lang) => lang.code === code);
}

// Get language name by code
export function getLanguageName(code: string): string {
  return getLanguageByCode(code)?.name ?? code.toUpperCase();
}

// Get Google Speech-to-Text locale by language code
export function getGoogleLocale(code: string): string {
  return getLanguageByCode(code)?.googleLocale ?? "en-US";
}
