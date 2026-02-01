"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface UseSpeechToTextReturn {
  transcript: string;
  isTranscribing: boolean;
  error: string | null;
  latencyMs: number | null;
  startTranscription: () => void;
  stopTranscription: () => void;
  restartTranscription: () => void;
}

export function useSpeechToText(
  audioStream: MediaStream | null
): UseSpeechToTextReturn {
  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const requestStartTimeRef = useRef<number>(0);

  // Process audio chunk and send to Whisper API
  const processAudioChunk = useCallback(async () => {
    if (chunksRef.current.length === 0) return;

    const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];

    // Only process if there's meaningful audio (> 1KB)
    if (audioBlob.size < 1000) return;

    // Track request start time for latency calculation
    requestStartTimeRef.current = Date.now();

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.webm");

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      // Calculate latency
      const latency = Date.now() - requestStartTimeRef.current;
      setLatencyMs(latency);

      if (!response.ok) {
        throw new Error("Transcription failed");
      }

      const data = await response.json();
      if (data.text && data.text.trim()) {
        setTranscript(data.text.trim());
      }
    } catch (err) {
      console.error("Transcription error:", err);
      // Don't set error state for individual chunk failures
    }
  }, []);

  // Start transcription
  const startTranscription = useCallback(() => {
    if (!audioStream) {
      setError("No audio stream available");
      return;
    }

    // Check if audio tracks exist
    const audioTracks = audioStream.getAudioTracks();
    if (audioTracks.length === 0) {
      setError("No audio tracks in stream");
      return;
    }

    try {
      // Create a new MediaStream with only audio tracks
      const audioOnlyStream = new MediaStream(audioTracks);

      const mediaRecorder = new MediaRecorder(audioOnlyStream, {
        mimeType: "audio/webm;codecs=opus",
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000); // Collect data every second
      setIsTranscribing(true);
      setError(null);

      // Process chunks every 4 seconds
      intervalRef.current = setInterval(() => {
        processAudioChunk();
      }, 4000);
    } catch (err) {
      setError("Failed to start recording");
      console.error("MediaRecorder error:", err);
    }
  }, [audioStream, processAudioChunk]);

  // Stop transcription
  const stopTranscription = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsTranscribing(false);
    chunksRef.current = [];
  }, []);

  // Restart transcription
  const restartTranscription = useCallback(() => {
    stopTranscription();
    setTranscript("");
    setLatencyMs(null);
    setTimeout(() => {
      startTranscription();
    }, 100);
  }, [stopTranscription, startTranscription]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTranscription();
    };
  }, [stopTranscription]);

  return {
    transcript,
    isTranscribing,
    error,
    latencyMs,
    startTranscription,
    stopTranscription,
    restartTranscription,
  };
}
