"""
SLIDING WINDOW TRANSLATION PROCESSOR

Works with transcription_server_continuous.py to provide low-latency translation.

Key Architecture:
- Receives 2-second transcription chunks with 4-second context
- Uses context to produce coherent translations
- Only translates the NEW portion (not the context)
- Immediately dispatches to TTS for continuous audio output

Example:
  Chunk 1: context="" new="Hello my friend"
    → Translate "Hello my friend" → "Hola mi amigo"
  
  Chunk 2: context="Hello my friend" new="how are you today"
    → LLM sees context but only outputs: "¿cómo estás hoy?"
  
  Chunk 3: context="Hello my friend how are you today" new="the weather is nice"
    → LLM sees context but only outputs: "el clima es agradable"

The context ensures coherent translation across chunk boundaries.
"""

import asyncio
import json
import logging
import time
from typing import Dict, Optional

from groq import Groq
from dotenv import load_dotenv

from redis_client import get_redis_client
from config import Config

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Groq client - use Config which properly loads from dotenv
client = Groq(api_key=Config.GROQ_API_KEY)

# Per-session translation state
class TranslationState:
    """Tracks translation state per user/room."""
    def __init__(self):
        self.last_translated_context = ""  # What we've already translated (source)
        self.last_translated_output = ""   # The actual translation output we sent
        self.chunk_translations: Dict[int, str] = {}  # sequence -> translation
        self.last_sequence = -1
        
translation_states: Dict[str, TranslationState] = {}  # key: f"{room_id}:{user_id}"

# Language code to full name mapping
LANGUAGE_NAMES = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'nl': 'Dutch',
    'pl': 'Polish',
    'ru': 'Russian',
    'uk': 'Ukrainian',
    'cs': 'Czech',
    'sk': 'Slovak',
    'bg': 'Bulgarian',
    'ro': 'Romanian',
    'hu': 'Hungarian',
    'el': 'Greek',
    'tr': 'Turkish',
    'ar': 'Arabic',
    'he': 'Hebrew',
    'hi': 'Hindi',
    'th': 'Thai',
    'vi': 'Vietnamese',
    'id': 'Indonesian',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'sv': 'Swedish',
    'da': 'Danish',
    'fi': 'Finnish',
    'no': 'Norwegian',
}


def get_translation_state(room_id: str, user_id: str) -> TranslationState:
    """Get or create translation state for a user."""
    key = f"{room_id}:{user_id}"
    if key not in translation_states:
        translation_states[key] = TranslationState()
    return translation_states[key]


async def get_target_language(room_id: str, target_user_id: str) -> str:
    """
    Get the spoken language of the target user from Redis.
    This is the language we should translate TO.
    """
    redis_client = get_redis_client()
    language_key = f"room:{room_id}:user:{target_user_id}:language"
    
    try:
        language = await redis_client.get(language_key)
        if language:
            if isinstance(language, bytes):
                language = language.decode('utf-8')
            # Convert language code to full name for the LLM
            language_name = LANGUAGE_NAMES.get(language, language.capitalize())
            logger.info(f"🌐 Target language for {target_user_id}: {language} -> {language_name}")
            return language_name
    except Exception as e:
        logger.warning(f"Failed to get target language from Redis: {e}")
    
    # Default to English if no language set
    logger.warning(f"⚠️ No language preference found for {target_user_id}, defaulting to English")
    return "English"


def remove_duplicate_prefix(new_translation: str, previous_translation: str) -> str:
    """
    Remove overlapping content from the start of new_translation
    that matches the end of previous_translation.
    
    Uses ONLY exact suffix-prefix word overlap to avoid false positives.
    The fuzzy matching approach was too aggressive and could eat genuinely
    new translations, especially for non-Latin languages.
    
    Example:
      previous: "Hello my friend how are you"
      new:      "how are you the weather is nice"
      result:   "the weather is nice"
    """
    if not previous_translation or not new_translation:
        return new_translation
    
    prev_words = previous_translation.split()
    new_words = new_translation.split()
    
    # Exact suffix-prefix overlap (handles perfect re-emissions)
    # Find the longest suffix of previous that matches a prefix of new
    best_overlap = 0
    for overlap_len in range(1, min(len(prev_words), len(new_words)) + 1):
        if prev_words[-overlap_len:] == new_words[:overlap_len]:
            best_overlap = overlap_len
    
    if best_overlap > 0:
        result = ' '.join(new_words[best_overlap:])
        if result:
            return result
        # If exact full overlap with nothing new, return empty
        return ""
    
    return new_translation


