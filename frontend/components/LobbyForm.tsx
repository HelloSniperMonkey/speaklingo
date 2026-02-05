"use client";

import { useState } from "react";
import { Gloria_Hallelujah } from "next/font/google";

const handFont = Gloria_Hallelujah({ subsets: ["latin"], weight: "400" });

interface LobbyFormDictionary {
  title: string;
  subtitle: string;
  createNewRoom: string;
  creatingRoom: string;
  or: string;
  enterRoomId: string;
  joinRoom: string;
  joining: string;
  poweredBy: string;
  features: {
    videoChat: string;
    speechToText: string;
    aiTranslation: string;
  };
}

interface LobbyFormProps {
  onCreateRoom: () => Promise<void>;
  onJoinRoom: (roomId: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  dictionary: LobbyFormDictionary;
}

export function LobbyForm({
  onCreateRoom,
  onJoinRoom,
  isLoading,
  error,
  dictionary,
}: LobbyFormProps) {
  const [roomId, setRoomId] = useState("");
  const [mode, setMode] = useState<"create" | "join" | null>(null);

  const handleJoin = async () => {
    if (roomId.trim()) {
      await onJoinRoom(roomId.trim());
    }
  };

  return (
    <div className={`w-full max-w-md mx-auto ${handFont.className}`}>
      <div className="sketch-card p-8 sm:p-10 mb-8">
        <div className="text-center mb-8">
          <div className="inline-block mb-4">
            <div className="sketch-pill text-xl">
              {dictionary.title}
            </div>
          </div>
          <p className="text-[var(--foreground)] opacity-70">
            {dictionary.subtitle}
          </p>
          <p className="text-sm text-[var(--foreground)] opacity-50 mt-2">
            {dictionary.poweredBy} <span className="font-bold border-b-2 border-[var(--accent)]">Lingo.dev</span>
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-200 text-sm font-bold shadow-[4px_4px_0_rgba(220,38,38,0.2)]">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Create Room Button */}
          <button
            onClick={async () => {
              setMode("create");
              await onCreateRoom();
            }}
            disabled={isLoading}
            className="btn-sketch-primary w-full flex items-center justify-center gap-3 text-lg"
          >
            {isLoading && mode === "create" ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
                {dictionary.creatingRoom}
              </>
            ) : (
              <>
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                {dictionary.createNewRoom}
              </>
            )}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <hr className="flex-1 border-[var(--accent)] opacity-30 border-t-2 border-dashed" />
            <span className="text-[var(--foreground)] font-bold opacity-50">{dictionary.or}</span>
            <hr className="flex-1 border-[var(--accent)] opacity-30 border-t-2 border-dashed" />
          </div>

          {/* Join Room */}
          <div className="space-y-4">
            <input
              type="text"
              placeholder={dictionary.enterRoomId}
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="input-sketch placeholder:text-gray-600 bg-transparent text-center text-lg"
            />
            <button
              onClick={async () => {
                setMode("join");
                await handleJoin();
              }}
              disabled={isLoading || !roomId.trim()}
              className="btn-sketch-secondary w-full flex items-center justify-center gap-3 text-lg"
            >
              {isLoading && mode === "join" ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
                  {dictionary.joining}
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M17 8l4 4m0 0l-4 4m4-4H3"
                    />
                  </svg>
                  {dictionary.joinRoom}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="p-2">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center border-2 border-[var(--accent)] bg-[var(--card-bg)] shadow-[4px_4px_0_var(--accent)]">
            <svg
              className="w-6 h-6 text-[var(--foreground)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="text-xs font-bold text-[var(--foreground)] opacity-70">{dictionary.features.videoChat}</p>
        </div>
        <div className="p-2">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center border-2 border-[var(--accent)] bg-[var(--card-bg)] shadow-[4px_4px_0_var(--accent)]">
            <svg
              className="w-6 h-6 text-[var(--foreground)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          </div>
          <p className="text-xs font-bold text-[var(--foreground)] opacity-70">{dictionary.features.speechToText}</p>
        </div>
        <div className="p-2">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center border-2 border-[var(--accent)] bg-[var(--card-bg)] shadow-[4px_4px_0_var(--accent)]">
            <svg
              className="w-6 h-6 text-[var(--foreground)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
              />
            </svg>
          </div>
          <p className="text-xs font-bold text-[var(--foreground)] opacity-70">{dictionary.features.aiTranslation}</p>
        </div>
      </div>
    </div>
  );
}
