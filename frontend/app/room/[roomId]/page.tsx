"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useTranslation } from "@/hooks/useTranslation";
import { useProcessedVoice } from "@/hooks/useProcessedVoice";
import { VideoContainer } from "@/components/VideoContainer";
import { SubtitlePanel } from "@/components/SubtitlePanel";
import { ControlBar } from "@/components/ControlBar";
import { LiveTranscription } from "@/components/LiveTranscription";
import { VoiceLatencyIndicator } from "@/components/VoiceLatencyIndicator";
import { getLanguageName } from "@/lib/languages";

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
  const role = searchParams.get("role") || "joiner"; // Default to joiner if no role specified

  const [targetLanguage, setTargetLanguage] = useState("en");
  const [showToast, setShowToast] = useState(false);
  const hasInitializedRef = useRef(false);
  const hasJoinedRef = useRef(false);
  const hasRegisteredVoiceRef = useRef(false);

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
  } = useSpeechToText(remoteStream);

  const { translatedText, isTranslating, translate } = useTranslation();

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
  useEffect(() => {
    if (transcript) {
      translate(transcript, targetLanguage);
    }
  }, [transcript, targetLanguage, translate]);

  // Handle transcription toggle
  const handleToggleTranscription = useCallback(() => {
    if (isTranscribing) {
      stopTranscription();
    } else {
      startTranscription();
    }
  }, [isTranscribing, startTranscription, stopTranscription]);

  // Handle hangup
  const handleHangup = useCallback(() => {
    stopTranscription();
    hangup();
    router.push("/");
  }, [stopTranscription, hangup, router]);

  // Copy room ID to clipboard
  const copyRoomId = useCallback(() => {
    navigator.clipboard.writeText(roomId);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  }, [roomId]);

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-white">
              WebRTC Translator
            </h1>
            <span className="text-xs text-gray-500">
              Powered by Lingo.dev
            </span>
          </div>
          <button
            onClick={copyRoomId}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-gray-400 transition-colors"
            title="Copy room ID"
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
            <span className="hidden sm:inline">Room: </span>
            <code className="font-mono">{roomId.slice(0, 8)}...</code>
          </button>
        </div>

        {/* Error message */}
        {webrtcError && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {webrtcError}
          </div>
        )}

        {/* Connection status */}
        {isConnecting && (
          <div className="mb-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-sm flex items-center gap-2">
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
            Connecting to peer... Share the room ID with your friend.
          </div>
        )}

        {/* Video Container */}
        <VideoContainer
          localStream={localStream}
          remoteStream={remoteStream}
          isConnected={isConnected}
          isCameraOn={isCameraOn}
        />

        {/* Subtitle Panel */}
        <SubtitlePanel
          originalText={transcript}
          translatedText={translatedText}
          isTranscribing={isTranscribing}
          isTranslating={isTranslating}
          targetLanguage={getLanguageName(targetLanguage)}
        />

        {/* Control Bar */}
        <ControlBar
          isMicOn={isMicOn}
          isCameraOn={isCameraOn}
          isTranscribing={isTranscribing}
          targetLanguage={targetLanguage}
          onToggleMic={toggleMic}
          onToggleCamera={toggleCamera}
          onToggleTranscription={handleToggleTranscription}
          onLanguageChange={setTargetLanguage}
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
          <div className="mt-6 text-center text-sm text-gray-500">
            <p>
              Share this room ID with your friend:{" "}
              <code className="bg-white/5 px-2 py-1 rounded font-mono">
                {roomId}
              </code>
            </p>
            <p className="mt-2">
              They can join by entering this ID on the home page.
            </p>
          </div>
        )}

        {/* Translation tip */}
        {isConnected && !isTranscribing && (
          <div className="mt-6 text-center text-sm text-gray-500">
            <p>
              Click the translation button{" "}
              <span className="inline-flex items-center justify-center w-6 h-6 bg-white/10 rounded-full mx-1">
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
                  />
                </svg>
              </span>{" "}
              to start live translation.
            </p>
          </div>
        )}
        {/* Live Transcription Section */}
        <LiveTranscription
          localStream={localStream}
          roomId={roomId}
          myUserId={userId}
        />

        {/* Toast Notification */}
        {showToast && (
          <div className="fixed bottom-4 right-4 bg-green-500/90 text-white px-4 py-2 rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
            Copied to clipboard
          </div>
        )}
      </div>
    </div>
  );
}
