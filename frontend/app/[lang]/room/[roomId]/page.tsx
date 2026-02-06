"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Gloria_Hallelujah } from "next/font/google";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useTranslation as useSpeechTranslation } from "@/hooks/useTranslation";
import { useProcessedVoice } from "@/hooks/useProcessedVoice";
import { VideoContainer } from "@/components/VideoContainer";
import { SubtitlePanel } from "@/components/SubtitlePanel";
import { ControlBar } from "@/components/ControlBar";
import { LiveTranscription } from "@/components/LiveTranscription";
import { VoiceLatencyIndicator } from "@/components/VoiceLatencyIndicator";
import { getLanguageName, getGoogleLocale } from "@/lib/languages";
import { useTranslation } from "../../components/I18nProvider";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";

const handFont = Gloria_Hallelujah({ subsets: ["latin"], weight: "400" });

// Get the unique voice user ID from storage
function getVoiceUserId(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('voiceUserId') || localStorage.getItem('voiceUserId') || '';
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const lang = params.lang as string;
  const role = searchParams.get("role") || "joiner"; // Default to joiner if no role specified

  const [spokenLanguage, setSpokenLanguage] = useState("en");
  const [showToast, setShowToast] = useState(false);
  const [isTranslationEnabled, setIsTranslationEnabled] = useState(false); // Translation pipeline toggle
  const [theirSpeech, setTheirSpeech] = useState(""); // Their transcribed speech (original)
  const [theirTranslatedSpeech, setTheirTranslatedSpeech] = useState(""); // Their translated speech
  const hasInitializedRef = useRef(false);
  const hasJoinedRef = useRef(false);
  const hasRegisteredVoiceRef = useRef(false);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null); // For muting remote audio

  const {
    localStream,
    remoteStream,
    isConnected,
    isConnecting,
    error: webrtcError,
    startMedia,
    createRoom,
    joinRoom,
    hangup,
    toggleMic,
    toggleCamera,
    isMicOn,
    isCameraOn,
    voiceDataChannel,
    peerConnection,
  } = useWebRTC();

  const {
    transcript,
    isTranscribing,
    latencyMs: transcriptionLatency,
    startTranscription,
    stopTranscription,
    restartTranscription,
    error: transcriptionError,
  } = useSpeechToText(remoteStream);

  const { translatedText, isTranslating, translate } = useSpeechTranslation();
  const { t } = useTranslation();

  // Processed voice stream for TTS playback
  // userId: 'local-user' for creator, determines whose processed voice to play locally vs send to remote
  const userId = role === "creator" ? "local-user" : "remote-user";

  // Get the actual unique voice user ID for this user
  const voiceUserId = useRef<string>('');
  useEffect(() => {
    voiceUserId.current = getVoiceUserId();
  }, []);

  const {
    isConnected: voiceConnected,
    isPlaying: voicePlaying,
    latencyMetrics: voiceLatency,
    error: voiceError,
    isMuted: voiceMuted,
    setMuted: setVoiceMuted,
    isPaused: voicePaused,
    setPaused: setVoicePaused,
    voiceMode,
    setDataChannel,
  } = useProcessedVoice({ roomId, userId, peerConnection });

  // Register voice user ID mapping when entering the room
  // This tells the backend: "local-user in this room has voice sample X"
  useEffect(() => {
    if (hasRegisteredVoiceRef.current || !roomId) return;
    hasRegisteredVoiceRef.current = true;

    const actualVoiceUserId = getVoiceUserId();
    if (actualVoiceUserId) {
      // Register the voice mapping with the backend
      fetch('/api/register-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          role: userId, // "local-user" or "remote-user"
          voiceUserId: actualVoiceUserId
        })
      }).then(res => {
        if (res.ok) {
          console.log(`[RoomPage] Registered voice mapping: ${userId} -> ${actualVoiceUserId}`);
        }
      }).catch(err => {
        console.error('[RoomPage] Failed to register voice mapping:', err);
      });
    }
  }, [roomId, userId]);

  // Store spoken language preference in Redis whenever it changes
  // This allows the translation processor to know what language this user speaks
  // So when translating FOR this user, it knows to translate TO their language
  useEffect(() => {
    if (!roomId || !userId) return;

    fetch('/api/set-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        userId, // "local-user" or "remote-user"
        spokenLanguage // e.g., "en", "hi", "es"
      })
    }).then(res => {
      if (res.ok) {
        console.log(`[RoomPage] 🌐 Stored language preference: ${userId} speaks ${spokenLanguage}`);
      } else {
        res.text().then(text => console.error('[RoomPage] Failed to store language:', text));
      }
    }).catch(err => {
      console.error('[RoomPage] Failed to store language preference:', err);
    });
  }, [roomId, userId, spokenLanguage]);

  // Pass the WebRTC data channel to the processed voice hook when available
  useEffect(() => {
    if (voiceDataChannel) {
      console.log("[RoomPage] Setting voice data channel for processed voice");
      setDataChannel(voiceDataChannel);
    }
  }, [voiceDataChannel, setDataChannel]);

  // Step 1: Start media when component mounts
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    console.log("[RoomPage] Starting media...");
    startMedia();
  }, [startMedia]);

  // Step 2: Once we have localStream, create or join the room
  useEffect(() => {
    if (!localStream || hasJoinedRef.current) return;
    hasJoinedRef.current = true;

    const setupRoom = async () => {
      try {
        if (role === "creator") {
          // Pass the existing roomId to createRoom so it uses the same document
          await createRoom(roomId);
        } else {
          await joinRoom(roomId);
        }
      } catch (err) {
        console.error("[RoomPage] Failed to setup room:", err);
      }
    };

    setupRoom();
  }, [localStream, role, roomId, createRoom, joinRoom]);

  // Translate when transcript changes
  // Note: The translation target is the OTHER party's spoken language
  // This is handled by the backend based on room state
  useEffect(() => {
    if (transcript) {
      translate(transcript, spokenLanguage);
    }
  }, [transcript, spokenLanguage, translate]);

  // Handle translation toggle - this enables/disables the entire translation pipeline
  // When enabled: mute remote audio, transcribe their speech, translate, play via TTS
  // When disabled: normal voice passthrough
  const handleToggleTranslation = useCallback(() => {
    setIsTranslationEnabled(prev => !prev);
  }, []);

  // Handle their speech transcription (from LiveTranscription component)
  const handleTheirSpeech = useCallback((text: string) => {
    setTheirSpeech(text);
  }, []);

  // Handle their translated speech (from LiveTranscription component)
  const handleTheirTranslation = useCallback((text: string) => {
    setTheirTranslatedSpeech(text);
  }, []);

  // Handle hangup
  const handleHangup = useCallback(() => {
    stopTranscription();
    hangup();
    router.push(`/${lang}`);
  }, [stopTranscription, hangup, router, lang]);

  // Copy room ID to clipboard
  const copyRoomId = useCallback(() => {
    navigator.clipboard.writeText(roomId);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  }, [roomId]);

  return (
    <div className={`min-h-screen p-4 md:p-8 ${handFont.className}`}>
      {/* Language Switcher in top-right corner */}
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher />
      </div>

      <div className="max-w-5xl mx-auto relative pt-8 md:pt-0">

        {/* Header */}
        <div className="flex items-center justify-between mb-4 pr-0">
          <div className="flex items-center gap-3">
            <div className="sketch-pill text-sm py-2 px-4">
              {t("room.title")}
            </div>
            <span className="text-xs text-[var(--foreground)] opacity-60">
              {t("common.poweredBy")} <span className="font-bold">Lingo.dev</span>
            </span>
          </div>
          <button
            onClick={copyRoomId}
            className="btn-sketch-secondary py-2 px-4 flex items-center gap-2 text-sm"
            title={t("room.copyRoomId")}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <span className="hidden sm:inline">{t("room.roomLabel")} </span>
            <code className="font-mono">{roomId.slice(0, 8)}...</code>
          </button>
        </div>

        {/* Error message */}
        {webrtcError && (
          <div className="mb-4 p-4 sketch-card border-red-500 bg-red-900/20 text-red-200 text-sm font-bold">
            {webrtcError}
          </div>
        )}
        {transcriptionError && (
          <div className="mb-4 p-4 sketch-card border-red-500 bg-red-900/20 text-red-200 text-sm font-bold">
            Transcription Error: {transcriptionError}
          </div>
        )}

        {/* Connection status */}
        {isConnecting && (
          <div className="mb-4 p-4 sketch-card border-yellow-500 bg-yellow-900/20 text-yellow-200 text-sm font-bold flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {t("room.connectingToPeer")}
          </div>
        )}

        {/* Video Container */}
        <VideoContainer
          localStream={localStream}
          remoteStream={remoteStream}
          isConnected={isConnected}
          isCameraOn={isCameraOn}
          isTranslationEnabled={isTranslationEnabled}
          ttsGenerationTimeMs={voiceLatency?.generationTimeMs}
        />

        {/* Subtitle Panel - shows THEIR speech (original) and THEIR translated speech */}
        <SubtitlePanel
          originalText={theirSpeech}
          translatedText={theirTranslatedSpeech}
          isTranscribing={isTranslationEnabled}
          isTranslating={isTranslationEnabled}
          targetLanguage={getLanguageName(spokenLanguage)}
        />

        {/* Control Bar */}
        <ControlBar
          isMicOn={isMicOn}
          isCameraOn={isCameraOn}
          isTranscribing={isTranslationEnabled}
          targetLanguage={spokenLanguage}
          onToggleMic={toggleMic}
          onToggleCamera={toggleCamera}
          onToggleTranscription={handleToggleTranslation}
          onLanguageChange={setSpokenLanguage}
          onHangup={handleHangup}
        />

        {/* Voice Stream Latency Indicator */}
        <div className="mt-4 flex justify-center">
          <VoiceLatencyIndicator
            isConnected={voiceConnected}
            isPlaying={voicePlaying}
            latencyMetrics={voiceLatency}
            error={voiceError}
            isMuted={voiceMuted}
            isPaused={voicePaused}
            transcriptionLatencyMs={transcriptionLatency}
            onToggleMute={() => setVoiceMuted(!voiceMuted)}
            onTogglePause={() => setVoicePaused(!voicePaused)}
            onRestartTranscription={restartTranscription}
          />
        </div>

        {/* Instructions */}
        {!isConnected && (
          <div className="mt-6 text-center text-sm text-[var(--foreground)] opacity-70 font-bold">
            <p>
              {t("room.shareRoomId")}{" "}
              <code className="bg-[var(--card-bg)] px-2 py-1 rounded font-mono border-2 border-[var(--foreground)]">
                {roomId}
              </code>
            </p>
            <p className="mt-2">
              {t("room.joinInstructions")}
            </p>
          </div>
        )}

        {/* Translation tip */}
        {isConnected && !isTranslationEnabled && (
          <div className="mt-6 text-center text-sm text-[var(--foreground)] opacity-70">
            <p>
              {t("room.translationTip")}
            </p>
          </div>
        )}
        {/* Live Transcription Section */}
        <LiveTranscription
          localStream={localStream}
          roomId={roomId}
          myUserId={userId}
          spokenLanguageLocale={getGoogleLocale(spokenLanguage)}
          isTranslationEnabled={isTranslationEnabled}
          onTheirSpeech={handleTheirSpeech}
          onTheirTranslation={handleTheirTranslation}
        />

        {/* Toast Notification */}
        {showToast && (
          <div className="fixed bottom-4 right-4 bg-green-500 text-black font-bold px-4 py-2 rounded-lg shadow-[4px_4px_0_#064e3b] border-2 border-green-900 animate-in fade-in slide-in-from-bottom-2 duration-200">
            {t("common.copiedToClipboard")}
          </div>
        )}
      </div>
    </div>
  );
}
