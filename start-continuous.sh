#!/bin/bash

# START-ALL CONTINUOUS MODE
# Uses the sliding window translation system for lower latency
# - 2-second transcription chunks
# - 4-second context window for coherent translation
# - Continuous audio output

echo "=============================================="
echo "  CONTINUOUS TRANSLATION MODE"
echo "  2s chunks + 4s context = lower latency"
echo "=============================================="

# Start Docker Compose (Redis)
echo "Starting Redis..."
docker compose up -d && echo "Docker Compose started"

# Activate virtual environment
echo "Activating virtual environment..."
source /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/backend/.venv/bin/activate

# Start Frontend
echo "Starting Frontend..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/frontend 
pm2 start npm --name "frontend" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/frontend-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/frontend-err.log \
	-- run dev

# Start CONTINUOUS Transcription Server (2-second chunks)
echo "Starting CONTINUOUS Transcription Server..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/backend/google-backend
pm2 start python --name "transcription-server" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/logs/transcription-server-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/logs/transcription-server-err.log \
	-- transcription_server_continuous.py

# Start CONTINUOUS Translation Processor (sliding window)
echo "Starting CONTINUOUS Translation Processor..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/backend/translate-api
pm2 start python --name "translation-processor" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/logs/translation-processor-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/logs/translation-processor-err.log \
	-- translation_processor_continuous.py

# Start Translation WebSocket Server
echo "Starting Translation WebSocket Server..."
pm2 start python --name "translation-ws-server" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/translation-ws-server-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/translation-ws-server-err.log \
	-- translation_ws_server.py

# Start Voice Server
echo "Starting Voice Server..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/backend/qwen3-tts-mlx
pm2 start python --name "voice-server" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/voice-server-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/voice-server-err.log \
	-- voice_server.py

# Start Transcription Broadcast Server
echo "Starting Transcription Broadcast Server..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/backend/google-backend
pm2 start python --name "transcription-broadcast" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/transcription-broadcast-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/transcription-broadcast-err.log \
	-- transcription_broadcast_server.py

# Start Voice WebSocket Server
echo "Starting Voice WebSocket Server..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/backend/qwen3-tts-mlx
pm2 start python --name "voice-ws-server" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/voice-ws-server-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/voice-ws-server-err.log \
	-- voice_ws_server.py

# Start CONTINUOUS Voice Processor (optimized for short chunks)
echo "Starting CONTINUOUS Voice Processor..."
pm2 start python --name "voice-processor" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/logs/voice-processor-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-new/logs/voice-processor-err.log \
	-- voice_processor_continuous.py

# Start Load Balancer
echo "Starting Load Balancer..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/backend/loadbalancer
pm2 start python --name "loadbalancer" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/loadbalancer-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/loadbalancer-err.log \
	-- loadbalancer.py

echo ""
echo "=============================================="
echo "  All CONTINUOUS services started!"
echo "  Transcription: 2s chunks"
echo "  Context window: 4s"
echo "=============================================="
pm2 status
