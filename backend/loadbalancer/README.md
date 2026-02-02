# Load Balancer / API Gateway

Routes all frontend API requests to appropriate backend services.

## Port: 8089

## Routes

### HTTP Routes
| Route | Target Service | Port |
|-------|---------------|------|
| `/api/translate/*` | Translation API | 8766 |
| `/api/voice/*` | Voice Server | 8712 |
| `/api/transcription/*` | Transcription API | 8765 |
| `/health` | Health check | - |
| `/health/full` | Full health (checks upstreams) | - |
| `/config` | Show configuration | - |

### WebSocket Routes
| Route | Target Service | Port |
|-------|---------------|------|
| `/ws/transcription` | Google Transcription (send audio) | 8765 |
| `/ws/transcription-sub` | Transcription Broadcast (receive) | 8766 |
| `/ws/translation` | Translation Stream | 8767 |
| `/ws/voice` | Voice Stream | 8768 |

## Usage

```bash
# Install dependencies
pip install -r requirements.txt

# Start
./start.sh

# Or directly
python loadbalancer.py
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LB_HOST` | `0.0.0.0` | Host to bind to |
| `LB_PORT` | `8089` | Port to listen on |
| `TRANSCRIPTION_WS_URL` | `ws://localhost:8765` | Transcription WebSocket |
| `TRANSCRIPTION_HTTP_URL` | `http://localhost:8765` | Transcription HTTP |
| `TRANSCRIPTION_BROADCAST_WS_URL` | `ws://localhost:8766` | Transcription broadcast WS |
| `TRANSLATION_WS_URL` | `ws://localhost:8767` | Translation WebSocket |
| `TRANSLATION_HTTP_URL` | `http://localhost:8766` | Translation HTTP |
| `VOICE_WS_URL` | `ws://localhost:8768` | Voice WebSocket |
| `VOICE_HTTP_URL` | `http://localhost:8712` | Voice HTTP |

## Remote Access

When using Cloudflare Tunnel:
- Frontend connects to `meetapi.snipermonkey.in` (routed to load balancer port 8089)
- Load balancer routes to local services
