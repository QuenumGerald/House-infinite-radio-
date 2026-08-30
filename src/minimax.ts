import { config } from './config.js';
import type { VoiceMode } from './music.js';

export type MiniMaxPayload = {
  model: string;
  payload: {
    lyrics: string;
    prompt: string;
    sample_rate?: number;
    bitrate?: number;
    format?: string;
  };
};

export function buildLyrics(voice: VoiceMode = 'instrumental'): string {
  if (voice === 'instrumental') {
    return '[instrumental]\n[groove]\n[beat]';
  }
  if (voice === 'single_word') {
    const words = ['Space', 'Dub', 'Shift', 'Deep', 'House', 'Move', 'Soul', 'Pulse'];
    const w = words[Math.floor(Math.random() * words.length)];
    return `[hook]\n${w}\n\n[beat]\n${w}`;
  }
  const hooks = [
    'Feel the rhythm move inside the night',
    'Lost in the sound when the bassline drops',
    'Keep on moving till the morning light',
    'Deep in the music where we belong'
  ];
  const h = hooks[Math.floor(Math.random() * hooks.length)];
  return `[hook]\n${h}\n\n[groove]\n${h}`;
}

export function payload(prompt: string, lyrics?: string): MiniMaxPayload {
  return {
    model: config.MINIMAX_MODEL || 'minimax-music-3.0',
    payload: {
      lyrics: lyrics || '[instrumental]\n[groove]\n[beat]',
      prompt,
      sample_rate: 44100,
      bitrate: 256000,
      format: 'mp3'
    }
  };
}

export async function generateMusic(body: MiniMaxPayload, maxRetries = 3): Promise<Uint8Array> {
  const endpoint = config.GMI_BASE_URL.includes('console.gmicloud.ai')
    ? `${config.GMI_BASE_URL}/api/v1/ie/requestqueue/apikey/requests`
    : 'https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests';

  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.GMI_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`GMI generation failed (${response.status}): ${await response.text()}`);
      }

      const type = response.headers.get('content-type') || '';
      if (type.startsWith('audio/')) {
        return new Uint8Array(await response.arrayBuffer());
      }

      const result = (await response.json()) as any;
      const url =
        result.outcome?.audio_url ||
        result.outcome?.media_urls?.[0]?.url ||
        result.audio_url ||
        result.data?.audio_url;

      if (!url) {
        throw new Error(`GMI response did not contain audio: ${JSON.stringify(result)}`);
      }

      const audio = await fetch(url);
      if (!audio.ok) {
        throw new Error(`Audio download failed (${audio.status})`);
      }

      return new Uint8Array(await audio.arrayBuffer());
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = attempt * 3000;
        console.warn(`[GMI Music] Tentative ${attempt}/${maxRetries} échouée (${err?.message || err}). Nouvelle tentative dans ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}
