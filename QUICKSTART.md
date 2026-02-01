# WebRTC Translator - Quick Reference

## 🚀 Quick Start

```bash
# 1. Add Gemini API key
echo "GEMINI_API_KEY=your_key_here" > backend/translate-api/.env

# 2. Start all services
./start-all.sh

# 3. Open browser
open http://localhost:3000
```

## 🛑 Stop Services

```bash
./stop-all.sh
```

## 📡 Service Ports

| Service | Port | Type | Description |
|---------|------|------|-------------|
| Frontend | 3000 | HTTP | Next.js app |
| Transcription | 8765 | WebSocket | Google Speech-to-Text |
| Translation WS | 8767 | WebSocket | Translation stream |
| Translation API | 8766 | HTTP | Fallback REST API |
| Redis | 6379 | TCP | Message broker |

## 🔍 Check Services

```bash
# Check if all services are running
lsof -i :3000,8765,8766,8767,6379

# Check Redis
docker ps | grep redis

# Check Python processes
ps aux | grep python | grep -E "(transcription|translation)"

# Monitor Redis messages
docker exec -it webrtc-translator-redis redis-cli MONITOR
```

## 📋 Logs

```bash
# View transcription logs
tail -f logs/transcription.log

# View translation processor logs
tail -f logs/translation_processor.log

# View translation WebSocket logs
tail -f logs/translation_ws.log

# View Redis logs
docker logs -f webrtc-translator-redis
```

## 🐛 Debugging

### Test Redis Pub/Sub

```bash
# Terminal 1: Subscribe to transcriptions
docker exec -it webrtc-translator-redis redis-cli
PSUBSCRIBE room:*:transcription

# Terminal 2: Publish test message
docker exec -it webrtc-translator-redis redis-cli
PUBLISH room:test123:transcription '{"text":"test","isFinal":true,"roomId":"test123"}'
```

### Test Translation Flow

```bash
# Terminal 1: Monitor all Redis activity
docker exec -it webrtc-translator-redis redis-cli MONITOR

# Terminal 2: Use the app and speak
# Watch messages flow through Redis
```

### Frontend Console Debugging

Open browser DevTools console and look for:
- "Connected to Transcription Server"
- "Connected to Translation Stream"
- WebSocket message logs

## 🔧 Common Issues

| Issue | Solution |
|-------|----------|
| Translation not appearing | Check Gemini API key in `.env` |
| Redis connection failed | Run `docker compose up -d` |
| Port already in use | Kill process: `lsof -ti :PORT \| xargs kill -9` |
| Frontend not building | Run `cd frontend && npm install` |
| No transcription | Check Google credentials |

## 📚 Architecture

```
┌─────────────┐
│  Frontend   │ ← ws://localhost:8765 (transcription)
│ (Port 3000) │ ← ws://localhost:8767 (translation)
└─────────────┘
       ↓
┌──────────────────────────────────────┐
│           Redis Pub/Sub              │
│  room:{roomId}:transcription    →    │
│  room:{roomId}:translation      →    │
└──────────────────────────────────────┘
       ↑                          ↑
       │                          │
┌──────┴─────────┐     ┌──────────┴──────────┐
│ Transcription  │     │ Translation         │
│ Server         │     │ Processor +         │
│ (Port 8765)    │     │ WebSocket (8767)    │
│                │     │                     │
│ Google Speech  │     │ Gemini 2.0 Flash    │
└────────────────┘     └─────────────────────┘
```

## 🔑 Environment Setup

### backend/google-backend/.env
```env
GOOGLE_APPLICATION_CREDENTIALS=./credential-videoapp.json
```

### backend/translate-api/.env  
```env
GEMINI_API_KEY=your_actual_api_key_here
REDIS_HOST=localhost
REDIS_PORT=6379
WS_PORT=8767
```

## 📝 Development Workflow

```bash
# Make changes to frontend
cd frontend
npm run build

# Restart translation processor
pkill -f translation_processor
cd backend/translate-api
source .venv/bin/activate
python translation_processor.py &

# Restart translation WebSocket
pkill -f translation_ws_server
python translation_ws_server.py &
```

## 🚢 Production Deployment

1. Use process managers (PM2, systemd)
2. Set up proper logging (not just stdout)
3. Configure health checks
4. Use Redis Sentinel for HA
5. Add monitoring (Prometheus/Grafana)
6. Set up alerts for service failures

## 📖 More Info

- Full setup: `SETUP.md`
- Translation guide: `TRANSLATION_SETUP.md`
- Project README: `README.md`
