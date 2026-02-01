export interface Subtitle {
  id: string;
  originalText: string;
  translatedText: string;
  timestamp: number;
  sourceLanguage?: string;
}

export interface RoomState {
  roomId: string;
  isCreator: boolean;
  isConnected: boolean;
}

export interface MediaState {
  isMicOn: boolean;
  isCameraOn: boolean;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
}

export interface TranslationResult {
  translated: string;
  sourceLocale?: string;
}
