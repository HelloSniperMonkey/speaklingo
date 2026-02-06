"""
Voice Sample Server for qwen3-tts voice cloning.
Accepts voice samples via HTTP and stores them in Redis with TTL.
Port: 8712
"""

import asyncio
import base64
import io
import json
import logging
import os
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Thread

from flask import Flask, request, jsonify
from flask_cors import CORS
import soundfile as sf
import numpy as np

# Redis for voice sample storage
import redis

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Redis client for voice sample storage (sync client for Flask)
redis_client = redis.Redis(host='localhost', port=6379, db=0)

# In-memory fallback cache
voice_samples_cache: dict[str, dict] = {}

# Voice sample TTL (1 hour)
VOICE_SAMPLE_TTL = 3600

# Local storage directory
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

# Thread pool for ffmpeg conversions (prevents blocking requests)
# Using 4 workers to handle concurrent uploads without blocking
ffmpeg_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix='ffmpeg')


def _convert_webm_to_wav_sync(webm_data: bytes) -> bytes:
    """
    Synchronous webm to wav conversion (runs in thread pool).
    This is the actual work that runs in a separate thread.
    """
    webm_path = None
    wav_path = None
    
    try:
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as webm_file:
            webm_file.write(webm_data)
            webm_path = webm_file.name
        
        wav_path = webm_path.replace('.webm', '.wav')
        
        # Use ffmpeg to convert webm to wav (16kHz mono for TTS)
        # Using subprocess.Popen for better control and timeout handling
        process = subprocess.Popen(
            ['ffmpeg', '-y', '-i', webm_path, '-ar', '16000', '-ac', '1', '-f', 'wav', wav_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        try:
            # Timeout after 30 seconds to prevent hanging
            _, stderr = process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise RuntimeError("ffmpeg conversion timed out after 30 seconds")
        
        if process.returncode != 0:
            error_msg = stderr.decode('utf-8', errors='replace') if stderr else 'Unknown error'
            logger.error(f"ffmpeg error: {error_msg}")
            raise RuntimeError(f"ffmpeg conversion failed: {error_msg}")
        
        with open(wav_path, 'rb') as f:
            wav_data = f.read()
        
        return wav_data
        
    finally:
        # Cleanup temp files
        if webm_path and os.path.exists(webm_path):
            try:
                os.remove(webm_path)
            except OSError:
                pass
        if wav_path and os.path.exists(wav_path):
            try:
                os.remove(wav_path)
            except OSError:
                pass


def convert_webm_to_wav(webm_data: bytes) -> bytes:
    """
    Convert webm audio to wav format using ffmpeg (non-blocking).
    
    Uses ThreadPoolExecutor to run ffmpeg in a separate thread,
    preventing it from blocking other Flask request handlers.
    """
    # Submit conversion to thread pool and wait for result
    # This allows other requests to be processed while ffmpeg runs
    future = ffmpeg_executor.submit(_convert_webm_to_wav_sync, webm_data)
    
    try:
        # Wait for conversion with timeout (slightly longer than process timeout)
        return future.result(timeout=35)
    except Exception as e:
        logger.error(f"Async ffmpeg conversion failed: {e}")
        raise


def store_voice_sample(room_id: str, user_id: str, wav_data: bytes, transcript: str = ""):
    """Store voice sample in Redis, local file, and memory."""
    # Use user-based key (shared across all rooms for same user)
    redis_key = f"voice_sample:{user_id}"
    
    # Also store with room-specific key for backwards compatibility
    room_key = f"voice_sample:{room_id}:{user_id}"
    
    sample_data = {
        'wav_base64': base64.b64encode(wav_data).decode('utf-8'),
        'transcript': transcript,
        'timestamp': time.time(),
        'userId': user_id
    }
    
    # Save to local file system (persistent)
    local_file = os.path.join(DATA_DIR, f"{user_id}.wav")
    local_meta = os.path.join(DATA_DIR, f"{user_id}.json")
    try:
        with open(local_file, 'wb') as f:
            f.write(wav_data)
        with open(local_meta, 'w') as f:
            json.dump({'transcript': transcript, 'timestamp': time.time()}, f)
        logger.info(f"Voice sample saved locally: {local_file}")
    except Exception as e:
        logger.error(f"Failed to save local file: {e}")
    
    # Store in Redis
    try:
        redis_client.setex(redis_key, VOICE_SAMPLE_TTL, json.dumps(sample_data))
        redis_client.setex(room_key, VOICE_SAMPLE_TTL, json.dumps(sample_data))
        logger.info(f"Voice sample stored in Redis: {redis_key}, {room_key}")
    except Exception as e:
        logger.warning(f"Redis store failed, using in-memory: {e}")
    
    # Store in memory cache
    voice_samples_cache[redis_key] = sample_data
    voice_samples_cache[room_key] = sample_data


def get_voice_sample(room_id: str, user_id: str) -> dict | None:
    """Retrieve voice sample from Redis or cache."""
    key = f"voice_sample:{room_id}:{user_id}"
    
    try:
        data = redis_client.get(key)
        if data:
            return json.loads(data)
    except Exception as e:
        logger.warning(f"Redis get failed: {e}")
    
    return voice_samples_cache.get(key)


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    redis_ok = False
    try:
        redis_ok = redis_client.ping()
    except:
        pass
    
    return jsonify({
        'status': 'healthy',
        'redis': 'connected' if redis_ok else 'disconnected',
        'cached_samples': len(voice_samples_cache)
    })


@app.route('/upload-voice-sample', methods=['POST'])
def upload_voice_sample():
    """
    Upload a voice sample for cloning.
    Expects multipart form data with:
    - audio: audio file (webm or wav)
    - roomId: room identifier
    - userId: user identifier (optional, defaults to 'default')
    - transcript: text spoken in the sample (optional, for better cloning)
    """
    try:
        # Get audio file
        if 'audio' not in request.files:
            # Check if raw binary in body
            audio_data = request.data
            if not audio_data:
                return jsonify({'error': 'No audio file provided'}), 400
            content_type = request.content_type or ''
        else:
            audio_file = request.files['audio']
            audio_data = audio_file.read()
            content_type = audio_file.content_type or audio_file.filename or ''
        
        # Get metadata
        room_id = request.form.get('roomId') or request.args.get('roomId') or 'default'
        user_id = request.form.get('userId') or request.args.get('userId') or 'default'
        transcript = request.form.get('transcript') or request.args.get('transcript') or ''
        
        logger.info(f"Received voice sample: room={room_id}, user={user_id}, size={len(audio_data)}, type={content_type}")
        
        # Convert to WAV if needed
        if 'webm' in content_type.lower() or audio_data[:4] == b'\x1a\x45\xdf\xa3':
            logger.info("Converting webm to wav...")
            wav_data = convert_webm_to_wav(audio_data)
        elif 'wav' in content_type.lower() or audio_data[:4] == b'RIFF':
            wav_data = audio_data
        else:
            # Try to convert anyway
            logger.info(f"Unknown format, attempting conversion...")
            try:
                wav_data = convert_webm_to_wav(audio_data)
            except:
                return jsonify({'error': f'Unsupported audio format: {content_type}'}), 400
        
        # Validate WAV data
        try:
            audio_array, sr = sf.read(io.BytesIO(wav_data))
            duration = len(audio_array) / sr
            logger.info(f"Audio validated: {duration:.2f}s at {sr}Hz")
        except Exception as e:
            return jsonify({'error': f'Invalid audio data: {str(e)}'}), 400
        
        # Store the sample
        store_voice_sample(room_id, user_id, wav_data, transcript)
        
        return jsonify({
            'status': 'success',
            'message': 'Voice sample uploaded',
            'roomId': room_id,
            'userId': user_id,
            'duration': duration,
            'sampleRate': sr
        })
    
    except Exception as e:
        logger.error(f"Upload error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/get-voice-sample', methods=['GET'])
def get_voice_sample_endpoint():
    """Get stored voice sample metadata (for debugging)."""
    room_id = request.args.get('roomId', 'default')
    user_id = request.args.get('userId', 'default')
    
    sample = get_voice_sample(room_id, user_id)
    if not sample:
        return jsonify({'error': 'No voice sample found'}), 404
    
    # Don't return the actual audio data, just metadata
    return jsonify({
        'roomId': room_id,
        'userId': user_id,
        'hasAudio': bool(sample.get('wav_base64')),
        'hasTranscript': bool(sample.get('transcript')),
        'timestamp': sample.get('timestamp')
    })


@app.route('/register-voice-mapping', methods=['POST'])
def register_voice_mapping():
    """
    Register a mapping between room role (local-user/remote-user) and the actual voice user ID.
    This allows the voice processor to look up the correct voice sample for each user.
    
    Body:
    - roomId: The room ID
    - role: "local-user" or "remote-user"  
    - voiceUserId: The actual unique voice user ID from the intro recording
    """
    try:
        data = request.get_json()
        room_id = data.get('roomId')
        role = data.get('role')  # "local-user" or "remote-user"
        voice_user_id = data.get('voiceUserId')
        
        if not room_id or not role or not voice_user_id:
            return jsonify({'error': 'Missing required fields: roomId, role, voiceUserId'}), 400
        
        # Store mapping in Redis: room:{roomId}:voice_mapping:{role} -> voiceUserId
        mapping_key = f"voice_mapping:{room_id}:{role}"
        
        try:
            redis_client.setex(mapping_key, VOICE_SAMPLE_TTL, voice_user_id)
            logger.info(f"Registered voice mapping: {mapping_key} -> {voice_user_id}")
        except Exception as e:
            logger.warning(f"Redis store failed for voice mapping: {e}")
            # Also store in memory cache as fallback
            voice_samples_cache[mapping_key] = voice_user_id
        
        return jsonify({
            'status': 'success',
            'message': 'Voice mapping registered',
            'roomId': room_id,
            'role': role,
            'voiceUserId': voice_user_id
        })
    
    except Exception as e:
        logger.error(f"Voice mapping error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/get-voice-mapping', methods=['GET'])
def get_voice_mapping():
    """Get the voice user ID for a room role (for debugging)."""
    room_id = request.args.get('roomId')
    role = request.args.get('role')
    
    if not room_id or not role:
        return jsonify({'error': 'Missing roomId or role'}), 400
    
    mapping_key = f"voice_mapping:{room_id}:{role}"
    
    try:
        voice_user_id = redis_client.get(mapping_key)
        if voice_user_id:
            if isinstance(voice_user_id, bytes):
                voice_user_id = voice_user_id.decode('utf-8')
            return jsonify({
                'roomId': room_id,
                'role': role,
                'voiceUserId': voice_user_id
            })
    except Exception as e:
        logger.warning(f"Redis get failed: {e}")
    
    # Try memory cache
    voice_user_id = voice_samples_cache.get(mapping_key)
    if voice_user_id:
        return jsonify({
            'roomId': room_id,
            'role': role,
            'voiceUserId': voice_user_id
        })
    
    return jsonify({'error': 'No voice mapping found'}), 404


@app.route('/set-language', methods=['POST'])
def set_language():
    """
    Set a user's spoken language preference.
    This is used by the translation processor to determine what language
    to translate TO for the other user.
    
    Body:
    - roomId: The room ID
    - userId: "local-user" or "remote-user"
    - spokenLanguage: The language code (e.g., "en", "hi", "es")
    """
    try:
        data = request.get_json()
        room_id = data.get('roomId')
        user_id = data.get('userId')  # "local-user" or "remote-user"
        spoken_language = data.get('spokenLanguage')
        
        if not room_id or not user_id or not spoken_language:
            return jsonify({'error': 'Missing required fields: roomId, userId, spokenLanguage'}), 400
        
        # Store in Redis: room:{roomId}:user:{userId}:language -> spokenLanguage
        language_key = f"room:{room_id}:user:{user_id}:language"
        
        try:
            redis_client.setex(language_key, VOICE_SAMPLE_TTL, spoken_language)
            logger.info(f"🌐 Language set: {language_key} -> {spoken_language}")
        except Exception as e:
            logger.warning(f"Redis store failed for language: {e}")
            # Also store in memory cache as fallback
            voice_samples_cache[language_key] = spoken_language
        
        return jsonify({
            'status': 'success',
            'message': 'Language preference set',
            'roomId': room_id,
            'userId': user_id,
            'spokenLanguage': spoken_language
        })
    
    except Exception as e:
        logger.error(f"Set language error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/get-language', methods=['GET'])
def get_language():
    """Get the spoken language for a user in a room (for debugging)."""
    room_id = request.args.get('roomId')
    user_id = request.args.get('userId')
    
    if not room_id or not user_id:
        return jsonify({'error': 'Missing roomId or userId'}), 400
    
    language_key = f"room:{room_id}:user:{user_id}:language"
    
    try:
        language = redis_client.get(language_key)
        if language:
            if isinstance(language, bytes):
                language = language.decode('utf-8')
            return jsonify({
                'roomId': room_id,
                'userId': user_id,
                'spokenLanguage': language
            })
    except Exception as e:
        logger.warning(f"Redis get failed: {e}")
    
    # Try memory cache
    language = voice_samples_cache.get(language_key)
    if language:
        return jsonify({
            'roomId': room_id,
            'userId': user_id,
            'spokenLanguage': language
        })
    
    return jsonify({'error': 'No language preference found'}), 404

if __name__ == '__main__':
    logger.info("Starting Voice Sample Server on port 8712...")
    app.run(host='0.0.0.0', port=8712, debug=False, threaded=True)
