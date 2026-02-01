"use client";

import { LanguageSelector } from "./LanguageSelector";

interface ControlBarProps {
  isMicOn: boolean;
  isCameraOn: boolean;
  isTranscribing: boolean;
  targetLanguage: string;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleTranscription: () => void;
  onLanguageChange: (lang: string) => void;
  onHangup: () => void;
}

export function ControlBar({
  isMicOn,
  isCameraOn,
  isTranscribing,
  targetLanguage,
  onToggleMic,
  onToggleCamera,
  onToggleTranscription,
  onLanguageChange,
  onHangup,
}: ControlBarProps) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 bg-black/40 backdrop-blur-md rounded-xl border border-white/10 mt-4">
      {/* Left side - Media controls */}
      <div className="flex items-center gap-3">
        {/* Mic toggle */}
        <button
          onClick={onToggleMic}
          className={`control-btn ${
            isMicOn ? "control-btn-active" : "control-btn-inactive"
          }`}
          title={isMicOn ? "Mute microphone" : "Unmute microphone"}
        >
          {isMicOn ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
              />
            </svg>
          )}
        </button>

        {/* Camera toggle */}
        <button
          onClick={onToggleCamera}
          className={`control-btn ${
            isCameraOn ? "control-btn-active" : "control-btn-inactive"
          }`}
          title={isCameraOn ? "Turn off camera" : "Turn on camera"}
        >
          {isCameraOn ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              />
            </svg>
          )}
        </button>

        {/* Transcription toggle */}
        <button
          onClick={onToggleTranscription}
          className={`control-btn ${
            isTranscribing
              ? "bg-green-600 text-white hover:bg-green-700"
              : "control-btn-active"
          }`}
          title={isTranscribing ? "Stop transcription" : "Start transcription"}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
            />
          </svg>
        </button>
      </div>

      {/* Center - Language selector */}
      <LanguageSelector value={targetLanguage} onChange={onLanguageChange} />

      {/* Right side - Hangup */}
      <button onClick={onHangup} className="btn-danger flex items-center gap-2">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z"
          />
        </svg>
        <span className="hidden sm:inline">Leave</span>
      </button>
    </div>
  );
}
