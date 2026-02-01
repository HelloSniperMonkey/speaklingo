# WebRTC Video App with Live Transcription

A WebRTC-based video calling application with real-time multilingual speech transcription powered by **MLX-Whisper Turbo**.

## Features

- **WebRTC Video Calls**: Peer-to-peer video calling using WebRTC and Firebase signaling
- **Live Transcription**: Real-time speech-to-text transcription for both local and remote audio
- **Multilingual Support**: Supports 99+ languages using OpenAI's Whisper Large V3 Turbo model
- **Apple Silicon Optimized**: Uses MLX framework for blazing fast inference on Mac M1/M2/M3 chips
- **Low Latency**: Uses streaming audio processing for near real-time transcription

## Architecture

```
┌─────────────────┐     WebSocket     ┌──────────────────────┐
│   Frontend      │ ◄──────────────► │  Transcription       │
│   (WebRTC)      │    Audio Chunks   │  Server (Python)     │
│                 │ ◄──────────────── │                      │
└─────────────────┘    Transcriptions │  MLX-Whisper Turbo   │
                                      └──────────────────────┘
```

## Prerequisites

- **macOS with Apple Silicon** (M1/M2/M3) - Required for MLX framework
- Python 3.8+
- Node.js 16+
- FFmpeg (optional, for additional audio processing)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/HelloSniperMonkey/videoapp.git
cd videoapp
```

### 2. Set up the Backend

```bash
cd videoapp/backend

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Alternatively, use the setup script
chmod +x setup.sh
./setup.sh

# The MLX-Whisper model will be downloaded automatically on first run (~1.5GB)
```

### 3. Set up the Frontend

```bash
# From the videoapp directory
npm install
```

## Running the Application

### 1. Start the Transcription Server

```bash
cd backend
python transcription_server.py
```

The server will start on `ws://localhost:8765`. On first run, it will download the MLX-Whisper Turbo model from Hugging Face (~1.5GB).

### 2. Start the Frontend

```bash
# In a new terminal, from the videoapp directory
npm run dev
```

The frontend will be available at `http://localhost:3000` (or similar Vite port).

## Usage

1. **Start Webcam**: Click "Start webcam" to enable your camera and microphone
2. **Make a Call**: Click "Create Call" to generate a call ID, share it with the other party
3. **Join a Call**: Enter the call ID and click "Answer"
4. **Enable Transcription**: 
   - Click "Transcribe Local Audio" to transcribe your own speech
   - Click "Transcribe Remote Audio" to transcribe the remote participant's speech
5. **Stop Transcription**: Click "Stop Transcription" to end the transcription session

## Supported Languages

MLX-Whisper Turbo (based on OpenAI Whisper Large V3 Turbo) supports 99+ languages including:

- **East Asian**: Chinese, Japanese, Korean, Cantonese
- **Southeast Asian**: Vietnamese, Indonesian, Thai, Malay, Filipino
- **European**: English, German, French, Spanish, Portuguese, Italian, Dutch, Swedish, Danish, Finnish, Polish, Czech, Slovak, Hungarian, Romanian, Bulgarian, Greek, Croatian, Slovenian, Russian, Ukrainian
- **Middle Eastern**: Arabic, Hebrew, Persian, Turkish
- **South Asian**: Hindi, Bengali, Tamil, Telugu, Urdu
- **And many more...**

## Configuration

### Backend Configuration

Environment variables for the transcription server:

- `HOST`: Server host (default: `0.0.0.0`)
- `PORT`: Server port (default: `8765`)

### Frontend Configuration

Edit `main.js` to change the WebSocket server URL:

```javascript
const WS_SERVER_URL = 'ws://localhost:8765';
```

## Technical Details

### Model Information

This transcription server uses **[mlx-community/whisper-large-v3-turbo](https://huggingface.co/mlx-community/whisper-large-v3-turbo)** from Hugging Face:

- **Base Model**: OpenAI Whisper Large V3 Turbo
- **Framework**: MLX (Apple Machine Learning Framework)
- **Optimized For**: Apple Silicon (M1/M2/M3)
- **Languages**: 99+ languages with automatic language detection

### Audio Processing

- The frontend uses the Web Audio API with a ScriptProcessor to capture audio at 16kHz
- Audio is converted to 16-bit PCM and sent as binary WebSocket messages
- The backend buffers audio chunks and processes them in batches for efficient transcription

### FFmpeg Integration (Optional)

For additional audio processing needs, you can use ffmpeg to extract audio from video streams:

```bash
# Extract audio from video file
ffmpeg -i input.mp4 -vn -ar 16000 -ac 1 -f s16le -acodec pcm_s16le output.pcm

# Stream audio with low latency
ffmpeg -re -i input.mp4 -vn -fflags nobuffer -flags low_delay -f s16le -ar 16000 -ac 1 -
```

You can also use the provided FFmpeg transcription script:

```bash
# Transcribe a video file
python ffmpeg_transcribe.py input.mp4

# Transcribe with a specific language
python ffmpeg_transcribe.py input.mp4 --language en

# Adjust chunk duration for faster/slower processing
python ffmpeg_transcribe.py input.mp4 --chunk-duration 5.0
```

Note: For WebRTC streams, the Web Audio API approach is preferred as it works directly with the MediaStream.

## Troubleshooting

### Connection Issues

1. Ensure the transcription server is running
2. Check if port 8765 is not blocked by firewall
3. For CORS issues, ensure both frontend and backend are on the same domain or configure CORS

### Transcription Quality

1. Ensure good audio quality (reduce background noise)
2. Speak clearly and at a moderate pace
3. The model works best with continuous speech rather than single words

### Performance

1. **Apple Silicon Mac is required** for MLX-Whisper
2. Reduce the `min_chunk_duration` in the backend for lower latency (may affect accuracy)
3. Close unnecessary applications to free up system resources

### Common Errors

#### "MLX-Whisper not installed"
```bash
pip install mlx-whisper
```

#### Model download issues
The model is downloaded from Hugging Face on first use. Ensure you have a stable internet connection.

## License

MIT License

## Credits

- [MLX-Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) - MLX implementation of Whisper
- [mlx-community/whisper-large-v3-turbo](https://huggingface.co/mlx-community/whisper-large-v3-turbo) - Pre-converted model
- [OpenAI Whisper](https://github.com/openai/whisper) - Original speech recognition model
- [Firebase](https://firebase.google.com/) - WebRTC signaling
