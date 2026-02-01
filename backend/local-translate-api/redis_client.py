"""
Centralized Redis client for Pub/Sub operations.
Provides connection pooling and error handling.
"""

import redis.asyncio as redis
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class RedisClient:
    def __init__(self, host='localhost', port=6379, db=0):
        self.host = host
        self.port = port
        self.db = db
        self._client: Optional[redis.Redis] = None
        self._pubsub: Optional[redis.client.PubSub] = None
        
    async def connect(self):
        """Establish Redis connection."""
        if not self._client:
            self._client = await redis.Redis(
                host=self.host,
                port=self.port,
                db=self.db,
                decode_responses=True,  # Auto-decode to strings
                socket_keepalive=True,
                socket_connect_timeout=5,
                retry_on_timeout=True
            )
            logger.info(f"Redis connected: {self.host}:{self.port}")
    
    async def disconnect(self):
        """Close Redis connection."""
        if self._pubsub:
            await self._pubsub.close()
        if self._client:
            await self._client.close()
            logger.info("Redis disconnected")
    
    async def publish(self, channel: str, message: str) -> int:
        """Publish message to channel. Returns number of subscribers."""
        await self.connect()
        return await self._client.publish(channel, message)
    
    async def subscribe(self, *channels):
        """Subscribe to one or more channels."""
        await self.connect()
        self._pubsub = self._client.pubsub()
        await self._pubsub.subscribe(*channels)
        return self._pubsub
    
    async def psubscribe(self, *patterns):
        """Subscribe to channel patterns (e.g., 'room:*:transcription')."""
        await self.connect()
        self._pubsub = self._client.pubsub()
        await self._pubsub.psubscribe(*patterns)
        return self._pubsub
    
    async def ping(self) -> bool:
        """Check if Redis is reachable."""
        try:
            await self.connect()
            return await self._client.ping()
        except Exception as e:
            logger.error(f"Redis ping failed: {e}")
            return False

# Global singleton
_redis_client = None

def get_redis_client():
    global _redis_client
    if not _redis_client:
        _redis_client = RedisClient()
    return _redis_client
