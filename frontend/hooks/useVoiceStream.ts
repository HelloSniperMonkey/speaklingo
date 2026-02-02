import { useCallback, useEffect, useRef, useState } from "react";
import { API_CONFIG } from "@/lib/apiConfig";

// Voice chunk message from WebSocket
interface VoiceChunkMessage {
  type: "voice_chunk" | "voice_error" | "status" | "pong" | "invalidation";
  hash?: string;  // Audio hash (format: {uuid}_au)
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

interface UseVoiceStreamOptions {
  roomId: string;
  autoPlay?: boolean;
  wsUrl?: string;
}

interface UseVoiceStreamReturn {
  isConnected: boolean;
  isPlaying: boolean;
  latencyMetrics: VoiceLatencyMetrics | null;
  currentText: string;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  setMuted: (muted: boolean) => void;
  isMuted: boolean;
  isPaused: boolean;
  setPaused: (paused: boolean) => void;
}

const DEFAULT_WS_URL = API_CONFIG.ws.voice;

export function useVoiceStream({
  roomId,
  autoPlay = true,
  wsUrl = DEFAULT_WS_URL,
}: UseVoiceStreamOptions): UseVoiceStreamReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState("");
  const [latencyMetrics, setLatencyMetrics] = useState<VoiceLatencyMetrics | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Session tracking for chunk assembly - buffer chunks until all arrive
  const currentSessionRef = useRef<string | null>(null);
  const sessionChunksRef = useRef<Map<string, Map<number, { buffer: AudioBuffer; message: VoiceChunkMessage }>>>(new Map());
  const sessionTotalChunksRef = useRef<Map<string, number>>(new Map());
  const sessionHashRef = useRef<Map<string, string>>(new Map()); // sessionId -> hash
  
  // Hash tracking for invalidation
  const currentAudioHashRef = useRef<string | null>(null);
  const invalidatedHashesRef = useRef<Set<string>>(new Set());
  const audioBufferHashMapRef = useRef<Map<AudioBuffer, string>>(new Map());
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Initialize AudioContext
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

