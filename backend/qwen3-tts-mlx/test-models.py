# import sys
# import os

# # Create a local mock of the module
# try:
#     from local_qwen import qwen3_tts
#     # Force the library to use my local version which fixes the SpeakerEncoder bug
#     sys.modules["mlx_audio.tts.models.qwen3_tts"] = qwen3_tts
# except ImportError:
#     print("Could not import local_qwen. Make sure you are running from backend/qwen3-tts directory.")

# from mlx_audio.tts.utils import load_model
# from mlx_audio.tts.generate import generate_audio
# import mlx.core as mx

# # Load the model (this will now use local_qwen code)
# model = load_model("mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit")

# generate_audio(
#     model=model,
#     text="Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged.",
#     ref_audio="/Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/backend/qwen3-tts/data/user_1770019649105_4dupmm6sx.wav",
#     ref_text="Hello I am feeling great today and the weather is sunny and it uplifts my mood.",
#     file_prefix="test_audio",
# )

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #

# from qwen_tts import Qwen3TTSModel
# import torch
# import time

# # Model will be automatically quantized when loaded
# model = Qwen3TTSModel.from_pretrained(
#     "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
#     device_map="mps",
# )

# # Voice cloning example
# import soundfile as sf

# start_time = time.time()
# wavs, sr = model.generate_voice_clone(
#     text="Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged.",
#     language="English",
#     ref_audio="data/user_1770019649105_4dupmm6sx.wav",
#     ref_text="Hello I am feeling great today and the weather is sunny which uplifts my mood.",
# )
# sf.write("output.wav", wavs[0], sr)
# end_time = time.time()

# generation_time = end_time - start_time

# if wavs:
#     # Get the first result
#     audio = wavs[0]
    
#     audio_duration = len(audio) / sr
    
#     # Print metrics
#     print(f"\n{'='*50}")
#     print("Generation completed!")
#     print(f"{'='*50}")
#     print(f"Generation time: {generation_time:.2f} seconds")
#     print(f"Audio duration: {audio_duration:.2f} seconds")
#     print(f"Speed: {audio_duration/generation_time:.2f}x faster than real-time")
#     print(f"{'='*50}\n")
    
#     print(f"Output written to: output.wav")
# else:
#     print("No audio generated!")

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
