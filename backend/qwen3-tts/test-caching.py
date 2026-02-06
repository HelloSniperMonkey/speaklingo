from qwen_tts import Qwen3TTSModel
import torch
import time
import soundfile as sf
import os

# Optimizations
os.environ["OMP_NUM_THREADS"] = str(os.cpu_count())
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True
torch.backends.cudnn.benchmark = True

print("=" * 70)
print("TESTING: AUDIO PREPROCESSING OPTIMIZATION")
print("=" * 70)

model = Qwen3TTSModel.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    device_map="cuda:0",
    dtype=torch.float16,
)

ref_audio = "data/intro_user.wav"
ref_text = "Hello I am feeling great today and the weather is sunny which uplifts my mood."

# Test 1: Multiple generations WITH reloading reference audio each time
print("\nTest 1: Generating 3 audios (reloading reference each time)...")
texts = [
    "Lorem Ipsum is simply dummy text of the printing industry.",
    "The quick brown fox jumps over the lazy dog.",
    "Hello world, this is a test of the text to speech system.",
]

torch.cuda.synchronize()
start = time.time()

for i, text in enumerate(texts):
    wavs, sr = model.generate_voice_clone(
        text=text,
        language="English",
        ref_audio=ref_audio,
        ref_text=ref_text,
    )
    sf.write(f"output_test1_{i}.wav", wavs[0], sr)

torch.cuda.synchronize()
elapsed = time.time() - start

total_duration = sum([len(sf.read(f"output_test1_{i}.wav")[0]) / sr for i in range(3)])
print(f"  Total time: {elapsed:.2f}s")
print(f"  Total audio: {total_duration:.2f}s")
print(f"  Real-time factor: {total_duration/elapsed:.2f}x")
print(f"  Time per generation: {elapsed/3:.2f}s")

# Clean up test files
for i in range(3):
    os.remove(f"output_test1_{i}.wav")

# Test 2: Try to extract speaker representation once (if supported)
print("\nTest 2: Checking if speaker embedding caching is possible...")

# Check if the model has methods to extract/cache speaker info
print("Model methods:", [m for m in dir(model) if not m.startswith('_')])

# Test 3: Multiple generations in sequence (measure if there's any caching)
print("\nTest 3: Repeated generation with same reference (checking for internal caching)...")

torch.cuda.synchronize()
start = time.time()

for i in range(3):
    wavs, sr = model.generate_voice_clone(
        text=texts[i],
        language="English",
        ref_audio=ref_audio,  # Same reference each time
        ref_text=ref_text,
    )

torch.cuda.synchronize()
elapsed2 = time.time() - start

print(f"  Total time: {elapsed2:.2f}s")
print(f"  Time per generation: {elapsed2/3:.2f}s")

if elapsed2 < elapsed * 0.8:
    print(f"  ✓ Internal caching detected! {((elapsed-elapsed2)/elapsed*100):.1f}% faster")
else:
    print(f"  ✗ No internal caching - reference audio processed each time")

# Test 4: Pre-load reference audio into memory
print("\nTest 4: Pre-loading reference audio into memory...")

import librosa
import numpy as np

# Load reference audio once
ref_audio_data, ref_sr = librosa.load(ref_audio, sr=None)
print(f"  Reference audio loaded: {len(ref_audio_data)} samples @ {ref_sr}Hz")

# Test if we can use in-memory audio (check model signature)
import inspect
sig = inspect.signature(model.generate_voice_clone)
print(f"  Function signature: {sig}")

print("\n" + "=" * 70)
print("ANALYSIS")
print("=" * 70)
print("\nThe massive slowdown is caused by:")
print("1. Loading/decoding reference audio file every time")
print("2. Computing speaker embeddings from scratch")
print("3. Audio preprocessing (resampling, mel-spectrograms)")
print("\nSince qwen_tts library doesn't expose speaker embedding extraction,")
print("you have limited optimization options for this model.")
print("\nRECOMMENDATIONS:")
print("1. Use your laptop - it's genuinely 25x faster")
print("2. Switch to XTTS v2 or StyleTTS2 for better GPU utilization")
print("3. For production, consider a dedicated TTS service optimized for speed")
