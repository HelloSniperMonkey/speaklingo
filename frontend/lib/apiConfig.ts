/**
 * API Configuration
 * 
 * Determines the correct API endpoints based on environment.
 * - dev: Uses localhost endpoints directly
 * - prod: Routes through load balancer (local or via Cloudflare tunnel)
 */

// Environment check
const API_ENV = process.env.NEXT_PUBLIC_API_ENV || 'dev';
const IS_PROD = API_ENV === 'prod';

// Load balancer configuration
const LOADBALANCER_URL = process.env.NEXT_PUBLIC_LOADBALANCER_URL || 'http://localhost:8089';
const WS_PROTOCOL = process.env.NEXT_PUBLIC_WS_PROTOCOL || 'ws';

// Parse load balancer URL to get host for WebSocket
const getLbHost = (): string => {
  try {
    const url = new URL(LOADBALANCER_URL);
    return url.host;
  } catch {
    return 'localhost:8089';
  }
};

const LB_HOST = getLbHost();

// Direct service ports (for dev mode)
const DIRECT_PORTS = {
  transcription: 8765,      // Google Transcription WS
  transcriptionBroadcast: 8766,  // Transcription Broadcast WS
  translation: 8767,        // Translation WS
  voice: 8768,              // Voice WS
  translationHttp: 8766,    // Translation HTTP
  voiceHttp: 8712,          // Voice HTTP
};

/**
 * API Endpoints configuration
 */
export const API_CONFIG = {
  env: API_ENV,
  isProd: IS_PROD,
  loadbalancer: LOADBALANCER_URL,
  
  // WebSocket URLs
  ws: {
    transcription: IS_PROD 
      ? `${WS_PROTOCOL}://${LB_HOST}/ws/transcription`
      : `ws://localhost:${DIRECT_PORTS.transcription}`,
    
    transcriptionBroadcast: IS_PROD
      ? `${WS_PROTOCOL}://${LB_HOST}/ws/transcription-sub`
      : `ws://localhost:${DIRECT_PORTS.transcriptionBroadcast}`,
    
    translation: IS_PROD
      ? `${WS_PROTOCOL}://${LB_HOST}/ws/translation`
      : `ws://localhost:${DIRECT_PORTS.translation}`,
    
    voice: IS_PROD
      ? `${WS_PROTOCOL}://${LB_HOST}/ws/voice`
      : `ws://localhost:${DIRECT_PORTS.voice}`,
  },
  
  // HTTP API URLs
  http: {
    translation: IS_PROD
      ? `${LOADBALANCER_URL}/api/translate`
      : `http://localhost:${DIRECT_PORTS.translationHttp}`,
    
    voice: IS_PROD
      ? `${LOADBALANCER_URL}/api/voice`
      : `http://localhost:${DIRECT_PORTS.voiceHttp}`,
    
    transcription: IS_PROD
      ? `${LOADBALANCER_URL}/api/transcription`
      : `http://localhost:${DIRECT_PORTS.transcription}`,
  },
};

// Log configuration in development
if (typeof window !== 'undefined') {
  console.log('[API Config]', {
    env: API_CONFIG.env,
    isProd: API_CONFIG.isProd,
    loadbalancer: API_CONFIG.loadbalancer,
  });
}

export default API_CONFIG;
