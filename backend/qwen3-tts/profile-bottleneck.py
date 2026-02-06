from qwen_tts import Qwen3TTSModel
import torch
import time
import soundfile as sf
import multiprocessing as mp
import psutil
import threading

# Monitor CPU and GPU usage during inference
class ResourceMonitor:
    def __init__(self):
        self.monitoring = False
        self.cpu_usage = []
        self.gpu_usage = []
        
    def monitor(self):
        import subprocess
        while self.monitoring:
            # CPU usage
            cpu = psutil.cpu_percent(interval=0.1)
            self.cpu_usage.append(cpu)
            
            # GPU usage
            try:
                result = subprocess.run(
                    ['nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
                    capture_output=True, text=True, timeout=1
                )
                gpu = float(result.stdout.strip())
                self.gpu_usage.append(gpu)
            except:
                pass
            
            time.sleep(0.1)
    
    def start(self):
        self.monitoring = True
        self.thread = threading.Thread(target=self.monitor, daemon=True)
        self.thread.start()
    
    def stop(self):
        self.monitoring = False
        time.sleep(0.2)
        return {
            'avg_cpu': sum(self.cpu_usage) / len(self.cpu_usage) if self.cpu_usage else 0,
            'max_cpu': max(self.cpu_usage) if self.cpu_usage else 0,
            'avg_gpu': sum(self.gpu_usage) / len(self.gpu_usage) if self.gpu_usage else 0,
            'max_gpu': max(self.gpu_usage) if self.gpu_usage else 0,
        }

print("=" * 70)
print("DETAILED PERFORMANCE PROFILING")
print("=" * 70)
print(f"CPU Cores: {mp.cpu_count()}")
print(f"GPU: {torch.cuda.get_device_name(0)}")
print(f"PyTorch: {torch.__version__}")
print("=" * 70)

# Load model with best config from previous test
print("\nLoading model (Standard Attention, float16)...")
model = Qwen3TTSModel.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    device_map="cuda:0",
    dtype=torch.float16,
)

test_text = "Lorem Ipsum is simply dummy text of the printing and typesetting industry."
ref_audio = "data/intro_user.wav"
ref_text = "Hello I am feeling great today and the weather is sunny which uplifts my mood."

# Warm-up
print("Warming up...")
model.generate_voice_clone(text="Test", language="English", ref_audio=ref_audio, ref_text=ref_text)

print("\n" + "=" * 70)
print("RUNNING PROFILED INFERENCE")
print("=" * 70)

# Profile with resource monitoring
monitor = ResourceMonitor()
monitor.start()

torch.cuda.synchronize()
start_time = time.time()

# Use PyTorch profiler
with torch.profiler.profile(
    activities=[
        torch.profiler.ProfilerActivity.CPU,
        torch.profiler.ProfilerActivity.CUDA,
    ],
    record_shapes=True,
    with_stack=True,
) as prof:
    wavs, sr = model.generate_voice_clone(
        text=test_text,
        language="English",
        ref_audio=ref_audio,
        ref_text=ref_text,
    )

torch.cuda.synchronize()
end_time = time.time()

resource_stats = monitor.stop()

generation_time = end_time - start_time
audio_duration = len(wavs[0]) / sr

print("\n" + "=" * 70)
print("RESULTS")
print("=" * 70)
print(f"Generation Time: {generation_time:.2f}s")
print(f"Audio Duration: {audio_duration:.2f}s")
print(f"Real-Time Factor: {audio_duration/generation_time:.2f}x")
print(f"\nAverage CPU Usage: {resource_stats['avg_cpu']:.1f}%")
print(f"Peak CPU Usage: {resource_stats['max_cpu']:.1f}%")
print(f"Average GPU Usage: {resource_stats['avg_gpu']:.1f}%")
print(f"Peak GPU Usage: {resource_stats['max_gpu']:.1f}%")

# Analyze profiling data
print("\n" + "=" * 70)
print("TOP 10 TIME-CONSUMING OPERATIONS")
print("=" * 70)

# CPU operations
print("\n📊 CPU Operations:")
print(prof.key_averages().table(
    sort_by="cpu_time_total", row_limit=10
))

# CUDA operations
print("\n🎮 CUDA Operations:")
print(prof.key_averages().table(
    sort_by="cuda_time_total", row_limit=10
))

# Export detailed trace (can be viewed in chrome://tracing)
trace_file = "trace.json"
prof.export_chrome_trace(trace_file)
print(f"\n💾 Detailed trace saved to: {trace_file}")
print("   View in Chrome at: chrome://tracing")

# Additional analysis
print("\n" + "=" * 70)
print("BOTTLENECK ANALYSIS")
print("=" * 70)

cpu_time_total = sum([item.cpu_time_total for item in prof.key_averages()])
cuda_time_total = sum([item.cuda_time_total for item in prof.key_averages()])

cpu_time_ms = cpu_time_total / 1000
cuda_time_ms = cuda_time_total / 1000

print(f"Total CPU Time: {cpu_time_ms:.2f}ms")
print(f"Total CUDA Time: {cuda_time_ms:.2f}ms")
print(f"CPU/CUDA Ratio: {cpu_time_ms/cuda_time_ms:.2f}x")

if resource_stats['avg_gpu'] < 50:
    print("\n⚠️  LOW GPU UTILIZATION DETECTED!")
    print("   Possible causes:")
    print("   1. CPU preprocessing bottleneck (audio processing)")
    print("   2. Small batch size (generating one sample at a time)")
    print("   3. CPU-GPU data transfer overhead")
    print("   4. Sequential operations not parallelized")

if resource_stats['avg_cpu'] > 70:
    print("\n⚠️  HIGH CPU USAGE DETECTED!")
    print("   CPU is likely the bottleneck - audio preprocessing intensive")

# Recommendations
print("\n" + "=" * 70)
print("OPTIMIZATION RECOMMENDATIONS")
print("=" * 70)
print("1. Enable batch processing (generate multiple audios at once)")
print("2. Pin CPU memory for faster CPU-GPU transfers")
print("3. Use torch.compile() if on PyTorch 2.0+")
print("4. Consider preprocessing audio on GPU")
print("5. Increase number of CPU workers for preprocessing")

sf.write("profiled_output.wav", wavs[0], sr)
print(f"\n✓ Output saved to: profiled_output.wav")
