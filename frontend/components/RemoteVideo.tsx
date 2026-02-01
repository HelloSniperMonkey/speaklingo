"use client";

import { useRef, useEffect, useState } from "react";

interface RemoteVideoProps {
  stream: MediaStream | null;
  isConnected: boolean;
}

export function RemoteVideo({ stream, isConnected }: RemoteVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);

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
      
      stream.addEventListener("addtrack", handleTrackAdded);
      stream.addEventListener("removetrack", handleTrackRemoved);
      
      // Try to play immediately if there are tracks
      if (stream.getTracks().length > 0) {
        videoElement.play().catch((err) => {
          console.warn("[RemoteVideo] Initial autoplay failed:", err);
        });
      }
      
      return () => {
        stream.removeEventListener("addtrack", handleTrackAdded);
        stream.removeEventListener("removetrack", handleTrackRemoved);
      };
    }
  }, [stream]);

  // Show video when we have a stream with video tracks OR when connected
  const showVideo = stream && (hasVideoTrack || isConnected);

  return (
    <div className="relative w-full aspect-video bg-gray-900 rounded-2xl overflow-hidden border border-white/10">
      {/* Always render the video element but control visibility */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
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
          <p className="text-sm">Waiting for connection...</p>
        </div>
      )}

      {/* Connection indicator */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            isConnected ? "bg-green-500 pulse" : "bg-yellow-500"
          }`}
        />
        <span className="text-xs text-white/70">
          {isConnected ? "Connected" : "Connecting..."}
        </span>
      </div>
    </div>
  );
}
