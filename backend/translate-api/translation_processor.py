"""
Translation Processor with STREAMING + SENTENCE-LEVEL DISPATCH.

Key optimization: Instead of waiting for the ENTIRE translation to complete,
this processor streams the Groq output and dispatches each complete sentence
to TTS as soon as it's detected. This can save 200-500ms for multi-sentence
translations.

Example:
  English: "Hello there. How are you doing?"
  Stream: "Hola" → "Hola allí" → "Hola allí." [DISPATCH!] → "¿Cómo" → ... → "?" [DISPATCH!]
  
Each sentence is sent to TTS immediately, allowing audio generation to start
while subsequent sentences are still being translated.
"""

import asyncio
import json
import logging
import os
import re
import time
from typing import Optional, List, AsyncGenerator

from dotenv import load_dotenv
from groq import Groq

from redis_client import get_redis_client

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Groq client
client = Groq(api_key=os.getenv('GROQ_API_KEY'))

# Simple translation cache
translation_cache: dict[str, str] = {}

# Sentence boundary pattern
SENTENCE_END_PATTERN = re.compile(r'[.!?。！？;:]\s*$')


def detect_sentence_end(text: str) -> bool:
    """Check if text ends with a sentence boundary."""
    return bool(SENTENCE_END_PATTERN.search(text.strip()))


async def translate_text_streaming(
    text: str,
    target_language: str = "English"
) -> AsyncGenerator[tuple[str, bool, float], None]:
    """
    Stream translation from Groq, yielding complete sentences as they're detected.
    
    Yields tuples of (sentence_text, is_final, latency_ms)
    """
    start_time = time.time()
    
    # Check cache first
    cache_key = f"{text}:{target_language}"
    if cache_key in translation_cache:
        cached = translation_cache[cache_key]
        latency = (time.time() - start_time) * 1000
        yield (cached, True, latency)
        return
    
    prompt = f"""Translate the following text to {target_language}. Only provide the translation, no additional text.

Text: {text}

Translation:"""
    
    try:
        # Create streaming completion
        stream = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.1,
            max_completion_tokens=200,
            top_p=1,
            stream=True  # Enable streaming
        )
        
        accumulated = ""
        last_dispatched_index = 0
        sentence_count = 0
        
        for chunk in stream:
            # Extract token from chunk
            delta = chunk.choices[0].delta
            if delta.content:
                accumulated += delta.content
                
                # Check if we have a complete sentence that hasn't been dispatched
                current_text = accumulated[last_dispatched_index:].strip()
                
                if current_text and detect_sentence_end(current_text):
                    sentence_count += 1
                    latency = (time.time() - start_time) * 1000
                    
                    logger.info(f"  📤 Sentence {sentence_count} ready: '{current_text[:50]}...' @ {latency:.0f}ms")
                    
                    yield (current_text, False, latency)
                    last_dispatched_index = len(accumulated)
        
        # Yield any remaining text as final
        remaining = accumulated[last_dispatched_index:].strip()
        if remaining:
            sentence_count += 1
            latency = (time.time() - start_time) * 1000
            logger.info(f"  📤 Final sentence {sentence_count}: '{remaining[:50]}...' @ {latency:.0f}ms")
            yield (remaining, True, latency)
        elif sentence_count > 0:
            # Already dispatched everything, just signal completion
            pass
        else:
            # No sentences dispatched yet, yield entire result
            latency = (time.time() - start_time) * 1000
            yield (accumulated.strip(), True, latency)
        
        # Cache the complete translation
        translation_cache[cache_key] = accumulated.strip()
        
        # Limit cache size
        if len(translation_cache) > 500:
            translation_cache.pop(next(iter(translation_cache)))
        
    except Exception as e:
        logger.error(f"Streaming translation error: {e}")
        latency = (time.time() - start_time) * 1000
        yield (text, True, latency)  # Fallback to original text


