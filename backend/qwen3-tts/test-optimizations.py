from qwen_tts import Qwen3TTSModel
import torch
import time
import soundfile as sf
import os

print("=" * 70)
print("TESTING PERFORMANCE OPTIMIZATIONS")
print("=" * 70)

# Set environment variables for better CPU performance
os.environ["OMP_NUM_THREADS"] = str(os.cpu_count())
os.environ["MKL_NUM_THREADS"] = str(os.cpu_count())
os.environ["NUMEXPR_NUM_THREADS"] = str(os.cpu_count())

print(f"CPU threads set to: {os.cpu_count()}")

test_text = "Lorem Ipsum is simply dummy text of the printing and typesetting industry."
ref_audio = "data/intro_user.wav"
ref_text = "Hello I am feeling great today and the weather is sunny which uplifts my mood."

# Test 1: torch.compile (PyTorch 2.0+ optimization)
print("\n" + "=" * 70)
print("TEST 1: torch.compile() Optimization")
print("=" * 70)

try:
    model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        device_map="cuda:0",
        dtype=torch.float16,
    )
    
    # Try to compile the model (PyTorch 2.0+)
    if hasattr(torch, 'compile'):
        print("Compiling model with torch.compile()...")
        model = torch.compile(model, mode="reduce-overhead")
    else:
        print("torch.compile() not available in this PyTorch version")
    
    # Warm-up
    model.generate_voice_clone(text="Test", language="English", ref_audio=ref_audio, ref_text=ref_text)
    
    # Benchmark
    torch.cuda.synchronize()
    start = time.time()
    wavs, sr = model.generate_voice_clone(text=test_text, language="English", ref_audio=ref_audio, ref_text=ref_text)
    torch.cuda.synchronize()
    end = time.time()
    
    gen_time = end - start
    audio_dur = len(wavs[0]) / sr
    print(f"✓ Generation Time: {gen_time:.2f}s")
    print(f"✓ Real-Time Factor: {audio_dur/gen_time:.2f}x")
    sf.write("output_compiled.wav", wavs[0], sr)
    
    del model
    torch.cuda.empty_cache()
    
except Exception as e:
    print(f"✗ Failed: {e}")

# Test 2: Pinned memory for faster CPU-GPU transfers
print("\n" + "=" * 70)
print("TEST 2: Pinned Memory + No Gradients")
print("=" * 70)

try:
    model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        device_map="cuda:0",
        dtype=torch.float16,
    )
    
    # Warm-up
    with torch.no_grad(), torch.cuda.amp.autocast():
        model.generate_voice_clone(text="Test", language="English", ref_audio=ref_audio, ref_text=ref_text)
    
    # Benchmark with no gradients and mixed precision
    torch.cuda.synchronize()
    start = time.time()
    
    with torch.no_grad(), torch.cuda.amp.autocast():
        wavs, sr = model.generate_voice_clone(text=test_text, language="English", ref_audio=ref_audio, ref_text=ref_text)
    
    torch.cuda.synchronize()
    end = time.time()
    
    gen_time = end - start
    audio_dur = len(wavs[0]) / sr
    print(f"✓ Generation Time: {gen_time:.2f}s")
    print(f"✓ Real-Time Factor: {audio_dur/gen_time:.2f}x")
    sf.write("output_optimized.wav", wavs[0], sr)
    
    del model
    torch.cuda.empty_cache()
    
except Exception as e:
    print(f"✗ Failed: {e}")

# Test 3: Disable cudNN benchmarking
print("\n" + "=" * 70)
print("TEST 3: cuDNN Benchmark Disabled")
print("=" * 70)

try:
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    
    model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        device_map="cuda:0",
        dtype=torch.float16,
    )
    
    # Warm-up
    model.generate_voice_clone(text="Test", language="English", ref_audio=ref_audio, ref_text=ref_text)
    
    torch.cuda.synchronize()
    start = time.time()
    wavs, sr = model.generate_voice_clone(text=test_text, language="English", ref_audio=ref_audio, ref_text=ref_text)
    torch.cuda.synchronize()
    end = time.time()
    
    gen_time = end - start
    audio_dur = len(wavs[0]) / sr
    print(f"✓ Generation Time: {gen_time:.2f}s")
    print(f"✓ Real-Time Factor: {audio_dur/gen_time:.2f}x")
    
    del model
    torch.cuda.empty_cache()
    
except Exception as e:
    print(f"✗ Failed: {e}")

# Test 4: Enable cudNN benchmarking (find optimal algorithms)
print("\n" + "=" * 70)
print("TEST 4: cuDNN Benchmark Enabled")
print("=" * 70)

try:
    torch.backends.cudnn.benchmark = True
    torch.backends.cudnn.deterministic = False
    
    model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        device_map="cuda:0",
        dtype=torch.float16,
    )
    
    # Multiple warm-ups for cuDNN to find best algorithm
    for _ in range(3):
        model.generate_voice_clone(text="Test", language="English", ref_audio=ref_audio, ref_text=ref_text)
    
    torch.cuda.synchronize()
    start = time.time()
    wavs, sr = model.generate_voice_clone(text=test_text, language="English", ref_audio=ref_audio, ref_text=ref_text)
    torch.cuda.synchronize()
    end = time.time()
    
    gen_time = end - start
    audio_dur = len(wavs[0]) / sr
    print(f"✓ Generation Time: {gen_time:.2f}s")
    print(f"✓ Real-Time Factor: {audio_dur/gen_time:.2f}x")
    
    del model
    torch.cuda.empty_cache()
    
except Exception as e:
    print(f"✗ Failed: {e}")

# Test 5: Different tensor cores settings
print("\n" + "=" * 70)
print("TEST 5: TF32 Tensor Cores Enabled (A100/L4 optimization)")
print("=" * 70)

try:
    # Enable TF32 for better performance on Ampere/Ada GPUs (L4)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True
    
    print("TF32 enabled for matmul and cuDNN")
    
    model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        device_map="cuda:0",
        dtype=torch.float16,
    )
    
    # Warm-up
    for _ in range(3):
        model.generate_voice_clone(text="Test", language="English", ref_audio=ref_audio, ref_text=ref_text)
    
    torch.cuda.synchronize()
    start = time.time()
    wavs, sr = model.generate_voice_clone(text=test_text, language="English", ref_audio=ref_audio, ref_text=ref_text)
    torch.cuda.synchronize()
    end = time.time()
    
    gen_time = end - start
    audio_dur = len(wavs[0]) / sr
    print(f"✓ Generation Time: {gen_time:.2f}s")
    print(f"✓ Real-Time Factor: {audio_dur/gen_time:.2f}x")
    sf.write("output_tf32.wav", wavs[0], sr)
    
    del model
    torch.cuda.empty_cache()
    
except Exception as e:
    print(f"✗ Failed: {e}")

print("\n" + "=" * 70)
print("OPTIMIZATION TESTS COMPLETE")
print("=" * 70)
print("\nIf none of these help significantly, the bottleneck is in:")
print("1. CPU-based audio preprocessing (wav file loading, resampling)")
print("2. Sequential model architecture (can't be parallelized)")
print("3. Model implementation not optimized for your GPU architecture")
print("\nYour laptop may have better single-core CPU performance,")
print("which is critical for audio preprocessing tasks.")
