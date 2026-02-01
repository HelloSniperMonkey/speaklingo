"""
Background worker that subscribes to transcription events,
translates them, and publishes to translation channel.
"""

import asyncio
import json
import logging
import time
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
from dotenv import load_dotenv

from redis_client import get_redis_client
from config import Config

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configure Local Model
def load_model():
    model_name = "facebook/nllb-200-distilled-600M"
    logger.info(f"Loading {model_name}...")
    start_load = time.time()

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name)

    # Select device
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")

    model.to(device)
    model.eval()

    end_load = time.time()
    logger.info(f"Model and tokenizer loaded in {(end_load - start_load) * 1000:.2f} ms")
    logger.info(f"Using device: {device}")

    return tokenizer, model, device

# Load model globally
tokenizer, model, device = load_model()

# Language mapping for NLLB
LANGUAGE_MAP = {
    'en': 'eng_Latn',
    'es': 'spa_Latn',
    'fr': 'fra_Latn',
    'de': 'deu_Latn',
    'it': 'ita_Latn',
    'pt': 'por_Latn',
    'hi': 'hin_Deva',
    'zh': 'zho_Hans',
    'ja': 'jpn_Jpan',
    'ko': 'kor_Hang',
    'ru': 'rus_Cyrl',
    'ar': 'ara_Arab',
    'unknown': 'eng_Latn'
}

def get_nllb_lang(code):
    return LANGUAGE_MAP.get(code, 'eng_Latn')

# Translation cache (in-memory for now)
translation_cache = {}

def _translate_sync(text, src_lang_code):
    """Synchronous translation logic to be run in executor."""
    try:
        src_lang = get_nllb_lang(src_lang_code)
        tgt_lang = "eng_Latn" # Always translate to English for now

        # Set source language
        tokenizer.src_lang = src_lang

        # Tokenize + move to device
        inputs = tokenizer(text, return_tensors="pt").to(device)

        # Target language token
        forced_bos_token_id = tokenizer.convert_tokens_to_ids(tgt_lang)

        with torch.no_grad():
            generated_tokens = model.generate(
                **inputs,
                forced_bos_token_id=forced_bos_token_id,
                max_length=200
            )

        # Decode
        result = tokenizer.batch_decode(
            generated_tokens,
            skip_special_tokens=True
        )[0]
        
        return result
    except Exception as e:
        logger.error(f"Sync translation error: {e}")
        raise e

async def translate_text(text: str, src_lang_code: str = 'unknown') -> dict:
    """Translate text using local NLLB model. Returns translated text and latency."""
    if not text.strip():
        return {'translated': '', 'latency_ms': 0}
    
    # Check cache
    cache_key = f"{src_lang_code}:{text}"
    if cache_key in translation_cache:
        logger.info(f"Cache hit for: {text[:30]}...")
        return {
            'translated': translation_cache[cache_key],
            'latency_ms': 0,
            'cache_hit': True
        }
    
    start_time = time.time()
    
    try:
        # Run in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        translated = await loop.run_in_executor(
            None,
            lambda: _translate_sync(text, src_lang_code)
        )
        
        latency_ms = int((time.time() - start_time) * 1000)
        
        # Cache the result
        translation_cache[cache_key] = translated
        
        # Limit cache size
        if len(translation_cache) > 500:
            # Remove oldest entry
            translation_cache.pop(next(iter(translation_cache)))
        
        return {
            'translated': translated,
            'latency_ms': latency_ms,
            'cache_hit': False
        }
    
    except Exception as e:
        logger.error(f"Translation error: {e}")
        latency_ms = int((time.time() - start_time) * 1000)
        return {
            'translated': text,  # Fallback
            'latency_ms': latency_ms,
            'error': str(e),
            'cache_hit': False
        }