      // Decode base64 to binary
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Decode WAV to AudioBuffer
      const arrayBuffer = bytes.buffer;
      return await ctx.decodeAudioData(arrayBuffer);
    },
    [getAudioContext]
  );

  // Play queued audio chunks
  const playNextChunk = useCallback(() => {
    if (isMuted || isPaused || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      return;
    }

    // Get next buffer and check if it's been invalidated
    let buffer = audioQueueRef.current.shift();
    while (buffer) {
      const bufferHash = audioBufferHashMapRef.current.get(buffer);
      const baseHash = bufferHash?.replace('_au', '');
      
      // Skip if invalidated
      if (baseHash && invalidatedHashesRef.current.has(baseHash)) {
        console.log(`Skipping invalidated audio chunk with hash ${bufferHash}`);
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

    // Track current source for stopping
    currentSourceRef.current = source;

    // Schedule playback
    const now = ctx.currentTime;
    const startTime = Math.max(now, nextPlayTimeRef.current);
    source.start(startTime);

    nextPlayTimeRef.current = startTime + buffer.duration;

    source.onended = () => {
      // Clean up hash mapping
      audioBufferHashMapRef.current.delete(buffer!);
      
      // Clear current source reference
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

    // Update metrics
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
  }, [isMuted, getAudioContext]);

  // Handle incoming voice chunk - buffer until all chunks arrive, then play in order
  const handleVoiceChunk = useCallback(
    async (message: VoiceChunkMessage) => {
      if (!message.audioBase64 || !message.sampleRate || !message.sessionId) return;

      const { sessionId, chunkIndex, totalChunks, hash } = message;
      
      // Check if this audio's hash has been invalidated
      const baseHash = hash?.replace('_au', '');
      if (baseHash && invalidatedHashesRef.current.has(baseHash)) {
        console.log(`Ignoring invalidated audio chunk with hash ${hash}`);
        return;
      }

      try {
        // Decode audio
        const audioBuffer = await decodeAudioChunk(
          message.audioBase64,
          message.sampleRate
        );

        // Initialize session chunk buffer if needed
        if (!sessionChunksRef.current.has(sessionId)) {
          sessionChunksRef.current.set(sessionId, new Map());
          console.log(`[VoiceStream] New session started: ${sessionId}, expecting ${totalChunks} chunks`);
        }
        
        // Store total chunks for this session
        if (totalChunks !== undefined) {
          sessionTotalChunksRef.current.set(sessionId, totalChunks);
        }
        
        // Store hash for this session
        if (hash) {
          sessionHashRef.current.set(sessionId, hash);
        }

        // Buffer this chunk
        const sessionChunks = sessionChunksRef.current.get(sessionId)!;
        sessionChunks.set(chunkIndex!, { buffer: audioBuffer, message });
        
        console.log(`[VoiceStream] Received chunk ${chunkIndex! + 1}/${totalChunks} for session ${sessionId.slice(0, 8)}...`);

        // Check if we have all chunks for this session
        const expectedTotal = sessionTotalChunksRef.current.get(sessionId);
        if (expectedTotal && sessionChunks.size === expectedTotal) {
          console.log(`[VoiceStream] All ${expectedTotal} chunks received for session ${sessionId.slice(0, 8)}, queuing in order`);
          
          // Sort chunks by index and add to playback queue
          const sortedIndices = Array.from(sessionChunks.keys()).sort((a, b) => a - b);
          
          for (const idx of sortedIndices) {
            const chunkData = sessionChunks.get(idx)!;
            const chunkHash = sessionHashRef.current.get(sessionId);
            
            // Track hash for this buffer
            if (chunkHash) {
              audioBufferHashMapRef.current.set(chunkData.buffer, chunkHash);
              currentAudioHashRef.current = chunkHash;
            }
            
            audioQueueRef.current.push(chunkData.buffer);
          }
          
          // Update current text
          const firstChunk = sessionChunks.get(0);
          if (firstChunk?.message.text) {
            setCurrentText(firstChunk.message.text);
          }

          // Calculate latency from first chunk
          if (firstChunk?.message.timestamp && firstChunk?.message.generationTimeMs) {
            const networkLatencyMs = Date.now() - firstChunk.message.timestamp * 1000;
            setLatencyMetrics({
              generationTimeMs: firstChunk.message.generationTimeMs,
              networkLatencyMs: Math.max(0, networkLatencyMs),
              totalLatencyMs: firstChunk.message.generationTimeMs + Math.max(0, networkLatencyMs),
              bufferSizeChunks: audioQueueRef.current.length,
              isPlaying: isPlayingRef.current,
            });
          }
          
          // Clean up session data
          sessionChunksRef.current.delete(sessionId);
          sessionTotalChunksRef.current.delete(sessionId);
          sessionHashRef.current.delete(sessionId);
          
          // Start playback if not already playing and autoPlay enabled and not paused
          if (autoPlay && !isPlayingRef.current && !isMuted && !isPaused) {
            playNextChunk();
          }
        }
      } catch (err) {
        console.error("Failed to decode audio chunk:", err);
      }
    },
    [autoPlay, decodeAudioChunk, isMuted, isPaused, playNextChunk]
  );

  // WebSocket message handler
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: VoiceChunkMessage = JSON.parse(event.data);

        switch (message.type) {
          case "voice_chunk":
            handleVoiceChunk(message);
            break;

          case "invalidation":
            // Handle audio invalidation
            const baseHash = message.hash;
            if (baseHash) {
              console.log(`Received audio invalidation for hash ${baseHash}`);
              invalidatedHashesRef.current.add(baseHash);
              
              const auHash = `${baseHash}_au`;
              
              // IMMEDIATELY stop currently playing audio if it's from invalidated hash
              if (currentSourceRef.current) {
                // Check if currently playing audio is from invalidated hash
                const isCurrentAudioInvalidated = currentAudioHashRef.current === auHash;
                if (isCurrentAudioInvalidated) {
                  try {
                    currentSourceRef.current.stop();
                    console.log(`Stopped currently playing invalidated audio ${auHash}`);
                  } catch (e) {
                    // Audio might have already ended
                  }
                  currentSourceRef.current = null;
                  isPlayingRef.current = false;
                  setIsPlaying(false);
                }
              }
              
              // Remove invalidated audio buffers from queue
              audioQueueRef.current = audioQueueRef.current.filter(buffer => {
                const bufferHash = audioBufferHashMapRef.current.get(buffer);
                if (bufferHash === auHash) {
                  audioBufferHashMapRef.current.delete(buffer);
                  return false;
                }
                return true;
              });
              
              // Clear current text if it matches invalidated audio
              if (currentAudioHashRef.current === auHash) {
                setCurrentText("");
                currentAudioHashRef.current = null;
              }
              
              // Clean up old invalidations (keep last 100)
              if (invalidatedHashesRef.current.size > 100) {
                const toDelete = Array.from(invalidatedHashesRef.current).slice(0, 20);
                toDelete.forEach(h => invalidatedHashesRef.current.delete(h));
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
            // Heartbeat response
            break;

          default:
            console.log("Unknown message type:", message);
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    },
    [handleVoiceChunk]
  );

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send join command
      ws.send(JSON.stringify({ command: "join", roomId }));

      // Start ping interval
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

      // Auto-reconnect
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error("Voice WebSocket error:", err);
      setError("Connection error");
    };
  }, [wsUrl, roomId, handleMessage]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    // Stop currently playing audio
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {
        // Audio might have already ended
      }
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
    
    // Clear session tracking
    sessionChunksRef.current.clear();
    sessionTotalChunksRef.current.clear();
    sessionHashRef.current.clear();
  }, []);

  // Mute control
  const handleSetMuted = useCallback((muted: boolean) => {
    setIsMuted(muted);
    if (muted) {
      // Clear queue when muting
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  }, []);

  // Pause control
  const handleSetPaused = useCallback((paused: boolean) => {
    setIsPaused(paused);
    if (paused) {
      // Stop currently playing audio when pausing
      if (currentSourceRef.current) {
        try {
          currentSourceRef.current.stop();
        } catch (e) {
          // Audio might have already ended
        }
        currentSourceRef.current = null;
      }
      isPlayingRef.current = false;
      setIsPlaying(false);
    } else {
      // Resume playback when unpausing
      if (audioQueueRef.current.length > 0 && !isPlayingRef.current && !isMuted) {
        playNextChunk();
      }
    }
  }, [isMuted, playNextChunk]);

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
    connect,
    disconnect,
    setMuted: handleSetMuted,
    isMuted,
    isPaused,
    setPaused: handleSetPaused,
  };
}
