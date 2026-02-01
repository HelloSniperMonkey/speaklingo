"use client";

import { RemoteVideo } from "./RemoteVideo";
import { LocalVideo } from "./LocalVideo";

interface VideoContainerProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  isCameraOn: boolean;
}

export function VideoContainer({
  localStream,
  remoteStream,
  isConnected,
  isCameraOn,
}: VideoContainerProps) {
  return (
    <div className="video-container relative w-full">
      <RemoteVideo stream={remoteStream} isConnected={isConnected} />
      <LocalVideo stream={localStream} isCameraOn={isCameraOn} />
    </div>
  );
}
