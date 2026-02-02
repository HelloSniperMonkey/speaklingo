"""
API Load Balancer / Gateway for WebRTC Translator
Routes requests to appropriate backend services.

Port: 8089

Routes:
  HTTP:
    /api/translate/* -> Translation API (8766)
    /api/voice/*     -> Voice Server (8712)
    /health          -> Health check
  
  WebSocket:
    /ws/transcription     -> Google Transcription WS (8765)
    /ws/transcription-sub -> Transcription Broadcast WS (8766)  
    /ws/translation       -> Translation WS (8767)
    /ws/voice             -> Voice WS (8768)
"""

import asyncio
import logging
import os
from typing import Dict, Any

import aiohttp
from aiohttp import web, WSMsgType
import aiohttp.client_exceptions

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Service endpoints configuration
SERVICES = {
    "transcription": {
        "ws": os.getenv("TRANSCRIPTION_WS_URL", "ws://localhost:8765"),
        "http": os.getenv("TRANSCRIPTION_HTTP_URL", "http://localhost:8765"),
    },
    "transcription_broadcast": {
        "ws": os.getenv("TRANSCRIPTION_BROADCAST_WS_URL", "ws://localhost:8766"),
        "http": os.getenv("TRANSCRIPTION_BROADCAST_HTTP_URL", "http://localhost:8766"),
    },
    "translation": {
        "ws": os.getenv("TRANSLATION_WS_URL", "ws://localhost:8767"),
        "http": os.getenv("TRANSLATION_HTTP_URL", "http://localhost:8766"),
    },
    "voice": {
        "ws": os.getenv("VOICE_WS_URL", "ws://localhost:8768"),
        "http": os.getenv("VOICE_HTTP_URL", "http://localhost:8712"),
    },
}

# Health check cache
health_status: Dict[str, bool] = {}


# ==================== HTTP Proxy ====================

