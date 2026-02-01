#!/usr/bin/env python3
"""
WebSocket server for broadcasting transcriptions to room members.
Subscribes to Redis pub/sub and relays transcription messages to connected clients.
"""

import asyncio
import json
import logging
import os
import websockets
from websockets.server import WebSocketServerProtocol
from redis_client import get_redis_client

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Track connected clients by room
room_clients: dict[str, set[WebSocketServerProtocol]] = {}


async def subscribe_to_room(room_id: str):
    """Subscribe to a room's transcription channel and broadcast to clients."""
    redis_client = get_redis_client()
    pubsub = await redis_client.pubsub()  # await the async pubsub method
    channel = f"room:{room_id}:transcription"
    
    await pubsub.subscribe(channel)
    logger.info(f"Subscribed to Redis channel: {channel}")
    
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                
                # Broadcast to all clients in this room
                if room_id in room_clients:
                    disconnected = set()
                    for client in room_clients[room_id]:
                        try:
                            await client.send(data)
                        except websockets.exceptions.ConnectionClosed:
                            disconnected.add(client)
                    
                    # Remove disconnected clients
                    room_clients[room_id] -= disconnected
                    
                    # If no clients left, unsubscribe
                    if not room_clients[room_id]:
                        logger.info(f"No clients left in room {room_id}, unsubscribing")
                        await pubsub.unsubscribe(channel)
                        del room_clients[room_id]
                        return
    except Exception as e:
        logger.error(f"Error in room subscription {room_id}: {e}")
    finally:
        await pubsub.unsubscribe(channel)


async def handle_client(websocket: WebSocketServerProtocol):
    """Handle a WebSocket client connection."""
    client_id = str(id(websocket))
    room_id = None
    subscription_task = None
    
    logger.info(f"Client connected: {client_id}")
    
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                command = data.get("command")
                
                if command == "subscribe":
                    new_room_id = data.get("roomId")
                    if new_room_id:
                        # Leave old room if any
                        if room_id and room_id in room_clients:
                            room_clients[room_id].discard(websocket)
                            if not room_clients[room_id]:
                                del room_clients[room_id]
                        
                        room_id = new_room_id
                        
                        # Join new room
                        if room_id not in room_clients:
                            room_clients[room_id] = set()
                            # Start subscription task for this room
                            subscription_task = asyncio.create_task(subscribe_to_room(room_id))
                        
                        room_clients[room_id].add(websocket)
                        logger.info(f"Client {client_id} subscribed to room {room_id}")
                        
                        await websocket.send(json.dumps({
                            "type": "status",
                            "status": "subscribed",
                            "roomId": room_id
                        }))
                        
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON from client {client_id}")
            except Exception as e:
                logger.error(f"Error handling message from {client_id}: {e}")
                
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Client disconnected: {client_id}")
    except Exception as e:
        logger.error(f"Client error {client_id}: {e}")
    finally:
        # Clean up
        if room_id and room_id in room_clients:
            room_clients[room_id].discard(websocket)
            if not room_clients[room_id]:
                del room_clients[room_id]
        logger.info(f"Client {client_id} cleaned up")


async def main():
    """Main entry point."""
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8766))
    
    logger.info(f"Starting Transcription Broadcast server on {host}:{port}")
    
    async with websockets.serve(
        handle_client,
        host,
        port,
        ping_interval=30,
        ping_timeout=10,
    ):
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())
