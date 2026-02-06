from mlx_audio.tts.utils import load_model
import mlx.core as mx
import soundfile as sf
import numpy as np
import time

model = load_model("mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit")

start_time = time.time()
# Load the reference audio file and convert to MLX array
ref_audio, sr = sf.read("data/intro_user.wav")
ref_audio = mx.array(ref_audio)

results = list(model.generate(
    text="This pipeline is exactly how MLX-Audio is meant to be used.If you want next, very relevant to your WebRTC work",
    ref_audio=ref_audio,
    ref_text="Hello I am feeling great today and the weather is sunny which uplifts my mood.",
))

audio = results[0].audio  # mx.array
# sr = results[0].sample_rate
end_time = time.time()

audio_duration = len(audio) / sr
print(f"Time taken: {end_time - start_time} seconds")
print(f"Speed: {audio_duration/(end_time - start_time):.2f}x faster than real-time")
# Convert mx.array → numpy
audio_np = np.array(audio)

sf.write("output_adi.wav", audio_np, samplerate=sr)