async def proxy_http(request: web.Request, target_url: str) -> web.Response:
    """Proxy HTTP request to target service."""
    try:
        async with aiohttp.ClientSession() as session:
            # Build target URL with path
            path = request.match_info.get("path", "")
            full_url = f"{target_url}/{path}" if path else target_url
            
            # Add query string if present
            if request.query_string:
                full_url += f"?{request.query_string}"
            
            # Prepare headers (exclude hop-by-hop headers)
            headers = {}
            for key, value in request.headers.items():
                if key.lower() not in ['host', 'connection', 'transfer-encoding']:
                    headers[key] = value
            
            # Get request body
            body = None
            if request.body_exists:
                body = await request.read()
            
            # Make the proxied request
            async with session.request(
                method=request.method,
                url=full_url,
                headers=headers,
                data=body,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                # Read response
                response_body = await resp.read()
                
                # Build response headers
                response_headers = {}
                for key, value in resp.headers.items():
                    if key.lower() not in ['content-encoding', 'transfer-encoding', 'content-length']:
                        response_headers[key] = value
                
                return web.Response(
                    body=response_body,
                    status=resp.status,
                    headers=response_headers,
                )
    except aiohttp.client_exceptions.ClientError as e:
        logger.error(f"Proxy error to {target_url}: {e}")
        return web.json_response(
            {"error": "Service unavailable", "details": str(e)},
            status=503
        )
    except Exception as e:
        logger.error(f"Unexpected proxy error: {e}")
        return web.json_response(
            {"error": "Internal server error", "details": str(e)},
            status=500
        )


# HTTP Route Handlers
async def translate_handler(request: web.Request) -> web.Response:
    """Proxy translation API requests."""
    return await proxy_http(request, SERVICES["translation"]["http"])


async def voice_handler(request: web.Request) -> web.Response:
    """Proxy voice API requests."""
    return await proxy_http(request, SERVICES["voice"]["http"])


async def transcription_handler(request: web.Request) -> web.Response:
    """Proxy transcription API requests."""
    return await proxy_http(request, SERVICES["transcription"]["http"])


# ==================== WebSocket Proxy ====================

async def proxy_websocket(request: web.Request, target_ws_url: str) -> web.WebSocketResponse:
    """Proxy WebSocket connection to target service."""
    ws_client = web.WebSocketResponse()
    await ws_client.prepare(request)
    
    logger.info(f"WebSocket client connected, proxying to {target_ws_url}")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(target_ws_url) as ws_server:
                
                async def forward_client_to_server():
                    """Forward messages from client to upstream server."""
                    async for msg in ws_client:
                        if msg.type == WSMsgType.TEXT:
                            await ws_server.send_str(msg.data)
                        elif msg.type == WSMsgType.BINARY:
                            await ws_server.send_bytes(msg.data)
                        elif msg.type == WSMsgType.CLOSE:
                            await ws_server.close()
                            break
                        elif msg.type == WSMsgType.ERROR:
                            logger.error(f"Client WS error: {ws_client.exception()}")
                            break
                
                async def forward_server_to_client():
                    """Forward messages from upstream server to client."""
                    async for msg in ws_server:
                        if msg.type == WSMsgType.TEXT:
                            await ws_client.send_str(msg.data)
                        elif msg.type == WSMsgType.BINARY:
                            await ws_client.send_bytes(msg.data)
                        elif msg.type == WSMsgType.CLOSE:
                            await ws_client.close()
                            break
                        elif msg.type == WSMsgType.ERROR:
                            logger.error(f"Server WS error: {ws_server.exception()}")
                            break
                
                # Run both forwarding tasks concurrently
                await asyncio.gather(
                    forward_client_to_server(),
                    forward_server_to_client(),
                    return_exceptions=True
                )
    
    except aiohttp.client_exceptions.ClientError as e:
        logger.error(f"WebSocket proxy error to {target_ws_url}: {e}")
        if not ws_client.closed:
            await ws_client.close(code=1011, message=b"Upstream connection failed")
    except Exception as e:
        logger.error(f"Unexpected WebSocket error: {e}")
        if not ws_client.closed:
            await ws_client.close(code=1011, message=str(e).encode())
    
    return ws_client


# WebSocket Route Handlers
async def ws_transcription_handler(request: web.Request) -> web.WebSocketResponse:
    """Proxy transcription WebSocket (for sending audio)."""
    return await proxy_websocket(request, SERVICES["transcription"]["ws"])


async def ws_transcription_sub_handler(request: web.Request) -> web.WebSocketResponse:
    """Proxy transcription broadcast WebSocket (for receiving transcriptions)."""
    return await proxy_websocket(request, SERVICES["transcription_broadcast"]["ws"])


async def ws_translation_handler(request: web.Request) -> web.WebSocketResponse:
    """Proxy translation WebSocket."""
    return await proxy_websocket(request, SERVICES["translation"]["ws"])


async def ws_voice_handler(request: web.Request) -> web.WebSocketResponse:
    """Proxy voice WebSocket."""
    return await proxy_websocket(request, SERVICES["voice"]["ws"])


# ==================== Health & Status ====================

async def health_check_service(name: str, http_url: str) -> bool:
    """Check if a service is healthy."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{http_url}/health",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                return resp.status == 200
    except Exception:
        return False


async def health_handler(request: web.Request) -> web.Response:
    """Health check endpoint that also checks upstream services."""
    services_health = {}
    
    # Check all services
    for name, urls in SERVICES.items():
        try:
            services_health[name] = await health_check_service(name, urls["http"])
        except Exception:
            services_health[name] = False
    
    all_healthy = all(services_health.values())
    
    return web.json_response({
        "status": "ok" if all_healthy else "degraded",
        "service": "loadbalancer",
        "upstreams": services_health,
    }, status=200 if all_healthy else 503)


async def simple_health_handler(request: web.Request) -> web.Response:
    """Simple health check that only checks the load balancer itself."""
    return web.json_response({
        "status": "ok",
        "service": "loadbalancer"
    })


async def config_handler(request: web.Request) -> web.Response:
    """Return current service configuration (for debugging)."""
    return web.json_response({
        "services": SERVICES,
        "routes": {
            "http": {
                "/api/translate/*": "Translation API",
                "/api/voice/*": "Voice Server",
                "/api/transcription/*": "Transcription API",
            },
            "websocket": {
                "/ws/transcription": "Google Transcription (send audio)",
                "/ws/transcription-sub": "Transcription Broadcast (receive)",
                "/ws/translation": "Translation Stream",
                "/ws/voice": "Voice Stream",
            }
        }
    })


# ==================== CORS Middleware ====================

@web.middleware
async def cors_middleware(request: web.Request, handler):
    """Add CORS headers to all responses."""
    # Handle preflight requests
    if request.method == 'OPTIONS':
        response = web.Response(status=204)
    else:
        try:
            response = await handler(request)
        except web.HTTPException as e:
            response = e
    
    # Add CORS headers
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With'
    response.headers['Access-Control-Max-Age'] = '86400'
    
    return response


# ==================== Application Setup ====================

def create_app() -> web.Application:
    """Create and configure the application."""
    app = web.Application(middlewares=[cors_middleware])
    
    # Health/Status routes
    app.router.add_get('/health', simple_health_handler)
    app.router.add_get('/health/full', health_handler)
    app.router.add_get('/config', config_handler)
    
    # HTTP API routes
    app.router.add_route('*', '/api/translate', translate_handler)
    app.router.add_route('*', '/api/translate/{path:.*}', translate_handler)
    app.router.add_route('*', '/api/voice', voice_handler)
    app.router.add_route('*', '/api/voice/{path:.*}', voice_handler)
    app.router.add_route('*', '/api/transcription', transcription_handler)
    app.router.add_route('*', '/api/transcription/{path:.*}', transcription_handler)
    
    # WebSocket routes
    app.router.add_get('/ws/transcription', ws_transcription_handler)
    app.router.add_get('/ws/transcription-sub', ws_transcription_sub_handler)
    app.router.add_get('/ws/translation', ws_translation_handler)
    app.router.add_get('/ws/voice', ws_voice_handler)
    
    return app


def main():
    """Run the load balancer server."""
    host = os.getenv("LB_HOST", "0.0.0.0")
    port = int(os.getenv("LB_PORT", 8089))
    
    logger.info(f"Starting Load Balancer on {host}:{port}")
    logger.info("Service Configuration:")
    for name, urls in SERVICES.items():
        logger.info(f"  {name}: HTTP={urls['http']}, WS={urls['ws']}")
    
    app = create_app()
    web.run_app(app, host=host, port=port)


if __name__ == "__main__":
    main()
