#!/usr/bin/env python3
"""
WebSocket server for real-time speech transcription using Google Cloud Speech-to-Text.
Receives audio chunks from the frontend and streams them to Google's API.
"""

import asyncio
import json
import logging
import os
import websockets
import time
import uuid
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
    # Fallback: Check for the specific credential file in the same directory
    current_dir = os.path.dirname(os.path.abspath(__file__))
    credential_path = os.path.join(current_dir, "credential-videoapp.json")
    
    if os.path.exists(credential_path):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credential_path
        logger.info(f"Found and loaded credentials from: {credential_path}")
    else:
        logger.warning("GOOGLE_APPLICATION_CREDENTIALS environment variable not set.")
        logger.warning(f"Could not find credential file at: {credential_path}")
        logger.warning("This server requires Google Cloud credentials to function.")

# Global client (initialized in main)
speech_client = None

class TranscriptionSession:
    """Manages a single transcription session."""

    def __init__(self, session_id: str, room_id: str | None = None, user_id: str | None = None):
        self.session_id = session_id
        self.room_id = room_id
        self.user_id = user_id
        self.audio_queue = asyncio.Queue()
        self.language_code = "en-US"  # Default language (BCP-47 format)
        self.sample_rate = 16000
        self.is_running = True
        # Stream management
        self.stream_generation = 0  # Incremented on each stream restart
        self.last_published_text = None
        
    async def add_audio(self, audio_data: bytes):
        """Add audio chunk to the processing queue."""
        if self.is_running:
            await self.audio_queue.put(("audio", audio_data, self.stream_generation))
    
    async def restart_stream(self):
        """Signal a stream restart - closes current stream and starts a new one."""
        self.stream_generation += 1
        logger.info(f"Session {self.session_id}: Restarting stream (generation {self.stream_generation})")
        # Send end-of-stream marker for current generation
        await self.audio_queue.put(("restart", None, self.stream_generation - 1))
    
    async def stop(self):
        """Stop the session."""
        self.is_running = False
        await self.audio_queue.put(("stop", None, self.stream_generation))  # Sentinel to end generator

    async def request_generator(self, generation: int):
        """Generator that yields StreamingRecognizeRequests for a specific stream generation."""
        
        # Handle "auto" or empty language by defaulting to en-US
        current_language = self.language_code
        if not current_language or current_language == "auto":
            current_language = "en-US"
            logger.info(f"Language 'auto' received; defaulting to {current_language} for Google Speech API")

        # First request must be the configuration
        # Note: To prevent auto-switching languages, we:
        # 1. Don't use alternative_language_codes
        # 2. Use latest_long model which respects language boundaries better
        # 3. Set model to 'command_and_search' for better single-language accuracy
        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=self.sample_rate,
            language_code=current_language,
            enable_automatic_punctuation=False,  # Faster response without punctuation
            # model='latest_long',  # Better for continuous speech, respects language selection
            # use_enhanced=True  # Use enhanced model for better accuracy
        )
        
        streaming_config = speech.StreamingRecognitionConfig(
            config=config,
            interim_results=True,
            single_utterance=False  # We handle utterance boundaries ourselves
        )
        
        yield speech.StreamingRecognizeRequest(streaming_config=streaming_config)
        
        # Subsequent requests are audio
        while True:
            item = await self.audio_queue.get()
            msg_type, data, msg_generation = item
            
            if msg_type == "stop":
                return
            
            if msg_type == "restart":
                # End this generator if this is our generation being restarted
                if msg_generation == generation:
                    return
                # Otherwise, put it back for the next generation to handle
                await self.audio_queue.put(item)
                continue
            
            if msg_type == "audio":
                # Only process audio for current generation
                if msg_generation == generation:
                    yield speech.StreamingRecognizeRequest(audio_content=data)


async def transcribe_stream(session: TranscriptionSession, websocket: WebSocketServerProtocol, generation: int):
    """Consumes audio from the session queue and sends to Google for a specific stream generation."""
    global speech_client
    if not speech_client:
        logger.error("Speech client not initialized")
        return

    try:
        logger.info(f"Starting transcription stream generation {generation} for session {session.session_id}")
        
        # We use the async client's streaming_recognize method
        requests = session.request_generator(generation)
        responses = await speech_client.streaming_recognize(requests=requests)
        
        # Track time to measure relative latency/lag
        last_result_time = time.time()

        async for response in responses:
            # Check if this generation is still current
            if generation != session.stream_generation:
                logger.info(f"Stream generation {generation} superseded, stopping")
                return
            
            now = time.time()
            processing_time = now - last_result_time
            last_result_time = now
            
            if not response.results:
                continue

            result = response.results[0]
            if not result.alternatives:
                continue

            alternative = result.alternatives[0]
            transcript = alternative.transcript
            is_final = result.is_final

            # Send back to client
            if transcript:
                response_data = {
                    "type": "transcription",
                    "text": transcript,
                    "session_id": session.session_id,
                    "final": is_final,
                    "generation": generation,
                    "processing_time": round(processing_time, 3)
                }
                
                if hasattr(alternative, 'confidence'):
                     response_data["confidence"] = alternative.confidence

                await websocket.send(json.dumps(response_data))
        
        logger.info(f"Stream generation {generation} ended normally")

    except asyncio.CancelledError:
        logger.info(f"Stream generation {generation} cancelled")
        raise
    except Exception as e:
        # Ignore errors from superseded generations
        if generation != session.stream_generation:
            logger.info(f"Stream generation {generation} error (superseded): {e}")
            return
        logger.error(f"Error in transcription stream gen {generation} for {session.session_id}: {e}")
        try:
           await websocket.send(json.dumps({
               "type": "error", 
               "message": f"Google Speech API Error: {str(e)}"
           }))
        except:
           pass

