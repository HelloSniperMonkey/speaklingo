Performance Issues Found
Critical Issues:
1. New Redis connection per call (voice_processor.py:79) - 10-50ms overhead per request
2. Only 2 thread workers (voice_processor.py:36) - blocks under load
3. Sequential chunk publishing (voice_processor.py:258-280) - accumulates latency
4. No voice sample caching (voice_processor.py:87,109) - 2-3x redundant I/O
5. Blocking ffmpeg subprocess in voice_server.py - blocks all requests during conversion
Moderate Issues:
6. No WebSocket connection limits - DoS vulnerability
7. Unbounded memory caches - OOM risk  
8. Manual string parsing for channels - fragile parsing logic
Quick Wins:
- Increase max_workers=8 in voice_processor.py
- Cache decoded voice samples with LRU
- Batch Redis publishes with asyncio.gather()
- Use ProcessPoolExecutor for MLX operations
- Add async subprocess for ffmpeg conversions
Would you like me to implement these optimizations?