"use client";

import { LANGUAGES } from "@/lib/languages";

interface LanguageSelectorProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

export function LanguageSelector({
  value,
  onChange,
  label = "Translate to",
}: LanguageSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-400 whitespace-nowrap">{label}:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="select-field text-sm"
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
}
