# Performance Analysis: L4 GPU vs Laptop

## Problem Summary

**L4 GPU Performance:** 0.02x real-time (223s to generate 4.8s audio)  
**Laptop Performance:** 0.5-0.6x real-time  
**L4 is 25x SLOWER despite 16x more TFLOPS**

## Root Cause: Audio Preprocessing Bottleneck

### Time Breakdown (223.56s total):
- **CPU operations:** 17.93s (8%)
- **GPU operations:** 2.20s (1%)
- **Missing time:** 203.43s (91%) ← **THE PROBLEM**

### Missing Time Breakdown:
1. **Audio file I/O** - Loading/decoding reference audio
2. **Audio preprocessing** - Resampling, normalization
3. **Feature extraction** - Mel-spectrograms, MFCCs
4. **Speaker embedding extraction** - CPU-intensive operations
5. **CPU-GPU data transfers** - Discrete GPU overhead
6. **Python/library overhead** - Sequential processing

### GPU Utilization:
- Average: 3.5%
- Peak: 80%
- **Conclusion:** GPU is 96.5% idle!

## Why Laptop is Faster

| Factor | Laptop (Apple Silicon + MLX) | L4 GPU (CUDA) |
|--------|------------------------------|---------------|
| Memory | Unified (no transfers) | Discrete (CPU↔GPU overhead) |
| Audio Libraries | Optimized for macOS | Generic Linux libraries |
| Framework | MLX (Apple-optimized) | CUDA (not optimized for this workload) |
| Audio I/O | Faster audio codecs | Standard ffmpeg/librosa |
| Single-core CPU | M-series (fast) | Cloud CPU (slower) |

## Solutions

### Immediate (Won't Help Much):
- ✅ Remove Flash Attention 2
- ✅ Use float16 instead of bfloat16
- ✅ Enable TF32 tensor cores
- ✅ Enable cuDNN benchmark
- ❌ **Result: Still 25x slower**

### Short-term (Might Help):
1. **Precompute speaker embeddings** - Extract once, reuse
2. **Cache audio preprocessing** - Don't reload reference audio every time
3. **Use GPU audio preprocessing** - Libraries like nnAudio
4. **Batch processing** - Generate multiple audios simultaneously

### Long-term (Recommended):
1. **Switch to GPU-optimized TTS model:**
   - StyleTTS2
   - XTTS v2 (Coqui)
   - Bark
   - Tortoise TTS

2. **Use streaming inference** - Process chunks in parallel

3. **Deploy on better CPU** - Higher single-core performance

4. **Keep using laptop** - It's genuinely faster for this specific model

## Recommendation

**For your use case (real-time translation), use your laptop or switch to a different TTS model.**

Qwen3-TTS is optimized for:
- Apple Silicon with MLX
- Batch processing (not real-time)
- Scenarios where audio quality > speed

For real-time GPU inference, consider:
- **XTTS v2** - Better GPU utilization
- **StyleTTS2** - Parallelizable architecture
- **Piper TTS** - Optimized for speed
- **Kokoro TTS** - Fast inference

## Code Example: Precompute Speaker Embeddings

```python
# Extract speaker embedding once
speaker_embedding = model.extract_speaker_embedding(
    ref_audio="data/intro_user.wav",
    ref_text="Hello I am feeling great today..."
)

# Reuse for multiple generations
for text in texts:
    wavs, sr = model.generate_with_embedding(
        text=text,
        speaker_embedding=speaker_embedding  # No preprocessing!
    )
```

This would eliminate the 203s bottleneck if the library supports it.
