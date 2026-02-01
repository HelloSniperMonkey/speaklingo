# WebRTC Translator Demo

Real-time video chat with AI-powered live translation using **Lingo.dev SDK**.

## What This App Does

This demo showcases a WebRTC-based video chat application with integrated speech-to-text transcription and real-time translation:

- **WebRTC Video Calls**: Connect with anyone using a simple room code
- **Speech-to-Text**: Transcribes remote audio using OpenAI Whisper API
- **Live Translation**: Translates transcripts in real-time with Lingo.dev SDK
- **Dual Subtitles**: Shows both original speech and translated text below the video

### How It Works

```
[Friend speaks in Spanish]
    -> [OpenAI Whisper: Speech-to-Text]
    -> "Hola, como estas?"
    -> [Lingo.dev SDK: localizeText()]
    -> "Hello, how are you?"
    -> [Display both versions]
```

## Screenshot

The app features a clean, dark interface with:
- Large remote video display
- Picture-in-picture local video
- Subtitle panel showing original + translated text
- Control bar with mic, camera, language selector, and hangup

## Prerequisites

- **Node.js 18+**
- **Firebase Project** - For WebRTC signaling (Firestore)
- **OpenAI API Key** - For Whisper speech-to-text
- **Lingo.dev API Key** - For AI translation (free tier: 10,000 words/month)

## How to Run Locally

1. **Navigate to the demo folder**:
   ```bash
   cd community/webrtc-translator
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.example .env.local
   ```
   Then edit `.env.local` with your API keys.

4. **Run the development server**:
   ```bash
   npm run dev
   ```

5. **Open the app**:
   Navigate to [http://localhost:3000](http://localhost:3000)

6. **Test with two browser windows**:
   - Open two browser windows/tabs
   - In the first window, click "Create New Room"
   - Copy the room ID
   - In the second window, paste the room ID and click "Join Room"
   - Click the translation button to start live translation

## Environment Variables

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase API key | [Firebase Console](https://console.firebase.google.com) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain | Firebase Console |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID | Firebase Console |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket | Firebase Console |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID | Firebase Console |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase app ID | Firebase Console |
| `OPENAI_API_KEY` | OpenAI API key for Whisper | [OpenAI Platform](https://platform.openai.com) |
| `LINGODOTDEV_API_KEY` | Lingo.dev API key | [Lingo.dev Platform](https://lingo.dev/app) |

### Firebase Setup

1. Create a new Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Firestore Database
3. Set Firestore rules to allow read/write (for development):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```
4. Get your Firebase config from Project Settings

## Lingo.dev Features Highlighted

This demo showcases the following Lingo.dev SDK features:

| Feature | Usage in App |
|---------|--------------|
| `LingoDotDevEngine` | Core SDK class for translation |
| `localizeText()` | Real-time text translation of transcripts |
| `fast: true` mode | Optimized for low-latency chat translation |
| Auto language detection | `sourceLocale: null` for automatic detection |
| 30+ language support | Language selector with popular languages |

### Code Example

```typescript
import { LingoDotDevEngine } from "@lingo.dev/_sdk";

const engine = new LingoDotDevEngine({
  apiKey: process.env.LINGODOTDEV_API_KEY,
});

// Translate with automatic source detection
const translated = await engine.localizeText(
  "Hola, como estas?",
  {
    sourceLocale: null,  // Auto-detect
    targetLocale: "en",
    fast: true,          // Optimize for speed
  }
);
// Result: "Hello, how are you?"
```

## Tech Stack

- **Next.js 15** - React framework with App Router
- **TypeScript** - Type-safe code
- **Tailwind CSS** - Utility-first styling
- **Firebase Firestore** - WebRTC signaling server
- **OpenAI Whisper** - Speech-to-text transcription
- **Lingo.dev SDK** - AI-powered translation

## Project Structure

```
webrtc-translator/
├── app/
│   ├── layout.tsx          # Root layout with dark theme
│   ├── page.tsx            # Lobby page (create/join room)
│   ├── globals.css         # Tailwind + custom styles
│   ├── room/[roomId]/
│   │   └── page.tsx        # Video call room
│   └── api/
│       ├── transcribe/     # Whisper API endpoint
│       └── translate/      # Lingo.dev API endpoint
├── components/
│   ├── VideoContainer.tsx  # Video display wrapper
│   ├── RemoteVideo.tsx     # Friend's video
│   ├── LocalVideo.tsx      # Your video (PIP)
│   ├── SubtitlePanel.tsx   # Original + translated text
│   ├── ControlBar.tsx      # Media controls
│   └── LanguageSelector.tsx
├── hooks/
│   ├── useWebRTC.ts        # WebRTC + Firebase signaling
│   ├── useSpeechToText.ts  # Audio capture + Whisper
│   └── useTranslation.ts   # Lingo.dev translation
└── lib/
    ├── firebase.ts         # Firebase config
    ├── lingo.ts            # Lingo.dev SDK setup
    └── languages.ts        # Supported languages
```

## Known Limitations

- **Browser Support**: Requires a modern browser with WebRTC support (Chrome, Firefox, Edge, Safari)
- **Audio Quality**: Transcription accuracy depends on audio quality and background noise
- **API Costs**: OpenAI Whisper and Lingo.dev have usage-based pricing after free tiers
- **Peer-to-Peer**: Only supports 1:1 video calls (no group calls)

## Contributing

This is a community demo for the Lingo.dev project. Feel free to:
- Report issues
- Suggest improvements
- Submit pull requests

## License

This demo is part of the Lingo.dev community contributions and is licensed under the same terms as the main repository.
