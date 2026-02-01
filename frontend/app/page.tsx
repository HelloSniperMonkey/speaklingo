"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Gloria_Hallelujah } from "next/font/google";
import { LANGUAGES } from "@/lib/languages";

const handFont = Gloria_Hallelujah({ subsets: ["latin"], weight: "400" });

export default function HomePage() {
  const router = useRouter();
  const [introLanguage, setIntroLanguage] = useState("en");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<string>("");
  const [voiceSampleUploaded, setVoiceSampleUploaded] = useState(false);

  // Generate a temporary room ID for voice sample storage (will be used when creating room)
  const tempRoomIdRef = useRef<string>(
    `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);

  const sendAudioToQwen = useCallback(async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "mic-input.webm");
      formData.append("roomId", tempRoomIdRef.current);
      formData.append("userId", "intro_user");
      formData.append("transcript", "Hello I am feeling great today and the weather is sunny which uplifts my mood.");

      const response = await fetch("/api/qwen-tts", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error || "Failed to reach voice server");
      }

      const data = await response.json();
      setRecordingStatus(`Voice sample uploaded (${data.duration?.toFixed(1) || '?'}s)`);
      setVoiceSampleUploaded(true);
      setRecordingError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send audio";
      setRecordingError(message);
      setVoiceSampleUploaded(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        if (audioBlob.size > 0) {
          setRecordingStatus("Sending...");
          await sendAudioToQwen(audioBlob);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecordingError(null);
      setRecordingStatus("Recording...");
      setIsRecording(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone access denied";
      setRecordingError(message);
    }
  }, [isRecording, sendAudioToQwen, stopRecording]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 intro-surface">
      <div className="relative max-w-4xl w-full bg-[#fffdf7] rounded-[28px] border-[4px] border-gray-900 shadow-[16px_16px_0_#111827] p-8 sm:p-12 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none intro-noise" aria-hidden />

        <div className="flex justify-center">
          <div className="sketch-pill">
            <span className={handFont.className}>Record your voice sample for translation</span>
          </div>
        </div>

        <div className={`text-center mt-10 space-y-8 ${handFont.className}`}>
          <p className="text-2xl sm:text-3xl leading-relaxed text-gray-900">
            Hello I am feeling great today and the weather is sunny which uplifts my mood.
          </p>

          <div className="flex flex-col items-center gap-3">
            <select
              value={introLanguage}
              onChange={(e) => setIntroLanguage(e.target.value)}
              className="sketch-select"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
            <span className="text-sm text-gray-500 font-medium">
              You can switch languages later inside the room controls.
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <button
              onClick={() => router.push('/create')}
              className="intro-btn intro-btn-primary"
            >
              Continue
            </button>
            <button
              onClick={() => router.push('/create')}
              className="intro-btn intro-btn-ghost"
            >
              Skip for now
            </button>
          </div>

          <div className="flex flex-col items-center gap-3 pt-4">
            <button
              type="button"
              onClick={toggleRecording}
              className={`sketch-circle ${isRecording ? "recording" : ""}`}
              aria-pressed={isRecording}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="w-7 h-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
                <path d="M19 11a7 7 0 0 1-14 0" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="8" y1="22" x2="16" y2="22" />
              </svg>
            </button>
            <div className="text-sm text-gray-600 font-medium min-h-[20px]">
              {recordingError ? recordingError : recordingStatus}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
