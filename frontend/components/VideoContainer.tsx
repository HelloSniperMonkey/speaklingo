"use client";

import { RemoteVideo } from "./RemoteVideo";
import { LocalVideo } from "./LocalVideo";

interface VideoContainerProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  isCameraOn: boolean;
  isTranslationEnabled?: boolean; // When true, mute remote audio and use TTS instead
}

export function VideoContainer({
  localStream,
  remoteStream,
  isConnected,
  isCameraOn,
  isTranslationEnabled = false,
}: VideoContainerProps) {
  return (
    <div className="video-container relative w-full">
      <RemoteVideo
        stream={remoteStream}
        isConnected={isConnected}
        isTranslationEnabled={isTranslationEnabled}
      />
      <LocalVideo stream={localStream} isCameraOn={isCameraOn} />
    </div>
  );
}
