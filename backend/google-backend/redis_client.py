"""
Centralized Redis client for Pub/Sub operations.
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
        
    async def connect(self):
        """Establish Redis connection."""
        if not self._client:
            self._client = await redis.Redis(
                host=self.host,
                port=self.port,
                db=self.db,
                decode_responses=True,
                socket_keepalive=True,
                socket_connect_timeout=5,
                retry_on_timeout=True
            )
            logger.info(f"Redis connected: {self.host}:{self.port}")
    
    async def disconnect(self):
        """Close Redis connection."""
        if self._client:
            await self._client.close()
            logger.info("Redis disconnected")
    
    async def publish(self, channel: str, message: str) -> int:
        """Publish message to channel. Returns number of subscribers."""
        try:
            await self.connect()
            return await self._client.publish(channel, message)
        except Exception as e:
            logger.error(f"Redis publish failed: {e}")
            return 0
    
    async def ping(self) -> bool:
        """Check if Redis is reachable."""
        try:
            await self.connect()
            return await self._client.ping()
        except Exception as e:
            logger.error(f"Redis ping failed: {e}")
            return False
    
    async def pubsub(self):
        """Get a pub/sub object for subscribing to channels."""
        await self.connect()
        return self._client.pubsub()

# Global singleton
_redis_client = None

def get_redis_client():
    global _redis_client
    if not _redis_client:
        _redis_client = RedisClient()
    return _redis_client
