"use client";

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
  const hasContent = originalText || translatedText;

  return (
    <div className="subtitle-panel p-4 mt-4">
      {/* Original text (what friend is saying) */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Original
          </span>
          {isTranscribing && (
            <span className="flex items-center gap-1 text-xs text-blue-400">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full pulse" />
              Listening...
            </span>
          )}
        </div>
        <p className="text-gray-400 text-base min-h-[24px]">
          {originalText || (
            <span className="text-gray-600 italic">
              Waiting for speech...
            </span>
          )}
        </p>
      </div>

      {/* Divider */}
      <hr className="border-white/10 my-3" />

      {/* Translated text */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Translated ({targetLanguage})
          </span>
          {isTranslating && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full pulse" />
              Translating...
            </span>
          )}
        </div>
        <p
          className={`text-white text-lg font-medium min-h-[28px] ${
            hasContent && translatedText ? "fade-in" : ""
          }`}
        >
          {translatedText || (
            <span className="text-gray-600 italic font-normal">
              Translation will appear here...
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
