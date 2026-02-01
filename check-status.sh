#!/bin/bash
# Diagnostic script to check all services

echo "🔍 WebRTC Translator Service Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Redis
echo "📦 Redis:"
if docker ps | grep -q webrtc-translator-redis; then
    echo "   ✅ Redis running (port 6379)"
    echo "   🌐 Redis GUI: http://localhost:8081"
else
    echo "   ❌ Redis not running"
    echo "   Fix: docker compose up -d"
fi
echo ""

# Check Transcription Server
echo "🎤 Transcription Server:"
if lsof -i :8765 > /dev/null 2>&1; then
    PID=$(lsof -ti :8765)
    echo "   ✅ Running on port 8765 (PID: $PID)"
else
    echo "   ❌ Not running"
    echo "   Fix: cd backend/google-backend && source venv/bin/activate && python transcription_server.py &"
fi
echo ""

# Check Translation Processor
echo "🌐 Translation Processor:"
if ps aux | grep -v grep | grep -q "translation_processor.py"; then
    PID=$(ps aux | grep -v grep | grep "translation_processor.py" | awk '{print $2}')
    echo "   ✅ Running (PID: $PID)"
else
    echo "   ❌ Not running"
    echo "   Fix: cd backend/translate-api && source .venv/bin/activate && python translation_processor.py &"
fi
echo ""

# Check Translation WebSocket
echo "🔌 Translation WebSocket:"
if lsof -i :8767 > /dev/null 2>&1; then
    PID=$(lsof -ti :8767)
    echo "   ✅ Running on port 8767 (PID: $PID)"
else
    echo "   ❌ Not running"
    echo "   Fix: cd backend/translate-api && source .venv/bin/activate && python translation_ws_server.py &"
fi
echo ""

# Check Frontend
echo "🎨 Frontend:"
if lsof -i :3000 > /dev/null 2>&1; then
    PID=$(lsof -ti :3000)
    echo "   ✅ Running on port 3000 (PID: $PID)"
    echo "   🌐 URL: http://localhost:3000"
else
    echo "   ❌ Not running"
    echo "   Fix: cd frontend && npm run dev"
fi
echo ""

# Check Gemini API Key
echo "🔑 Gemini API Key:"
if [ -f "backend/translate-api/.env" ]; then
    if grep -q "your_api_key_here" backend/translate-api/.env; then
        echo "   ❌ Not configured (still has placeholder)"
        echo "   Fix: Edit backend/translate-api/.env and add your Gemini API key"
    elif grep -q "GEMINI_API_KEY=" backend/translate-api/.env; then
        KEY=$(grep "GEMINI_API_KEY=" backend/translate-api/.env | cut -d'=' -f2)
        if [ -n "$KEY" ] && [ "$KEY" != "your_api_key_here" ]; then
            echo "   ✅ Configured"
        else
            echo "   ❌ Empty or placeholder"
        fi
    else
        echo "   ❌ Not found in .env"
    fi
else
    echo "   ❌ .env file not found"
fi
echo ""

# Test Redis Connection
echo "🔗 Redis Connection Test:"
if docker exec webrtc-translator-redis redis-cli ping > /dev/null 2>&1; then
    echo "   ✅ Redis responding to PING"
else
    echo "   ❌ Redis not responding"
fi
echo ""

# Recent logs
echo "📋 Recent Activity:"
echo ""
echo "Translation Processor (last 3 lines):"
tail -3 logs/translation_processor.log 2>/dev/null || echo "   No logs found"
echo ""
echo "Translation WebSocket (last 3 lines):"
tail -3 logs/translation_ws.log 2>/dev/null || echo "   No logs found"
echo ""
echo "Transcription (last 3 lines):"
tail -3 logs/transcription.log 2>/dev/null || echo "   No logs found"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Run './start-all.sh' to start all services"
echo "Run './stop-all.sh' to stop all services"
