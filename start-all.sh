#!/bin/bash

# Start Docker Compose
echo "Starting Docker Compose..."
docker compose up -d && echo "Docker Compose started successfully"

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

# Start Transcription Server
echo "Starting Transcription Server..."
cd ../backend/google-backend
pm2 start python --name "transcription-server" \
	--output ../../logs/transcription-server-out.log \
	--error ../../logs/transcription-server-err.log \
	-- transcription_server.py

# Start Translation Processor
echo "Starting Translation Processor..."
cd ../translate-api
pm2 start python --name "translation-processor" \
	--output ../../logs/translation-processor-out.log \
	--error ../../logs/translation-processor-err.log \
	-- translation_processor.py

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

# Start Voice Processor (STREAMING v2 - publishes chunks as generated) change back to voice_processor.py if dont need streaming
echo "Starting Voice Processor (Streaming Mode)..."
pm2 start python --name "voice-processor" \
	--output ../../logs/voice-processor-out.log \
	--error ../../logs/voice-processor-err.log \
	-- voice_processor_sentence_chunking.py

# Start Load Balancer
echo "Starting Load Balancer..."
cd ../loadbalancer
pm2 start python --name "loadbalancer" \
	--output ../../logs/loadbalancer-out.log \
	--error ../../logs/loadbalancer-err.log \
	-- loadbalancer.py

echo "All services started!"
pm2 status