"""Configuration management."""

import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Redis
    REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
    REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
    REDIS_DB = int(os.getenv('REDIS_DB', 0))
    
    # WebSocket Server
    WS_HOST = os.getenv('WS_HOST', '0.0.0.0')
    WS_PORT = int(os.getenv('WS_PORT', 8767))
    
    # Translation API
    GROQ_API_KEY = os.getenv('GROQ_API_KEY')
    
    # Timeouts
    REDIS_TIMEOUT = 5  # seconds
    TRANSLATION_TIMEOUT = 10  # seconds
