"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice Mode:
 * - "dev": Play processed voice locally for testing (you hear your own translated voice)
 * - "prod": Send processed voice to remote peer via WebRTC data channel
 */
const VOICE_MODE = process.env.NEXT_PUBLIC_VOICE_MODE || "dev";

// Voice chunk message from WebSocket
interface VoiceChunkMessage {
  type: "voice_chunk" | "voice_error" | "status" | "pong" | "invalidation";
  hash?: string;
  sessionId?: string;
  roomId?: string;
  userId?: string;  // The speaker (who said the original text)
  targetUserId?: string;  // The listener (whose voice is used for TTS, who should hear this)
  chunkIndex?: number;
  totalChunks?: number;
  audioBase64?: string;
  sampleRate?: number;
  text?: string;
  generationTimeMs?: number;
  audioDurationMs?: number;
  timestamp?: number;
  error?: string;
  status?: string;
}

// Latency metrics
interface VoiceLatencyMetrics {
  generationTimeMs: number;
  networkLatencyMs: number;
  totalLatencyMs: number;
  bufferSizeChunks: number;
  isPlaying: boolean;
}

interface UseProcessedVoiceOptions {
  roomId: string;
  userId: string; // 'local-user' or 'remote-user'
  peerConnection?: RTCPeerConnection | null;
  wsUrl?: string;
}

interface UseProcessedVoiceReturn {
  isConnected: boolean;
  isPlaying: boolean;
  latencyMetrics: VoiceLatencyMetrics | null;
  currentText: string;
  error: string | null;
  voiceMode: string;
  // Methods
  connect: () => void;
  disconnect: () => void;
  setMuted: (muted: boolean) => void;
  isMuted: boolean;
  isPaused: boolean;
  setPaused: (paused: boolean) => void;
  // Data channel for receiving remote processed voice
  dataChannel: RTCDataChannel | null;
  setDataChannel: (channel: RTCDataChannel | null) => void;
}

const DEFAULT_WS_URL = "ws://localhost:8768";

