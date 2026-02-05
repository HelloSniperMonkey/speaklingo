#!/usr/bin/env python3
"""
CONTINUOUS TRANSCRIPTION SERVER - WebSocket server for real-time speech transcription.

KEY DIFFERENCE from original:
- Emits transcription chunks every 2 seconds (configurable) regardless of silence
- Each chunk includes context window tracking for the translation processor
- No waiting for silence detection - continuous streaming

This enables the sliding window translation approach where:
- 4 seconds of context (already translated) + 2 seconds new = 6 second window
- Translation starts immediately every 2s, not waiting for speaker to stop
"""

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Optional

import websockets
from websockets.server import WebSocketServerProtocol
from google.cloud import speech

from redis_client import get_redis_client

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Check for Google Credentials
if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
    # Check multiple possible paths
    possible_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "credential-videoapp.json"),
        "/Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/backend/google-backend/credential-videoapp.json",
    ]
    
    for credential_path in possible_paths:
        if os.path.exists(credential_path):
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credential_path
            logger.info(f"Found credentials: {credential_path}")
            break
    else:
        logger.warning("Google credentials not found in any expected location!")

# Global client
speech_client = None

# Configuration
CHUNK_INTERVAL_SECONDS = 3.0  # Max time to wait before emitting (fallback for continuous speech)
CONTEXT_WINDOW_SECONDS = 4.0  # Keep 4 seconds of context

# Character-based context window
# Average speaking rate: ~150 words/min = ~2.5 words/sec = ~15 chars/sec
# 4-5 seconds of context ≈ 60-100 characters
# For non-Latin scripts (Bengali, Hindi, etc.), characters are denser
CONTEXT_MAX_CHARS = 150  # Increased for better context in non-Latin scripts

# Hybrid chunk emission settings
# Emit when ANY of these conditions are met:
# 1. Sentence boundary detected AND silence > SENTENCE_SILENCE_MS
# 2. Long silence > LONG_SILENCE_MS (pause in speech without sentence end)
# 3. Timer reaches CHUNK_INTERVAL_SECONDS (fallback for continuous speech)
# 4. BUT only if MIN_CHUNK_LENGTH characters accumulated

MIN_CHUNK_LENGTH = 25  # Increased to get more complete phrases (prevents fragments)
# Sentence endings for multiple languages:
# . ? ! - English/Western
# 。？！ - Chinese/Japanese
# । - Bengali/Hindi (Devanagari purna viram)
SENTENCE_ENDINGS = '.?!。？！।'
SENTENCE_SILENCE_MS = 200  # Short silence needed after sentence ending
LONG_SILENCE_MS = 800  # Long silence triggers emit even without sentence ending