async def translate_with_context(
    context: str,
    new_text: str,
    target_language: str = "English"
) -> tuple[str, float]:
    """
    Translate new_text using context for coherence.
    Only returns translation of new_text, not the context.
    """
    start_time = time.time()
    
    if not new_text.strip():
        return "", 0
    
    # Build the prompt
    if context.strip():
        prompt = f"""You are a real-time speech translator. Translate [NEW TEXT] from the source language to {target_language}.

[PREVIOUSLY SPOKEN - For understanding context, DO NOT translate]
{context}

[NEW TEXT - Translate THIS ONLY]
{new_text}

CRITICAL RULES:
1. Output ONLY the translation of [NEW TEXT], never repeat [PREVIOUSLY SPOKEN]
2. Use [PREVIOUSLY SPOKEN] to understand context and meaning
3. If [NEW TEXT] is incomplete/fragmented, translate it naturally as a continuation
4. Make the translation flow naturally from the context
5. NO explanations, NO notes, ONLY the translation

Translation:"""
    else:
        # No context, simple translation
        prompt = f"""Translate to {target_language}. Output ONLY the translation.

Text: {new_text}

Translation:"""
    
    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_completion_tokens=150,
                top_p=1,
                stream=False
            )
        )
        
        translated = response.choices[0].message.content
        if translated:
            translated = translated.strip()
            # Remove any accidental quoting
            if translated.startswith('"') and translated.endswith('"'):
                translated = translated[1:-1]
        else:
            translated = new_text  # Fallback
        
        latency_ms = (time.time() - start_time) * 1000
        return translated, latency_ms
        
    except Exception as e:
        logger.error(f"Translation error: {e}")
        return new_text, (time.time() - start_time) * 1000


async def process_continuous_chunk(message_data: str, channel: str):
    """
    Process a continuous transcription chunk.
    Translates the new text using context and dispatches to TTS.
    """
    try:
        chunk = json.loads(message_data)
        
        # Only process chunk messages
        if chunk.get('type') != 'transcription_chunk':
            # Handle legacy final transcriptions
            if chunk.get('type') == 'transcription' and chunk.get('isFinal'):
                await process_legacy_transcription(message_data, channel)
            return
        
        room_id = chunk.get('roomId')
        user_id = chunk.get('userId')
        context = chunk.get('context', '')
        new_text = chunk.get('newText', '')
        full_text = chunk.get('fullText', '')
        tc_hash = chunk.get('hash')
        chunk_sequence = chunk.get('chunkSequence', 0)
        
        if not new_text.strip() or not room_id:
            return
        
        # Determine target user for TTS
        target_user_id = None
        if user_id == 'local-user':
            target_user_id = 'remote-user'
        elif user_id == 'remote-user':
            target_user_id = 'local-user'
        
        logger.info(f"🔄 Chunk {chunk_sequence}: context='{context[:30]}...' new='{new_text[:40]}...'")
        
        # Get translation state
        state = get_translation_state(room_id, user_id)
        
        # Get target user's language preference from Redis
        target_language_name = await get_target_language(room_id, target_user_id) if target_user_id else "English"
        
        logger.info(f"   🎯 Translating to: {target_language_name} (for {target_user_id})")
        
        # Translate with context to the target language
        translated, latency_ms = await translate_with_context(context, new_text, target_language_name)
        
        if not translated.strip():
            return
        
        logger.info(f"  ✅ Raw translation ({latency_ms:.0f}ms): '{translated[:60]}...'")
        
        # DEDUPLICATION: Remove content that overlaps with previous translations
        original_translated = translated
        if state.last_translated_output:
            translated = remove_duplicate_prefix(translated, state.last_translated_output)
            if translated != original_translated:
                logger.info(f"  🔧 Deduplicated: '{translated[:60]}...'")
        
        # Skip if nothing left after deduplication
        if not translated.strip():
            logger.info(f"  ⏭️ Skipped (fully duplicate content)")
            return
        
        # Build translation message for TTS
        translation_msg = {
            'type': 'translation',
            'hash': tc_hash.replace('_tc', '_ml') if tc_hash else None,
            'roomId': room_id,
            'userId': user_id,
            'targetUserId': target_user_id,
            'sessionId': chunk.get('sessionId'),
            'originalText': new_text,
            'originalContext': context,
            'translatedText': translated,
            'sourceLanguage': chunk.get('language', 'unknown'),
            'targetLanguage': target_language_name,
            'isFinal': False,  # Continuous chunks are never "final"
            'isChunk': True,
            'chunkSequence': chunk_sequence,
            'timestamp': int(time.time() * 1000),
            'latencyMs': int(latency_ms),
            'metadata': {
                'mode': 'continuous',
                'contextLength': len(context),
                'newTextLength': len(new_text),
                'deduplicated': translated != original_translated
            }
        }
        
        # Publish to translation channel (TTS processor listens here)
        redis_client = get_redis_client()
        translation_channel = f"room:{room_id}:translation"
        await redis_client.publish(translation_channel, json.dumps(translation_msg))
        
        # Update state for next deduplication check
        # Keep only the LAST translation for dedup (not rolling window)
        # Rolling window was too aggressive - common words across translations
        # would trigger false dedup matches
        state.last_translated_output = translated
        
        state.chunk_translations[chunk_sequence] = translated
        state.last_sequence = chunk_sequence
        
        logger.info(f"  📤 Dispatched to TTS: '{translated[:50]}...'")
    
    except Exception as e:
        logger.error(f"Error processing chunk: {e}", exc_info=True)


