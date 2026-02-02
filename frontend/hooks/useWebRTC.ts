"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { firestore } from "@/lib/firebase";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  addDoc,
  updateDoc,
} from "firebase/firestore";

const ICE_SERVERS = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
    {
      urls: ["stun:stun3.l.google.com:19302", "stun:stun4.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

interface UseWebRTCReturn {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  isConnecting: boolean;
  roomId: string | null;
  error: string | null;
  startMedia: () => Promise<void>;
  createRoom: (existingRoomId?: string) => Promise<string>;
  joinRoom: (roomId: string) => Promise<void>;
  hangup: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  isMicOn: boolean;
  isCameraOn: boolean;
  // Data channel for processed voice
  voiceDataChannel: RTCDataChannel | null;
  peerConnection: RTCPeerConnection | null;
}

export function useWebRTC(): UseWebRTCReturn {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);
  // Track remote stream version to force re-renders when tracks change
  const [remoteStreamVersion, setRemoteStreamVersion] = useState(0);
  // Data channel for processed voice
  const [voiceDataChannel, setVoiceDataChannel] = useState<RTCDataChannel | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const unsubscribersRef = useRef<(() => void)[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  // Cleanup function - uses ref to avoid dependency on localStream
  const cleanup = useCallback(() => {
    unsubscribersRef.current.forEach((unsub) => unsub());
    unsubscribersRef.current = [];

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    setLocalStream(null);
    setRemoteStream(null);
    setIsConnected(false);
    setIsConnecting(false);
    setRoomId(null);
  }, []);

  // Start media (camera + microphone)
  const startMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      setError(null);
    } catch (err) {
      setError("Failed to access camera/microphone. Please check permissions.");
      console.error("Media error:", err);
    }
  }, []);

  // Create a new room (caller) - optionally use an existing room ID
  const createRoom = useCallback(async (existingRoomId?: string): Promise<string> => {
    if (!localStream) {
      throw new Error("Local stream not available");
    }

    setIsConnecting(true);
    setError(null);

    try {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      const remote = new MediaStream();
      setRemoteStream(remote);

      // Create data channel for processed voice (creator creates the channel)
      const voiceChannel = pc.createDataChannel("processed-voice", {
        ordered: true,
      });
      voiceChannel.onopen = () => {
        console.log("[WebRTC] Voice data channel opened (creator)");
        setVoiceDataChannel(voiceChannel);
      };
      voiceChannel.onclose = () => {
        console.log("[WebRTC] Voice data channel closed");
        setVoiceDataChannel(null);
      };

      // Add local tracks to peer connection
      // Only add VIDEO tracks - audio (original voice) is NOT transmitted
      // The translated voice is sent via TTS system instead
      localStream.getTracks().forEach((track) => {
        if (track.kind === 'video') {
          pc.addTrack(track, localStream);
        }
      });

      // Handle remote tracks - this is crucial for receiving media
      pc.ontrack = (event) => {
        console.log("[WebRTC] Received remote track:", event.track.kind);
        event.streams[0].getTracks().forEach((track) => {
          console.log("[WebRTC] Adding remote track to stream:", track.kind);
          remote.addTrack(track);
        });
        // Force a state update to trigger re-render
        setRemoteStreamVersion((v) => v + 1);
        setIsConnected(true);
        setIsConnecting(false);
      };

      // Use existing room ID or create a new one
      const callDoc = existingRoomId 
        ? doc(firestore, "calls", existingRoomId)
        : doc(collection(firestore, "calls"));
      const offerCandidates = collection(callDoc, "offerCandidates");
      const answerCandidates = collection(callDoc, "answerCandidates");

      // Buffer ICE candidates until connection is ready
      const bufferedCandidates: RTCIceCandidateInit[] = [];

      // Collect ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("[WebRTC] Sending ICE candidate (creator)");
          addDoc(offerCandidates, event.candidate.toJSON());
        }
      };

      pc.onicegatheringstatechange = () => {
        console.log("[WebRTC] ICE gathering state:", pc.iceGatheringState);
      };

      // Create offer
      const offerDescription = await pc.createOffer();
      await pc.setLocalDescription(offerDescription);

      const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
      };

      await setDoc(callDoc, { offer }, { merge: true });
      setRoomId(callDoc.id);
      console.log("[WebRTC] Room created with ID:", callDoc.id);

      // Listen for remote answer
      const unsubAnswer = onSnapshot(callDoc, async (snapshot) => {
        const data = snapshot.data();
        if (!pc.currentRemoteDescription && data?.answer) {
          console.log("[WebRTC] Received answer from remote peer");
          const answerDescription = new RTCSessionDescription(data.answer);
          await pc.setRemoteDescription(answerDescription);
          
          // Add any buffered candidates now that remote description is set
          for (const candidate of bufferedCandidates) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          bufferedCandidates.length = 0;
        }
      });
      unsubscribersRef.current.push(unsubAnswer);

      // Listen for remote ICE candidates
      const unsubCandidates = onSnapshot(answerCandidates, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === "added") {
            const candidateData = change.doc.data();
            console.log("[WebRTC] Received ICE candidate from remote (answer)");
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } else {
              // Buffer candidates until remote description is set
              bufferedCandidates.push(candidateData);
            }
          }
        });
      });
      unsubscribersRef.current.push(unsubCandidates);

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        console.log("[WebRTC] Connection state:", pc.connectionState);
        if (pc.connectionState === "connected") {
          setIsConnected(true);
          setIsConnecting(false);
        } else if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed"
        ) {
          setIsConnected(false);
        }
      };

      // Also monitor ICE connection state for more reliable status
      pc.oniceconnectionstatechange = () => {
        console.log("[WebRTC] ICE connection state:", pc.iceConnectionState);
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          setIsConnected(true);
          setIsConnecting(false);
        } else if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          setIsConnected(false);
        }
      };

      return callDoc.id;
    } catch (err) {
      console.error("[WebRTC] Failed to create room:", err);
      setError("Failed to create room");
      setIsConnecting(false);
      throw err;
    }
  }, [localStream]);

  // Join an existing room (callee)
  const joinRoom = useCallback(
    async (id: string): Promise<void> => {
      if (!localStream) {
        throw new Error("Local stream not available");
      }

      setIsConnecting(true);
      setError(null);

      try {
        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;

        const remote = new MediaStream();
        setRemoteStream(remote);

        // Handle incoming data channel for processed voice (joiner receives the channel)
        pc.ondatachannel = (event) => {
          const channel = event.channel;
          if (channel.label === "processed-voice") {
            console.log("[WebRTC] Voice data channel received (joiner)");
            channel.onopen = () => {
              console.log("[WebRTC] Voice data channel opened (joiner)");
              setVoiceDataChannel(channel);
            };
            channel.onclose = () => {
              console.log("[WebRTC] Voice data channel closed");
              setVoiceDataChannel(null);
            };
          }
        };

        // Add local tracks
        // Only add VIDEO tracks - audio (original voice) is NOT transmitted
        // The translated voice is sent via TTS system instead
        localStream.getTracks().forEach((track) => {
          if (track.kind === 'video') {
            pc.addTrack(track, localStream);
          }
        });

        // Handle remote tracks - this is crucial for receiving media
        pc.ontrack = (event) => {
          console.log("[WebRTC] Received remote track (joiner):", event.track.kind);
          event.streams[0].getTracks().forEach((track) => {
            console.log("[WebRTC] Adding remote track to stream (joiner):", track.kind);
            remote.addTrack(track);
          });
          // Force a state update to trigger re-render
          setRemoteStreamVersion((v) => v + 1);
          setIsConnected(true);
          setIsConnecting(false);
        };

        const callDoc = doc(firestore, "calls", id);
        const answerCandidates = collection(callDoc, "answerCandidates");
        const offerCandidates = collection(callDoc, "offerCandidates");

        // Collect ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log("[WebRTC] Sending ICE candidate (joiner)");
            addDoc(answerCandidates, event.candidate.toJSON());
          }
        };

        pc.onicegatheringstatechange = () => {
          console.log("[WebRTC] ICE gathering state (joiner):", pc.iceGatheringState);
        };

        // Get the offer - retry a few times if not ready
        let callData = null;
        let retries = 0;
        const maxRetries = 10;
        
        while (!callData?.offer && retries < maxRetries) {
          callData = (await getDoc(callDoc)).data();
          if (!callData?.offer) {
            console.log("[WebRTC] Waiting for offer... retry", retries + 1);
            await new Promise(resolve => setTimeout(resolve, 500));
            retries++;
          }
        }
        
        if (!callData?.offer) {
          throw new Error("Room not found or not ready yet. The room creator may still be setting up.");
        }

        console.log("[WebRTC] Got offer from room creator");
        const offerDescription = callData.offer;
        await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

        // Create answer
        const answerDescription = await pc.createAnswer();
        await pc.setLocalDescription(answerDescription);

        const answer = {
          type: answerDescription.type,
          sdp: answerDescription.sdp,
        };

        console.log("[WebRTC] Sending answer to room creator");
        await updateDoc(callDoc, { answer });
        setRoomId(id);

        // Listen for remote ICE candidates
        const unsubCandidates = onSnapshot(offerCandidates, (snapshot) => {
          snapshot.docChanges().forEach(async (change) => {
            if (change.type === "added") {
              const data = change.doc.data();
              console.log("[WebRTC] Received ICE candidate from creator");
              await pc.addIceCandidate(new RTCIceCandidate(data));
            }
          });
        });
        unsubscribersRef.current.push(unsubCandidates);

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
          console.log("[WebRTC] Connection state (joiner):", pc.connectionState);
          if (pc.connectionState === "connected") {
            setIsConnected(true);
            setIsConnecting(false);
          } else if (
            pc.connectionState === "disconnected" ||
            pc.connectionState === "failed"
          ) {
            setIsConnected(false);
          }
        };

        // Also monitor ICE connection state for more reliable status
        pc.oniceconnectionstatechange = () => {
          console.log("[WebRTC] ICE connection state (joiner):", pc.iceConnectionState);
          if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
            setIsConnected(true);
            setIsConnecting(false);
          } else if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
            setIsConnected(false);
          }
        };
      } catch (err) {
        console.error("[WebRTC] joinRoom error:", err);
        setError("Failed to join room. Check the room ID.");
        setIsConnecting(false);
        throw err;
      }
    },
    [localStream]
  );

  // Toggle microphone - actually stops the track to release the microphone
  const toggleMic = useCallback(async () => {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    
    if (isMicOn && audioTrack) {
      // Stop the track to release the microphone
      audioTrack.stop();
      localStream.removeTrack(audioTrack);
      setIsMicOn(false);
    } else {
      // Get a new audio stream and add it
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newAudioTrack = newStream.getAudioTracks()[0];
        if (newAudioTrack) {
          // Replace the track in the peer connection
          const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'audio' || (!s.track && s.track === null));
          if (sender) {
            await sender.replaceTrack(newAudioTrack);
          } else {
            // If no sender found, try to add the track
            pcRef.current?.addTrack(newAudioTrack, localStream);
          }
          localStream.addTrack(newAudioTrack);
          setIsMicOn(true);
        }
      } catch (err) {
        console.error("Failed to restart microphone:", err);
        setError("Failed to access microphone. Please check permissions.");
      }
    }
  }, [localStream, isMicOn]);

  // Toggle camera - actually stops the track to release the camera (turns off camera light)
  const toggleCamera = useCallback(async () => {
    if (!localStream) return;
    
    const videoTrack = localStream.getVideoTracks()[0];
    
    if (isCameraOn && videoTrack) {
      // Stop the track to release the camera (this turns off the camera light)
      videoTrack.stop();
      localStream.removeTrack(videoTrack);
      setIsCameraOn(false);
    } else {
      // Get a new video stream and add it
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (newVideoTrack) {
          // Replace the track in the peer connection
          const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video' || (!s.track && s.track === null));
          if (sender) {
            await sender.replaceTrack(newVideoTrack);
          } else {
            // If no sender found, try to add the track
            pcRef.current?.addTrack(newVideoTrack, localStream);
          }
          localStream.addTrack(newVideoTrack);
          setIsCameraOn(true);
        }
      } catch (err) {
        console.error("Failed to restart camera:", err);
        setError("Failed to access camera. Please check permissions.");
      }
    }
  }, [localStream, isCameraOn]);

  // Hangup
  const hangup = useCallback(() => {
    cleanup();
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    localStream,
    remoteStream,
    isConnected,
    isConnecting,
    roomId,
    error,
    startMedia,
    createRoom,
    joinRoom,
    hangup,
    toggleMic,
    toggleCamera,
    isMicOn,
    isCameraOn,
    voiceDataChannel,
    peerConnection: pcRef.current,
  };
}
