"use client";

import { useRef, useEffect, useState, useCallback } from "react";

// Video delay in milliseconds to sync with TTS audio processing pipeline
const VIDEO_DELAY_MS = 2000;
// Frame capture rate (fps) — lower than display to save memory
const CAPTURE_FPS = 24;
const CAPTURE_INTERVAL_MS = 1000 / CAPTURE_FPS;

interface BufferedFrame {
  bitmap: ImageBitmap;
  timestamp: number;
}

interface RemoteVideoProps {
  stream: MediaStream | null;
  isConnected: boolean;
  isTranslationEnabled?: boolean; // When true, mute remote audio (TTS will play instead)
}

export function RemoteVideo({ stream, isConnected, isTranslationEnabled = false }: RemoteVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);   // Hidden, plays real-time stream
  const canvasRef = useRef<HTMLCanvasElement>(null);  // Visible, shows delayed frames
  const audioRef = useRef<HTMLAudioElement>(null);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);
  const [isBufferReady, setIsBufferReady] = useState(false);

  // Frame buffer refs (not state — mutated in rAF loop)
  const frameBufferRef = useRef<BufferedFrame[]>([]);
  const animFrameRef = useRef<number>(0);
  const lastCaptureRef = useRef<number>(0);
  const bufferReadyRef = useRef(false);

  // Clean up all buffered ImageBitmaps
  const flushBuffer = useCallback(() => {
    const buf = frameBufferRef.current;
    while (buf.length > 0) {
      const f = buf.shift();
      f?.bitmap.close();
    }
    bufferReadyRef.current = false;
    setIsBufferReady(false);
  }, []);

  // ── 1. Attach stream to hidden <video> (real-time source) ──
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !stream) return;

    videoElement.srcObject = stream;
    setHasVideoTrack(stream.getVideoTracks().length > 0);

    const handleTrackAdded = (event: MediaStreamTrackEvent) => {
      console.log("[RemoteVideo] Track added:", event.track.kind);
      if (event.track.kind === "video") setHasVideoTrack(true);
      videoElement.play().catch(() => {});
    };

    const handleTrackRemoved = (event: MediaStreamTrackEvent) => {
      console.log("[RemoteVideo] Track removed:", event.track.kind);
      if (event.track.kind === "video") {
        setHasVideoTrack(stream.getVideoTracks().length > 0);
      }
    };

    stream.addEventListener("addtrack", handleTrackAdded);
    stream.addEventListener("removetrack", handleTrackRemoved);

    if (stream.getTracks().length > 0) {
      videoElement.play().catch(() => {});
    }

    return () => {
      stream.removeEventListener("addtrack", handleTrackAdded);
      stream.removeEventListener("removetrack", handleTrackRemoved);
    };
  }, [stream]);

  // ── 2. Frame-buffer loop: capture → buffer → draw delayed ──
  useEffect(() => {
    const videoElement = videoRef.current;
    const canvas = canvasRef.current;
    if (!videoElement || !canvas || !stream) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    flushBuffer();
    const frameBuffer = frameBufferRef.current;

    const tick = () => {
      const now = performance.now();

      // Capture a frame at CAPTURE_FPS rate
      if (
        videoElement.readyState >= 2 &&
        videoElement.videoWidth > 0 &&
        now - lastCaptureRef.current >= CAPTURE_INTERVAL_MS
      ) {
        lastCaptureRef.current = now;

        // Resize canvas to match video dimensions
        if (canvas.width !== videoElement.videoWidth || canvas.height !== videoElement.videoHeight) {
          canvas.width = videoElement.videoWidth;
          canvas.height = videoElement.videoHeight;
        }

        // Capture as GPU-backed ImageBitmap (much lighter than ImageData)
        const captureTime = now;
        createImageBitmap(videoElement).then((bitmap) => {
          frameBuffer.push({ bitmap, timestamp: captureTime });
        });
      }

      // Find and display the frame that is VIDEO_DELAY_MS old
      const targetTime = now - VIDEO_DELAY_MS;

      // Drop frames older than our target (keep the closest one before target)
      while (frameBuffer.length > 1 && frameBuffer[1].timestamp <= targetTime) {
        const old = frameBuffer.shift();
        old?.bitmap.close(); // Free GPU memory
      }

      // Draw the delayed frame onto the visible canvas
      if (frameBuffer.length > 0 && frameBuffer[0].timestamp <= targetTime) {
        ctx.drawImage(frameBuffer[0].bitmap, 0, 0, canvas.width, canvas.height);
        if (!bufferReadyRef.current) {
          bufferReadyRef.current = true;
          setIsBufferReady(true);
          console.log("[RemoteVideo] Buffer filled — showing delayed video");
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      flushBuffer();
    };
  }, [stream, flushBuffer]);

  // ── 3. Audio playback (unchanged) ──
  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement || !stream) return;

    const setupAudio = () => {
      const audioTracks = stream.getAudioTracks();
      console.log(`[RemoteVideo] setupAudio called - found ${audioTracks.length} audio track(s), isConnected: ${isConnected}`);
      if (audioTracks.length > 0) {
        const audioStream = new MediaStream(audioTracks);
        audioElement.srcObject = audioStream;
        audioElement.muted = isTranslationEnabled;
        audioElement.play().catch((err) => {
          console.warn("[RemoteVideo] Audio autoplay failed:", err);
        });
        console.log(`[RemoteVideo] ✅ Audio setup complete - muted: ${isTranslationEnabled}, tracks: ${audioTracks.length}`);
        return true;
      }
      return false;
    };

    const success = setupAudio();

    let retryTimeout: NodeJS.Timeout | null = null;
    if (!success && isConnected) {
      console.log("[RemoteVideo] No audio tracks yet despite isConnected=true, scheduling retry...");
      retryTimeout = setTimeout(() => {
        setupAudio();
      }, 500);
    }

    const handleTrackAdded = (event: MediaStreamTrackEvent) => {
      if (event.track.kind === "audio") {
        console.log("[RemoteVideo] addtrack event fired for audio track, setting up audio playback");
        setupAudio();
      }
    };

    stream.addEventListener("addtrack", handleTrackAdded);

    return () => {
      stream.removeEventListener("addtrack", handleTrackAdded);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [stream, isTranslationEnabled, isConnected]);

  // Mute/unmute audio based on translation mode
  useEffect(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
      audioElement.muted = isTranslationEnabled;
      console.log(`[RemoteVideo] 🔊 Remote audio muted: ${isTranslationEnabled} (translation ${isTranslationEnabled ? 'ON - TTS will play' : 'OFF - normal voice'})`);
    }
  }, [isTranslationEnabled]);

  // Reset buffer when stream changes
  useEffect(() => {
    flushBuffer();
  }, [stream, flushBuffer]);

  const showVideo = stream && (hasVideoTrack || isConnected) && isBufferReady;

  return (
    <div className="relative w-full aspect-video bg-gray-900 rounded-2xl overflow-hidden border border-white/10">
      {/* Hidden audio element for remote audio */}
      <audio ref={audioRef} autoPlay playsInline hidden />

      {/* Hidden video element — plays real-time stream as frame source */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="opacity-0 absolute w-0 h-0 pointer-events-none"
      />

      {/* Visible canvas — displays frames delayed by VIDEO_DELAY_MS */}
      <canvas
        ref={canvasRef}
        className={`w-full h-full object-cover ${showVideo ? 'block' : 'hidden'}`}
      />

      {!showVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
          <svg
            className="w-16 h-16 mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <p className="text-sm">
            {stream && hasVideoTrack ? "Buffering video..." : "Waiting for connection..."}
          </p>
        </div>
      )}

      {/* Connection indicator */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500 pulse" : "bg-yellow-500"}`}
        />
        <span className="text-xs text-white/70">
          {isConnected ? "Connected" : "Connecting..."}
        </span>
      </div>
    </div>
  );
}
