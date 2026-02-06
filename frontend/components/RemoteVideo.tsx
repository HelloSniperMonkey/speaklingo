"use client";

import { useRef, useEffect, useState } from "react";

// Video delay in milliseconds to sync with TTS audio processing
const VIDEO_DELAY_MS = 1000;

interface RemoteVideoProps {
  stream: MediaStream | null;
  isConnected: boolean;
  isTranslationEnabled?: boolean; // When true, mute remote audio (TTS will play instead)
}

export function RemoteVideo({ stream, isConnected, isTranslationEnabled = false }: RemoteVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null); // Separate audio element for remote audio
  const [hasVideoTrack, setHasVideoTrack] = useState(false);
  const [isDelayComplete, setIsDelayComplete] = useState(false);
  const delayTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (videoElement && stream) {
      videoElement.srcObject = stream;

      // Check for existing tracks
      const videoTracks = stream.getVideoTracks();
      setHasVideoTrack(videoTracks.length > 0);

      // Listen for track additions
      const handleTrackAdded = (event: MediaStreamTrackEvent) => {
        console.log("[RemoteVideo] Track added:", event.track.kind);
        if (event.track.kind === "video") {
          setHasVideoTrack(true);
        }
        // Force play when tracks are added
        videoElement.play().catch((err) => {
          console.warn("[RemoteVideo] Autoplay failed:", err);
        });
      };

      const handleTrackRemoved = (event: MediaStreamTrackEvent) => {
        console.log("[RemoteVideo] Track removed:", event.track.kind);
        if (event.track.kind === "video") {
          const videoTracks = stream.getVideoTracks();
          setHasVideoTrack(videoTracks.length > 0);
        }
      };

      // When video starts playing, start the delay timer
      const handlePlaying = () => {
        console.log("[RemoteVideo] Video playing, starting delay timer");
        if (delayTimerRef.current) {
          clearTimeout(delayTimerRef.current);
        }
        delayTimerRef.current = setTimeout(() => {
          console.log("[RemoteVideo] Delay complete, showing video");
          setIsDelayComplete(true);
        }, VIDEO_DELAY_MS);
      };

      stream.addEventListener("addtrack", handleTrackAdded);
      stream.addEventListener("removetrack", handleTrackRemoved);
      videoElement.addEventListener("playing", handlePlaying);

      // Try to play immediately if there are tracks
      if (stream.getTracks().length > 0) {
        videoElement.play().catch((err) => {
          console.warn("[RemoteVideo] Initial autoplay failed:", err);
        });
      }

      return () => {
        stream.removeEventListener("addtrack", handleTrackAdded);
        stream.removeEventListener("removetrack", handleTrackRemoved);
        videoElement.removeEventListener("playing", handlePlaying);
        if (delayTimerRef.current) {
          clearTimeout(delayTimerRef.current);
        }
      };
    }
  }, [stream]);

  // Handle audio playback separately from video
  // NOTE: We include `isConnected` as a dependency because Chrome does NOT fire
  // `addtrack` events for programmatic MediaStream.addTrack() calls.
  // When WebRTC's ontrack handler adds audio tracks to the remote stream,
  // no addtrack event fires. But isConnected changes at the same time,
  // so re-running this effect when isConnected changes lets us pick up the tracks.
  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement || !stream) return;

    const setupAudio = () => {
      const audioTracks = stream.getAudioTracks();
      console.log(`[RemoteVideo] setupAudio called - found ${audioTracks.length} audio track(s), isConnected: ${isConnected}`);
      if (audioTracks.length > 0) {
        const audioStream = new MediaStream(audioTracks);
        audioElement.srcObject = audioStream;
        // Respect current translation state when starting playback
        audioElement.muted = isTranslationEnabled;
        audioElement.play().catch((err) => {
          console.warn("[RemoteVideo] Audio autoplay failed:", err);
        });
        console.log(`[RemoteVideo] ✅ Audio setup complete - muted: ${isTranslationEnabled}, tracks: ${audioTracks.length}`);
        return true;
      }
      return false;
    };

    // Setup audio for any existing tracks
    const success = setupAudio();

    // Fallback: if no tracks yet, retry after a short delay
    // This handles edge cases where state updates arrive before tracks
    let retryTimeout: NodeJS.Timeout | null = null;
    if (!success && isConnected) {
      console.log("[RemoteVideo] No audio tracks yet despite isConnected=true, scheduling retry...");
      retryTimeout = setTimeout(() => {
        setupAudio();
      }, 500);
    }

    // Also listen for tracks added later (as a safety net, even though Chrome
    // doesn't fire addtrack for programmatic addTrack calls)
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

  // Reset delay when stream changes
  useEffect(() => {
    setIsDelayComplete(false);
  }, [stream]);

  // Show video when we have a stream with video tracks OR when connected AND delay complete
  const showVideo = stream && (hasVideoTrack || isConnected) && isDelayComplete;

  return (
    <div className="relative w-full aspect-video bg-gray-900 rounded-2xl overflow-hidden border border-white/10">
      {/* Hidden audio element for remote audio - muted when translation is enabled */}
      <audio ref={audioRef} autoPlay playsInline hidden />

      {/* Video element - plays immediately but hidden until delay completes */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover ${showVideo ? 'block' : 'opacity-0 absolute'}`}
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
            {stream && hasVideoTrack ? "Syncing video..." : "Waiting for connection..."}
          </p>
        </div>
      )}

      {/* Connection indicator */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500 pulse" : "bg-yellow-500"
            }`}
        />
        <span className="text-xs text-white/70">
          {isConnected ? "Connected" : "Connecting..."}
        </span>
      </div>
    </div>
  );
}
