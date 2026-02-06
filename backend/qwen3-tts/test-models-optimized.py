from qwen_tts import Qwen3TTSModel
import torch
import time
import os

# ========== OPTIMIZATIONS FOR L4 GPU ==========
# Set CPU threads for preprocessing
os.environ["OMP_NUM_THREADS"] = str(os.cpu_count())
os.environ["MKL_NUM_THREADS"] = str(os.cpu_count())

# Enable TF32 tensor cores (L4 has Ampere/Ada architecture)
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True
torch.backends.cudnn.benchmark = True  # Find optimal cuDNN algorithms

print("=" * 60)
print("OPTIMIZED L4 GPU INFERENCE")
print("=" * 60)
print(f"GPU: {torch.cuda.get_device_name(0)}")
print(f"CPU Threads: {os.cpu_count()}")
print(f"TF32 Enabled: True")
print(f"cuDNN Benchmark: True")
print("=" * 60)

# Load model with optimized settings
# - Using float16 (better than bfloat16 on L4)
# - NO flash_attention_2 (causes slowdown)
model = Qwen3TTSModel.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    device_map="cuda:0",
    dtype=torch.float16,
)

print(f"Model device: {model.device}")
print("Model loaded successfully!")

# Voice cloning example
import soundfile as sf

# Warm-up run (first run is always slower)
print("\nRunning warm-up...")
model.generate_voice_clone(
    text="Test warm-up.",
    language="English",
    ref_audio="data/intro_user.wav",
    ref_text="Hello I am feeling great today.",
)

# Actual inference
test_text = "Lorem Ipsum is simply dummy text of the printing and typesetting industry."

print("\nRunning optimized inference...")
torch.cuda.synchronize()
start_time = time.time()

# Use no_grad context for inference (saves memory and compute)
with torch.no_grad():
    wavs, sr = model.generate_voice_clone(
        text=test_text,
        language="English",
        ref_audio="data/intro_user.wav",
        ref_text="Hello I am feeling great today and the weather is sunny which uplifts my mood.",
    )

torch.cuda.synchronize()  # Wait for GPU to finish
end_time = time.time()

generation_time = end_time - start_time

if wavs:
    # Get the first result
    audio = wavs[0]
    audio_duration = len(audio) / sr
    
    # Print metrics
    print(f"\n{'='*60}")
    print("GENERATION COMPLETED!")
    print(f"{'='*60}")
    print(f"Generation time: {generation_time:.2f} seconds")
    print(f"Audio duration: {audio_duration:.2f} seconds")
    print(f"Speed: {audio_duration/generation_time:.2f}x real-time")
    
    # GPU memory usage
    memory_allocated = torch.cuda.memory_allocated(0) / 1e9
    memory_reserved = torch.cuda.memory_reserved(0) / 1e9
    print(f"GPU Memory Used: {memory_allocated:.2f} GB / {memory_reserved:.2f} GB reserved")
    print(f"{'='*60}\n")
    
    # Save output
    sf.write("output_optimized.wav", audio, sr)
    print(f"Output written to: output_optimized.wav")
else:
    print("No audio generated!")

# Check if performance is acceptable
if audio_duration / generation_time < 0.5:
    print("\n⚠️  WARNING: Still slower than expected!")
    print("The bottleneck is likely in CPU-based audio preprocessing.")
    print("This model may be better optimized for your laptop's CPU architecture.")
    print("\nYour laptop advantages:")
    print("  - Faster single-core CPU performance")
    print("  - Better CPU-memory bandwidth")
    print("  - MLX framework optimized for Apple Silicon")
    print("\nTo improve L4 performance:")
    print("  - Run profile-bottleneck.py to see exact bottleneck")
    print("  - Consider batching multiple audio generations")
    print("  - Use a different TTS model optimized for GPU inference")
