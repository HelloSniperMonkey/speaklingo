"""
Voice Processor with SENTENCE-LEVEL CHUNKING for lower latency.

Since MLX Qwen3-TTS doesn't support true streaming, we chunk the INPUT TEXT
into sentences and generate each independently. This allows us to:
1. Start playing the first sentence while generating the second
2. Achieve much lower perceived latency
3. Handle interruptions more gracefully

Example:
  Input: "Hello there. How are you doing today? I hope you're well."
  Chunks: ["Hello there.", "How are you doing today?", "I hope you're well."]
  Each chunk is generated and published independently.
"""

import asyncio
import base64
import io
import json
import logging
import os
import re
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from queue import Queue, Empty
from typing import Optional, List

import numpy as np
import soundfile as sf

from redis_client import get_redis_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Model configuration
MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"

# Sentence splitting patterns
# Match sentence boundaries: . ! ? and also ; : for longer pauses
SENTENCE_PATTERN = re.compile(r'(?<=[.!?;:])\s+')

# Minimum characters for a chunk (merge very short sentences)
MIN_CHUNK_LENGTH = 15

# Maximum characters per chunk (split very long sentences)
MAX_CHUNK_LENGTH = 100

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


def split_into_sentences(text: str) -> List[str]:
    """
    Split text into sentence chunks for incremental TTS.
    
    Strategy:
    1. Split on sentence boundaries (. ! ? ; :)
    2. Merge short chunks (< MIN_CHUNK_LENGTH)
    3. Split long chunks (> MAX_CHUNK_LENGTH) on commas or spaces
    """
    # Initial split on sentence boundaries
    parts = SENTENCE_PATTERN.split(text.strip())
    parts = [p.strip() for p in parts if p.strip()]
    
    if not parts:
        return [text.strip()] if text.strip() else []
    
    chunks = []
    current_chunk = ""
    
    for part in parts:
        if not current_chunk:
            current_chunk = part
        elif len(current_chunk) < MIN_CHUNK_LENGTH:
            # Merge short chunk with next
            current_chunk += " " + part
        else:
            chunks.append(current_chunk)
            current_chunk = part
    
    if current_chunk:
        chunks.append(current_chunk)
    
    # Split any chunks that are too long
    final_chunks = []
    for chunk in chunks:
        if len(chunk) > MAX_CHUNK_LENGTH:
            # Split on commas first
            sub_parts = chunk.split(',')
            sub_chunk = ""
            for sp in sub_parts:
                sp = sp.strip()
                if not sp:
                    continue
                if len(sub_chunk) + len(sp) + 2 <= MAX_CHUNK_LENGTH:
                    sub_chunk = (sub_chunk + ", " + sp).strip(", ")
                else:
                    if sub_chunk:
                        final_chunks.append(sub_chunk)
                    sub_chunk = sp
            if sub_chunk:
                final_chunks.append(sub_chunk)
        else:
            final_chunks.append(chunk)
    
    return final_chunks


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


def generate_single_sentence(
    text: str,
    ref_audio_mx,
    ref_text: str,
    sr: int,
) -> tuple[np.ndarray, int, float]:
    """Generate TTS for a single sentence chunk. Returns (audio, sample_rate, generation_time)."""
    import mlx.core as mx
    
    model, _ = load_model()
    
    start_time = time.time()
    
    # Generate audio (non-streaming since MLX doesn't truly stream)
    results = list(model.generate(
        text=text,
        ref_audio=ref_audio_mx,
        ref_text=ref_text or text if ref_audio_mx is not None else None,
        stream=False,  # Don't bother with streaming since it doesn't work
    ))
    
    gen_time = time.time() - start_time
    
    if results:
        audio_np = np.array(results[0].audio)
        return audio_np, sr, gen_time
    
    return np.array([]), sr, gen_time