async def process_legacy_transcription(message_data: str, channel: str):
    """Handle legacy final transcription messages for backwards compatibility."""
    try:
        transcription = json.loads(message_data)
        
        if not transcription.get('isFinal', False):
            return
        
        text = transcription.get('text', '')
        if not text.strip():
            return
        
        room_id = transcription.get('roomId')
        user_id = transcription.get('userId')
        tc_hash = transcription.get('hash')
        
        target_user_id = None
        if user_id == 'local-user':
            target_user_id = 'remote-user'
        elif user_id == 'remote-user':
            target_user_id = 'local-user'
        
        logger.info(f"[Legacy] Final transcription: {text[:50]}...")
        
        translated, latency_ms = await translate_with_context("", text)
        
        translation_msg = {
            'type': 'translation',
            'hash': tc_hash.replace('_tc', '_ml') if tc_hash else None,
            'roomId': room_id,
            'userId': user_id,
            'targetUserId': target_user_id,
            'sessionId': transcription.get('sessionId'),
            'originalText': text,
            'translatedText': translated,
            'sourceLanguage': transcription.get('language', 'unknown'),
            'targetLanguage': 'en',
            'isFinal': True,
            'timestamp': int(time.time() * 1000),
            'latencyMs': int(latency_ms)
        }
        
        redis_client = get_redis_client()
        await redis_client.publish(f"room:{room_id}:translation", json.dumps(translation_msg))
        
    except Exception as e:
        logger.error(f"Legacy transcription error: {e}")


async def process_invalidation(message_data: str, channel: str):
    """Process invalidation messages."""
    try:
        invalidation = json.loads(message_data)
        
        tc_hash = invalidation.get('hash')
        room_id = invalidation.get('roomId')
        
        if not tc_hash or not room_id:
            return
        
        logger.info(f"Processing invalidation: {tc_hash}")
        
        invalidation_msg = {
            'type': 'invalidation',
            'hash': tc_hash,
            'roomId': room_id,
            'userId': invalidation.get('userId'),
            'timestamp': int(time.time() * 1000)
        }
        
        redis_client = get_redis_client()
        await redis_client.publish(f"room:{room_id}:translation", json.dumps(invalidation_msg))
        
    except Exception as e:
        logger.error(f"Invalidation error: {e}")


async def main():
    """Main entry point."""
    redis_client = get_redis_client()
    
    logger.info("=" * 60)
    logger.info("  SLIDING WINDOW TRANSLATION PROCESSOR")
    logger.info("  Mode: Continuous chunks with context")
    logger.info("  Translates 2s new text with 4s context")
    logger.info("=" * 60)
    
    try:
        pubsub = await redis_client.psubscribe('room:*:transcription', 'room:*:invalidation')
        logger.info("Subscribed to: room:*:transcription, room:*:invalidation")
        
        async for message in pubsub.listen():
            if message['type'] == 'pmessage':
                channel = message['channel']
                data = message['data']
                
                if ':invalidation' in channel:
                    asyncio.create_task(process_invalidation(data, channel))
                elif ':transcription' in channel:
                    asyncio.create_task(process_continuous_chunk(data, channel))
    
    except Exception as e:
        logger.error(f"Processor error: {e}")
        await asyncio.sleep(5)
        await main()


if __name__ == '__main__':
    asyncio.run(main())
