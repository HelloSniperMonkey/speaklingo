# Translation API Server

Backend translation service using Gemini 2.5 Flash Lite to translate transcriptions to English.

## Setup

1. Add your Gemini API key to `.env`:
   ```
   GEMINI_API_KEY=your_actual_api_key_here
   ```

2. Run setup script:
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

3. Start the server:
   ```bash
   source .venv/bin/activate
   python translation_server.py
   ```

The server will run on `http://localhost:8766`

## API Endpoints

### POST /translate
Translate text to English.

Request:
```json
{
  "text": "आप कैसे हैं"
}
```

Response:
```json
{
  "translated": "how are you",
  "latency_ms": 234
}
```

### GET /health
Health check endpoint.

Response:
```json
{
  "status": "ok",
  "service": "translation-api"
}
```
