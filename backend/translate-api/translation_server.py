import os
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Configure Groq
GROQ_API_KEY = os.getenv('GROQ_API_KEY')
if not GROQ_API_KEY or GROQ_API_KEY == 'your_api_key_here':
    print("WARNING: GROQ_API_KEY not set in .env file")
    client = None
else:
    client = Groq(api_key=GROQ_API_KEY)

def translate_text(text: str) -> dict:
    """
    Translate the given text to English using Groq (openai/gpt-oss-safeguard-20b)
    Returns dict with translated text and latency
    """
    if not text or not text.strip():
        return {
            'translated': '',
            'latency_ms': 0
        }
    
    if not client:
        return {
            'translated': text,
            'latency_ms': 0,
            'error': 'Groq API not configured'
        }
    
    start_time = time.time()
    
    try:
        # Create a strict prompt for translation only
        prompt = f"""Translate the following text to English. Only provide the translation, no additional text.

Text: {text}

Translation:"""

        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",  # Fast and good for translation
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.1,  # Low temperature for consistent output
            max_completion_tokens=100,  # Limit tokens for short translations
            top_p=1,
            stream=False
        )
        
        translated = completion.choices[0].message.content
        
        if not translated or translated is None:
            translated = text  # Fallback to original
        else:
            translated = translated.strip()
        latency_ms = int((time.time() - start_time) * 1000)
        
        return {
            'translated': translated,
            'latency_ms': latency_ms
        }
    
    except Exception as e:
        print(f"Translation error: {str(e)}")
        latency_ms = int((time.time() - start_time) * 1000)
        return {
            'translated': text,  # Fallback to original text
            'latency_ms': latency_ms,
            'error': str(e)
        }

@app.route('/translate', methods=['POST'])
def translate():
    """
    Endpoint to translate text to English
    Expects JSON: { "text": "आप कैसे हैं" }
    Returns JSON: { "translated": "how are you", "latency_ms": 234 }
    """
    try:
        data = request.json
        text = data.get('text', '')
        
        if not text:
            return jsonify({'error': 'No text provided'}), 400
        
        result = translate_text(text)
        return jsonify(result)
    
    except Exception as e:
        print(f"API error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'service': 'translation-api'})

if __name__ == '__main__':
    print("Starting Translation API server on port 8766...")
    print(f"Groq API Key configured: {'Yes' if GROQ_API_KEY and GROQ_API_KEY != 'your_api_key_here' else 'No'}")
    app.run(host='0.0.0.0', port=8766, debug=True)
