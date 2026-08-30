import type { Genre } from '@prisma/client';
export const genres = ['DEEP_HOUSE','MINIMAL_DEEP_TECH','SOULFUL_HOUSE'] as const;
const labels:Record<Genre,string>={DEEP_HOUSE:'deep house',MINIMAL_DEEP_TECH:'minimal deep tech',SOULFUL_HOUSE:'soulful house'};
export type VoiceMode='instrumental'|'single_word'|'short_hook';
export function chooseVoice(random=Math.random):VoiceMode { const n=random(); return n<.65?'instrumental':n<.85?'single_word':'short_hook'; }
export function buildPrompt(genre:Genre,voice:VoiceMode,bpm=123){
  const vocal=voice==='instrumental'?'strictly instrumental, no vocals':voice==='single_word'?'one single word repeated only occasionally, no verses': 'one unique vocal hook of 7 to 9 words maximum, no verses or other lyrics';
  return `${labels[genre]}, ${bpm} BPM, 3 to 5 minutes. Groove-first club track; strong kick, syncopated bassline and restrained percussion; few simultaneous elements; subtle swung hats where appropriate; optional 7th/9th chords. ${vocal}. Clean DJ-friendly intro and outro. No festival EDM, supersaws, huge builds, drops, or generic pop structure.`;
}
export function varyBpm(random=Math.random){return 120+Math.floor(random()*7)}
