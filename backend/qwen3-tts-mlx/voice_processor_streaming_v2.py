"""
Voice Processor Worker for qwen3-tts with TRUE STREAMING support.

This version uses a queue-based approach to truly stream audio chunks
as they are generated, publishing each chunk immediately to Redis.

Key improvements over standard voice_processor.py:
1. Uses stream=True in model.generate() 
2. Uses a producer/consumer pattern to publish chunks in real-time
3. First audio reaches the listener 500-1500ms earlier than batch mode
"""

import asyncio
import base64
import io
import json
import logging
import os
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from queue import Queue, Empty
from typing import Optional

import numpy as np
import soundfile as sf

from redis_client import get_redis_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Model configuration
MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"

# Streaming configuration
# At 12.5 Hz token rate:
# - 0.3 = ~4 tokens = ~0.3s audio (aggressive, lowest latency)
# - 0.5 = ~6 tokens = ~0.5s audio (low latency)
# - 1.0 = ~12 tokens = ~1s audio (balanced)
# IMPORTANT: Lower = more chunks, lower first-chunk latency
STREAMING_INTERVAL = 0.3  # 300ms chunks for minimal latency

# Thread pool - single worker for GPU
executor = ThreadPoolExecutor(max_workers=1)

# Global model
_model = None
_model_type = None

# Active generations for cancellation
active_generations = {}

# Main TTS request queue
tts_request_queue = None


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
    except Exception as e:
        logger.warning(f"Voice mapping lookup failed: {e}")
    return None


def get_voice_sample(room_id: str, user_id: str, target_user_id: str = None):
    """Get voice sample for cloning."""
    import redis
    
    actual_voice_id = get_voice_mapping(room_id, target_user_id) if target_user_id else None
    voice_user_id = actual_voice_id or target_user_id or user_id
    
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
                logger.info(f"✓ Voice sample: {key}")
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
            return wav_data, transcript, sr
    
    return None


def audio_to_base64(audio: np.ndarray, sample_rate: int) -> str:
    """Convert audio to base64 WAV."""
    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format='WAV')
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode('utf-8')


def streaming_tts_producer(
    text: str,
    room_id: str,
    user_id: str,
    target_user_id: str,
    base_hash: str,
    chunk_queue: Queue,
):
    """
    Producer thread: generates TTS audio in streaming mode and puts chunks into queue.
    This runs in the thread pool and yields chunks as they're generated.
    """
    import mlx.core as mx
    
    try:
        model, _ = load_model()
        
        voice_sample = get_voice_sample(room_id, user_id, user_id)
        
        ref_audio_mx = None
        ref_text = None
        sr = 24000
        
        if voice_sample:
            wav_data, ref_text, sr = voice_sample
            ref_audio, _ = sf.read(io.BytesIO(wav_data))
            ref_audio_mx = mx.array(ref_audio)
            logger.info(f"🎤 Streaming TTS with voice cloning")
        else:
            logger.info(f"🔊 Streaming TTS with default voice")
        
        chunk_index = 0
        start_time = time.time()
        
        # Generate with streaming enabled
        for result in model.generate(
            text=text,
            ref_audio=ref_audio_mx,
            ref_text=ref_text or text if ref_audio_mx is not None else None,
            stream=True,
            streaming_interval=STREAMING_INTERVAL,
        ):
            # Check cancellation
            if base_hash and active_generations.get(base_hash, {}).get('cancelled'):
                logger.info(f"⛔ Cancelled mid-stream: {base_hash}")
                chunk_queue.put(('CANCELLED', None, None))
                return
            
            audio_np = np.array(result.audio)
            is_final = getattr(result, 'is_final_chunk', False)
            
            elapsed = time.time() - start_time
            logger.info(f"  📦 Chunk {chunk_index} ready ({len(audio_np)/sr:.2f}s audio) @ {elapsed:.2f}s")
            
            chunk_queue.put(('CHUNK', audio_np, {
                'chunk_index': chunk_index,
                'sample_rate': sr,
                'is_final': is_final,
                'elapsed_time': elapsed,
            }))
            
            chunk_index += 1
        
        # Signal completion
        total_time = time.time() - start_time
        chunk_queue.put(('DONE', None, {'total_time': total_time, 'total_chunks': chunk_index}))
        
    except Exception as e:
        logger.error(f"TTS producer error: {e}", exc_info=True)
        chunk_queue.put(('ERROR', None, {'error': str(e)}))


