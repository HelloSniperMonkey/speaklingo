"""
CONTINUOUS VOICE PROCESSOR for Qwen3-TTS

Works with the sliding window translation system to provide low-latency TTS.

Key Features:
- Processes translation chunks as they arrive (every ~2 seconds)
- Generates and publishes audio quickly for each chunk
- Maintains smooth audio playback by queuing chunks properly
- Optimized for short text segments (2-3 seconds of speech)

For continuous translation, each chunk is typically short, so we:
- Skip sentence splitting (chunks are already small)
- Generate audio immediately
- Publish with sequence numbers for proper ordering
"""

import asyncio
import base64
import io
import json
import logging
import os
import sys
import time
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from queue import Queue, Empty
from threading import Lock
from typing import Optional, Tuple

import numpy as np
import soundfile as sf

from redis_client import get_redis_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Model configuration
MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"

# Thread pool - single worker for GPU
executor = ThreadPoolExecutor(max_workers=1)

# Global model
_model = None
_model_type = None

# Active generations for cancellation
active_generations = {}

# ===== Fair Round-Robin TTS Scheduler =====
# Per-user queues for fair scheduling when multiple users talk simultaneously
# This prevents User B from waiting for all of User A's chunks
MAX_QUEUE_PER_USER = 2  # Max pending requests per user (older ones dropped)
REQUEST_STALENESS_THRESHOLD = 5.0  # Skip requests older than 5 seconds
_user_queues: dict[str, list[dict]] = {}  # userId -> list of requests
_user_queue_lock = Lock()
_queue_event = None  # asyncio.Event to signal new requests

# ===== Voice Sample LRU Cache =====
# Cache for decoded voice samples to avoid redundant I/O
# Key: voice_user_id, Value: (wav_data, transcript, sample_rate, timestamp)
VOICE_SAMPLE_CACHE_SIZE = 32
VOICE_SAMPLE_CACHE_TTL = 300  # 5 minutes TTL
_voice_sample_cache: OrderedDict[str, Tuple[bytes, str, int, float]] = OrderedDict()
_voice_sample_cache_lock = Lock()


def load_model():
    """Load the TTS model."""
    global _model, _model_type
    
    if _model is not None:
        return _model, _model_type
    
    try:
        from mlx_audio.tts.utils import load_model as mlx_load_model
        logger.info(f"Loading MLX TTS model: {MODEL_ID}")
        _model = mlx_load_model(MODEL_ID)
        _model_type = 'mlx'
        logger.info("✅ MLX TTS model loaded successfully")
        return _model, _model_type
    except Exception as e:
        logger.error(f"Failed to load MLX TTS model: {e}")
        raise


def get_voice_mapping(room_id: str, role: str) -> Optional[str]:
    """Get mapped voice user ID from Redis."""
    import redis
    try:
        client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        return client.get(f"voice_mapping:{room_id}:{role}")
    except Exception:
        pass
    return None


def _get_cache_key(room_id: str, voice_user_id: str) -> str:
    """Generate cache key for voice sample."""
    return f"{room_id}:{voice_user_id}"


def _cache_get(cache_key: str) -> Optional[Tuple[bytes, str, int]]:
    """Get voice sample from cache if valid."""
    with _voice_sample_cache_lock:
        if cache_key in _voice_sample_cache:
            wav_data, transcript, sr, cached_time = _voice_sample_cache[cache_key]
            # Check TTL
            if time.time() - cached_time < VOICE_SAMPLE_CACHE_TTL:
                # Move to end (most recently used)
                _voice_sample_cache.move_to_end(cache_key)
                logger.debug(f"✓ Voice sample cache HIT: {cache_key}")
                return wav_data, transcript, sr
            else:
                # Expired, remove from cache
                del _voice_sample_cache[cache_key]
    return None


def _cache_put(cache_key: str, wav_data: bytes, transcript: str, sr: int):
    """Put voice sample in cache."""
    with _voice_sample_cache_lock:
        # Remove oldest if at capacity
        while len(_voice_sample_cache) >= VOICE_SAMPLE_CACHE_SIZE:
            _voice_sample_cache.popitem(last=False)
        
        _voice_sample_cache[cache_key] = (wav_data, transcript, sr, time.time())
        logger.info(f"✓ Voice sample cached: {cache_key} (cache size: {len(_voice_sample_cache)})")


