# Continuous Translation Architecture

## Overview

This document describes the **sliding window continuous translation** system that provides lower latency compared to the silence-based finalization approach.

## Architecture Comparison

### Old Approach (Silence-Based)
```
User speaks: "Hello my friend. How are you today?"
              |---------- Speaking ------------|  |-- Silence --|
              
Timeline:     0s       2s       4s       6s      7s (250ms silence detected)
              
Translation starts:                              ↓ Here (after silence)
TTS starts:                                      ↓ Here (after translation)
Audio plays:                                        ↓ Here (~2-4s delay)
```

**Latency: 2-4 seconds from end of speech to audio**

### New Approach (Continuous Chunks)
```
User speaks: "Hello my friend. How are you today?"
              |--- 2s ---|--- 2s ---|--- 2s ---|
              
Timeline:     0s       2s       4s       6s
              ↓         ↓         ↓
              Chunk1    Chunk2    Chunk3
              
Translation: Instant   +Context  +Context
TTS:         Generate  Generate  Generate
Audio:       Play      Queue     Queue
```

**Latency: ~2 seconds from speech to audio (consistent)**

## How It Works

### 1. Transcription Server (`transcription_server_continuous.py`)
- Receives audio from WebSocket
- Google STT provides interim results continuously
- Every **2 seconds**, emits a chunk with:
  - `context`: Previous 4 seconds of text (already translated)
  - `newText`: Current 2 seconds (to translate)
  - `fullText`: Complete accumulated transcription

### 2. Translation Processor (`translation_processor_continuous.py`)
- Receives chunks via Redis pubsub
- Uses **context** for coherent translation
- Only translates **newText** (not context)
- Prompt engineering trick:
  ```
  [CONTEXT - Already translated, for reference]:
  "Hello my friend"
  
  [NEW TEXT - Translate ONLY this]:
  "how are you today"
  
  Translation: "¿cómo estás hoy?"
  ```
- Immediately publishes to TTS

### 3. Voice Processor (`voice_processor_continuous.py`)
- Receives translations via Redis pubsub
- Generates audio for each short chunk (~2-3 seconds of speech)
- Publishes with sequence numbers for proper ordering
- No sentence splitting needed (chunks are already short)

## Configuration

### Chunk Interval
```python
CHUNK_INTERVAL_SECONDS = 2.0  # Emit every 2 seconds
```

### Context Window
```python
CONTEXT_WINDOW_SECONDS = 4.0  # Keep 4 seconds of history
CONTEXT_CHUNKS = 2            # 2 chunks of history
```

## Usage

### Start Continuous Mode
```bash
./start-continuous.sh
```

### Start Legacy Mode (silence-based)
```bash
./start-all.sh
```

### Stop All
```bash
./stop-all.sh
```

## Expected Latency

| Stage | Legacy | Continuous |
|-------|--------|------------|
| Wait for speech end | 0-5s (variable) | 0-2s (fixed) |
| STT processing | ~200ms | ~200ms |
| Translation | ~300ms | ~300ms |
| TTS generation | ~1-2s | ~1-2s |
| **Total to first audio** | **2-8s** | **~2-3s** |

## Trade-offs

### Pros
- **Consistent latency** (~2s regardless of speech length)
- **Continuous output** (audio plays while user still speaking)
- **Better for long utterances** (no waiting for silence)

### Cons
- **More API calls** (translation every 2s)
- **Potential fragmentation** (might split mid-sentence)
- **Context overhead** (LLM processes context each time)

## Files

| Component | File |
|-----------|------|
| Transcription | `backend/google-backend/transcription_server_continuous.py` |
| Translation | `backend/translate-api/translation_processor_continuous.py` |
| TTS | `backend/qwen3-tts-mlx/voice_processor_continuous.py` |
| Start Script | `start-continuous.sh` |

## Debugging

### Check logs
```bash
# Transcription
pm2 logs transcription-server

# Translation
pm2 logs translation-processor

# Voice
pm2 logs voice-processor
```

### Expected log output
```
# Transcription
📤 Chunk 0: new='Hello my friend' context_len=0
📤 Chunk 1: new='how are you today' context_len=15

# Translation
🔄 Chunk 0: context='' new='Hello my friend'
  ✅ Translated in 180ms: 'Hola mi amigo'
🔄 Chunk 1: context='Hello my friend' new='how are you today'
  ✅ Translated in 220ms: '¿cómo estás hoy?'

# Voice
🔊 Chunk 0: 'Hola mi amigo'
  ✅ Generated 1.2s audio in 0.8s
🔊 Chunk 1: '¿cómo estás hoy?'
  ✅ Generated 1.5s audio in 1.0s
```
