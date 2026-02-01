"use client";

import { useState } from "react";

interface LobbyFormProps {
  onCreateRoom: () => Promise<void>;
  onJoinRoom: (roomId: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function LobbyForm({
  onCreateRoom,
  onJoinRoom,
  isLoading,
  error,
}: LobbyFormProps) {
  const [roomId, setRoomId] = useState("");
  const [mode, setMode] = useState<"create" | "join" | null>(null);

  const handleJoin = async () => {
    if (roomId.trim()) {
      await onJoinRoom(roomId.trim());
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">
          WebRTC Translator
        </h1>
        <p className="text-gray-400">
          Real-time video chat with live AI translation
        </p>
        <p className="text-sm text-gray-500 mt-2">
          Powered by <span className="text-white font-medium">Lingo.dev</span>
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Create Room Button */}
        <button
          onClick={async () => {
            setMode("create");
            await onCreateRoom();
          }}
          disabled={isLoading}
          className="btn-primary w-full flex items-center justify-center gap-3"
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
              Creating room...
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
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              Create New Room
            </>
          )}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4">
          <hr className="flex-1 border-white/10" />
          <span className="text-gray-500 text-sm">or</span>
          <hr className="flex-1 border-white/10" />
        </div>

        {/* Join Room */}
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Enter room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="input-field"
          />
          <button
            onClick={async () => {
              setMode("join");
              await handleJoin();
            }}
            disabled={isLoading || !roomId.trim()}
            className="btn-secondary w-full flex items-center justify-center gap-3"
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
                Joining...
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
                    strokeWidth={2}
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
                Join Room
              </>
            )}
          </button>
        </div>
      </div>

      {/* Features */}
      <div className="mt-12 grid grid-cols-3 gap-4 text-center">
        <div className="p-4">
          <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-white/5 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="text-xs text-gray-500">Video Chat</p>
        </div>
        <div className="p-4">
          <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-white/5 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          </div>
          <p className="text-xs text-gray-500">Speech to Text</p>
        </div>
        <div className="p-4">
          <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-white/5 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
              />
            </svg>
          </div>
          <p className="text-xs text-gray-500">AI Translation</p>
        </div>
      </div>
    </div>
  );
}
