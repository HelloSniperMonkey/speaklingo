"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface TranslationMessage {
  type: "translation" | "status" | "error" | "invalidation";
  hash?: string;  // Translation hash (format: {uuid}_ml)
  roomId?: string;
  userId?: string;
  sessionId?: string;
  originalText?: string;
  translatedText?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  isFinal?: boolean;
  timestamp?: number;
  latencyMs?: number;
  status?: string;
  message?: string;
  metadata?: {
    transcriptionTimestamp?: number;
    totalLatencyMs?: number;
    cacheHit?: boolean;
    transcriptionHash?: string;
  };
}

export function useTranslationStream(roomId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [translation, setTranslation] = useState<TranslationMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  // Track recent translations by hash to handle invalidations
  const translationHistoryRef = useRef<Map<string, TranslationMessage>>(new Map());
  const invalidatedHashesRef = useRef<Set<string>>(new Set());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket("ws://localhost:8767");

    ws.onopen = () => {
      console.log("Connected to Translation Stream");
      
      // Join room
      ws.send(JSON.stringify({
        command: "join",
        roomId: roomId,
      }));
      
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const data: TranslationMessage = JSON.parse(event.data);
        
        if (data.type === "translation") {
          // Check if this translation's hash has been invalidated
          const baseHash = data.hash?.replace('_ml', '');
          if (baseHash && invalidatedHashesRef.current.has(baseHash)) {
            console.log(`Ignoring invalidated translation with hash ${data.hash}`);
            return;
          }
          
          // Store in history if has hash
          if (data.hash) {
            translationHistoryRef.current.set(data.hash, data);
            // Limit history size
            if (translationHistoryRef.current.size > 50) {
              const firstKey = translationHistoryRef.current.keys().next().value;
              if (firstKey) translationHistoryRef.current.delete(firstKey);
            }
          }
          
          setTranslation(data);
        } else if (data.type === "invalidation") {
          // Handle invalidation: mark hash as invalidated and clear if currently displayed
          const baseHash = data.hash;
          if (baseHash) {
            console.log(`Received invalidation for hash ${baseHash}`);
            invalidatedHashesRef.current.add(baseHash);
            
            // Remove from history
            const mlHash = `${baseHash}_ml`;
            translationHistoryRef.current.delete(mlHash);
            
            // Clear from display if currently showing invalidated translation
            if (translation?.hash === mlHash) {
              setTranslation(null);
            }
            
            // Clean up old invalidations (keep last 100)
            if (invalidatedHashesRef.current.size > 100) {
              const toDelete = Array.from(invalidatedHashesRef.current).slice(0, 20);
              toDelete.forEach(h => invalidatedHashesRef.current.delete(h));
            }
          }
        } else if (data.type === "error") {
          setError(data.message || "Unknown error");
        } else if (data.type === "status") {
          console.log("Translation stream status:", data.status);
        }
      } catch (err) {
        console.error("Failed to parse translation message:", err);
      }
    };

    ws.onclose = () => {
      console.log("Disconnected from Translation Stream");
      setIsConnected(false);
    };

    ws.onerror = (event) => {
      console.error("Translation WebSocket error:", event);
      setError("Connection error");
    };

    wsRef.current = ws;
  }, [roomId]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    isConnected,
    translation,
    error,
    connect,
    disconnect,
  };
}