async def translate_text(text: str) -> dict:
    """
    Legacy non-streaming translation for compatibility.
    """
    start_time = time.time()
    
    # Check cache
    if text in translation_cache:
        return {
            'translated': translation_cache[text],
            'latency_ms': 1,
            'cache_hit': True
        }
    
    try:
        prompt = f"""Translate the following text to English. Only provide the translation, no additional text.

Text: {text}

Translation:"""
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.1,
                max_completion_tokens=100,
                top_p=1,
                stream=False
            )
        )
        
        translated = response.choices[0].message.content
        
        if not translated:
            translated = text
        else:
            translated = translated.strip()
        
        latency_ms = int((time.time() - start_time) * 1000)
        translation_cache[text] = translated
        
        if len(translation_cache) > 500:
            translation_cache.pop(next(iter(translation_cache)))
        
        return {
            'translated': translated,
            'latency_ms': latency_ms,
            'cache_hit': False
        }
    
    except Exception as e:
        logger.error(f"Translation error: {e}")
        return {
            'translated': text,
            'latency_ms': int((time.time() - start_time) * 1000),
            'error': str(e),
            'cache_hit': False
        }


async def process_transcription_streaming(message_data: str, channel: str):
    """
    Process transcription with STREAMING translation.
    Dispatches each translated sentence to TTS immediately.
    """
    try:
        transcription = json.loads(message_data)
        
        if not transcription.get('isFinal', False):
            return
        
        text = transcription.get('text', '')
        if not text.strip():
            return
        
        room_id = transcription.get('roomId')
        user_id = transcription.get('userId')
        session_id = transcription.get('sessionId')
        tc_hash = transcription.get('hash')
        
        # Determine target user
        target_user_id = None
        if user_id == 'local-user':
            target_user_id = 'remote-user'
        elif user_id == 'remote-user':
            target_user_id = 'local-user'
        
        logger.info(f"🔄 Streaming translation for room {room_id}: {text[:50]}...")
        
        redis_client = get_redis_client()
        translation_channel = f"room:{room_id}:translation"
        
        sentence_index = 0
        all_sentences = []
        
        # Stream translation and dispatch sentences
        async for sentence, is_final, latency_ms in translate_text_streaming(text):
            all_sentences.append(sentence)
            
            # Build translation message for this sentence
            translation_msg = {
                'type': 'translation',
                'hash': tc_hash.replace('_tc', '_ml') if tc_hash else None,
                'roomId': room_id,
                'userId': user_id,
                'targetUserId': target_user_id,
                'sessionId': session_id,
                'originalText': text,
                'translatedText': sentence,  # Just this sentence
                'fullTranslation': ' '.join(all_sentences) if is_final else None,
                'sourceLanguage': transcription.get('language', 'unknown'),
                'targetLanguage': 'en',
                'isFinal': is_final,
                'isStreamingSentence': True,
                'sentenceIndex': sentence_index,
                'timestamp': int(time.time() * 1000),
                'latencyMs': int(latency_ms),
                'metadata': {
                    'transcriptionTimestamp': transcription.get('timestamp'),
                    'streamingMode': True,
                    'sentenceCount': len(all_sentences) if is_final else sentence_index + 1
                }
            }
            
            await redis_client.publish(translation_channel, json.dumps(translation_msg))
            
            logger.info(f"  ✅ Dispatched sentence {sentence_index + 1} to TTS @ {latency_ms:.0f}ms")
            sentence_index += 1
        
        logger.info(f"✅ Streaming translation complete: {len(all_sentences)} sentences")
    
    except Exception as e:
        logger.error(f"Error processing streaming transcription: {e}", exc_info=True)


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


# Configuration: set to True to use streaming mode
USE_STREAMING_TRANSLATION = True


async def main():
    """Main processor entry point."""
    redis_client = get_redis_client()
    
    mode = "STREAMING" if USE_STREAMING_TRANSLATION else "BATCH"
    logger.info(f"Starting Translation Processor ({mode} MODE)...")
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
                    if USE_STREAMING_TRANSLATION:
                        asyncio.create_task(process_transcription_streaming(data, channel))
                    else:
                        asyncio.create_task(process_transcription(data, channel))
    
    except Exception as e:
        logger.error(f"Processor error: {e}")
        await asyncio.sleep(5)
        # Restart
        await main()


if __name__ == '__main__':
    asyncio.run(main())
