import { NextRequest, NextResponse } from "next/server";
import { createLingoEngine } from "@/lib/lingo";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, sourceLocale, targetLocale } = body;

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    if (!targetLocale) {
      return NextResponse.json(
        { error: "No target locale provided" },
        { status: 400 }
      );
    }

    const engine = createLingoEngine();

    // Use Lingo.dev SDK to translate
    // sourceLocale can be null for auto-detection
    const translated = await engine.localizeText(text, {
      sourceLocale: sourceLocale || null,
      targetLocale,
      fast: true, // Optimize for real-time chat
    });

    return NextResponse.json({
      translated,
      sourceLocale: sourceLocale || "auto",
      targetLocale,
    });
  } catch (error) {
    console.error("Translation error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to translate text";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
