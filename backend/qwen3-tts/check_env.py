import sys
import torch
print(f"Python version: {sys.version}")
print(f"Torch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Target Device: {device}")

try:
    import qwen_tts
    print("qwen_tts imported successfully")
    print("Attributes in qwen_tts:", dir(qwen_tts))
except ImportError as e:
    print(f"Error importing qwen_tts: {e}")
    try:
        import qwen3_tts
        print("qwen3_tts imported successfully")
        print("Attributes in qwen3_tts:", dir(qwen3_tts))
    except ImportError as e2:
         print(f"Error importing qwen3_tts: {e2}")