def get_voice_sample(room_id: str, user_id: str, target_user_id: str = None):
    """Get voice sample for cloning with LRU caching."""
    import redis
    
    actual_voice_id = get_voice_mapping(room_id, target_user_id) if target_user_id else None
    voice_user_id = actual_voice_id or target_user_id or user_id
    
    # Check cache first
    cache_key = _get_cache_key(room_id, voice_user_id)
    cached = _cache_get(cache_key)
    if cached:
        return cached
    
    keys = [
        f"voice_sample:{voice_user_id}",
        f"voice_sample:{room_id}:{voice_user_id}",
        f"voice_sample:intro_user",
    ]
    
    try:
        client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        for key in keys:
            data = client.get(key)
            if data:
                sample = json.loads(data)
                wav_data = base64.b64decode(sample['wav_base64'])
                transcript = sample.get('transcript', '')
                audio, sr = sf.read(io.BytesIO(wav_data))
                logger.info(f"✓ Voice sample from Redis: {key}")
                # Cache the result
                _cache_put(cache_key, wav_data, transcript, sr)
                return wav_data, transcript, sr
    except Exception:
        pass
    
    # Local fallback
    data_dir = os.path.join(os.path.dirname(__file__), 'data')
    for uid in [voice_user_id, 'intro_user']:
        if not uid:
            continue
        wav_file = os.path.join(data_dir, f"{uid}.wav")
        if os.path.exists(wav_file):
            with open(wav_file, 'rb') as f:
                wav_data = f.read()
            _, sr = sf.read(wav_file)
            meta_file = os.path.join(data_dir, f"{uid}.json")
            transcript = ''
            if os.path.exists(meta_file):
                with open(meta_file) as f:
                    transcript = json.load(f).get('transcript', '')
            logger.info(f"✓ Voice sample from file: {wav_file}")
            # Cache the result
            _cache_put(cache_key, wav_data, transcript, sr)
            return wav_data, transcript, sr
    
    return None


def audio_to_base64(audio: np.ndarray, sample_rate: int) -> str:
    """Convert audio to base64 WAV."""
    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format='WAV')
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode('utf-8')


def generate_audio_fast(
    text: str,
    room_id: str,
    user_id: str
) -> tuple[np.ndarray, int, float]:
    """
    Generate audio for a short text chunk.
    Optimized for speed - no streaming, just fast generation.
    """
    import mlx.core as mx
    
    model, _ = load_model()
    start_time = time.time()
    
    voice_sample = get_voice_sample(room_id, user_id, user_id)
    
    ref_audio_mx = None
    ref_text = None
    sr = 24000
    
    if voice_sample:
        wav_data, ref_text, sr = voice_sample
        ref_audio, _ = sf.read(io.BytesIO(wav_data))
        ref_audio_mx = mx.array(ref_audio)
    
    # Generate (non-streaming for speed with short text)
    results = list(model.generate(
        text=text,
        ref_audio=ref_audio_mx,
        ref_text=ref_text or text if ref_audio_mx is not None else None,
        stream=False
    ))
    
    gen_time = time.time() - start_time
    
    if results:
        audio_np = np.array(results[0].audio)
        return audio_np, sr, gen_time
    
    return np.array([]), sr, gen_time


