"use client";

import { useState, useCallback, useRef } from "react";

interface UseTranslationReturn {
  translatedText: string;
  isTranslating: boolean;
  error: string | null;
  translate: (text: string, targetLocale: string, sourceLocale?: string) => Promise<void>;
}

export function useTranslation(): UseTranslationReturn {
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cache to avoid re-translating the same text
  const cacheRef = useRef<Map<string, string>>(new Map());

  const translate = useCallback(
    async (text: string, targetLocale: string, sourceLocale?: string) => {
      if (!text.trim()) {
        setTranslatedText("");
        return;
      }

      // Check cache
      const cacheKey = `${text}:${sourceLocale || "auto"}:${targetLocale}`;
      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        setTranslatedText(cached);
        return;
      }

      setIsTranslating(true);
      setError(null);

      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            sourceLocale: sourceLocale || null,
            targetLocale,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Translation failed");
        }

        const data = await response.json();
        const translated = data.translated || "";

        // Cache the result
        cacheRef.current.set(cacheKey, translated);

        // Limit cache size
        if (cacheRef.current.size > 100) {
          const firstKey = cacheRef.current.keys().next().value;
          if (firstKey) {
            cacheRef.current.delete(firstKey);
          }
        }

        setTranslatedText(translated);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Translation failed";
        setError(errorMessage);
        console.error("Translation error:", err);
      } finally {
        setIsTranslating(false);
      }
    },
    []
  );

  return {
    translatedText,
    isTranslating,
    error,
    translate,
  };
}
