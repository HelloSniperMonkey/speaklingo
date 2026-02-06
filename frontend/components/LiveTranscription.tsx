"use client";

import { useGoogleLiveTranscription } from "@/hooks/useGoogleLiveTranscription";
import { useTranslationStream } from "@/hooks/useTranslationStream";
import { useTranscriptionStream } from "@/hooks/useTranscriptionStream";
import { API_CONFIG } from "@/lib/apiConfig";
import { useEffect, useState, useRef } from "react";

interface LiveTranscriptionProps {
    localStream: MediaStream | null;
    remoteStream?: MediaStream | null; // Optional - not used in simplified flow
    roomId: string;
    myUserId?: string; // 'local-user' for creator, 'remote-user' for joiner
    spokenLanguageLocale: string; // Google STT locale code (e.g., 'en-US', 'es-ES')
    isTranslationEnabled: boolean; // Controls if translation pipeline is active
    onTheirSpeech?: (text: string) => void; // Callback when their speech is transcribed
    onTheirTranslation?: (text: string) => void; // Callback when their speech is translated
}

export function LiveTranscription({
    localStream,
    roomId,
    myUserId = 'local-user', // 'local-user' for creator, 'remote-user' for joiner
    spokenLanguageLocale, // Google STT locale from parent
    isTranslationEnabled, // Whether translation mode is active
    onTheirSpeech, // Callback to send their speech to parent
    onTheirTranslation, // Callback to send their translation to parent
}: LiveTranscriptionProps) {

    // My speech (what I say) - transcribed locally
    const [mySegments, setMySegments] = useState<string[]>([]);
    const [myLag, setMyLag] = useState<number | null>(null);

    // Their speech (what they say) - received via broadcast
    const [theirSegments, setTheirSegments] = useState<string[]>([]);
    const [theirLag, setTheirLag] = useState<number | null>(null);

    // Translations
    const [myTranslations, setMyTranslations] = useState<Array<{ hash?: string, text: string }>>([]);
    const [theirTranslations, setTheirTranslations] = useState<Array<{ hash?: string, text: string }>>([]);
    const [myTranslationLatency, setMyTranslationLatency] = useState<number | null>(null);
    const [theirTranslationLatency, setTheirTranslationLatency] = useState<number | null>(null);

    // Ref to track the last processed messages to prevent duplicates
    const lastProcessedTranslationRef = useRef<any>(null);
    const lastProcessedTranscriptionRef = useRef<any>(null);

    const wsUrl = API_CONFIG.ws.transcription;

    // Single transcriber for MY audio only
    const transcriber = useGoogleLiveTranscription(wsUrl);

    // Translation stream hook - receives translations for all users in room
    const { translation: translationMessage, isConnected: isTranslationConnected } = useTranslationStream(roomId);

    // Transcription stream hook - receives transcriptions broadcast by other users
    const { transcription: remoteTranscription, isConnected: isTranscriptionStreamConnected } = useTranscriptionStream(roomId);

    // Handle MY transcription results (from local audio)
    useEffect(() => {
        if (transcriber.transcription) {
            setMyLag(transcriber.transcription.processingTime || null);
            if (transcriber.transcription.isFinal) {
                const text = transcriber.transcription.text;
                setMySegments(prev => [...prev, text]);
            }
        }
    }, [transcriber.transcription]);

    // Handle THEIR transcription results (from broadcast stream)
    useEffect(() => {
        if (remoteTranscription) {
            // Prevent duplicate processing
            if (lastProcessedTranscriptionRef.current === remoteTranscription) {
                return;
            }
            lastProcessedTranscriptionRef.current = remoteTranscription;

            const { userId, text, isFinal, processingTime } = remoteTranscription;

            // Only show transcriptions from the OTHER user
            if (userId && userId !== myUserId && isFinal && text) {
                setTheirSegments(prev => [...prev, text]);
                setTheirLag(processingTime || null);
                // Notify parent of their speech
                onTheirSpeech?.(text);
            }
        }
    }, [remoteTranscription, myUserId, onTheirSpeech]);

    // Handle incoming translation messages from WebSocket stream
    useEffect(() => {
        if (translationMessage) {
            if (translationMessage.type === 'translation') {
                // Prevent duplicate processing
                if (lastProcessedTranslationRef.current === translationMessage) {
                    return;
                }
                lastProcessedTranslationRef.current = translationMessage;

                const { userId, translatedText, hash } = translationMessage;

                // Route translation based on who spoke:
                // - If userId === myUserId → My speech translated → show in "My Translation"
                // - If userId !== myUserId → Their speech translated → show in "Their Translation"
                const isMyTranslation = userId === myUserId;

                const newTranslation = { hash, text: translatedText || '' };

                console.log(`[LiveTranscription] Translation: userId=${userId}, myUserId=${myUserId}, isMyTranslation=${isMyTranslation}`);

                if (isMyTranslation) {
                    setMyTranslations(prev => [...prev, newTranslation]);
                    setMyTranslationLatency(translationMessage.latencyMs || null);
                } else {
                    setTheirTranslations(prev => [...prev, newTranslation]);
                    setTheirTranslationLatency(translationMessage.latencyMs || null);
                    // Notify parent of their translated speech
                    onTheirTranslation?.(translatedText || '');
                }
            } else if (translationMessage.type === 'invalidation') {
                const baseHash = translationMessage.hash;
                if (baseHash) {
                    const mlHash = `${baseHash}_ml`;
                    setMyTranslations(prev => prev.filter(t => t.hash !== mlHash));
                    setTheirTranslations(prev => prev.filter(t => t.hash !== mlHash));
                }
            }
        }
    }, [translationMessage, myUserId, onTheirTranslation]);

    // Interim text for my speech
    const myInterim = !transcriber.transcription?.isFinal ? transcriber.transcription?.text : "";

    // Auto-start/stop transcription based on isTranslationEnabled from parent
    useEffect(() => {
        if (isTranslationEnabled && localStream && !transcriber.isRecording) {
            console.log('[LiveTranscription] Auto-starting transcription (translation enabled)');
            transcriber.startRecording(localStream, spokenLanguageLocale, roomId, myUserId);
        } else if (!isTranslationEnabled && transcriber.isRecording) {
            console.log('[LiveTranscription] Auto-stopping transcription (translation disabled)');
            transcriber.stopRecording();
        }
    }, [isTranslationEnabled, localStream, transcriber.isRecording, spokenLanguageLocale, roomId, myUserId]);

    const handleStart = () => {
        if (localStream) {
            console.log('[LiveTranscription] Starting transcription for my audio with locale:', spokenLanguageLocale);
            // Transcribe MY audio with MY userId using the spoken language locale
            transcriber.startRecording(localStream, spokenLanguageLocale, roomId, myUserId);
        } else {
            console.error('[LiveTranscription] No localStream available');
        }
    };

    const handleStop = () => {
        transcriber.stopRecording();
    };

    return (
        <div className="w-full max-w-5xl mx-auto mt-8 p-6 bg-[#1a1f2e] rounded-xl border border-gray-800">
            <h2 className="text-2xl font-bold text-center text-slate-200 mb-6 font-mono">
                5. Live Transcription
            </h2>

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
                <button
                    onClick={handleStart}
                    disabled={transcriber.isRecording || !localStream}
                    className={`px-4 py-2 rounded border font-medium transition-colors ${transcriber.isRecording
                        ? "bg-green-900/20 border-green-500/50 text-green-400 cursor-default"
                        : "bg-white text-black border-white hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        }`}
                >
                    {transcriber.isRecording ? "🎙️ Transcribing..." : "Start Transcription"}
                </button>

                <button
                    onClick={handleStop}
                    disabled={!transcriber.isRecording}
                    className="px-4 py-2 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                >
                    Stop
                </button>

                <div className="flex items-center gap-2 ml-2">
                    <div
                        className={`w-2 h-2 rounded-full ${transcriber.isConnected ? "bg-green-500" : "bg-gray-500"
                            }`}
                    />
                    <span className="text-sm font-mono text-gray-400">
                        {transcriber.isConnected ? "Connected" : "Disconnected"}
                    </span>
                </div>
            </div>

            {/* Transcription Boxes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* My Speech */}
                <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-semibold text-slate-300 text-center font-mono flex items-center justify-center gap-2">
                        🎤 My Speech
                        {myLag !== null && (
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                {Math.round(myLag * 1000)}ms lag
                            </span>
                        )}
                    </h3>
                    <div className="h-64 bg-[#0f1219] border-2 border-slate-700 rounded-lg p-4 overflow-y-auto font-mono text-sm text-gray-300 relative shadow-inner">
                        {mySegments.length > 0 || myInterim ? (
                            <div className="flex flex-col gap-2">
                                {mySegments.map((seg, i) => (
                                    <div key={i} className="text-slate-300">{seg}</div>
                                ))}
                                {myInterim && <div className="text-gray-500 italic">{myInterim}</div>}
                            </div>
                        ) : (
                            <span className="text-gray-600 italic">Click "Start Transcription" to transcribe what you say...</span>
                        )}
                    </div>
                </div>

                {/* Their Speech */}
                <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-semibold text-slate-300 text-center font-mono flex items-center justify-center gap-2">
                        👂 Their Speech
                        {theirLag !== null && (
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                {Math.round(theirLag * 1000)}ms lag
                            </span>
                        )}
                    </h3>
                    <div className="h-64 bg-[#0f1219] border-2 border-slate-700 rounded-lg p-4 overflow-y-auto font-mono text-sm text-gray-300 relative shadow-inner">
                        {theirSegments.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                {theirSegments.map((seg, i) => (
                                    <div key={i} className="text-slate-300">{seg}</div>
                                ))}
                            </div>
                        ) : (
                            <span className="text-gray-600 italic">
                                {isTranscriptionStreamConnected
                                    ? "Waiting for the other person to speak..."
                                    : "Connecting to transcription stream..."}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Translation Boxes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                {/* My Speech Translated */}
                <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-semibold text-green-300 text-center font-mono flex items-center justify-center gap-2">
                        🎤 My Speech Translated
                        {myTranslationLatency && (
                            <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">
                                {myTranslationLatency}ms lag
                            </span>
                        )}
                    </h3>
                    <div className="h-48 bg-[#0f1219] border-2 border-green-700/50 rounded-lg p-4 overflow-y-auto font-mono text-sm text-green-200 relative shadow-inner">
                        {myTranslations.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                {myTranslations.map((translation, i) => (
                                    <div key={translation.hash || i} className="text-green-100">{translation.text}</div>
                                ))}
                            </div>
                        ) : (
                            <span className="text-gray-600 italic">Your translated speech will appear here...</span>
                        )}
                    </div>
                </div>

                {/* Their Speech Translated */}
                <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-semibold text-green-300 text-center font-mono flex items-center justify-center gap-2">
                        👂 Their Speech Translated
                        {theirTranslationLatency && (
                            <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">
                                {theirTranslationLatency}ms lag
                            </span>
                        )}
                    </h3>
                    <div className="h-48 bg-[#0f1219] border-2 border-green-700/50 rounded-lg p-4 overflow-y-auto font-mono text-sm text-green-200 relative shadow-inner">
                        {theirTranslations.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                {theirTranslations.map((translation, i) => (
                                    <div key={translation.hash || i} className="text-green-100">{translation.text}</div>
                                ))}
                            </div>
                        ) : (
                            <span className="text-gray-600 italic">Their translated speech will appear here...</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Connection Status */}
            <div className="mt-4 flex items-center justify-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                    <span className="text-gray-400">Transcription:</span>
                    <div className={`w-2 h-2 rounded-full ${transcriber.isConnected ? "bg-green-500" : "bg-gray-500"}`} />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-gray-400">Stream:</span>
                    <div className={`w-2 h-2 rounded-full ${isTranscriptionStreamConnected ? "bg-green-500" : "bg-gray-500"}`} />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-gray-400">Translation:</span>
                    <div className={`w-2 h-2 rounded-full ${isTranslationConnected ? "bg-green-500" : "bg-gray-500"}`} />
                </div>
            </div>

            {/* Error Display */}
            {transcriber.error && (
                <div className="mt-4 p-3 bg-red-900/20 border border-red-500/30 rounded text-red-400 text-center text-sm">
                    {transcriber.error}
                </div>
            )}
        </div>
    );
}