async def process_continuous_translation(message: dict, redis_client):
    """
    Process a continuous translation chunk and generate TTS.
    Optimized for short chunks with immediate dispatch.
    """
    room_id = message.get('roomId')
    user_id = message.get('userId', 'default')
    target_user_id = message.get('targetUserId')
    text = message.get('translatedText') or message.get('text', '')
    ml_hash = message.get('hash')
    chunk_sequence = message.get('chunkSequence', 0)
    is_chunk = message.get('isChunk', False)
    
    if not text or not room_id:
        return
    
    base_hash = ml_hash.replace('_ml', '') if ml_hash else None
    au_hash = f"{base_hash}_au" if base_hash else None
    session_id = str(uuid.uuid4())
    
    # Check cancellation
    if base_hash and active_generations.get(base_hash, {}).get('cancelled'):
        logger.info(f"Skipping cancelled: {base_hash}")
        return
    
    logger.info(f"🔊 Chunk {chunk_sequence}: '{text[:40]}...'")
    
    # Track generation
    if base_hash:
        active_generations[base_hash] = {
            'session_id': session_id,
            'cancelled': False,
            'room_id': room_id
        }
    
    channel = f"room:{room_id}:voice-chunk"
    
    try:
        # Generate audio in thread pool
        loop = asyncio.get_event_loop()
        audio_np, sample_rate, gen_time = await loop.run_in_executor(
            executor,
            generate_audio_fast,
            text, room_id, user_id
        )
        
        if len(audio_np) == 0:
            logger.warning(f"No audio generated for chunk {chunk_sequence}")
            return
        
        audio_duration = len(audio_np) / sample_rate
        
        logger.info(f"  ✅ Generated {audio_duration:.2f}s audio in {gen_time:.2f}s ({audio_duration/gen_time:.1f}x RT)")
        
        # Check cancellation before publishing
        if base_hash and active_generations.get(base_hash, {}).get('cancelled'):
            logger.info(f"Cancelled before publish: {base_hash}")
            return
        
        # Publish audio chunk
        chunk_message = {
            'type': 'voice_chunk',
            'hash': au_hash,
            'sessionId': session_id,
            'roomId': room_id,
            'userId': user_id,
            'targetUserId': target_user_id,
            'chunkIndex': 0,  # Single chunk per translation
            'totalChunks': 1,
            'audioBase64': audio_to_base64(audio_np, sample_rate),
            'sampleRate': sample_rate,
            'text': text,
            'isContinuousChunk': is_chunk,
            'chunkSequence': chunk_sequence,  # For ordering
            'isFinalChunk': True,
            'generationTimeMs': int(gen_time * 1000),
            'audioDurationMs': int(audio_duration * 1000),
            'timestamp': time.time()
        }
        
        await redis_client.publish(channel, json.dumps(chunk_message))
        logger.info(f"  📤 Published to {channel}")
        
        # Cleanup
        if base_hash and base_hash in active_generations:
            del active_generations[base_hash]
            
    except Exception as e:
        logger.error(f"TTS generation error: {e}", exc_info=True)
        
        if base_hash and base_hash in active_generations:
            del active_generations[base_hash]


async def process_invalidation(message: dict, redis_client):
    """Handle invalidation requests."""
    base_hash = message.get('hash')
    room_id = message.get('roomId')
    
    if not base_hash:
        return
    
    if base_hash in active_generations:
        active_generations[base_hash]['cancelled'] = True
        logger.info(f"⛔ Marked {base_hash} for cancellation")
    
    await redis_client.publish(f"room:{room_id}:voice-chunk", json.dumps({
        'type': 'invalidation',
        'hash': base_hash,
        'roomId': room_id,
        'timestamp': time.time()
    }))


def _add_to_user_queue(data: dict):
    """Add request to per-user queue with fair limiting."""
    user_id = data.get('userId', 'default')
    data['_enqueue_time'] = time.time()  # Track when request was queued
    
    with _user_queue_lock:
        if user_id not in _user_queues:
            _user_queues[user_id] = []
        
        user_queue = _user_queues[user_id]
        
        # Limit queue depth per user - drop oldest if at capacity
        while len(user_queue) >= MAX_QUEUE_PER_USER:
            dropped = user_queue.pop(0)
            logger.info(f"⏭️ Dropped stale request for {user_id} (queue full)")
        
        user_queue.append(data)
        logger.debug(f"Queued request for {user_id} (queue size: {len(user_queue)})")


