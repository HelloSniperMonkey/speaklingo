"""
Voice Processor Worker for qwen3-tts.
Subscribes to Redis translation channel, generates voice using TTS,
and publishes audio chunks to voice-chunk channel.
"""

import asyncio
import base64
import io
import json
import logging
import os
import sys
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import soundfile as sf

from redis_client import get_redis_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Model configuration
MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit"
FALLBACK_MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit"
DEFAULT_VOICE = "Chelsie"

# Audio chunk size in seconds (500ms for low latency)
CHUNK_DURATION = 0.5

# Thread pool for blocking TTS operations
executor = ThreadPoolExecutor(max_workers=2)

# Global model instance
_model = None
_model_type = None  # 'mlx' or 'qwen'

# Track active audio generation sessions for cancellation
active_generations = {}  # hash -> {'session_id': str, 'cancelled': bool, 'room_id': str}


def load_model():
    """Load the TTS model (lazy initialization)."""
    global _model, _model_type
    
    if _model is not None:
        return _model, _model_type
    
    # Load MLX TTS model
    try:
        from mlx_audio.tts.utils import load_model as mlx_load_model
        logger.info(f"Loading MLX TTS model: {MODEL_ID}")
        _model = mlx_load_model(MODEL_ID)
        _model_type = 'mlx'
        logger.info("MLX TTS model loaded successfully")
        return _model, _model_type
    except Exception as e:
        logger.error(f"Failed to load MLX TTS model: {e}")
        raise RuntimeError(f"Could not load TTS model: {e}")


def get_voice_sample_from_redis(room_id: str, user_id: str = 'default') -> tuple[bytes, str, int] | None:
    """Fetch voice sample from Redis or local file (sync version for thread pool).
    Returns (wav_data, transcript, sample_rate) or None."""
    import redis
    
    # Try user-based key first, then room-based, then global 'intro_user' fallback
    keys_to_try = [
        f"voice_sample:{user_id}",
        f"voice_sample:{room_id}:{user_id}",
        f"voice_sample:intro_user",  # Global fallback for intro voice sample
    ]
    
    try:
        client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        for key in keys_to_try:
            data = client.get(key)
            if data:
                sample = json.loads(data)
                wav_data = base64.b64decode(sample['wav_base64'])
                transcript = sample.get('transcript', '')
                # Extract sample rate from WAV data
                audio, sr = sf.read(io.BytesIO(wav_data))
                logger.info(f"✓ Found voice sample in Redis: {key} (sr={sr})")
                return wav_data, transcript, sr
    except Exception as e:
        logger.warning(f"Redis lookup failed: {e}")
    
    # Fallback to local files - try user_id first, then intro_user
    users_to_try = [user_id]
    if user_id != 'intro_user':
        users_to_try.append('intro_user')
    
    try:
        data_dir = os.path.join(os.path.dirname(__file__), 'data')
        for uid in users_to_try:
            wav_file = os.path.join(data_dir, f"{uid}.wav")
            meta_file = os.path.join(data_dir, f"{uid}.json")
            
            if os.path.exists(wav_file):
                with open(wav_file, 'rb') as f:
                    wav_data = f.read()
                
                # Extract sample rate from WAV file
                audio, sr = sf.read(wav_file)
                
                transcript = ''
                if os.path.exists(meta_file):
                    with open(meta_file, 'r') as f:
                        meta = json.load(f)
                        transcript = meta.get('transcript', '')
                
                logger.info(f"✓ Found voice sample in local file: {wav_file} (sr={sr})")
                return wav_data, transcript, sr
    except Exception as e:
        logger.warning(f"Local file lookup failed: {e}")
    
    logger.warning(f"✗ No voice sample found for user={user_id}, room={room_id}")
    return None