async def handle_client(websocket: WebSocketServerProtocol):
    """Handle a WebSocket client connection."""
    session_id = str(id(websocket))
    room_id = None
    user_id = None
    
    # Create session immediately (room_id can be set later via config command)
    session = TranscriptionSession(session_id, room_id, user_id)
    
    logger.info(f"New client connected: {session_id}")
    
    # Track transcription tasks - will be started after config is received
    active_tasks = []
    stream_started = False
    
    try:
        async for message in websocket:
            try:
                if isinstance(message, bytes):
                    # Binary message: audio data
                    await session.add_audio(message)
                            
                elif isinstance(message, str):
                    # Text message: control commands
                    data = json.loads(message)
                    command = data.get("command")
                    
                    if command == "start":
                        logger.info(f"Session {session_id}: Starting...")
                        await websocket.send(json.dumps({
                            "type": "status",
                            "status": "started",
                            "backend": "google-cloud-speech"
                        }))
                        
                    elif command == "stop":
                        logger.info(f"Session {session_id}: Stopping...")
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
                        logger.info(f"Configs updated: lang={session.language_code}, room={session.room_id}, user={session.user_id}")
                        
                        # Start transcription stream now that we have the language config
                        if not stream_started:
                            stream_started = True
                            transcription_task = asyncio.create_task(
                                transcribe_stream(session, websocket, session.stream_generation)
                            )
                            active_tasks.append(transcription_task)
                            logger.info(f"Started transcription stream with language: {session.language_code}")
                        
                    elif command == "finalize_and_restart":
                        # Client detected silence - finalize current text and restart stream
                        text = data.get("text", "")
                        if text and session.room_id:
                            logger.info(f"Silence-based finalization: {text[:50]}...")
                            
                            # Publish to Redis immediately
                            redis_client = get_redis_client()
                            new_hash = str(uuid.uuid4())
                            
                            redis_message = {
                                "type": "transcription",
                                "hash": f"{new_hash}_tc",
                                "roomId": session.room_id,
                                "userId": session.user_id or session.session_id,
                                "sessionId": session.session_id,
                                "text": text,
                                "language": session.language_code,
                                "isFinal": True,
                                "finalizedBySilence": True,
                                "timestamp": int(time.time() * 1000)
                            }
                            channel = f"room:{session.room_id}:transcription"
                            try:
                                result = await redis_client.publish(channel, json.dumps(redis_message))
                                logger.info(f"Published to '{channel}' (subscribers: {result}) - Hash: {new_hash}_tc")
                            except Exception as e:
                                logger.error(f"Failed to publish to Redis: {e}")
                            
                            # Acknowledge to frontend
                            await websocket.send(json.dumps({
                                "type": "finalized",
                                "text": text,
                                "hash": f"{new_hash}_tc"
                            }))
                        
                        # Restart the stream for next utterance
                        await session.restart_stream()
                        
                        # Start new transcription task for new generation
                        new_task = asyncio.create_task(
                            transcribe_stream(session, websocket, session.stream_generation)
                        )
                        active_tasks.append(new_task)
                        
                        # Clean up completed tasks
                        active_tasks = [t for t in active_tasks if not t.done()]
                        
                        await websocket.send(json.dumps({
                            "type": "stream_restarted",
                            "generation": session.stream_generation
                        }))
                        
                    elif command == "finalize":
                        # Legacy finalize command (without restart)
                        text = data.get("text", "")
                        if text and session.room_id:
                            logger.info(f"Finalizing interim text: {text[:50]}...")
                            
                            redis_client = get_redis_client()
                            new_hash = str(uuid.uuid4())
                            
                            redis_message = {
                                "type": "transcription",
                                "hash": f"{new_hash}_tc",
                                "roomId": session.room_id,
                                "userId": session.user_id or session.session_id,
                                "sessionId": session.session_id,
                                "text": text,
                                "language": session.language_code,
                                "isFinal": True,
                                "finalizedBySilence": True,
                                "timestamp": int(time.time() * 1000)
                            }
                            channel = f"room:{session.room_id}:transcription"
                            try:
                                result = await redis_client.publish(channel, json.dumps(redis_message))
                                logger.info(f"Published to '{channel}' (subscribers: {result})")
                                await websocket.send(json.dumps({
                                    "type": "finalized",
                                    "text": text,
                                    "hash": f"{new_hash}_tc"
                                }))
                            except Exception as e:
                                logger.error(f"Failed to publish to Redis: {e}")
                        
            except json.JSONDecodeError:
                logger.error("JSON decode error")
            except Exception as e:
                logger.error(f"Error handling message: {e}")
                
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Client disconnected: {session_id}")
    except Exception as e:
        logger.error(f"Connection error: {e}")
    finally:
        await session.stop()
        # Cancel all active transcription tasks
        for task in active_tasks:
            if not task.done():
                task.cancel()
        for task in active_tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.error(f"Transcription task error on cleanup: {e}")
            
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
        logger.error("Make sure google-cloud-speech is installed and credentials are set.")
        return

    logger.info(f"Starting Google Speech WebSocket server on {host}:{port}")
    
    async with websockets.serve(
        handle_client,
        host,
        port,
        ping_interval=30,
        ping_timeout=10,
        max_size=10 * 1024 * 1024
    ):
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())