async def streaming_tts_consumer(
    chunk_queue: Queue,
    redis_client,
    message: dict,
    session_id: str,
    base_hash: str,
    au_hash: str,
):
    """
    Consumer coroutine: reads chunks from queue and publishes to Redis immediately.
    This provides true streaming - audio is published as it's generated.
    """
    room_id = message.get('roomId')
    user_id = message.get('userId', 'default')
    target_user_id = message.get('targetUserId')
    text = message.get('translatedText') or message.get('text', '')
    
    channel = f"room:{room_id}:voice-chunk"
    total_samples = 0
    chunks_published = 0
    
    first_chunk_time = None
    
    while True:
        try:
            # Non-blocking check with small timeout
            try:
                status, audio, meta = await asyncio.get_event_loop().run_in_executor(
                    None, 
                    lambda: chunk_queue.get(timeout=0.05)
                )
            except Empty:
                # Queue empty, yield to event loop
                await asyncio.sleep(0.01)
                continue
            
            if status == 'CHUNK':
                if first_chunk_time is None:
                    first_chunk_time = meta['elapsed_time']
                    logger.info(f"⚡ First chunk ready in {first_chunk_time:.3f}s!")
                
                sample_rate = meta['sample_rate']
                total_samples += len(audio)
                
                chunk_message = {
                    'type': 'voice_chunk',
                    'hash': au_hash,
                    'sessionId': session_id,
                    'roomId': room_id,
                    'userId': user_id,
                    'targetUserId': target_user_id,
                    'chunkIndex': meta['chunk_index'],
                    'totalChunks': -1,  # Unknown until done
                    'audioBase64': audio_to_base64(audio, sample_rate),
                    'sampleRate': sample_rate,
                    'text': text,
                    'isStreamingChunk': True,
                    'isFinalChunk': meta['is_final'],
                    'firstChunkLatencyMs': int(first_chunk_time * 1000) if first_chunk_time else 0,
                    'timestamp': time.time()
                }
                
                await redis_client.publish(channel, json.dumps(chunk_message))
                chunks_published += 1
                
            elif status == 'DONE':
                total_time = meta['total_time']
                audio_duration = total_samples / 24000
                
                logger.info(f"✅ Stream complete: {chunks_published} chunks, "
                           f"{audio_duration:.2f}s audio in {total_time:.2f}s "
                           f"({audio_duration/total_time:.1f}x realtime)")
                
                if first_chunk_time:
                    logger.info(f"⚡ First-chunk latency: {first_chunk_time*1000:.0f}ms")
                
                break
                
            elif status == 'CANCELLED':
                logger.info(f"Stream cancelled after {chunks_published} chunks")
                break
                
            elif status == 'ERROR':
                error = meta.get('error', 'Unknown error')
                logger.error(f"Stream error: {error}")
                
                await redis_client.publish(channel, json.dumps({
                    'type': 'voice_error',
                    'sessionId': session_id,
                    'roomId': room_id,
                    'error': error,
                    'timestamp': time.time()
                }))
                break
                
        except Exception as e:
            logger.error(f"Consumer error: {e}", exc_info=True)
            break
    
    # Cleanup
    if base_hash and base_hash in active_generations:
        del active_generations[base_hash]


async def process_translation_streaming(message: dict, redis_client):
    """
    Process translation with TRUE streaming TTS.
    Uses producer/consumer pattern for real-time chunk publishing.
    """
    room_id = message.get('roomId')
    user_id = message.get('userId', 'default')
    target_user_id = message.get('targetUserId')
    text = message.get('translatedText') or message.get('text', '')
    ml_hash = message.get('hash')
    
    if not text or not room_id:
        return
    
    base_hash = ml_hash.replace('_ml', '') if ml_hash else None
    au_hash = f"{base_hash}_au" if base_hash else None
    session_id = str(uuid.uuid4())
    
    logger.info(f"🔄 Starting streaming TTS: '{text[:50]}...'")
    
    # Track generation
    if base_hash:
        active_generations[base_hash] = {
            'session_id': session_id,
            'cancelled': False,
            'room_id': room_id
        }
    
    # Create queue for producer/consumer communication
    chunk_queue = Queue()
    
    # Start producer in thread pool
    loop = asyncio.get_event_loop()
    producer_future = loop.run_in_executor(
        executor,
        streaming_tts_producer,
        text, room_id, user_id, target_user_id, base_hash, chunk_queue
    )
    
    # Run consumer (publishes chunks as they arrive)
    await streaming_tts_consumer(
        chunk_queue, redis_client, message, session_id, base_hash, au_hash
    )
    
    # Wait for producer to finish
    await producer_future


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


async def process_tts_queue(redis_client):
    """Process TTS requests from queue."""
    global tts_request_queue
    
    logger.info("🚀 Streaming TTS queue processor started")
    
    while True:
        try:
            data = await tts_request_queue.get()
            
            ml_hash = data.get('hash')
            base_hash = ml_hash.replace('_ml', '') if ml_hash else None
            
            if base_hash and active_generations.get(base_hash, {}).get('cancelled'):
                logger.info(f"Skipping pre-cancelled: {base_hash}")
                tts_request_queue.task_done()
                continue
            
            await process_translation_streaming(data, redis_client)
            tts_request_queue.task_done()
            
        except Exception as e:
            logger.error(f"Queue error: {e}", exc_info=True)
            await asyncio.sleep(1)


async def translation_subscriber():
    """Subscribe to translation channel."""
    global tts_request_queue
    
    redis_client = get_redis_client()
    tts_request_queue = asyncio.Queue()
    
    asyncio.create_task(process_tts_queue(redis_client))
    
    while True:
        try:
            pubsub = await redis_client.psubscribe('room:*:translation')
            logger.info("📡 Subscribed to room:*:translation (STREAMING MODE)")
            
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
                            await tts_request_queue.put(data)
                            
                    except json.JSONDecodeError:
                        pass
        
        except Exception as e:
            logger.error(f"Subscriber error: {e}")
            await asyncio.sleep(5)


async def main():
    """Main entry point."""
    logger.info("=" * 50)
    logger.info("  STREAMING Voice Processor v2.0")
    logger.info(f"  Chunk interval: {STREAMING_INTERVAL}s")
    logger.info("=" * 50)
    
    logger.info("Loading TTS model...")
    try:
        await asyncio.get_event_loop().run_in_executor(executor, load_model)
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        sys.exit(1)
    
    await translation_subscriber()


if __name__ == '__main__':
    asyncio.run(main())
