# Issues & Fixes

## Fixed Issues (Feb 2, 2026)

### 1. ✅ Audio Playback Bug - Two sentences spoken rapidly not playing
**Root Cause:** GPU contention when running concurrent TTS generations with MLX.
- ThreadPoolExecutor had `max_workers=2`, allowing 2 TTS operations to run simultaneously
- MLX GPU throws `failed assertion 'encodeSignalEvent:value: with uncommitted encoder'` when competing for GPU
- Voice processor crashed, losing both audio generations

**Fix:**
- Changed to `max_workers=1` in voice_processor.py
- Added asyncio Queue system to serialize ALL TTS requests
- Requests are now processed one-at-a-time, preventing GPU crashes
- Queue tracks pending requests and skips already-cancelled ones

### 2. ✅ Voice Separation for 2-Way Communication
**Issue:** Both users were using the same `intro_user.wav` voice sample regardless of who spoke.

**Fix:**
- Added `targetUserId` concept for 2-way voice routing:
  - When User A (local-user) speaks → use User B's (remote-user) voice for TTS
  - When User B (remote-user) speaks → use User A's (local-user) voice for TTS
- Translation processor now sets `targetUserId` as the opposite of `userId`
- Voice processor uses `targetUserId` to look up the correct voice sample
- Frontend filters audio playback based on `targetUserId` (only plays audio targeted for current user)

**Files Changed:**
- `backend/qwen3-tts-mlx/voice_processor.py` - Queue system, voice sample lookup with targetUserId
- `backend/translate-api/translation_processor.py` - Added targetUserId to translation messages
- `frontend/hooks/useProcessedVoice.ts` - Updated filtering logic for targetUserId

---

## Previous Performance Issues Found

Critical Issues:
1. ~~New Redis connection per call (voice_processor.py:79) - 10-50ms overhead per request~~ (uses get_redis_client now)
2. ~~Only 2 thread workers (voice_processor.py:36) - blocks under load~~ **FIXED**: Now uses 1 worker + queue to prevent crashes
3. Sequential chunk publishing (voice_processor.py:258-280) - accumulates latency
4. No voice sample caching (voice_processor.py:87,109) - 2-3x redundant I/O
5. Blocking ffmpeg subprocess in voice_server.py - blocks all requests during conversion

Moderate Issues:
6. No WebSocket connection limits - DoS vulnerability
7. Unbounded memory caches - OOM risk  
8. Manual string parsing for channels - fragile parsing logic

Quick Wins (Still TODO):
- Cache decoded voice samples with LRU
- Batch Redis publishes with asyncio.gather()
- Add async subprocess for ffmpeg conversions