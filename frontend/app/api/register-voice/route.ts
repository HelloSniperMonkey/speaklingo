import { NextRequest, NextResponse } from "next/server";

// Get voice server URL from environment
const API_ENV = process.env.NEXT_PUBLIC_API_ENV || 'dev';
const IS_PROD = API_ENV === 'prod';
const LOADBALANCER_URL = process.env.NEXT_PUBLIC_LOADBALANCER_URL || 'http://localhost:8089';

const getVoiceServerUrl = (): string => {
  if (IS_PROD) {
    return `${LOADBALANCER_URL}/api/voice`;
  }
  return process.env.QWEN_TTS_URL || "http://localhost:8712";
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomId, role, voiceUserId } = body;

    if (!roomId || !role || !voiceUserId) {
      return NextResponse.json(
        { error: "Missing required fields: roomId, role, voiceUserId" },
        { status: 400 }
      );
    }

    const targetUrl = getVoiceServerUrl();

    // Register the voice mapping with the backend
    const response = await fetch(`${targetUrl}/register-voice-mapping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, role, voiceUserId }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.error || "Failed to register voice mapping" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("register-voice proxy error:", error);
    const message = error instanceof Error ? error.message : "Failed to register voice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
