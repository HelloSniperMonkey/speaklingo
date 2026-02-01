import time
import requests
import json

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "translategemma:latest"   # change if needed

PROMPT = """translate to english Translate the following text to English.
Output ONLY the English translation, no additional words, explanations, or punctuation marks.
If the text is already in English, return it as is.

Text: এটা আমি শুধু ভান করছি।
Translation:"""

payload = {
    "model": MODEL,
    "prompt": PROMPT,
    "stream": False
}

start_time = time.perf_counter()

response = requests.post(OLLAMA_URL, json=payload)
response.raise_for_status()

end_time = time.perf_counter()

data = response.json()

latency_ms = (end_time - start_time) * 1000

print("Model output:")
print(data["response"].strip())
print("\nLatency:")
print(f"{latency_ms:.2f} ms")
