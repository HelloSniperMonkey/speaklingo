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
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const roomId = formData.get("roomId") as string | null;
    const userId = formData.get("userId") as string | null;
    const transcript = formData.get("transcript") as string | null;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const targetUrl = getVoiceServerUrl();

    // Forward to voice server with multipart form data
    const backendFormData = new FormData();
    backendFormData.append("audio", audioFile, audioFile.name || "recording.webm");
    if (roomId) backendFormData.append("roomId", roomId);
    if (userId) backendFormData.append("userId", userId);
    if (transcript) backendFormData.append("transcript", transcript);

    const backendResponse = await fetch(`${targetUrl}/upload-voice-sample`, {
      method: "POST",
      body: backendFormData,
    });

    const data = await backendResponse.json();
    return NextResponse.json(data, { status: backendResponse.status });
  } catch (error) {
    console.error("qwen-tts proxy error:", error);
    const message = error instanceof Error ? error.message : "Failed to reach voice server";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