def generate_audio_with_voice_clone(text: str, room_id: str, user_id: str = 'default') -> tuple[np.ndarray, int]:
    """
    Generate audio using TTS with voice cloning if sample available.
    Returns (audio_array, sample_rate).
    """
    import mlx.core as mx
    
    model, model_type = load_model()
    
    # Try to get voice sample for cloning
    voice_sample = get_voice_sample_from_redis(room_id, user_id)
    
    if voice_sample:
        wav_data, ref_text, ref_sample_rate = voice_sample
        
        # Load reference audio and preserve its sample rate
        ref_audio, sr = sf.read(io.BytesIO(wav_data))
        ref_audio_mx = mx.array(ref_audio)
        
        logger.info(f"🎤 Using voice cloning with reference audio (sr={sr})")
        
        # Generate with MLX model
        results = list(model.generate(
            text=text,
            ref_audio=ref_audio_mx,
            ref_text=ref_text or text,
        ))
        
        audio_mx = results[0].audio
        # Use the reference audio's sample rate to avoid distortion
        output_sr = sr
        
        # Convert MLX array to numpy
        audio_np = np.array(audio_mx)
        
        return audio_np, output_sr
    else:
        # Use default generation without voice cloning
        logger.info(f"🔊 Using default voice generation")
        results = list(model.generate(text=text))
        audio_mx = results[0].audio
        sr = results[0].sample_rate
        
        # Convert MLX array to numpy
        audio_np = np.array(audio_mx)
        
        return audio_np, sr


def chunk_audio(audio: np.ndarray, sample_rate: int, chunk_duration: float = CHUNK_DURATION) -> list[np.ndarray]:
    """Split audio into chunks of specified duration."""
    chunk_samples = int(sample_rate * chunk_duration)
    chunks = []
    
    for i in range(0, len(audio), chunk_samples):
        chunk = audio[i:i + chunk_samples]
        chunks.append(chunk)
    
    return chunks


def audio_to_base64(audio: np.ndarray, sample_rate: int) -> str:
    """Convert audio array to base64-encoded WAV."""
    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format='WAV')
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode('utf-8')


async def process_translation(message: dict, redis_client):
    """
    Process a translation message and generate voice.
    Publishes audio chunks to Redis.
    """
    room_id = message.get('roomId')
    user_id = message.get('userId', 'default')
    text = message.get('translatedText') or message.get('text', '')
    source_language = message.get('sourceLanguage', 'unknown')
    target_language = message.get('targetLanguage', 'unknown')
    ml_hash = message.get('hash')  # Extract hash (format: {uuid}_ml)
    
    if not text or not room_id:
        logger.warning(f"Invalid message: missing text or roomId")
        return
    
    # Extract base hash and create audio hash
    base_hash = ml_hash.replace('_ml', '') if ml_hash else None
    au_hash = f"{base_hash}_au" if base_hash else None
    
    logger.info(f"Processing voice for room {room_id}, user {user_id}: '{text[:50]}...' (hash: {au_hash})")
    logger.info(f"  Language: {source_language} → {target_language}")
    
    session_id = str(uuid.uuid4())
    generation_start = time.time()
    
    # Track this generation session
    if base_hash:
        active_generations[base_hash] = {
            'session_id': session_id,
            'cancelled': False,
            'room_id': room_id
        }
    
    try:
        # Run TTS in thread pool (blocking operation)
        loop = asyncio.get_event_loop()
        audio, sample_rate = await loop.run_in_executor(
            executor,
            generate_audio_with_voice_clone,
            text, room_id, user_id
        )
        
        # Check if cancelled during generation
        if base_hash and active_generations.get(base_hash, {}).get('cancelled'):
            logger.info(f"Generation cancelled for hash {base_hash}, skipping publish")
            if base_hash in active_generations:
                del active_generations[base_hash]
            return
        
        generation_time = time.time() - generation_start
        audio_duration = len(audio) / sample_rate
        
        logger.info(f"Generated {audio_duration:.2f}s audio in {generation_time:.2f}s "
                   f"({audio_duration/generation_time:.1f}x realtime)")
        
        # Chunk the audio
        chunks = chunk_audio(audio, sample_rate)
        total_chunks = len(chunks)
        
        # Publish each chunk
        channel = f"room:{room_id}:voice-chunk"
        
        for idx, chunk in enumerate(chunks):
            # Check for cancellation before publishing each chunk
            if base_hash and active_generations.get(base_hash, {}).get('cancelled'):
                logger.info(f"Generation cancelled during chunk publish for hash {base_hash}")
                break
            
            chunk_message = {
                'type': 'voice_chunk',
                'hash': au_hash,  # Include audio hash
                'sessionId': session_id,
                'roomId': room_id,
                'userId': user_id,
                'chunkIndex': idx,
                'totalChunks': total_chunks,
                'audioBase64': audio_to_base64(chunk, sample_rate),
                'sampleRate': sample_rate,
                'text': text,
                'generationTimeMs': int(generation_time * 1000),
                'audioDurationMs': int(audio_duration * 1000),
                'timestamp': time.time()
            }
            
            await redis_client.publish(channel, json.dumps(chunk_message))
            
            # Small delay between chunks to simulate streaming
            # (helps with playback synchronization)
            if idx < total_chunks - 1:
                await asyncio.sleep(0.01)
        
        logger.info(f"Published {total_chunks} chunks to {channel}")
        
        # Clean up tracking
        if base_hash and base_hash in active_generations:
            del active_generations[base_hash]
        
    except Exception as e:
        logger.error(f"Voice generation failed: {e}", exc_info=True)
        
        # Clean up tracking on error
        if base_hash and base_hash in active_generations:
            del active_generations[base_hash]
        
        # Publish error message
        error_message = {
            'type': 'voice_error',
            'sessionId': session_id,
            'roomId': room_id,
            'error': str(e),
            'timestamp': time.time()
        }
        await redis_client.publish(f"room:{room_id}:voice-chunk", json.dumps(error_message))


