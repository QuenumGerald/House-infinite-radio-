import { describe, expect, it } from 'vitest';
import { buildPrompt, chooseArtist, chooseVoice, varyBpm } from './music.js';

describe('music rules', () => {
  it('implements vocal boundaries', () => {
    expect(chooseVoice(() => 0.64)).toBe('instrumental');
    expect(chooseVoice(() => 0.65)).toBe('single_word');
    expect(chooseVoice(() => 0.85)).toBe('short_hook');
  });

  it('keeps BPM in range', () => {
    expect(varyBpm(() => 0)).toBe(120);
    expect(varyBpm(() => 0.999)).toBe(126);
  });

  it('includes golden blueprint constraints', () => {
    const p = buildPrompt('DEEP_HOUSE', 'instrumental', 123);
    expect(p).toContain('Deep House');
    expect(p).toContain('Starts with clean DJ mixing intro of isolated 4/4 kick drum and hi-hats');
    expect(p).toContain('rolling bassline enters gradually');
    expect(p).toContain('Clean DJ outro. No EDM drops, no supersaws');
  });

  it('uses a drum and bass-specific blueprint and tempo range', () => {
    const p = buildPrompt('DRUM_AND_BASS', 'instrumental', 174, 'Vector Rain');
    expect(p).toContain('Drum & Bass, 174 BPM');
    expect(p).toContain('two-step break');
    expect(varyBpm('DRUM_AND_BASS', () => 0)).toBe(170);
    expect(varyBpm('DRUM_AND_BASS', () => 0.999)).toBe(176);
    expect(chooseArtist('DRUM_AND_BASS', () => 0)).toBe('Vector Rain');
  });
});