class ContinuousTranscriptionSession:
    """
    Manages a continuous transcription session with 2-second chunking.
    """

    def __init__(self, session_id: str, room_id: Optional[str] = None, user_id: Optional[str] = None):
        self.session_id = session_id
        self.room_id = room_id
        self.user_id = user_id
        self.audio_queue = asyncio.Queue()
        self.language_code = "en-US"
        self.sample_rate = 16000
        self.is_running = True
        
        # Stream management
        self.stream_generation = 0
        
        # Continuous chunking state
        self.current_interim_text = ""  # Current interim transcription
        self.last_emitted_text = ""     # What we last emitted
        self.context_text = ""          # Rolling context (character-based, not chunk-based)
        self.chunk_timer_task: Optional[asyncio.Task] = None
        self.silence_detector_task: Optional[asyncio.Task] = None
        self.last_chunk_time = time.time()
        self.chunk_sequence = 0  # Sequence number for chunks
        
        # Silence detection state
        self.last_text_update_time = time.time()  # When we last got new text
        self.silence_emitted = False  # Whether we already emitted for this silence
        
        # WebSocket reference (set when stream starts)
        self.websocket: Optional[WebSocketServerProtocol] = None
        
    async def add_audio(self, audio_data: bytes):
        """Add audio chunk to the processing queue."""
        if self.is_running:
            await self.audio_queue.put(("audio", audio_data, self.stream_generation))
    
    def update_interim_text(self, text: str):
        """Update the current interim transcription text."""
        if text != self.current_interim_text:
            self.current_interim_text = text
            self.last_text_update_time = time.time()  # Reset silence timer
            self.silence_emitted = False  # Allow new silence-based emission
    
    def _compute_new_text(self, current_text: str) -> str:
        """
        Compute genuinely new text vs last_emitted_text using word-level diffing.
        
        Handles the case where Google STT's is_final result differs slightly
        from the accumulated interim (e.g., minor word corrections), which
        would cause a naive startswith() check to fail and re-emit everything.
        """
        if not current_text:
            return ""
        if not self.last_emitted_text:
            return current_text
        
        # Fast path: exact character-level prefix match
        if current_text.startswith(self.last_emitted_text):
            return current_text[len(self.last_emitted_text):].strip()
        
        # Slow path: word-level prefix matching
        # Handles minor differences from Google finals (punctuation, word corrections)
        last_words = self.last_emitted_text.split()
        current_words = current_text.split()
        
        # Strip trailing punctuation for fuzzy word comparison
        def clean(w):
            return w.rstrip('.,!?;:\u0964\u0965')  # includes Bengali danda
        
        common_prefix_len = 0
        for i in range(min(len(last_words), len(current_words))):
            if clean(last_words[i]) == clean(current_words[i]):
                common_prefix_len = i + 1
            else:
                break
        
        # If we matched a significant portion of last_emitted (>50%), trust the diff
        if common_prefix_len > 0 and common_prefix_len >= len(last_words) * 0.5:
            new_words = current_words[common_prefix_len:]
            return ' '.join(new_words).strip()
        
        # Fallback: treat entire text as new
        return current_text
    
    async def emit_chunk(self, force: bool = False, trigger: str = "manual"):
        """
        Emit the current transcription chunk if there's new content.
        trigger: 'timer', 'silence', 'manual', or 'force'
        """
        current_text = self.current_interim_text.strip()
        
        # Calculate what's new since last emission
        # We want to emit only the NEW part, but include context for translation
        if not current_text:
            return
        
        # Check if we have new content
        if current_text == self.last_emitted_text and not force:
            return
        
        # Compute the new text using word-level diffing (handles Google final corrections)
        new_text = self._compute_new_text(current_text)
        
        if not new_text:
            return
        
        # Use character-based context (keeps last ~100 chars)
        context = self.context_text
        
        # Create chunk message
        chunk_hash = str(uuid.uuid4())
        chunk_message = {
            "type": "transcription_chunk",
            "hash": f"{chunk_hash}_tc",
            "roomId": self.room_id,
            "userId": self.user_id or self.session_id,
            "sessionId": self.session_id,
            "context": context,           # Previous ~4 seconds (already translated)
            "newText": new_text,           # Current chunk (to translate)
            "fullText": current_text,      # Full accumulated text
            "language": self.language_code,
            "isFinal": False,              # These are continuous chunks, never "final"
            "isChunk": True,
            "chunkSequence": self.chunk_sequence,
            "timestamp": int(time.time() * 1000)
        }
        
        # Publish to Redis for translation processor
        if self.room_id:
            try:
                redis_client = get_redis_client()
                channel = f"room:{self.room_id}:transcription"
                await redis_client.publish(channel, json.dumps(chunk_message))
                trigger_icon = "⏱️" if trigger == "timer" else "🔇" if trigger == "silence" else "📤"
                logger.info(f"{trigger_icon} Chunk {self.chunk_sequence} [{trigger}]: new='{new_text[:40]}' ctx='{context[-30:] if context else ''}'")
            except Exception as e:
                logger.error(f"Redis publish error: {e}")
        
        # Send to WebSocket client
        if self.websocket:
            try:
                await self.websocket.send(json.dumps({
                    "type": "chunk_emitted",
                    "hash": f"{chunk_hash}_tc",
                    "newText": new_text,
                    "fullText": current_text,
                    "context": context,
                    "chunkSequence": self.chunk_sequence,
                    "timestamp": int(time.time() * 1000)
                }))
            except Exception as e:
                logger.error(f"WebSocket send error: {e}")
        
        # Update context with character-based sliding window
        # Append new text to context, then trim to max chars
        if self.context_text:
            self.context_text = self.context_text + " " + new_text
        else:
            self.context_text = new_text
        
        # Keep only the last CONTEXT_MAX_CHARS characters
        if len(self.context_text) > CONTEXT_MAX_CHARS:
            # Find a word boundary to trim at
            trim_text = self.context_text[-CONTEXT_MAX_CHARS:]
            space_idx = trim_text.find(' ')
            if space_idx > 0:
                self.context_text = trim_text[space_idx + 1:]
            else:
                self.context_text = trim_text
        
        self.last_emitted_text = current_text
        self.chunk_sequence += 1
        self.last_chunk_time = time.time()
    
    async def chunk_timer_loop(self):
        """Background task that emits chunks every CHUNK_INTERVAL_SECONDS (fallback for continuous speech)."""
        logger.info(f"Starting timer fallback (interval: {CHUNK_INTERVAL_SECONDS}s)")
        
        while self.is_running:
            try:
                await asyncio.sleep(CHUNK_INTERVAL_SECONDS)
                
                if not self.is_running:
                    break
                
                # Check if we have enough text to emit
                current_text = self.current_interim_text.strip()
                new_text = self._compute_new_text(current_text) if current_text else ""
                
                # Only emit if we have minimum content
                if len(new_text) >= MIN_CHUNK_LENGTH:
                    logger.info(f"⏱️ Timer triggered ({CHUNK_INTERVAL_SECONDS}s elapsed)")
                    await self.emit_chunk(trigger="timer")
                    self.silence_emitted = True  # Prevent silence detector from re-emitting
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Chunk timer error: {e}")
        
        logger.info("Chunk timer stopped")
    
    async def silence_detector_loop(self):
        """
        Hybrid chunk emission detector.
        
        Emits when ANY of these conditions are met:
        1. Sentence boundary (., ?, !) detected AND silence > 200ms
        2. Long silence > 800ms (pause without sentence ending)
        3. Timer fallback handles continuous speech (separate loop)
        4. All require MIN_CHUNK_LENGTH characters accumulated
        """
        logger.info(f"Starting hybrid detector (sentence+{SENTENCE_SILENCE_MS}ms, long silence {LONG_SILENCE_MS}ms, min {MIN_CHUNK_LENGTH} chars)")
        
        check_interval = 0.1  # Check every 100ms for responsiveness
        
        while self.is_running:
            try:
                await asyncio.sleep(check_interval)
                
                if not self.is_running:
                    break
                
                if self.silence_emitted:
                    continue
                
                # Get the new text since last emission
                current_text = self.current_interim_text.strip()
                new_text = self._compute_new_text(current_text) if current_text else ""
                
                # Check minimum length requirement
                if len(new_text) < MIN_CHUNK_LENGTH:
                    continue
                
                silence_duration_ms = (time.time() - self.last_text_update_time) * 1000
                
                # Check for sentence boundary with short silence
                ends_with_sentence = any(new_text.rstrip().endswith(c) for c in SENTENCE_ENDINGS)
                
                if ends_with_sentence and silence_duration_ms >= SENTENCE_SILENCE_MS:
                    # Sentence completed - emit immediately
                    logger.info(f"📝 Sentence boundary detected ({silence_duration_ms:.0f}ms silence)")
                    await self.emit_chunk(trigger="sentence")
                    self.silence_emitted = True
                    
                elif silence_duration_ms >= LONG_SILENCE_MS:
                    # Long pause without sentence ending - still emit
                    logger.info(f"🔇 Long silence detected ({silence_duration_ms:.0f}ms)")
                    await self.emit_chunk(trigger="silence")
                    self.silence_emitted = True
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Hybrid detector error: {e}")
        
        logger.info("Hybrid detector stopped")
    
    async def restart_stream(self):
        """Restart the stream and reset context."""
        self.stream_generation += 1
        logger.info(f"Session {self.session_id}: Restarting stream (gen {self.stream_generation})")
        
        # Emit any remaining content before restart
        await self.emit_chunk(force=True, trigger="restart")
        
        # Reset state for new utterance
        self.current_interim_text = ""
        self.last_emitted_text = ""
        self.context_text = ""  # Reset character-based context
        self.chunk_sequence = 0
        self.silence_emitted = False  # Reset silence state
        self.last_text_update_time = time.time()
        
        await self.audio_queue.put(("restart", None, self.stream_generation - 1))
    
    async def stop(self):
        """Stop the session."""
        self.is_running = False
        
        # Cancel timer
        if self.chunk_timer_task and not self.chunk_timer_task.done():
            self.chunk_timer_task.cancel()
        
        # Cancel silence detector
        if self.silence_detector_task and not self.silence_detector_task.done():
            self.silence_detector_task.cancel()
        
        # Emit final chunk
        await self.emit_chunk(force=True, trigger="final")
        
        await self.audio_queue.put(("stop", None, self.stream_generation))

    async def request_generator(self, generation: int):
        """Generator that yields StreamingRecognizeRequests."""
        current_language = self.language_code
        if not current_language or current_language == "auto":
            current_language = "en-US"

        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=self.sample_rate,
            language_code=current_language,
            enable_automatic_punctuation=False,
        )
        
        streaming_config = speech.StreamingRecognitionConfig(
            config=config,
            interim_results=True,
            single_utterance=False
        )
        
        yield speech.StreamingRecognizeRequest(streaming_config=streaming_config)
        
        while True:
            item = await self.audio_queue.get()
            msg_type, data, msg_generation = item
            
            if msg_type == "stop":
                return
            
            if msg_type == "restart":
                if msg_generation == generation:
                    return
                await self.audio_queue.put(item)
                continue
            
            if msg_type == "audio" and msg_generation == generation:
                yield speech.StreamingRecognizeRequest(audio_content=data)


