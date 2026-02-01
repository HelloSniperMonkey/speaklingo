import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Lazy initialization to avoid build-time errors
let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    // Convert to proper format for OpenAI
    const buffer = await audioFile.arrayBuffer();
    const file = new File([buffer], "audio.webm", { type: "audio/webm" });

    const client = getOpenAI();
    const transcription = await client.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      response_format: "json",
    });

    return NextResponse.json({
      text: transcription.text,
    });
  } catch (error) {
    console.error("Transcription error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to transcribe audio";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
