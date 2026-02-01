export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

// Supported languages for translation
// Using short locale codes that Lingo.dev supports
export const LANGUAGES: Language[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Espanol" },
  { code: "fr", name: "French", nativeName: "Francais" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "pt", name: "Portuguese", nativeName: "Portugues" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "ru", name: "Russian", nativeName: "Russkiy" },
  { code: "zh", name: "Chinese", nativeName: "Zhongwen" },
  { code: "ja", name: "Japanese", nativeName: "Nihongo" },
  { code: "ko", name: "Korean", nativeName: "Hangugeo" },
  { code: "ar", name: "Arabic", nativeName: "Al-Arabiyyah" },
  { code: "hi", name: "Hindi", nativeName: "Hindi" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "tr", name: "Turkish", nativeName: "Turkce" },
  { code: "vi", name: "Vietnamese", nativeName: "Tieng Viet" },
  { code: "th", name: "Thai", nativeName: "Phasa Thai" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "uk", name: "Ukrainian", nativeName: "Ukrayinska" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "cs", name: "Czech", nativeName: "Cestina" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "el", name: "Greek", nativeName: "Ellinika" },
  { code: "he", name: "Hebrew", nativeName: "Ivrit" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  { code: "no", name: "Norwegian", nativeName: "Norsk" },
  { code: "ro", name: "Romanian", nativeName: "Romana" },
  { code: "sk", name: "Slovak", nativeName: "Slovencina" },
  { code: "bg", name: "Bulgarian", nativeName: "Balgarski" },
];

// Get language by code
export function getLanguageByCode(code: string): Language | undefined {
  return LANGUAGES.find((lang) => lang.code === code);
}

// Get language name by code
export function getLanguageName(code: string): string {
  return getLanguageByCode(code)?.name ?? code.toUpperCase();
}
