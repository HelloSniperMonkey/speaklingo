"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { Gloria_Hallelujah } from "next/font/google";
import { useTranslation } from "./components/I18nProvider";
import { LanguageSwitcher } from "./components/LanguageSwitcher";

const handFont = Gloria_Hallelujah({ subsets: ["latin"], weight: "400" });

// Generate a unique user ID that persists across sessions
// Supports ?testUser=2 query param for testing with same browser
function getOrCreateUserId(testUserOverride?: string | null): string {
  if (typeof window === 'undefined') return `user_${Date.now()}`;

  // For testing: use ?testUser=2 to simulate a second user in same browser
  if (testUserOverride) {
    const testUserId = `test_user_${testUserOverride}`;
    sessionStorage.setItem('voiceUserId', testUserId);
    return testUserId;
  }

  let uniqueUserId = localStorage.getItem('voiceUserId');
  if (!uniqueUserId) {
    uniqueUserId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem('voiceUserId', uniqueUserId);
  }
  return uniqueUserId;
}

// Wrap the main content to handle Suspense for useSearchParams
export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">...</div>}>
      <HomePageContent />
    </Suspense>
  );
}

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const lang = params.lang as string;
  const testUser = searchParams.get('testUser'); // For testing: ?testUser=2 simulates second user
  const { t } = useTranslation();


  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<string>("");
  const [voiceSampleUploaded, setVoiceSampleUploaded] = useState(false);

  // Use a unique persistent user ID for voice sample storage
  // This ensures each user's voice sample is stored separately
  const uniqueUserIdRef = useRef<string>('');

  useEffect(() => {
    uniqueUserIdRef.current = getOrCreateUserId(testUser);
  }, [testUser]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);

  const sendAudioToQwen = useCallback(async (audioBlob: Blob) => {
    try {
      const uniqueUserId = uniqueUserIdRef.current || getOrCreateUserId(testUser);

      const formData = new FormData();
      formData.append("audio", audioBlob, "mic-input.webm");
      formData.append("roomId", "global");  // Use global room for pre-session voice samples
      formData.append("userId", uniqueUserId);  // Use unique user ID instead of "intro_user"
      formData.append("transcript", t("home.sampleText"));

      const response = await fetch("/api/qwen-tts", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error || "Failed to reach voice server");
      }

      const data = await response.json();
      setRecordingStatus(t("home.voiceSampleUploaded"));
      setVoiceSampleUploaded(true);
      setRecordingError(null);

      // Store the unique user ID in sessionStorage for the room to use
      sessionStorage.setItem('voiceUserId', uniqueUserId);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("home.failedToSendAudio");
      setRecordingError(message);
      setVoiceSampleUploaded(false);
    }
  }, [testUser, t]);

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
          setRecordingStatus(t("home.sending"));
          await sendAudioToQwen(audioBlob);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecordingError(null);
      setRecordingStatus(t("home.recording"));
      setIsRecording(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("home.microphoneAccessDenied");
      setRecordingError(message);
    }
  }, [isRecording, sendAudioToQwen, stopRecording, t]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  return (
    <div className="intro-surface">
      {/* Language Switcher in top-right corner */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>

      <div className="sketch-card relative max-w-4xl w-full p-8 sm:p-12">
        <div className="absolute inset-0 pointer-events-none intro-noise" aria-hidden />

        <div className="flex justify-center">
          <div className="sketch-pill">
            <span className={handFont.className}>{t("home.title")}</span>
          </div>
        </div>

        <div className={`text-center mt-10 space-y-8 ${handFont.className}`}>
          <p className="text-2xl sm:text-3xl leading-relaxed text-[var(--foreground)]">
            {t("home.sampleText")}
          </p>

          <p className="text-sm font-medium text-[var(--foreground)] opacity-70">
            {t("home.languageHint")}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <button
              onClick={() => router.push(`/${lang}/create`)}
              className="intro-btn intro-btn-primary"
            >
              {t("common.continue")}
            </button>
            <button
              onClick={() => router.push(`/${lang}/create`)}
              className="intro-btn intro-btn-ghost"
            >
              {t("common.skipForNow")}
            </button>
          </div>

          <div className="flex flex-col items-center gap-3 pt-4">
            <button
              type="button"
              onClick={toggleRecording}
              className={`sketch-circle ${isRecording ? "recording" : ""}`}
              aria-pressed={isRecording}
              aria-label={isRecording ? t("home.stopRecording") : t("home.startRecording")}
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
            <div className="text-sm font-medium min-h-[20px] text-[var(--foreground)] opacity-80">
              {recordingError ? recordingError : recordingStatus}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
