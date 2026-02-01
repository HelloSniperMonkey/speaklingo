"use client";

import { useRef, useEffect } from "react";

interface LocalVideoProps {
  stream: MediaStream | null;
  isCameraOn: boolean;
}

export function LocalVideo({ stream, isCameraOn }: LocalVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (videoElement && stream) {
      videoElement.srcObject = stream;
      // Try to play
      videoElement.play().catch((err) => {
        console.warn("[LocalVideo] Autoplay failed:", err);
      });
    }
  }, [stream]);

  return (
    <div className="video-pip shadow-2xl">
      {/* Always render video but control visibility */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted // Mute local video to prevent echo
        className={`w-full h-full object-cover transform scale-x-[-1] ${stream && isCameraOn ? 'block' : 'hidden'}`}
      />
      {(!stream || !isCameraOn) && (
        <div className="w-full h-full flex items-center justify-center bg-gray-800">
          <svg
            className="w-8 h-8 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
