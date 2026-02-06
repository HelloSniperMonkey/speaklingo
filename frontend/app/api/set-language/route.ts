import { NextRequest, NextResponse } from 'next/server';

// Get voice server URL from environment (same pattern as register-voice)
const API_ENV = process.env.NEXT_PUBLIC_API_ENV || 'dev';
const IS_PROD = API_ENV === 'prod';
const LOADBALANCER_URL = process.env.NEXT_PUBLIC_LOADBALANCER_URL || 'http://localhost:8089';

const getVoiceServerUrl = (): string => {
    if (IS_PROD) {
        return `${LOADBALANCER_URL}/api/voice`;
    }
    return process.env.QWEN_TTS_URL || 'http://localhost:8712';
};

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { roomId, userId, spokenLanguage } = body;

        if (!roomId || !userId || !spokenLanguage) {
            return NextResponse.json(
                { error: 'Missing roomId, userId, or spokenLanguage' },
                { status: 400 }
            );
        }

        const targetUrl = getVoiceServerUrl();

        // Forward to the voice server (via loadbalancer in prod) which has Redis access
        const response = await fetch(`${targetUrl}/set-language`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId, userId, spokenLanguage })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error(`[set-language] Backend error:`, errorData);
            return NextResponse.json(
                { error: errorData.error || 'Failed to store language preference' },
                { status: response.status }
            );
        }

        const data = await response.json();
        console.log(`[set-language] Stored: ${userId} in room ${roomId} speaks ${spokenLanguage}`);

        return NextResponse.json(data);
    } catch (error) {
        console.error('[set-language] proxy error:', error);
        const message = error instanceof Error ? error.message : 'Failed to set language';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