async def continuous_transcribe_stream(session: ContinuousTranscriptionSession, websocket: WebSocketServerProtocol, generation: int):
    """Continuous transcription that updates session state with interim results."""
    global speech_client
    
    if not speech_client:
        logger.error("Speech client not initialized")
        return

    try:
        logger.info(f"Starting continuous stream gen {generation}")
        
        requests = session.request_generator(generation)
        responses = await speech_client.streaming_recognize(requests=requests)
        
        async for response in responses:
            if generation != session.stream_generation:
                logger.info(f"Stream gen {generation} superseded")
                return
            
            if not response.results:
                continue

            result = response.results[0]
            if not result.alternatives:
                continue

            alternative = result.alternatives[0]
            transcript = alternative.transcript
            is_final = result.is_final

            if transcript:
                # Update session's interim text (chunk timer will emit it)
                session.update_interim_text(transcript)
                
                # Also send real-time updates to client for display
                await websocket.send(json.dumps({
                    "type": "transcription",
                    "text": transcript,
                    "session_id": session.session_id,
                    "final": is_final,
                    "generation": generation
                }))
                
                # If Google marks it as final, we could force emit,
                # but we let the timer handle it for consistency
                if is_final:
                    await session.emit_chunk(force=True, trigger="google_final")
                    # Reset for next utterance
                    session.current_interim_text = ""
        
        logger.info(f"Stream gen {generation} ended normally")

    except asyncio.CancelledError:
        logger.info(f"Stream gen {generation} cancelled")
        raise
    except Exception as e:
        if generation != session.stream_generation:
            logger.info(f"Stream gen {generation} error (superseded)")
            return
        logger.error(f"Stream error: {e}")


