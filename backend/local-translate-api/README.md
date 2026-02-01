# Translation API Server

Backend translation service using a local NLLB-200 model (Facebook) to translate transcriptions to English.

## Setup

1. Run setup script (installs PyTorch and Transformers):
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