def sentence_chunking_producer(
    text: str,
    room_id: str,
    user_id: str,
    target_user_id: str,
    base_hash: str,
    chunk_queue: Queue,
):
    """
    Producer: splits text into sentences and generates each independently.
    Puts each sentence's audio into the queue as soon as it's ready.
    """
    import mlx.core as mx
    
    try:
        # Get voice sample once
        voice_sample = get_voice_sample(room_id, user_id, user_id)
        
        ref_audio_mx = None
        ref_text = None
        sr = 24000
        
        if voice_sample:
            wav_data, ref_text, sr = voice_sample
            ref_audio, _ = sf.read(io.BytesIO(wav_data))
            ref_audio_mx = mx.array(ref_audio)
            logger.info(f"🎤 Sentence-chunked TTS with voice cloning")
        else:
            logger.info(f"🔊 Sentence-chunked TTS with default voice")
        
        # Split into sentences
        sentences = split_into_sentences(text)
        total_sentences = len(sentences)
        
        logger.info(f"📝 Split into {total_sentences} sentence chunks")
        for i, s in enumerate(sentences):
            logger.info(f"   [{i+1}] {s[:50]}{'...' if len(s) > 50 else ''}")
        
        total_start = time.time()
        
        for i, sentence in enumerate(sentences):
            # Check cancellation
            if base_hash and active_generations.get(base_hash, {}).get('cancelled'):
                logger.info(f"⛔ Cancelled at sentence {i+1}")
                chunk_queue.put(('CANCELLED', None, None))
                return
            
            # Generate this sentence
            audio_np, sample_rate, gen_time = generate_single_sentence(
                sentence, ref_audio_mx, ref_text, sr
            )
            
            elapsed = time.time() - total_start
            audio_duration = len(audio_np) / sample_rate if len(audio_np) > 0 else 0
            
            logger.info(f"  📦 Sentence {i+1}/{total_sentences} ready ({audio_duration:.2f}s audio) in {gen_time:.2f}s @ {elapsed:.2f}s total")
            
            chunk_queue.put(('CHUNK', audio_np, {
                'chunk_index': i,
                'total_chunks': total_sentences,
                'sample_rate': sample_rate,
                'is_final': (i == total_sentences - 1),
                'elapsed_time': elapsed,
                'sentence_text': sentence,
                'generation_time': gen_time,
            }))
        
        total_time = time.time() - total_start
        chunk_queue.put(('DONE', None, {'total_time': total_time, 'total_chunks': total_sentences}))
        
    except Exception as e:
        logger.error(f"Producer error: {e}", exc_info=True)
        chunk_queue.put(('ERROR', None, {'error': str(e)}))


async def sentence_chunking_consumer(
    chunk_queue: Queue,
    redis_client,
    message: dict,
    session_id: str,
    base_hash: str,
    au_hash: str,
):
    """Consumer: publishes each sentence chunk to Redis as it arrives."""
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
            try:
                status, audio, meta = await asyncio.get_event_loop().run_in_executor(
                    None, 
                    lambda: chunk_queue.get(timeout=0.05)
                )
            except Empty:
                await asyncio.sleep(0.01)
                continue
            
            if status == 'CHUNK':
                if first_chunk_time is None:
                    first_chunk_time = meta['elapsed_time']
                    logger.info(f"⚡ First sentence ready in {first_chunk_time:.3f}s!")
                
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
                    'totalChunks': meta['total_chunks'],
                    'audioBase64': audio_to_base64(audio, sample_rate),
                    'sampleRate': sample_rate,
                    'text': meta.get('sentence_text', ''),
                    'fullText': text,
                    'isSentenceChunk': True,
                    'isFinalChunk': meta['is_final'],
                    'firstChunkLatencyMs': int(first_chunk_time * 1000) if first_chunk_time else 0,
                    'generationTimeMs': int(meta.get('generation_time', 0) * 1000),
                    'timestamp': time.time()
                }
                
                await redis_client.publish(channel, json.dumps(chunk_message))
                chunks_published += 1
                
            elif status == 'DONE':
                total_time = meta['total_time']
                audio_duration = total_samples / 24000
                
                logger.info(f"✅ Complete: {chunks_published} sentences, "
                           f"{audio_duration:.2f}s audio in {total_time:.2f}s "
                           f"({audio_duration/total_time:.1f}x realtime)")
                
                if first_chunk_time:
                    logger.info(f"⚡ First-sentence latency: {first_chunk_time*1000:.0f}ms")
                
                break
                
            elif status == 'CANCELLED':
                logger.info(f"Cancelled after {chunks_published} sentences")
                break
                
            elif status == 'ERROR':
                error = meta.get('error', 'Unknown error')
                logger.error(f"Error: {error}")
                
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
    
    if base_hash and base_hash in active_generations:
        del active_generations[base_hash]


async def process_translation_with_sentence_chunking(message: dict, redis_client):
    """Process translation with sentence-level chunking."""
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
    
    logger.info(f"🔄 Processing: '{text[:60]}...'")
    
    if base_hash:
        active_generations[base_hash] = {
            'session_id': session_id,
            'cancelled': False,
            'room_id': room_id
        }
    
    chunk_queue = Queue()
    
    loop = asyncio.get_event_loop()
    producer_future = loop.run_in_executor(
        executor,
        sentence_chunking_producer,
        text, room_id, user_id, target_user_id, base_hash, chunk_queue
    )
    
    await sentence_chunking_consumer(
        chunk_queue, redis_client, message, session_id, base_hash, au_hash
    )
    
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
    
    logger.info("🚀 Sentence-chunking TTS queue processor started")
    
    while True:
        try:
            data = await tts_request_queue.get()
            
            ml_hash = data.get('hash')
            base_hash = ml_hash.replace('_ml', '') if ml_hash else None
            
            if base_hash and active_generations.get(base_hash, {}).get('cancelled'):
                tts_request_queue.task_done()
                continue
            
            await process_translation_with_sentence_chunking(data, redis_client)
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
            logger.info("📡 Subscribed to room:*:translation (SENTENCE-CHUNKING MODE)")
            
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
    logger.info("=" * 60)
    logger.info("  SENTENCE-CHUNKING Voice Processor")
    logger.info("  Splits text into sentences for lower first-audio latency")
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