async def handle_continuous_client(websocket: WebSocketServerProtocol):
    """Handle a WebSocket client with continuous transcription."""
    session_id = str(id(websocket))
    session = ContinuousTranscriptionSession(session_id)
    session.websocket = websocket
    
    logger.info(f"New continuous client: {session_id}")
    
    active_tasks = []
    stream_started = False
    
    try:
        async for message in websocket:
            try:
                if isinstance(message, bytes):
                    await session.add_audio(message)
                    
                elif isinstance(message, str):
                    data = json.loads(message)
                    command = data.get("command")
                    
                    if command == "start":
                        logger.info(f"Session {session_id}: Starting continuous mode")
                        await websocket.send(json.dumps({
                            "type": "status",
                            "status": "started",
                            "mode": "continuous",
                            "chunkInterval": CHUNK_INTERVAL_SECONDS,
                            "contextWindow": CONTEXT_WINDOW_SECONDS
                        }))
                        
                    elif command == "stop":
                        logger.info(f"Session {session_id}: Stopping")
                        await session.stop()
                        await websocket.send(json.dumps({
                            "type": "status",
                            "status": "stopped"
                        }))
                        
                    elif command == "config":
                        if "language" in data:
                            session.language_code = data["language"]
                        if "roomId" in data:
                            session.room_id = data["roomId"]
                        if "userId" in data:
                            session.user_id = data["userId"]
                        
                        logger.info(f"Config: lang={session.language_code}, room={session.room_id}, user={session.user_id}")
                        
                        if not stream_started:
                            stream_started = True
                            
                            # Start transcription stream
                            transcription_task = asyncio.create_task(
                                continuous_transcribe_stream(session, websocket, session.stream_generation)
                            )
                            active_tasks.append(transcription_task)
                            
                            # Start chunk timer (fallback for continuous speech)
                            session.chunk_timer_task = asyncio.create_task(
                                session.chunk_timer_loop()
                            )
                            active_tasks.append(session.chunk_timer_task)
                            
                            # Start silence detector (for faster emission on pauses)
                            session.silence_detector_task = asyncio.create_task(
                                session.silence_detector_loop()
                            )
                            active_tasks.append(session.silence_detector_task)
                            
                            logger.info(f"Started continuous transcription: {CHUNK_INTERVAL_SECONDS}s timer + {SILENCE_THRESHOLD_MS}ms silence detection")
                    
                    elif command == "finalize_and_restart":
                        # Still support this for explicit breaks
                        text = data.get("text", "")
                        if text and session.room_id:
                            session.update_interim_text(text)
                            await session.emit_chunk(force=True, trigger="finalize")
                        
                        await session.restart_stream()
                        
                        new_task = asyncio.create_task(
                            continuous_transcribe_stream(session, websocket, session.stream_generation)
                        )
                        active_tasks.append(new_task)
                        active_tasks = [t for t in active_tasks if not t.done()]
                        
                        await websocket.send(json.dumps({
                            "type": "stream_restarted",
                            "generation": session.stream_generation
                        }))
                        
            except json.JSONDecodeError:
                logger.error("JSON decode error")
            except Exception as e:
                logger.error(f"Message error: {e}")
                
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Client disconnected: {session_id}")
    except Exception as e:
        logger.error(f"Connection error: {e}")
    finally:
        await session.stop()
        for task in active_tasks:
            if not task.done():
                task.cancel()
        for task in active_tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        logger.info(f"Session ended: {session_id}")


async def main():
    """Main entry point."""
    global speech_client
    
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8765))
    
    try:
        from google.cloud import speech_v1
        speech_client = speech_v1.SpeechAsyncClient()
        logger.info("Google Speech Async Client initialized.")
    except Exception as e:
        logger.error(f"Failed to initialize Google Speech Client: {e}")
        return

    logger.info("=" * 60)
    logger.info("  HYBRID TRANSCRIPTION SERVER")
    logger.info("  Emission triggers:")
    logger.info(f"    📝 Sentence end + {SENTENCE_SILENCE_MS}ms silence")
    logger.info(f"    🔇 Long silence: {LONG_SILENCE_MS}ms")
    logger.info(f"    ⏱️  Timer fallback: {CHUNK_INTERVAL_SECONDS}s")
    logger.info(f"  Min chunk: {MIN_CHUNK_LENGTH} chars")
    logger.info(f"  Context: ~{CONTEXT_MAX_CHARS} chars")
    logger.info(f"  Server: {host}:{port}")
    logger.info("=" * 60)
    
    async with websockets.serve(
        handle_continuous_client,
        host,
        port,
        ping_interval=30,
        ping_timeout=10,
        max_size=10 * 1024 * 1024
    ):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
