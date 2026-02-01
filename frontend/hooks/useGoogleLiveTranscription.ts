import { useState, useRef, useCallback, useEffect } from 'react';

const AUDIO_ENCODING = 'LINEAR16';
const SAMPLE_RATE = 16000;

// Silence detection configuration
const SILENCE_THRESHOLD = 0.01; // RMS threshold below which audio is considered silence
const SILENCE_DURATION_MS = 600; // ms of continuous silence before finalizing (reduced for faster response)
const MIN_SPEECH_DURATION_MS = 100; // Minimum speech duration before we consider silence detection

interface TranscriptionResult {
    text: string;
    isFinal: boolean;
    speaker: 'local' | 'remote';
    processingTime?: number;
    session_id?: string;
}

export function useGoogleLiveTranscription(url: string) {
    const [isConnected, setIsConnected] = useState(false);
    const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);

    const websocketRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const lastInterimTextRef = useRef<string>('');
    
    // RMS-based silence detection refs
    const silenceStartTimeRef = useRef<number | null>(null);
    const speechStartTimeRef = useRef<number | null>(null);
    const isSpeakingRef = useRef<boolean>(false);
    const pendingRestartRef = useRef<boolean>(false);
    const configRef = useRef<{ language: string; roomId?: string; userId?: string }>({ language: 'en-US' });

    const connect = useCallback(() => {
        if (websocketRef.current?.readyState === WebSocket.OPEN) return;

        try {
            const ws = new WebSocket(url);

            ws.onopen = () => {
                console.log('Connected to Transcription Server');
                setIsConnected(true);
                setError(null);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'transcription') {
                        setTranscription({
                            text: data.text,
                            isFinal: data.final,
                            speaker: 'local',
                            processingTime: data.processing_time,
                            session_id: data.session_id
                        });

                        // Store interim text for silence-based finalization
                        if (!data.final && data.text) {
                            lastInterimTextRef.current = data.text;
                        } else if (data.final) {
                            lastInterimTextRef.current = '';
                        }
                    } else if (data.type === 'finalized') {
                        // Backend confirmed finalization, clear interim text
                        console.log('Backend finalized:', data.text?.substring(0, 50));
                        lastInterimTextRef.current = '';
                    } else if (data.type === 'stream_restarted') {
                        // Backend confirmed stream restart
                        console.log('Stream restarted, ready for new utterance');
                        pendingRestartRef.current = false;
                    } else if (data.type === 'error') {
                        console.error('Transcription error:', data.message);
                        setError(data.message);
                    } else if (data.type === 'status') {
                        console.log('Server status:', data.status);
                    }
                } catch (e) {
                    console.error('Failed to parse message:', e);
                }
            };

            ws.onclose = () => {
                console.log('Disconnected from Transcription Server');
                setIsConnected(false);
                setIsRecording(false);
            };

            ws.onerror = (event) => {
                console.error('WebSocket error:', event);
                setError('Connection error');
            };

            websocketRef.current = ws;
        } catch (err) {
            console.error('Connection failed:', err);
            setError('Failed to connect to server');
        }
    }, [url]);

    const disconnect = useCallback(() => {
        if (websocketRef.current) {
            websocketRef.current.close();
            websocketRef.current = null;
        }
        stopRecording();
        setIsConnected(false);
    }, []);

    // Calculate RMS (Root Mean Square) energy of audio buffer
    const calculateRMS = useCallback((buffer: Float32Array): number => {
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i] * buffer[i];
        }
        return Math.sqrt(sum / buffer.length);
    }, []);

    // Handle silence detection and stream restart
    const handleSilenceDetection = useCallback((rms: number) => {
        const now = Date.now();
        const isSilent = rms < SILENCE_THRESHOLD;

        if (isSilent) {
            // If we were speaking, start tracking silence
            if (isSpeakingRef.current) {
                if (silenceStartTimeRef.current === null) {
                    silenceStartTimeRef.current = now;
                }

                const silenceDuration = now - silenceStartTimeRef.current;
                const speechDuration = speechStartTimeRef.current ? now - speechStartTimeRef.current : 0;

                // Only finalize if we had meaningful speech and silence threshold reached
                if (silenceDuration >= SILENCE_DURATION_MS && speechDuration >= MIN_SPEECH_DURATION_MS) {
                    // We have silence after speech - finalize and restart stream
                    if (lastInterimTextRef.current && websocketRef.current?.readyState === WebSocket.OPEN && !pendingRestartRef.current) {
                        console.log(`Silence detected (${silenceDuration}ms), finalizing: "${lastInterimTextRef.current.substring(0, 50)}..."`);
                        
                        pendingRestartRef.current = true;
                        
                        // Send finalize command with restart flag
                        websocketRef.current.send(JSON.stringify({
                            command: 'finalize_and_restart',
                            text: lastInterimTextRef.current
                        }));
                        
                        lastInterimTextRef.current = '';
                    }
                    
                    // Reset speech tracking
                    isSpeakingRef.current = false;
                    speechStartTimeRef.current = null;
                    silenceStartTimeRef.current = null;
                }
            }
        } else {
            // Audio detected - reset silence tracking
            silenceStartTimeRef.current = null;
            
            if (!isSpeakingRef.current) {
                // Speech started
                isSpeakingRef.current = true;
                speechStartTimeRef.current = now;
                pendingRestartRef.current = false;
            }
        }
    }, []);

    const processAudio = useCallback((inputData: Float32Array) => {
        if (!websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) return;

        // Calculate RMS energy for silence detection
        const rms = calculateRMS(inputData);
        handleSilenceDetection(rms);

        // Don't send audio if we're waiting for stream restart
        if (pendingRestartRef.current) return;

        // Downsample from AudioContext rate (e.g. 44100 or 48000) to 16000
        // And convert Float32 to Int16
        const targetSampleRate = SAMPLE_RATE;
        const contextSampleRate = audioContextRef.current?.sampleRate || 48000;
        const ratio = contextSampleRate / targetSampleRate;

        const newLength = Math.floor(inputData.length / ratio);
        const result = new Int16Array(newLength);

        for (let i = 0; i < newLength; i++) {
            // Simple downsampling (decimation). Ideally use a filter.
            // Also handling clamping.
            const offset = Math.floor(i * ratio);
            const sample = Math.max(-1, Math.min(1, inputData[offset]));
            result[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        websocketRef.current.send(result.buffer);
    }, [calculateRMS, handleSilenceDetection]);

    const setLanguage = useCallback((languageCode: string) => {
        if (websocketRef.current?.readyState === WebSocket.OPEN) {
            websocketRef.current.send(JSON.stringify({
                command: 'config',
                language: languageCode
            }));
        }
    }, []);

    const stopRecording = useCallback(() => {
        console.log('[Transcription] stopRecording called');
        
        // Reset silence detection state
        silenceStartTimeRef.current = null;
        speechStartTimeRef.current = null;
        isSpeakingRef.current = false;
        pendingRestartRef.current = false;
        lastInterimTextRef.current = '';

        if (websocketRef.current?.readyState === WebSocket.OPEN) {
            websocketRef.current.send(JSON.stringify({ command: 'stop' }));
        }

        // Disconnect audio processing nodes
        try {
            if (sourceRef.current) {
                sourceRef.current.disconnect();
            }
        } catch (e) {
            console.warn('[Transcription] Error disconnecting source:', e);
        }
        
        try {
            if (processorRef.current) {
                processorRef.current.disconnect();
            }
        } catch (e) {
            console.warn('[Transcription] Error disconnecting processor:', e);
        }

        // Close AudioContext
        try {
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
            }
        } catch (e) {
            console.warn('[Transcription] Error closing audio context:', e);
        }

        sourceRef.current = null;
        processorRef.current = null;
        audioContextRef.current = null;
        streamRef.current = null;

        setIsRecording(false);
        console.log('[Transcription] Recording stopped and cleaned up');
    }, []);

    const startRecording = useCallback(async (
        stream: MediaStream, 
        languageCode: string = 'en-US',
        roomId?: string,
        userId?: string
    ) => {
        if (!stream) {
            console.error('[Transcription] No stream provided');
            return;
        }
        
        // If already recording, stop first (inline cleanup to avoid dependency)
        if (audioContextRef.current || sourceRef.current || processorRef.current) {
            console.log('[Transcription] Cleaning up previous recording...');
            // Reset silence detection state
            silenceStartTimeRef.current = null;
            speechStartTimeRef.current = null;
            isSpeakingRef.current = false;
            pendingRestartRef.current = false;
            lastInterimTextRef.current = '';

            if (websocketRef.current?.readyState === WebSocket.OPEN) {
                websocketRef.current.send(JSON.stringify({ command: 'stop' }));
            }

            try { sourceRef.current?.disconnect(); } catch (e) {}
            try { processorRef.current?.disconnect(); } catch (e) {}
            try { 
                if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                    audioContextRef.current.close();
                }
            } catch (e) {}

            sourceRef.current = null;
            processorRef.current = null;
            audioContextRef.current = null;
            streamRef.current = null;
            setIsRecording(false);
            
            // Wait a bit for cleanup
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log('[Transcription] Starting recording...');

        // Store config for potential restarts
        configRef.current = { language: languageCode, roomId, userId };

        // Close any existing WebSocket and reconnect fresh
        if (websocketRef.current) {
            if (websocketRef.current.readyState === WebSocket.OPEN || 
                websocketRef.current.readyState === WebSocket.CONNECTING) {
                websocketRef.current.close();
            }
            websocketRef.current = null;
        }
        
        // Connect fresh
        connect();
        
        // Wait for connection to be established
        await new Promise<void>((resolve) => {
            const checkConnection = setInterval(() => {
                if (websocketRef.current?.readyState === WebSocket.OPEN) {
                    clearInterval(checkConnection);
                    resolve();
                }
            }, 100);
            // Timeout after 5 seconds
            setTimeout(() => {
                clearInterval(checkConnection);
                resolve();
            }, 5000);
        });

        try {
            if (websocketRef.current?.readyState === WebSocket.OPEN) {
                // Send language config first with optional roomId and userId
                websocketRef.current.send(JSON.stringify({
                    command: 'config',
                    language: languageCode,
                    roomId: roomId,
                    userId: userId
                }));
                websocketRef.current.send(JSON.stringify({ command: 'start' }));
            } else {
                console.error('[Transcription] WebSocket not connected after waiting');
                setError('Failed to connect to transcription server');
                return;
            }

            streamRef.current = stream;
            
            // Create a fresh AudioContext
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = audioContext;
            
            // Resume AudioContext if it's suspended (browser autoplay policy)
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            // bufferSize 4096 is substantial but safe
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                processAudio(inputData);
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            // Reset silence detection state
            silenceStartTimeRef.current = null;
            speechStartTimeRef.current = null;
            isSpeakingRef.current = false;
            pendingRestartRef.current = false;

            setIsRecording(true);
            console.log('[Transcription] Recording started successfully');
        } catch (err) {
            console.error('[Transcription] Failed to start recording:', err);
            setError('Failed to start audio capture');
        }
    }, [connect, processAudio]);

    // Clean up on unmount
    useEffect(() => {
        return () => {
            disconnect();
        };
    }, [disconnect]);

    return {
        isConnected,
        transcription,
        error,
        isRecording,
        connect,
        disconnect,
        startRecording,
        stopRecording,
        setLanguage
    };
}
