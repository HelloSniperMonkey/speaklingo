import { NextRequest, NextResponse } from "next/server";

const DEFAULT_VOICE_SERVER_URL = "http://localhost:8712";

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

    const targetUrl = process.env.QWEN_TTS_URL || DEFAULT_VOICE_SERVER_URL;

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