async def process_transcription(message_data: str, channel: str):
    """Process a transcription message and publish translation."""
    try:
        transcription = json.loads(message_data)
        
        # Only translate final transcriptions to reduce load
        if not transcription.get('isFinal', False):
            logger.debug(f"Skipping interim transcription: {transcription.get('text', '')[:30]}")
            return
        
        text = transcription.get('text', '')
        if not text.strip():
            return
        
        room_id = transcription.get('roomId')
        user_id = transcription.get('userId')
        session_id = transcription.get('sessionId')
        tc_hash = transcription.get('hash')  # Extract hash (format: {uuid}_tc)
        
        logger.info(f"Translating for room {room_id}: {text[:50]}... (hash: {tc_hash})")
        
        # Translate
        src_lang_code = transcription.get('language', 'unknown')
        result = await translate_text(text, src_lang_code)
        
        # Build translation message
        translation_msg = {
            'type': 'translation',
            'hash': tc_hash.replace('_tc', '_ml') if tc_hash else None,  # Convert tc hash to ml hash
            'roomId': room_id,
            'userId': user_id,
            'sessionId': session_id,
            'originalText': text,
            'translatedText': result['translated'],
            'sourceLanguage': transcription.get('language', 'unknown'),
            'targetLanguage': 'en',
            'isFinal': True,
            'timestamp': int(time.time() * 1000),
            'latencyMs': result['latency_ms'],
            'metadata': {
                'transcriptionTimestamp': transcription.get('timestamp'),
                'totalLatencyMs': result['latency_ms'] + int(transcription.get('processingTime', 0) * 1000),
                'cacheHit': result.get('cache_hit', False),
                'transcriptionHash': tc_hash
            }
        }
        
        # Publish to translation channel
        redis_client = get_redis_client()
        translation_channel = f"room:{room_id}:translation"
        await redis_client.publish(translation_channel, json.dumps(translation_msg))
        
        logger.info(f"Published translation to {translation_channel}")
    
    except Exception as e:
        logger.error(f"Error processing transcription: {e}")

async def process_invalidation(message_data: str, channel: str):
    """Process an invalidation message and propagate to voice processor via translation channel."""
    try:
        invalidation = json.loads(message_data)
        
        tc_hash = invalidation.get('hash')  # Base hash without suffix
        room_id = invalidation.get('roomId')
        
        if not tc_hash or not room_id:
            return
        
        logger.info(f"Processing invalidation for hash {tc_hash} in room {room_id}")
        
        # Propagate invalidation to TRANSLATION channel (not invalidation channel)
        # This prevents infinite loop - we listen to room:*:invalidation
        # but publish to room:*:translation with type=invalidation
        invalidation_msg = {
            'type': 'invalidation',
            'hash': tc_hash,  # Send base hash, frontend will derive suffixes
            'roomId': room_id,
            'userId': invalidation.get('userId'),
            'sessionId': invalidation.get('sessionId'),
            'timestamp': int(time.time() * 1000)
        }
        
        # Publish to TRANSLATION channel (voice processor subscribes to this)
        redis_client = get_redis_client()
        translation_channel = f"room:{room_id}:translation"
        await redis_client.publish(translation_channel, json.dumps(invalidation_msg))
        
        logger.info(f"Propagated invalidation to {translation_channel}")
    
    except Exception as e:
        logger.error(f"Error processing invalidation: {e}")

async def main():
    """Main processor entry point."""
    redis_client = get_redis_client()
    
    logger.info("Starting Translation Processor...")
    logger.info("Subscribing to Redis patterns: room:*:transcription, room:*:invalidation")
    
    try:
        # Subscribe to transcription and invalidation channels from transcription server
        pubsub = await redis_client.psubscribe('room:*:transcription', 'room:*:invalidation')
        
        async for message in pubsub.listen():
            if message['type'] == 'pmessage':
                channel = message['channel']
                data = message['data']
                
                # Process based on channel type
                # Note: We listen to room:*:invalidation but publish invalidations to room:*:translation
                # This prevents infinite loop
                if ':invalidation' in channel:
                    asyncio.create_task(process_invalidation(data, channel))
                elif ':transcription' in channel:
                    asyncio.create_task(process_transcription(data, channel))
    
    except Exception as e:
        logger.error(f"Processor error: {e}")
        await asyncio.sleep(5)
        # Restart
        await main()

if __name__ == '__main__':
    asyncio.run(main())
