import os
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Configure Gemini
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
if not GEMINI_API_KEY or GEMINI_API_KEY == 'your_api_key_here':
    print("WARNING: GEMINI_API_KEY not set in .env file")
else:
    genai.configure(api_key=GEMINI_API_KEY)

# Use Gemini 2.5 Flash Lite
model = genai.GenerativeModel('gemini-2.5-flash-lite')

def translate_text(text: str) -> dict:
    """
    Translate the given text to English using Gemini 2.5 Flash Lite
    Returns dict with translated text and latency
    """
    if not text or not text.strip():
        return {
            'translated': '',
            'latency_ms': 0
        }
    
    start_time = time.time()
    
    try:
        # Create a strict prompt for translation only
        prompt = f"""Translate the following text to English. 
Output ONLY the English translation, no additional words, explanations, or punctuation marks.
If the text is already in English, return it as is.

Text: {text}

Translation:"""

        response = model.generate_content(
            prompt,
            generation_config={
                'temperature': 0.1,  # Low temperature for consistent output
                'max_output_tokens': 100,  # Limit tokens for short translations
            }
        )
        
        translated = response.text.strip()
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
    print(f"Gemini API Key configured: {'Yes' if GEMINI_API_KEY and GEMINI_API_KEY != 'your_api_key_here' else 'No'}")
    app.run(host='0.0.0.0', port=8766, debug=True)
