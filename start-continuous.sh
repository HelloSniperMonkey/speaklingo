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
source ./backend/.venv/bin/activate

# Start Frontend
echo "Starting Frontend..."
cd ./frontend
pm2 start npm --name "frontend" \
	--output ../logs/frontend-out.log \
	--error ../logs/frontend-err.log \
	-- run dev

# Start CONTINUOUS Transcription Server (2-second chunks)
echo "Starting CONTINUOUS Transcription Server..."
cd ../backend/google-backend
pm2 start python --name "transcription-server" \
	--output ../../logs/transcription-server-out.log \
	--error ../../logs/transcription-server-err.log \
	-- transcription_server_continuous.py

# Start CONTINUOUS Translation Processor (sliding window)
echo "Starting CONTINUOUS Translation Processor..."
cd ../translate-api
pm2 start python --name "translation-processor" \
	--output ../../logs/translation-processor-out.log \
	--error ../../logs/translation-processor-err.log \
	-- translation_processor_continuous.py

# Start Translation WebSocket Server
echo "Starting Translation WebSocket Server..."
pm2 start python --name "translation-ws-server" \
	--output ../../logs/translation-ws-server-out.log \
	--error ../../logs/translation-ws-server-err.log \
	-- translation_ws_server.py

# Start Voice Server
echo "Starting Voice Server..."
cd ../qwen3-tts-mlx
pm2 start python --name "voice-server" \
	--output ../../logs/voice-server-out.log \
	--error ../../logs/voice-server-err.log \
	-- voice_server.py

# Start Transcription Broadcast Server
echo "Starting Transcription Broadcast Server..."
cd ../google-backend
pm2 start python --name "transcription-broadcast" \
	--output ../../logs/transcription-broadcast-out.log \
	--error ../../logs/transcription-broadcast-err.log \
	-- transcription_broadcast_server.py

# Start Voice WebSocket Server
echo "Starting Voice WebSocket Server..."
cd ../qwen3-tts-mlx
pm2 start python --name "voice-ws-server" \
	--output ../../logs/voice-ws-server-out.log \
	--error ../../logs/voice-ws-server-err.log \
	-- voice_ws_server.py

# Start CONTINUOUS Voice Processor (optimized for short chunks)
echo "Starting CONTINUOUS Voice Processor..."
pm2 start python --name "voice-processor" \
	--output ../../logs/voice-processor-out.log \
	--error ../../logs/voice-processor-err.log \
	-- voice_processor_continuous.py

# Start Load Balancer
echo "Starting Load Balancer..."
cd ../loadbalancer
pm2 start python --name "loadbalancer" \
	--output ../../logs/loadbalancer-out.log \
	--error ../../logs/loadbalancer-err.log \
	-- loadbalancer.py

echo ""
echo "=============================================="
echo "  All CONTINUOUS services started!"
echo "  Transcription: 2s chunks"
echo "  Context window: 4s"
echo "=============================================="
pm2 status
