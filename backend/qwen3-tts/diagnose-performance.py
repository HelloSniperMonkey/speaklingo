from qwen_tts import Qwen3TTSModel
import torch
import time
import soundfile as sf

print("=" * 60)
print("SYSTEM DIAGNOSTICS")
print("=" * 60)
print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA version: {torch.version.cuda}")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
print("=" * 60)

# Test different configurations
configs = [
    {
        "name": "Original (Flash Attention 2)",
        "params": {
            "device_map": "cuda:0",
            "dtype": torch.bfloat16,
            "attn_implementation": "flash_attention_2",
        }
    },
    {
        "name": "Standard Attention (bfloat16)",
        "params": {
            "device_map": "cuda:0",
            "dtype": torch.bfloat16,
        }
    },
    {
        "name": "Standard Attention (float16)",
        "params": {
            "device_map": "cuda:0",
            "dtype": torch.float16,
        }
    },
]

test_text = "Lorem Ipsum is simply dummy text of the printing and typesetting industry."
results = []

for config in configs:
    print(f"\n{'='*60}")
    print(f"Testing: {config['name']}")
    print(f"{'='*60}")
    
    try:
        # Clear cache
        torch.cuda.empty_cache()
        
        # Load model
        load_start = time.time()
        model = Qwen3TTSModel.from_pretrained(
            "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
            **config['params']
        )
        load_time = time.time() - load_start
        print(f"Model device: {model.device}")
        print(f"Load time: {load_time:.2f}s")
        
        # Warm-up run (first run is often slower)
        print("Running warm-up...")
        model.generate_voice_clone(
            text="Test",
            language="English",
            ref_audio="data/intro_user.wav",
            ref_text="Hello I am feeling great today.",
        )
        
        # Actual test
        print("Running benchmark...")
        torch.cuda.synchronize()  # Ensure GPU operations complete
        start_time = time.time()
        
        wavs, sr = model.generate_voice_clone(
            text=test_text,
            language="English",
            ref_audio="data/intro_user.wav",
            ref_text="Hello I am feeling great today and the weather is sunny which uplifts my mood.",
        )
        
        torch.cuda.synchronize()  # Ensure GPU operations complete
        end_time = time.time()
        
        generation_time = end_time - start_time
        audio_duration = len(wavs[0]) / sr
        rtf = audio_duration / generation_time  # Real-time factor
        
        result = {
            "config": config['name'],
            "generation_time": generation_time,
            "audio_duration": audio_duration,
            "rtf": rtf,
            "load_time": load_time
        }
        results.append(result)
        
        print(f"✓ Generation time: {generation_time:.2f}s")
        print(f"✓ Audio duration: {audio_duration:.2f}s")
        print(f"✓ Speed: {rtf:.2f}x real-time")
        
        # Check GPU utilization
        if torch.cuda.is_available():
            memory_allocated = torch.cuda.memory_allocated(0) / 1e9
            memory_reserved = torch.cuda.memory_reserved(0) / 1e9
            print(f"✓ GPU Memory Allocated: {memory_allocated:.2f} GB")
            print(f"✓ GPU Memory Reserved: {memory_reserved:.2f} GB")
        
        # Save output
        output_file = f"output_{config['name'].replace(' ', '_').replace('(', '').replace(')', '')}.wav"
        sf.write(output_file, wavs[0], sr)
        print(f"✓ Saved to: {output_file}")
        
        # Clean up
        del model
        torch.cuda.empty_cache()
        
    except Exception as e:
        print(f"✗ Failed: {e}")
        results.append({
            "config": config['name'],
            "error": str(e)
        })

# Summary
print("\n" + "=" * 60)
print("BENCHMARK SUMMARY")
print("=" * 60)
for result in results:
    if "error" in result:
        print(f"\n{result['config']}: FAILED")
        print(f"  Error: {result['error']}")
    else:
        print(f"\n{result['config']}:")
        print(f"  Generation Time: {result['generation_time']:.2f}s")
        print(f"  Audio Duration: {result['audio_duration']:.2f}s")
        print(f"  Real-Time Factor: {result['rtf']:.2f}x")
        print(f"  Load Time: {result['load_time']:.2f}s")

# Find best
valid_results = [r for r in results if "error" not in r]
if valid_results:
    best = max(valid_results, key=lambda x: x['rtf'])
    print(f"\n{'='*60}")
    print(f"🏆 BEST CONFIGURATION: {best['config']}")
    print(f"   Real-Time Factor: {best['rtf']:.2f}x")
    print(f"{'='*60}")
