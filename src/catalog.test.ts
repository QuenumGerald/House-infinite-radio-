import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { libraryAudioPath, parseRadioDump } from './catalog.js';

const fixture = `
COPY public."Recipe" (id, genre, prompt, approved, "createdAt") FROM stdin;
rec1	DEEP_HOUSE	Warm deep house prompt	t	2026-08-30 11:34:46.379
rec2	SOULFUL_HOUSE	Legacy genre ignored	f	2026-08-30 11:34:46.379
rec3	DRUM_AND_BASS	Reese sub prompt	t	2026-08-30 11:35:02.312
\\.

COPY public."Track" (id, title, genre, status, "audioPath", "durationSeconds", "minimaxPayload", "recipeId", "createdAt", "updatedAt", artist) FROM stdin;
trk1	Velvet Shift	DEEP_HOUSE	REJECTED	/data/media/trk1.mp3	118.9	{"source":"dump"}	rec1	2026-08-30 11:35:14.802	2026-08-30 18:30:18.174	Velvet Current
trk2	Missing File	DEEP_HOUSE	BUFFERED	\\N	90	{"source":"dump"}	rec1	2026-08-30 11:35:14.802	2026-08-30 18:30:18.174	Velvet Current
trk3	Signal Cascade	DRUM_AND_BASS	BUFFERED	/data/media/trk3.mp3	103.8	{"source":"dump"}	rec3	2026-08-30 11:35:02.317	2026-08-30 18:34:22.552	Kinetic Vale
trk4	Orphan	DEEP_HOUSE	BUFFERED	/data/media/trk4.mp3	80	{"source":"dump"}	missing	2026-08-30 11:35:02.317	2026-08-30 18:34:22.552	Unknown
\\.
`;

describe('library catalog', () => {
  it('keeps supported recipes and playable tracks from the dump', () => {
    const catalog = parseRadioDump(fixture);
    expect(catalog.recipes.map(recipe => recipe.id)).toEqual(['rec1', 'rec3']);
    expect(catalog.tracks).toEqual([
      { id: 'trk1', title: 'Velvet Shift', artist: 'Velvet Current', genre: 'DEEP_HOUSE', durationSeconds: 118.9, recipeId: 'rec1', fileName: 'trk1.mp3' },
      { id: 'trk3', title: 'Signal Cascade', artist: 'Kinetic Vale', genre: 'DRUM_AND_BASS', durationSeconds: 103.8, recipeId: 'rec3', fileName: 'trk3.mp3' }
    ]);
  });

  it('rewrites seeded audio onto the configured media directory', () => {
    expect(libraryAudioPath('/data/media', 'trk1.mp3')).toBe('/data/media/trk1.mp3');
    expect(libraryAudioPath('./data/media/', '../trk1.mp3')).toBe('./data/media/trk1.mp3');
  });

  it('imports the exported station dump', async () => {
    const catalog = parseRadioDump(await readFile('deploy-export/radio.sql', 'utf8'));
    expect(catalog.recipes).toHaveLength(28);
    expect(catalog.tracks).toHaveLength(28);
    expect(catalog.tracks.every(track => track.fileName.endsWith('.mp3'))).toBe(true);
  });
});
