# Translation Setup Guide

## Overview
The translation system uses Gemini 2.5 Flash Lite to translate transcriptions from any language to English in real-time.

## Architecture
- **Backend**: Flask server running on port 8766 that handles translation via Gemini API
- **Frontend**: React hooks that call the backend and display translations with latency metrics

## Setup Instructions

### 1. Backend Setup (Translation API)

```bash
cd backend/translate-api
```

#### Option A: Automated Setup
```bash
./setup.sh
```

#### Option B: Manual Setup
```bash
# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure API Key

Edit `backend/translate-api/.env` and add your Gemini API key:
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

**Get your API key from**: https://aistudio.google.com/app/apikey

### 3. Start the Translation Server

```bash
# Make sure you're in backend/translate-api with activated venv
source .venv/bin/activate
python translation_server.py
```

The server will start on `http://localhost:8766`

### 4. Frontend Setup

The frontend is already configured to use the backend translation API. No additional setup needed!

### 5. Testing

1. Start the Google transcription backend (port 8765)
2. Start the translation API (port 8766)
3. Start the frontend development server
4. Navigate to a room and start transcribing
5. Watch both transcription and translation appear in real-time!

## Features

### Translation Boxes
- **Local Translation**: Shows translated output from your microphone
- **Remote Translation**: Shows translated output from remote user's audio
- **Latency Display**: Shows translation latency in milliseconds
- **Loading States**: Visual indicators when translation is in progress

### API Features
- Structured output (translation only, no extra words)
- Low latency with Gemini 2.5 Flash Lite
- Automatic caching to avoid re-translating identical text
- Error handling with fallback to original text

## Troubleshooting

### Translation not working
1. Check if translation API is running on port 8766
2. Verify API key is correctly set in `.env`
3. Check browser console for errors
4. Ensure backend URL is correct in `useBackendTranslation.ts` (default: `http://localhost:8766`)

### High latency
- Gemini 2.5 Flash Lite should provide <500ms latency
- Check your internet connection
- Consider using a different model if needed

### Port conflicts
- Translation API uses port 8766
- Google transcription uses port 8765
- Frontend uses port 3000
- Change ports in respective files if needed

## File Structure

```
backend/translate-api/
├── .env                    # API key configuration
├── requirements.txt        # Python dependencies
├── setup.sh               # Setup script
├── translation_server.py  # Flask server
└── README.md              # Documentation

frontend/
├── hooks/
│   └── useBackendTranslation.ts  # Translation hook
└── components/
    └── LiveTranscription.tsx     # UI with translation boxes
```
