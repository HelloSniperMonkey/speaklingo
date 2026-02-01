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
import tempfile
import time
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


def convert_webm_to_wav(webm_data: bytes) -> bytes:
    """Convert webm audio to wav format using ffmpeg."""
    import subprocess
    
    with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as webm_file:
        webm_file.write(webm_data)
        webm_path = webm_file.name
    
    wav_path = webm_path.replace('.webm', '.wav')
    
    try:
        # Use ffmpeg to convert webm to wav (16kHz mono for TTS)
        result = subprocess.run([
            'ffmpeg', '-y', '-i', webm_path,
            '-ar', '16000', '-ac', '1', '-f', 'wav', wav_path
        ], capture_output=True, text=True)
        
        if result.returncode != 0:
            logger.error(f"ffmpeg error: {result.stderr}")
            raise RuntimeError(f"ffmpeg conversion failed: {result.stderr}")
        
        with open(wav_path, 'rb') as f:
            wav_data = f.read()
        
        return wav_data
    finally:
        # Cleanup temp files
        if os.path.exists(webm_path):
            os.remove(webm_path)
        if os.path.exists(wav_path):
            os.remove(wav_path)


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


if __name__ == '__main__':
    logger.info("Starting Voice Sample Server on port 8712...")
    app.run(host='0.0.0.0', port=8712, debug=False, threaded=True)
