"""
Background worker that subscribes to transcription events,
translates them, and publishes to translation channel.
"""

import asyncio
import json
import logging
import time
import google.generativeai as genai
from dotenv import load_dotenv

from redis_client import get_redis_client
from config import Config

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configure Gemini
genai.configure(api_key=Config.GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.5-flash-lite')

# Translation cache (in-memory for now)
translation_cache = {}

async def translate_text(text: str) -> dict:
    """Translate text using Gemini. Returns translated text and latency."""
    if not text.strip():
        return {'translated': '', 'latency_ms': 0}
    
    # Check cache
    if text in translation_cache:
        logger.info(f"Cache hit for: {text[:30]}...")
        return {
            'translated': translation_cache[text],
            'latency_ms': 0,
            'cache_hit': True
        }
    
    start_time = time.time()
    
    try:
        prompt = f"""Translate the following text to English. 
Output ONLY the English translation, no additional words, explanations, or punctuation marks.
If the text is already in English, return it as is.

Text: {text}

Translation:"""
        
        # Run in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: model.generate_content(
                prompt,
                generation_config={
                    'temperature': 0.1,
                    'max_output_tokens': 100,
                }
            )
        )
        
        translated = response.text.strip()
        latency_ms = int((time.time() - start_time) * 1000)
        
        # Cache the result
        translation_cache[text] = translated
        
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
        
        # Determine the target user (who should RECEIVE/PLAY the audio) in 2-way communication
        # When local-user speaks, remote-user should hear it (and vice versa)
        # The TTS should use the SPEAKER's voice so the listener hears the speaker's cloned voice
        target_user_id = None
        if user_id == 'local-user':
            target_user_id = 'remote-user'  # Remote user will play this audio
        elif user_id == 'remote-user':
            target_user_id = 'local-user'   # Local user will play this audio
        
        # Note: Voice cloning uses user_id (speaker's voice), targetUserId is for routing
        logger.info(f"Translating for room {room_id}: {text[:50]}... (hash: {tc_hash}, speaker: {user_id}, target_listener: {target_user_id})")
        
        # Translate
        result = await translate_text(text)
        
        # Build translation message
        translation_msg = {
            'type': 'translation',
            'hash': tc_hash.replace('_tc', '_ml') if tc_hash else None,  # Convert tc hash to ml hash
            'roomId': room_id,
            'userId': user_id,              # Speaker - whose voice to clone
            'targetUserId': target_user_id,  # Listener - who should play this audio
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
