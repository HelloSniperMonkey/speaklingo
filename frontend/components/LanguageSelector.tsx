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
  label = "My spoken language",
}: LanguageSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-bold opacity-70 whitespace-nowrap">{label}:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sketch-select text-sm py-2 px-4 min-w-[150px]"
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code} className="text-black bg-white">
            {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
}