export function useProcessedVoice({
  roomId,
  userId,
  peerConnection,
  wsUrl = DEFAULT_WS_URL,
}: UseProcessedVoiceOptions): UseProcessedVoiceReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState("");
  const [latencyMetrics, setLatencyMetrics] = useState<VoiceLatencyMetrics | null>(null);
  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Hash tracking for invalidation
  const currentAudioHashRef = useRef<string | null>(null);
  const invalidatedHashesRef = useRef<Set<string>>(new Set());
  const audioBufferHashMapRef = useRef<Map<AudioBuffer, string>>(new Map());
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Get/create AudioContext
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  // Decode base64 audio chunk to AudioBuffer
  const decodeAudioChunk = useCallback(
    async (base64Audio: string, sampleRate: number): Promise<AudioBuffer> => {
      const ctx = getAudioContext();
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return await ctx.decodeAudioData(bytes.buffer);
    },
    [getAudioContext]
  );

  // Play next chunk from queue
  const playNextChunk = useCallback(() => {
    if (isMuted || isPaused || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      return;
    }

    // Skip invalidated buffers
    let buffer = audioQueueRef.current.shift();
    while (buffer) {
      const bufferHash = audioBufferHashMapRef.current.get(buffer);
      const baseHash = bufferHash?.replace("_au", "");
      if (baseHash && invalidatedHashesRef.current.has(baseHash)) {
        audioBufferHashMapRef.current.delete(buffer);
        buffer = audioQueueRef.current.shift();
        continue;
      }
      break;
    }

    if (!buffer) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      return;
    }

    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    currentSourceRef.current = source;

    const now = ctx.currentTime;
    const startTime = Math.max(now, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;

    source.onended = () => {
      audioBufferHashMapRef.current.delete(buffer!);
      if (currentSourceRef.current === source) {
        currentSourceRef.current = null;
      }
      if (audioQueueRef.current.length > 0) {
        playNextChunk();
      } else {
        isPlayingRef.current = false;
        setIsPlaying(false);
      }
    };

    isPlayingRef.current = true;
    setIsPlaying(true);

    setLatencyMetrics((prev) => ({
      ...(prev || {
        generationTimeMs: 0,
        networkLatencyMs: 0,
        totalLatencyMs: 0,
        bufferSizeChunks: 0,
        isPlaying: true,
      }),
      bufferSizeChunks: audioQueueRef.current.length,
      isPlaying: true,
    }));
  }, [isMuted, isPaused, getAudioContext]);

  // Send voice chunk to remote peer via data channel (PROD mode)
  const sendToRemotePeer = useCallback(
    (message: VoiceChunkMessage) => {
      if (dataChannel && dataChannel.readyState === "open") {
        try {
          dataChannel.send(JSON.stringify({
            ...message,
            type: "processed_voice",
          }));
          console.log("[ProcessedVoice] Sent voice chunk to remote peer");
        } catch (err) {
          console.error("[ProcessedVoice] Failed to send via data channel:", err);
        }
      }
    },
    [dataChannel]
  );

  // Handle incoming voice chunk from backend
  const handleVoiceChunk = useCallback(
    async (message: VoiceChunkMessage) => {
      if (!message.audioBase64 || !message.sampleRate) return;

      // Voice routing logic for 2-way communication:
      // - userId: The speaker (who said the original text)
      // - targetUserId: The listener (who should hear this audio, whose voice was used)
      // 
      // In production mode:
      // - If targetUserId === my userId, this audio is FOR ME to hear (I'm the listener)
      // - If targetUserId !== my userId, this audio is for the OTHER person
      //
      // Note: The backend sets targetUserId to the opposite of userId:
      // - When local-user speaks, targetUserId is remote-user
      // - When remote-user speaks, targetUserId is local-user
      
      const targetUser = message.targetUserId;
      const speakerUser = message.userId;
      
      // Check if this audio is for me (I'm the target/listener)
      const isForMe = targetUser === userId;
      
      // Skip if this audio's hash has been invalidated
      const baseHash = message.hash?.replace("_au", "");
      if (baseHash && invalidatedHashesRef.current.has(baseHash)) {
        console.log(`[ProcessedVoice] Ignoring invalidated audio ${message.hash}`);
        return;
      }

      // DEV mode: Play all processed voice locally for testing
      // PROD mode: Only play audio that is targeted FOR ME
      
      if (VOICE_MODE === "dev") {
        // In dev mode, play everything locally to test the TTS output
        console.log(`[ProcessedVoice] DEV mode: Playing voice chunk locally (speaker: ${speakerUser}, target: ${targetUser}, me: ${userId})`);
        await playVoiceLocally(message);
      } else {
        // PROD mode - only play audio targeted for me
        if (isForMe) {
          // This audio is FOR ME - play it locally
          console.log(`[ProcessedVoice] PROD mode: Playing audio targeted for me (speaker: ${speakerUser})`);
          await playVoiceLocally(message);
        } else {
          // This audio is for someone else - ignore it
          console.log(`[ProcessedVoice] PROD mode: Ignoring audio not for me (target: ${targetUser}, me: ${userId})`);
        }
      }
    },
    [userId]
  );

  // Play voice chunk locally
  const playVoiceLocally = useCallback(
    async (message: VoiceChunkMessage) => {
      if (!message.audioBase64 || !message.sampleRate) return;

      try {
        const audioBuffer = await decodeAudioChunk(
          message.audioBase64,
          message.sampleRate
        );

        if (message.hash) {
          audioBufferHashMapRef.current.set(audioBuffer, message.hash);
          currentAudioHashRef.current = message.hash;
        }

        audioQueueRef.current.push(audioBuffer);

        if (message.text) {
          setCurrentText(message.text);
        }

        if (message.timestamp && message.generationTimeMs) {
          const networkLatencyMs = Date.now() - message.timestamp * 1000;
          setLatencyMetrics({
            generationTimeMs: message.generationTimeMs,
            networkLatencyMs: Math.max(0, networkLatencyMs),
            totalLatencyMs: message.generationTimeMs + Math.max(0, networkLatencyMs),
            bufferSizeChunks: audioQueueRef.current.length,
            isPlaying: isPlayingRef.current,
          });
        }

        if (!isPlayingRef.current && !isMuted && !isPaused) {
          playNextChunk();
        }
      } catch (err) {
        console.error("[ProcessedVoice] Failed to decode audio:", err);
      }
    },
    [decodeAudioChunk, isMuted, isPaused, playNextChunk]
  );

  // Handle messages from WebSocket
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: VoiceChunkMessage = JSON.parse(event.data);

        switch (message.type) {
          case "voice_chunk":
            handleVoiceChunk(message);
            break;

          case "invalidation":
            const baseHash = message.hash;
            if (baseHash) {
              console.log(`[ProcessedVoice] Received invalidation for ${baseHash}`);
              invalidatedHashesRef.current.add(baseHash);
              const auHash = `${baseHash}_au`;

              // Stop currently playing if invalidated
              if (currentSourceRef.current && currentAudioHashRef.current === auHash) {
                try {
                  currentSourceRef.current.stop();
                } catch (e) {}
                currentSourceRef.current = null;
                isPlayingRef.current = false;
                setIsPlaying(false);
              }

              // Remove from queue
              audioQueueRef.current = audioQueueRef.current.filter((buffer) => {
                const bHash = audioBufferHashMapRef.current.get(buffer);
                if (bHash === auHash) {
                  audioBufferHashMapRef.current.delete(buffer);
                  return false;
                }
                return true;
              });

              if (currentAudioHashRef.current === auHash) {
                setCurrentText("");
                currentAudioHashRef.current = null;
              }

              // Cleanup old invalidations
              if (invalidatedHashesRef.current.size > 100) {
                const toDelete = Array.from(invalidatedHashesRef.current).slice(0, 20);
                toDelete.forEach((h) => invalidatedHashesRef.current.delete(h));
              }
            }
            break;

          case "voice_error":
            setError(message.error || "Voice generation error");
            break;

          case "status":
            if (message.status === "connected") {
              setIsConnected(true);
              setError(null);
            }
            break;

          case "pong":
            break;

          default:
            console.log("[ProcessedVoice] Unknown message:", message);
        }
      } catch (err) {
        console.error("[ProcessedVoice] Failed to parse message:", err);
      }
    },
    [handleVoiceChunk]
  );

  // Handle processed voice from remote peer via data channel (PROD mode)
  const handleDataChannelMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "processed_voice") {
          console.log("[ProcessedVoice] Received processed voice from remote peer");
          // Play the remote peer's processed voice
          playVoiceLocally(message);
        }
      } catch (err) {
        console.error("[ProcessedVoice] Failed to parse data channel message:", err);
      }
    },
    [playVoiceLocally]
  );

  // Set up data channel listener when it changes
  useEffect(() => {
    if (dataChannel) {
      dataChannel.onmessage = handleDataChannelMessage;
      console.log("[ProcessedVoice] Data channel message handler attached");
    }
  }, [dataChannel, handleDataChannelMessage]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    console.log(`[ProcessedVoice] Connecting to voice stream (mode: ${VOICE_MODE}, userId: ${userId})`);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ command: "join", roomId, userId }));

      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ command: "ping" }));
        }
      }, 25000);
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      setIsConnected(false);
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error("[ProcessedVoice] WebSocket error:", err);
      setError("Connection error");
    };
  }, [wsUrl, roomId, userId, handleMessage]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {}
      currentSourceRef.current = null;
    }

    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    audioQueueRef.current = [];
  }, []);

  // Mute control
  const handleSetMuted = useCallback((muted: boolean) => {
    setIsMuted(muted);
    if (muted) {
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  }, []);

  // Pause control
  const handleSetPaused = useCallback(
    (paused: boolean) => {
      setIsPaused(paused);
      if (paused) {
        if (currentSourceRef.current) {
          try {
            currentSourceRef.current.stop();
          } catch (e) {}
          currentSourceRef.current = null;
        }
        isPlayingRef.current = false;
        setIsPlaying(false);
      } else {
        if (audioQueueRef.current.length > 0 && !isPlayingRef.current && !isMuted) {
          playNextChunk();
        }
      }
    },
    [isMuted, playNextChunk]
  );

  // Auto-connect on mount
  useEffect(() => {
    if (roomId) {
      connect();
    }
    return () => {
      disconnect();
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [roomId, connect, disconnect]);

  return {
    isConnected,
    isPlaying,
    latencyMetrics,
    currentText,
    error,
    voiceMode: VOICE_MODE,
    connect,
    disconnect,
    setMuted: handleSetMuted,
    isMuted,
    isPaused,
    setPaused: handleSetPaused,
    dataChannel,
    setDataChannel,
  };
}
