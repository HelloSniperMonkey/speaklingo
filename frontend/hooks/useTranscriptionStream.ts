"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface TranscriptionMessage {
  type: "transcription" | "status" | "error";
  hash?: string;
  roomId?: string;
  userId?: string;
  sessionId?: string;
  text?: string;
  language?: string;
  isFinal?: boolean;
  finalizedBySilence?: boolean;
  timestamp?: number;
  processingTime?: number;
}

/**
 * Hook to subscribe to transcription broadcasts from the room.
 * This receives transcriptions published by other users in the same room.
 */
export function useTranscriptionStream(roomId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [transcription, setTranscription] = useState<TranscriptionMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (!roomId) return;

    // Connect to the transcription broadcast WebSocket
    // This assumes a WebSocket server that broadcasts transcriptions for a room
    // We'll use the translation WS server port 8767 but with transcription subscription
    const ws = new WebSocket("ws://localhost:8766");

    ws.onopen = () => {
      console.log("[TranscriptionStream] Connected");
      
      // Subscribe to room transcriptions
      ws.send(JSON.stringify({
        command: "subscribe",
        roomId: roomId,
      }));
      
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const data: TranscriptionMessage = JSON.parse(event.data);
        
        if (data.type === "transcription") {
          setTranscription(data);
        } else if (data.type === "error") {
          console.error("[TranscriptionStream] Error:", data);
          setError(data.text || "Unknown error");
        }
      } catch (e) {
        console.error("[TranscriptionStream] Failed to parse message:", e);
      }
    };

    ws.onclose = () => {
      console.log("[TranscriptionStream] Disconnected");
      setIsConnected(false);
      
      // Attempt reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = (event) => {
      console.error("[TranscriptionStream] WebSocket error:", event);
      setError("Connection error");
    };

    wsRef.current = ws;
  }, [roomId]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Connect on mount if roomId is available
  useEffect(() => {
    if (roomId) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [roomId, connect, disconnect]);

  return {
    transcription,
    isConnected,
    error,
    connect,
    disconnect,
  };
}
