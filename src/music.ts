import type { Genre } from '@prisma/client';

export const genres = ['DEEP_HOUSE', 'MINIMAL_DEEP_TECH', 'DRUM_AND_BASS'] as const;

const soundDesigns: Record<Genre, string> = {
  MINIMAL_DEEP_TECH: 'Tight clicky 909/808 kick, continuous rolling sub-bassline, micro-percussion, sparse dub delay stabs',
  DEEP_HOUSE: 'Warm punchy 909 kick with 58% swing, deep syncopated Juno-106 sub-bassline, sampled Fender Rhodes minor 7th/9th stabs, subtle tape saturation',
  DRUM_AND_BASS: 'Tight rolling two-step breakbeat, weighty reese sub-bass, shuffled ghost snares, atmospheric pads, precise bass edits and restrained jungle percussion'
};

const labels: Record<Genre, string> = {
  MINIMAL_DEEP_TECH: 'Minimal / Deep Tech & Microhouse',
  DEEP_HOUSE: 'Deep House',
  DRUM_AND_BASS: 'Drum & Bass'
};

export const artistsByGenre: Record<Genre, readonly string[]> = {
  DEEP_HOUSE: ['Velvet Current', 'Mira Solace', 'Night Terrace'],
  MINIMAL_DEEP_TECH: ['Static Parcel', 'Lumen Tool', 'Low Orbit'],
  DRUM_AND_BASS: ['Vector Rain', 'Subphase', 'Kinetic Vale']
};

export type VoiceMode = 'instrumental' | 'single_word' | 'short_hook';

export function chooseVoice(random = Math.random): VoiceMode {
  const n = random();
  return n < 0.65 ? 'instrumental' : n < 0.85 ? 'single_word' : 'short_hook';
}

export function chooseArtist(genre: Genre, random = Math.random) {
  const artists = artistsByGenre[genre];
  return artists[Math.floor(random() * artists.length)];
}

export function buildPrompt(genre: Genre, voice: VoiceMode, bpm = 123, artist = chooseArtist(genre)) {
  const label = labels[genre];
  const sound = soundDesigns[genre];
  const arrangement = genre === 'DRUM_AND_BASS'
    ? 'Starts with an atmospheric DJ-mixable intro: filtered break fragments and distant percussion, then the full two-step break and sub enter progressively. Keep tension through 16-bar variations, not a festival drop.'
    : 'Starts with clean DJ mixing intro of isolated 4/4 kick drum and hi-hats, rolling bassline enters gradually. Hypnotic continuous groove with subtle evolutionary changes every 16 to 32 bars.';
  return `${label}, ${bpm} BPM, original artist identity: ${artist}. ${arrangement} ${sound}. Clean DJ outro. No EDM drops, no supersaws.`;
}

export function varyBpm(genreOrRandom: Genre | (() => number) = 'DEEP_HOUSE', suppliedRandom = Math.random) {
  const genre = typeof genreOrRandom === 'function' ? 'DEEP_HOUSE' : genreOrRandom;
  const random = typeof genreOrRandom === 'function' ? genreOrRandom : suppliedRandom;
  return genre === 'DRUM_AND_BASS' ? 170 + Math.floor(random() * 7) : 120 + Math.floor(random() * 7);
}