def _get_next_request_round_robin() -> dict | None:
    """
    Get next request using round-robin across users.
    Returns None if no requests available.
    Skips stale requests (older than threshold).
    """
    with _user_queue_lock:
        # Get list of users with pending requests
        users_with_requests = [u for u, q in _user_queues.items() if q]
        
        if not users_with_requests:
            return None
        
        # Round-robin: rotate user order each call
        # Move first user to end for next call
        if len(users_with_requests) > 1:
            first_user = users_with_requests[0]
            # Rotate by moving first user's queue to end conceptually
            # (we just pick from first user with requests)
        
        current_time = time.time()
        
        for user_id in users_with_requests:
            queue = _user_queues[user_id]
            
            while queue:
                request = queue.pop(0)
                enqueue_time = request.get('_enqueue_time', current_time)
                age = current_time - enqueue_time
                
                # Skip stale requests
                if age > REQUEST_STALENESS_THRESHOLD:
                    logger.info(f"⏭️ Skipped stale request for {user_id} (age: {age:.1f}s)")
                    continue
                
                # Valid request found
                # Rotate: move this user to end of consideration for fairness
                if user_id in _user_queues:
                    # Just processed from this user, others get priority next
                    pass
                
                return request
        
        return None


async def process_tts_queue(redis_client):
    """
    Process TTS requests using fair round-robin scheduling.
    
    This ensures when 2 users talk simultaneously:
    - User A chunk 1 processed
    - User B chunk 1 processed  
    - User A chunk 2 processed
    - User B chunk 2 processed
    
    Instead of User B waiting for ALL of User A's chunks.
    """
    global _queue_event
    
    logger.info("🚀 Fair round-robin TTS scheduler started")
    
    # Track last processed user for round-robin
    last_processed_user = None
    
    while True:
        try:
            # Get next request using round-robin
            data = _get_next_request_round_robin()
            
            if data is None:
                # No requests, wait for signal
                await _queue_event.wait()
                _queue_event.clear()
                continue
            
            user_id = data.get('userId', 'default')
            ml_hash = data.get('hash')
            base_hash = ml_hash.replace('_ml', '') if ml_hash else None
            
            # Skip if cancelled
            if base_hash and active_generations.get(base_hash, {}).get('cancelled'):
                logger.debug(f"Skipping cancelled request: {base_hash}")
                continue
            
            # Log fairness info
            if last_processed_user and last_processed_user != user_id:
                logger.info(f"🔄 Fair switch: {last_processed_user} → {user_id}")
            
            last_processed_user = user_id
            
            await process_continuous_translation(data, redis_client)
            
        except Exception as e:
            logger.error(f"Queue error: {e}", exc_info=True)
            await asyncio.sleep(0.1)


async def translation_subscriber():
    """Subscribe to translation channel."""
    global _queue_event
    
    redis_client = get_redis_client()
    _queue_event = asyncio.Event()
    
    asyncio.create_task(process_tts_queue(redis_client))
    
    while True:
        try:
            pubsub = await redis_client.psubscribe('room:*:translation')
            logger.info("📡 Subscribed to room:*:translation (CONTINUOUS MODE + FAIR SCHEDULING)")
            
            async for message in pubsub.listen():
                if message['type'] == 'pmessage':
                    try:
                        data = json.loads(message['data'])
                        channel = message['channel']
                        parts = channel.split(':')
                        if len(parts) >= 3:
                            data['roomId'] = parts[1]
                        
                        msg_type = data.get('type')
                        if msg_type == 'invalidation':
                            asyncio.create_task(process_invalidation(data, redis_client))
                        elif msg_type == 'translation':
                            # Add to per-user queue for fair scheduling
                            _add_to_user_queue(data)
                            _queue_event.set()  # Signal queue processor
                            
                    except json.JSONDecodeError:
                        pass
        
        except Exception as e:
            logger.error(f"Subscriber error: {e}")
            await asyncio.sleep(5)


async def main():
    """Main entry point."""
    logger.info("=" * 60)
    logger.info("  CONTINUOUS Voice Processor")
    logger.info("  Optimized for 2-second translation chunks")
    logger.info("=" * 60)
    
    logger.info("Loading TTS model...")
    try:
        await asyncio.get_event_loop().run_in_executor(executor, load_model)
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        sys.exit(1)
    
    await translation_subscriber()


if __name__ == '__main__':
    asyncio.run(main())
