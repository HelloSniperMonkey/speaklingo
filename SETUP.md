# WebRTC Translator - Event-Driven Architecture Setup

## Overview

This project uses a **Redis Pub/Sub** event-driven architecture for real-time translation:

- **Transcription Service** (port 8765): Google Speech-to-Text WebSocket server
- **Translation Processor** (background): Subscribes to transcriptions, translates via Gemini
- **Translation WebSocket** (port 8767): Broadcasts translations to frontend
- **Redis** (port 6379): Message broker for Pub/Sub communication

## Architecture Flow

```
Audio → Transcription WS (8765) → Redis → Translation Processor
                 ↓                            ↓
            Frontend ←────────────────── Translation WS (8767)
```

## Quick Start

### 1. Start Redis (Docker)

```bash
# Start Redis in the background
docker compose up -d

# Verify Redis is running
docker ps | grep redis
```

### 2. Setup Google Backend (Transcription Service)

```bash
cd backend/google-backend

# Activate virtual environment (or create one)
source .venv/bin/activate  # or: python3 -m venv .venv && source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start transcription server
python transcription_server.py
```

**Running on:** `ws://localhost:8765`

### 3. Setup Translation API

```bash
cd backend/translate-api

# Setup virtual environment and install dependencies
./setup.sh

# OR manually:
# python3 -m venv .venv
# source .venv/bin/activate
# pip install -r requirements.txt

# Add your Gemini API key to .env
# Edit .env and set: GEMINI_API_KEY=your_actual_key_here

# Start Translation Processor (background worker)
python translation_processor.py &

# Start Translation WebSocket Server
python translation_ws_server.py
```

**Running on:** 
- Translation Processor (subscribes to Redis)
- Translation WebSocket: `ws://localhost:8767`

### 4. Start Frontend

```bash
cd frontend

# Install dependencies (if not already done)
npm install

# Build latest changes
npm run build

# Start development server
npm run dev
```

**Running on:** `http://localhost:3000`

## Full Startup Script

Create a script to start all services:

```bash
#!/bin/bash
# start-all.sh

# Start Redis
docker compose up -d

# Start Google Backend
cd backend/google-backend
source .venv/bin/activate
python transcription_server.py &
cd ../..

# Start Translation Services
cd backend/translate-api
source .venv/bin/activate
python translation_processor.py &
python translation_ws_server.py &
cd ../..

# Start Frontend
cd frontend
npm run dev

echo "All services started!"
echo "Frontend: http://localhost:3000"
echo "Transcription WS: ws://localhost:8765"
echo "Translation WS: ws://localhost:8767"
echo "Redis: localhost:6379"
```

## Redis Channels

### Transcription Channel
**Pattern:** `room:{roomId}:transcription`

**Example:** `room:abc123:transcription`

**Payload:**
```json
{
  "type": "transcription",
  "roomId": "abc123",
  "userId": "local-user",
  "sessionId": "140234567890",
  "text": "Hello, how are you?",
  "language": "en-US",
  "isFinal": true,
  "confidence": 0.95,
  "timestamp": 1737900000000,
  "processingTime": 0.123
}
```

### Translation Channel
**Pattern:** `room:{roomId}:translation`

**Example:** `room:abc123:translation`

**Payload:**
```json
{
  "type": "translation",
  "roomId": "abc123",
  "userId": "local-user",
  "sessionId": "140234567890",
  "originalText": "नमस्ते",
  "translatedText": "Hello",
  "sourceLanguage": "hi",
  "targetLanguage": "en",
  "isFinal": true,
  "timestamp": 1737900000150,
  "latencyMs": 234,
  "metadata": {
    "transcriptionTimestamp": 1737900000000,
    "totalLatencyMs": 357,
    "cacheHit": false
  }
}
```

## Testing

### Test Redis Connection

```bash
# Install Redis CLI
docker exec -it webrtc-translator-redis redis-cli

# Subscribe to all transcription channels
PSUBSCRIBE room:*:transcription

# In another terminal, publish a test message
docker exec -it webrtc-translator-redis redis-cli
PUBLISH room:test123:transcription '{"text":"hello"}'
```

### Monitor All Events

```bash
# Monitor all Redis activity
docker exec -it webrtc-translator-redis redis-cli MONITOR
```

## Troubleshooting

### Redis not connecting
```bash
# Check if Redis container is running
docker ps | grep redis

# Restart Redis
docker compose down
docker compose up -d

# Check logs
docker logs webrtc-translator-redis
```

### Translation not appearing
1. **Check Translation Processor is running**
   ```bash
   ps aux | grep translation_processor
   ```

2. **Check Translation WebSocket is running**
   ```bash
   ps aux | grep translation_ws_server
   # Or check if port 8767 is in use
   lsof -i :8767
   ```

3. **Check Redis Pub/Sub**
   ```bash
   # Subscribe to translation channel
   docker exec -it webrtc-translator-redis redis-cli
   PSUBSCRIBE room:*:translation
   ```

4. **Check frontend WebSocket connection**
   - Open browser console
   - Look for "Connected to Translation Stream" message

### Port conflicts

- **8765**: Transcription WebSocket
- **8766**: Translation HTTP API (fallback, not used in event-driven mode)
- **8767**: Translation WebSocket
- **6379**: Redis
- **3000**: Frontend

Kill processes on specific ports:
```bash
# macOS/Linux
lsof -ti :8767 | xargs kill -9

# Or
kill -9 $(lsof -ti :8767)
```

## Environment Variables

### backend/google-backend/.env
```env
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credential-videoapp.json
REDIS_HOST=localhost
REDIS_PORT=6379
```

### backend/translate-api/.env
```env
GEMINI_API_KEY=your_gemini_api_key_here
REDIS_HOST=localhost
REDIS_PORT=6379
WS_PORT=8767
```

## Development Tips

### Rebuild frontend after changes
```bash
cd frontend
npm run build
```

### Watch Redis messages in real-time
```bash
docker exec -it webrtc-translator-redis redis-cli MONITOR
```

### Check all running services
```bash
# Check all Node processes
ps aux | grep node

# Check all Python processes
ps aux | grep python

# Check all listening ports
lsof -i -P | grep LISTEN
```

### Stop all services
```bash
# Stop Redis
docker compose down

# Kill all Python processes (careful!)
pkill -f "python.*transcription_server"
pkill -f "python.*translation"

# Kill frontend
pkill -f "next dev"
```

## Production Considerations

1. **Use process managers**:
   - PM2 for Node.js
   - Supervisor/systemd for Python services

2. **Redis persistence**: Already configured in docker-compose.yml with AOF

3. **Health checks**: Each service should expose `/health` endpoint

4. **Monitoring**: Add Prometheus metrics for:
   - Redis publish/subscribe rates
   - Translation latency
   - WebSocket connection counts

5. **Error handling**: Circuit breakers for Redis failures

6. **Scaling**: Run multiple translation processors for load distribution

## License

See main project README
