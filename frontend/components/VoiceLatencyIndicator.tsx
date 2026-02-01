"use client";

import { Gloria_Hallelujah } from "next/font/google";

const handFont = Gloria_Hallelujah({ subsets: ["latin"], weight: "400" });

interface VoiceLatencyMetrics {
  generationTimeMs: number;
  networkLatencyMs: number;
  totalLatencyMs: number;
  bufferSizeChunks: number;
  isPlaying: boolean;
}

interface VoiceLatencyIndicatorProps {
  isConnected: boolean;
  isPlaying: boolean;
  latencyMetrics: VoiceLatencyMetrics | null;
  error: string | null;
  isMuted: boolean;
  isPaused?: boolean;
  transcriptionLatencyMs?: number | null;
  onToggleMute?: () => void;
  onTogglePause?: () => void;
  onRestartTranscription?: () => void;
}

export function VoiceLatencyIndicator({
  isConnected,
  isPlaying,
  latencyMetrics,
  error,
  isMuted,
  isPaused,
  transcriptionLatencyMs,
  onToggleMute,
  onTogglePause,
  onRestartTranscription,
}: VoiceLatencyIndicatorProps) {
  // Determine status
  const getStatus = () => {
    if (error) return { label: "Error", color: "text-red-600", bg: "bg-red-100" };
    if (!isConnected) return { label: "Disconnected", color: "text-gray-500", bg: "bg-gray-100" };
    if (isPaused) return { label: "Paused", color: "text-yellow-600", bg: "bg-yellow-100" };
    if (isPlaying) return { label: "Playing", color: "text-green-600", bg: "bg-green-100" };
    return { label: "Idle", color: "text-blue-600", bg: "bg-blue-100" };
  };

  const status = getStatus();

  // Format latency display
  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div
      className={`
        inline-flex items-center gap-3 px-4 py-2
        bg-[#fffdf7] border-2 border-gray-800 rounded-xl
        shadow-[4px_4px_0_#111827]
        ${handFont.className}
      `}
    >
      {/* Voice icon with pulse animation when playing */}
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className={`w-5 h-5 ${isPlaying ? "text-green-600" : "text-gray-600"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          {!isMuted && (
            <>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </>
          )}
          {isMuted && <line x1="23" y1="9" x2="17" y2="15" />}
        </svg>
        {isPlaying && (
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
      </div>

      {/* Status badge */}
      <span
        className={`
          text-xs font-medium px-2 py-0.5 rounded-full
          ${status.bg} ${status.color}
        `}
      >
        {status.label}
      </span>

      {/* Latency metrics */}
      {latencyMetrics && isConnected && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span title="Generation time">
            🎙 {formatLatency(latencyMetrics.generationTimeMs)}
          </span>
          <span className="text-gray-400">|</span>
          <span title="Total latency">
            ⏱ {formatLatency(latencyMetrics.totalLatencyMs)}
          </span>
          {latencyMetrics.bufferSizeChunks > 0 && (
            <>
              <span className="text-gray-400">|</span>
              <span title="Buffer size">
                📦 {latencyMetrics.bufferSizeChunks}
              </span>
            </>
          )}
        </div>
      )}

      {/* Transcription latency */}
      {transcriptionLatencyMs !== undefined && transcriptionLatencyMs !== null && (
        <div className="flex items-center gap-1 text-xs text-gray-600" title="Transcription latency">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <span>{formatLatency(transcriptionLatencyMs)} lag</span>
        </div>
      )}

      {/* Play/Pause button */}
      {onTogglePause && (
        <button
          onClick={onTogglePause}
          className={`
            p-1 rounded-lg transition-colors
            ${isPaused ? "bg-yellow-100 text-yellow-600" : "bg-gray-100 text-gray-600"}
            hover:bg-gray-200
          `}
          title={isPaused ? "Resume audio" : "Pause audio"}
        >
          {isPaused ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          )}
        </button>
      )}

      {/* Mute button */}
      {onToggleMute && (
        <button
          onClick={onToggleMute}
          className={`
            p-1 rounded-lg transition-colors
            ${isMuted ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-600"}
            hover:bg-gray-200
          `}
          title={isMuted ? "Unmute voice" : "Mute voice"}
        >
          {isMuted ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>
      )}

      {/* Restart transcription button */}
      {onRestartTranscription && (
        <button
          onClick={onRestartTranscription}
          className="
            p-1 rounded-lg transition-colors
            bg-gray-100 text-gray-600
            hover:bg-gray-200
          "
          title="Restart transcription"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      )}

      {/* Error display */}
      {error && (
        <span className="text-xs text-red-600 ml-1" title={error}>
          ⚠️
        </span>
      )}
    </div>
  );
}
