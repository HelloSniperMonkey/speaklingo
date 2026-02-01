#!/bin/bash

# Start script for qwen3-tts voice cloning services
# Requires Redis to be running on port 6379

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting qwen3-tts Voice Cloning Services${NC}"
echo "============================================"

# Check Redis
# echo -e "${YELLOW}Checking Redis connection...${NC}"
# if redis-cli ping > /dev/null 2>&1; then
#     echo -e "${GREEN}✓ Redis is running${NC}"
# else
#     echo -e "${RED}✗ Redis is not running. Start it with: redis-server${NC}"
#     exit 1
# fi

# Create virtual environment if it doesn't exist
if [ ! -d "../.venv" ]; then
    echo -e "${YELLOW}Creating virtual environment...${NC}"
    python3 -m venv ../.venv
fi

# Activate virtual environment
source ../.venv/bin/activate

# Install dependencies
# echo -e "${YELLOW}Installing dependencies...${NC}"
# pip install -q -r requirements.txt

# Start services in background
echo ""
echo -e "${GREEN}Starting services...${NC}"

# 1. Voice Sample Server (port 8712)
echo -e "${YELLOW}Starting Voice Sample Server on port 8712...${NC}"
python voice_server.py > ../logs/voice_server.log 2>&1 &
VOICE_SERVER_PID=$!
echo "  PID: $VOICE_SERVER_PID"

# Wait for voice server to start
sleep 2

# 2. Voice WebSocket Server (port 8768)
echo -e "${YELLOW}Starting Voice WebSocket Server on port 8768...${NC}"
python voice_ws_server.py > ../logs/voice_ws_server.log 2>&1 &
VOICE_WS_PID=$!
echo "  PID: $VOICE_WS_PID"

# Wait for WS server to start
sleep 1

# 3. Voice Processor Worker
echo -e "${YELLOW}Starting Voice Processor Worker...${NC}"
python voice_processor.py > ../logs/voice_processor.log 2>&1 &
VOICE_PROCESSOR_PID=$!
echo "  PID: $VOICE_PROCESSOR_PID"

# Save PIDs for stop script
echo "$VOICE_SERVER_PID" > .voice_server.pid
echo "$VOICE_WS_PID" > .voice_ws_server.pid
echo "$VOICE_PROCESSOR_PID" > .voice_processor.pid

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}All voice services started!${NC}"
echo ""
echo "Services running:"
echo "  - Voice Sample Server:    http://localhost:8712"
echo "  - Voice WebSocket Server: ws://localhost:8768"
echo "  - Voice Processor:        (background worker)"
echo ""
echo "Logs:"
echo "  - ../logs/voice_server.log"
echo "  - ../logs/voice_ws_server.log"
echo "  - ../logs/voice_processor.log"
echo ""
echo -e "To stop: ${YELLOW}./stop.sh${NC}"
