"""
WebSocket server for broadcasting translations to clients.
Subscribes to Redis translation channel and pushes to connected clients.
"""

import asyncio
import json
import logging
from typing import Set
import websockets
from websockets.server import WebSocketServerProtocol

from redis_client import get_redis_client
from config import Config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Track connected clients per room
room_clients: dict[str, Set[WebSocketServerProtocol]] = {}

async def handle_client(websocket: WebSocketServerProtocol):
    """Handle individual WebSocket client connection."""
    room_id = None
    
    try:
        # Wait for initial join message
        message = await websocket.recv()
        data = json.loads(message)
        
        if data.get('command') == 'join':
            room_id = data.get('roomId')
            if not room_id:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'roomId required'
                }))
                return
            
            # Add client to room
            if room_id not in room_clients:
                room_clients[room_id] = set()
            room_clients[room_id].add(websocket)
            
            logger.info(f"Client joined room {room_id}. Total: {len(room_clients[room_id])}")
            
            await websocket.send(json.dumps({
                'type': 'status',
                'status': 'connected',
                'roomId': room_id,
                'service': 'translation-stream'
            }))
            
            # Keep connection alive
            async for msg in websocket:
                # Handle ping/pong or other commands
                try:
                    cmd_data = json.loads(msg)
                    if cmd_data.get('command') == 'ping':
                        await websocket.send(json.dumps({'type': 'pong'}))
                except:
                    pass
    
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Client disconnected from room {room_id}")
    except Exception as e:
        logger.error(f"Client error: {e}")
    finally:
        # Remove client from room
        if room_id and room_id in room_clients:
            room_clients[room_id].discard(websocket)
            if not room_clients[room_id]:
                del room_clients[room_id]
            logger.info(f"Client removed from room {room_id}")

async def redis_subscriber():
    """
    Background task that subscribes to Redis translation channels
    and broadcasts to WebSocket clients.
    """
    redis_client = get_redis_client()
    
    try:
        # Subscribe to all translation channels using pattern
        pubsub = await redis_client.psubscribe('room:*:translation')
        logger.info("Subscribed to Redis pattern: room:*:translation")
        
        async for message in pubsub.listen():
            if message['type'] == 'pmessage':
                channel = message['channel']
                data_str = message['data']
                
                # Extract roomId from channel name
                # Channel format: room:{roomId}:translation
                parts = channel.split(':')
                if len(parts) >= 3:
                    room_id = parts[1]
                    
                    # Broadcast to all clients in this room
                    if room_id in room_clients:
                        clients = room_clients[room_id].copy()
                        logger.info(f"Broadcasting to {len(clients)} clients in room {room_id}")
                        
                        # Send to all clients concurrently
                        await asyncio.gather(
                            *[client.send(data_str) for client in clients],
                            return_exceptions=True
                        )
    
    except Exception as e:
        logger.error(f"Redis subscriber error: {e}")
        # Implement exponential backoff retry
        await asyncio.sleep(5)
        # Restart subscriber
        asyncio.create_task(redis_subscriber())

async def main():
    """Main server entry point."""
    # Start Redis subscriber in background
    subscriber_task = asyncio.create_task(redis_subscriber())
    
    # Start WebSocket server
    logger.info(f"Starting Translation WebSocket server on {Config.WS_HOST}:{Config.WS_PORT}")
    
    async with websockets.serve(
        handle_client,
        Config.WS_HOST,
        Config.WS_PORT,
        ping_interval=30,
        ping_timeout=10
    ):
        await asyncio.Future()  # Run forever

if __name__ == '__main__':
    asyncio.run(main())
