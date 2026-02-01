import { LingoDotDevEngine } from "@lingo.dev/_sdk";

// Server-side only - create engine instance
export function createLingoEngine() {
  const apiKey = process.env.LINGODOTDEV_API_KEY;
  
  if (!apiKey) {
    throw new Error("LINGODOTDEV_API_KEY is not configured");
  }

  return new LingoDotDevEngine({
    apiKey,
  });
}
