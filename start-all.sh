#!/bin/bash

# Start Docker Compose
echo "Starting Docker Compose..."
docker compose up -d && echo "Docker Compose started successfully"

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

# Start Transcription Server
echo "Starting Transcription Server..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/backend/google-backend
pm2 start python --name "transcription-server" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/transcription-server-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/transcription-server-err.log \
	-- transcription_server.py

# Start Translation Processor
echo "Starting Translation Processor..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/backend/translate-api
pm2 start python --name "translation-processor" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/translation-processor-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/translation-processor-err.log \
	-- translation_processor.py

# Start Translation WebSocket Server
echo "Starting Translation WebSocket Server..."
pm2 start python --name "translation-ws-server" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/translation-ws-server-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/translation-ws-server-err.log \
	-- translation_ws_server.py

# Start Voice Server
echo "Starting Voice Server..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/backend/qwen3-tts-mlx
# source /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/backend/qwen3-tts/.venv/bin/activate 
pm2 start python --name "voice-server" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/voice-server-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/voice-server-err.log \
	-- voice_server.py

# Start Transcription Broadcast Server
echo "Starting Transcription Broadcast Server..."
cd ../google-backend
pm2 start python --name "transcription-broadcast" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/transcription-broadcast-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/transcription-broadcast-err.log \
	-- transcription_broadcast_server.py

# Start Voice WebSocket Server
echo "Starting Voice WebSocket Server..."
cd ../qwen3-tts-mlx
pm2 start python --name "voice-ws-server" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/voice-ws-server-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/voice-ws-server-err.log \
	-- voice_ws_server.py

# Start Voice Processor
echo "Starting Voice Processor..."
pm2 start python --name "voice-processor" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/voice-processor-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/voice-processor-err.log \
	-- voice_processor.py

# Start Load Balancer
echo "Starting Load Balancer..."
cd /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/backend/loadbalancer
pm2 start python --name "loadbalancer" \
	--output /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/loadbalancer-out.log \
	--error /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/logs/loadbalancer-err.log \
	-- loadbalancer.py

echo "All services started!"
pm2 status