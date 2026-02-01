## Plan: Redis Pub/Sub Event-Driven Translation + Streaming Voice Cloning

Event-driven architecture with transcription → translation → voice generation pipeline using Redis pub/sub and WebSocket streaming for ultra-low latency voice cloning.

### Steps

1. **Create voice generation server with streaming support** [backend/qwen3-tts/voice_server.py](backend/qwen3-tts/voice_server.py)
   - Flask server on port 8712 with `/upload-voice-sample` endpoint
   - Store voice samples in memory cache with roomId key for cloning
   - Add `/health` endpoint for status checks
   - Implement audio chunking utility (500ms segments) for streaming WAV files as base64 chunks

2. **Create voice processor worker** [backend/qwen3-tts/voice_processor.py](backend/qwen3-tts/voice_processor.py)
   - Subscribe to Redis pattern `room:*:translation`
   - Generate voice using qwen3-tts with cached voice sample for that roomId
   - Chunk generated audio into 500ms segments with metadata (chunkIndex, totalChunks, sessionId)
   - Publish chunks sequentially to `room:{roomId}:voice-chunk` channel
   - Track generation start/end timestamps for latency metrics
   - Run as standalone background process with error recovery

3. **Create voice stream WebSocket server** [backend/qwen3-tts/voice_ws_server.py](backend/qwen3-tts/voice_ws_server.py)
   - WebSocket server on port 8768 (follows pattern of [translation_ws_server.py](backend/translate-api/translation_ws_server.py))
   - Clients send `{command: "join", roomId: "abc123"}` on connect
   - Subscribe to `room:{roomId}:voice-chunk` Redis channel
   - Broadcast voice chunks to all clients in same room
   - Send latency metadata (generationTime, totalLatency) with each session

4. **Update qwen-tts API route** [frontend/app/api/qwen-tts/route.ts](frontend/app/api/qwen-tts/route.ts)
   - Change endpoint to `http://localhost:8712/upload-voice-sample`
   - Add roomId parameter from request
   - Forward audio file to voice server for caching
   - Return success/failure status

5. **Create frontend voice stream hook** [frontend/hooks/useVoiceStream.ts](frontend/hooks/useVoiceStream.ts)
   - Connect to `ws://localhost:8768`
   - Send join command with roomId
   - Receive voice chunks and reconstruct audio
   - Use Web Audio API to queue and play chunks seamlessly
   - Track latency metrics (generationTime, receivedTime)
   - Auto-reconnect on disconnect

6. **Update intro page recording flow** [page.tsx](frontend/app/page.tsx#L189-L215)
   - Pass roomId (generate temp ID for intro page) to `sendAudioToQwen`
   - Show "Voice sample uploaded" status after successful upload
   - Display error if upload fails

7. **Create voice latency display component** [frontend/components/VoiceLatencyIndicator.tsx](frontend/components/VoiceLatencyIndicator.tsx)
   - Show real-time latency for qwen3-tts generation (ms)
   - Display connection status (connected/generating/idle/error)
   - Show chunk buffer status (how many chunks queued)
   - Use sketch-style design matching existing UI

8. **Integrate voice stream in room page** [frontend/app/room/[roomId]/page.tsx](frontend/app/room/[roomId]/page.tsx)
   - Import and use `useVoiceStream(roomId)`
   - Add `<VoiceLatencyIndicator>` component to ControlBar area
   - Ensure audio playback doesn't conflict with WebRTC audio

### Further Considerations

1. **Voice sample management?** Should voice samples persist across page refreshes? Options: A) In-memory only (lost on refresh), B) Redis with TTL (1 hour), C) Firestore for persistence. **Recommendation: Redis with 1-hour TTL** for balance of speed and persistence.

2. **Multiple users in same room?** Each user needs separate voice sample. Options: A) `room:{roomId}:user:{userId}:voice-chunk` channels, B) Include userId in chunk metadata. **Recommendation: Include userId in metadata** to keep channel structure simple.

3. **Audio codec and bandwidth?** Current: base64-encoded WAV chunks (~150KB/sec). Options: A) Keep WAV for quality, B) Encode to Opus/AAC for 80% size reduction. **Recommendation: Start with WAV**, optimize to Opus later if bandwidth becomes issue.

4. **Qwen3-TTS generation speed insufficient?** If generation takes too long (>2x real-time), consider: changing the model to mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit since it’s quantised it will be faster albeit at some quality cost.