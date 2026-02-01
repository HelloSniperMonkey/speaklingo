"use client";

import { useState, useCallback, useRef } from "react";

interface TranslationResult {
  translated: string;
  latency_ms: number;
}

interface UseBackendTranslationReturn {
  translatedText: string;
  latency: number;
  isTranslating: boolean;
  error: string | null;
  translate: (text: string) => Promise<string | null>;
}

const BACKEND_URL = "http://localhost:8766";

export function useBackendTranslation(): UseBackendTranslationReturn {
  const [translatedText, setTranslatedText] = useState("");
  const [latency, setLatency] = useState(0);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cache to avoid re-translating the same text
  const cacheRef = useRef<Map<string, TranslationResult>>(new Map());

  const translate = useCallback(async (text: string): Promise<string | null> => {
    if (!text.trim()) {
      setTranslatedText("");
      setLatency(0);
      return null;
    }

    // Check cache
    const cached = cacheRef.current.get(text);
    if (cached) {
      setTranslatedText(cached.translated);
      setLatency(cached.latency_ms);
      return cached.translated;
    }

    setIsTranslating(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/translate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Translation failed");
      }

      const data: TranslationResult = await response.json();

      // Cache the result
      cacheRef.current.set(text, data);

      // Limit cache size
      if (cacheRef.current.size > 100) {
        const firstKey = cacheRef.current.keys().next().value;
        if (firstKey) {
          cacheRef.current.delete(firstKey);
        }
      }

      setTranslatedText(data.translated);
      setLatency(data.latency_ms);
      return data.translated;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Translation failed";
      setError(errorMessage);
      console.error("Translation error:", err);
      return null;
    } finally {
      setIsTranslating(false);
    }
  }, []);

  return {
    translatedText,
    latency,
    isTranslating,
    error,
    translate,
  };
}