async def process_invalidation(message: dict, redis_client):
    """
    Process an invalidation message and cancel in-flight audio generation.
    """
    base_hash = message.get('hash')
    room_id = message.get('roomId')
    
    if not base_hash:
        return
    
    logger.info(f"Processing invalidation for hash {base_hash}")
    
    # Mark as cancelled if currently generating
    if base_hash in active_generations:
        active_generations[base_hash]['cancelled'] = True
        logger.info(f"Marked in-flight generation for hash {base_hash} as cancelled")
    
    # Publish invalidation to voice-chunk channel so frontend can stop playback
    invalidation_msg = {
        'type': 'invalidation',
        'hash': base_hash,  # Frontend will derive _au suffix
        'roomId': room_id,
        'timestamp': time.time()
    }
    
    channel = f"room:{room_id}:voice-chunk"
    await redis_client.publish(channel, json.dumps(invalidation_msg))
    logger.info(f"Published audio invalidation to {channel}")


async def translation_subscriber():
    """
    Subscribe to translation channel and process messages.
    Receives both translations and invalidations from the same channel.
    """
    redis_client = get_redis_client()
    
    while True:
        try:
            # Only subscribe to translation channel - invalidations come through here too
            pubsub = await redis_client.psubscribe('room:*:translation')
            logger.info("Subscribed to Redis pattern: room:*:translation")
            
            async for message in pubsub.listen():
                if message['type'] == 'pmessage':
                    try:
                        data = json.loads(message['data'])
                        
                        # Extract roomId from channel
                        channel = message['channel']
                        parts = channel.split(':')
                        if len(parts) >= 3:
                            data['roomId'] = parts[1]
                        
                        # Process based on message type
                        msg_type = data.get('type')
                        if msg_type == 'invalidation':
                            asyncio.create_task(process_invalidation(data, redis_client))
                        elif msg_type == 'translation':
                            asyncio.create_task(process_translation(data, redis_client))
                        
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON in message: {message['data']}")
                        
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON in message: {message['data']}")
        
        except Exception as e:
            logger.error(f"Subscriber error: {e}", exc_info=True)
            await asyncio.sleep(5)  # Retry with backoff


async def main():
    """Main entry point."""
    logger.info("Starting Voice Processor Worker...")
    
    # Pre-load model
    logger.info("Pre-loading TTS model...")
    try:
        await asyncio.get_event_loop().run_in_executor(executor, load_model)
        logger.info("Model loaded, starting subscriber...")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        sys.exit(1)
    
    await translation_subscriber()


if __name__ == '__main__':
    asyncio.run(main())
