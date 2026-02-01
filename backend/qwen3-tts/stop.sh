#!/bin/bash

# Stop script for qwen3-tts voice cloning services

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Stopping qwen3-tts Voice Cloning Services${NC}"
echo "============================================"

stop_service() {
    local name=$1
    local pid_file=$2
    
    if [ -f "$pid_file" ]; then
        PID=$(cat "$pid_file")
        if kill -0 "$PID" 2>/dev/null; then
            echo -e "Stopping $name (PID: $PID)..."
            kill "$PID"
            sleep 1
            if kill -0 "$PID" 2>/dev/null; then
                echo -e "${YELLOW}Force killing $name...${NC}"
                kill -9 "$PID"
            fi
            echo -e "${GREEN}✓ $name stopped${NC}"
        else
            echo -e "${YELLOW}$name was not running${NC}"
        fi
        rm -f "$pid_file"
    else
        echo -e "${YELLOW}No PID file for $name${NC}"
    fi
}

stop_service "Voice Sample Server" ".voice_server.pid"
stop_service "Voice WebSocket Server" ".voice_ws_server.pid"
stop_service "Voice Processor" ".voice_processor.pid"

echo ""
echo -e "${GREEN}All voice services stopped.${NC}"
