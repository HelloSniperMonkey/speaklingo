"use client";

import { useTranslation } from "@/app/[lang]/components/I18nProvider";

interface SubtitlePanelProps {
  originalText: string;
  translatedText: string;
  isTranscribing: boolean;
  isTranslating: boolean;
  targetLanguage: string;
}

export function SubtitlePanel({
  originalText,
  translatedText,
  isTranscribing,
  isTranslating,
  targetLanguage,
}: SubtitlePanelProps) {
  const { t } = useTranslation();
  const hasContent = originalText || translatedText;

  return (
    <div className="subtitle-panel p-6 mt-4">
      {/* Original text (what friend is saying) */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-[var(--foreground)] opacity-50 uppercase tracking-widest">
            {t("subtitle.original")}
          </span>
          {isTranscribing && (
            <span className="flex items-center gap-1 text-xs text-blue-300 font-bold animate-pulse">
              <span className="w-2 h-2 bg-blue-400 rounded-full" />
              {t("subtitle.listening")}
            </span>
          )}
        </div>
        <p className="text-[var(--foreground)] opacity-70 text-lg font-hand min-h-[28px] leading-relaxed">
          {originalText || (
            <span className="opacity-30 italic">
              {t("subtitle.waitingForSpeech")}
            </span>
          )}
        </p>
      </div>

      {/* Divider */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-30 my-4" />

      {/* Translated text */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-[var(--foreground)] opacity-50 uppercase tracking-widest">
            {t("subtitle.translated")} ({targetLanguage})
          </span>
          {isTranslating && (
            <span className="flex items-center gap-1 text-xs text-green-300 font-bold animate-pulse">
              <span className="w-2 h-2 bg-green-400 rounded-full" />
              {t("subtitle.translating")}
            </span>
          )}
        </div>
        <p
          className={`text-[var(--foreground)] text-xl font-bold font-hand min-h-[32px] leading-relaxed ${hasContent && translatedText ? "fade-in" : ""
            }`}
        >
          {translatedText || (
            <span className="opacity-30 italic font-normal">
              {t("subtitle.translationPlaceholder")}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

