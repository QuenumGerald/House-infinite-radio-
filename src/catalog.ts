import { basename } from 'node:path';
import { genres } from './music.js';

export type LibraryGenre = (typeof genres)[number];

export type LibraryRecipe = {
  id: string;
  genre: LibraryGenre;
  prompt: string;
  approved: boolean;
};

export type LibraryTrack = {
  id: string;
  title: string;
  artist: string;
  genre: LibraryGenre;
  durationSeconds: number;
  recipeId: string;
  fileName: string;
};

export type LibraryCatalog = {
  recipes: LibraryRecipe[];
  tracks: LibraryTrack[];
};

const supported = new Set<string>(genres);

function copyRows(sql: string, table: string): string[] {
  const marker = `COPY public."${table}"`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${table} dump`);
  const after = sql.slice(start);
  const stdin = after.indexOf('FROM stdin;\n');
  if (stdin < 0) throw new Error(`Missing ${table} rows`);
  const body = after.slice(stdin + 'FROM stdin;\n'.length);
  const end = body.indexOf('\n\\.\n');
  if (end < 0) throw new Error(`Unterminated ${table} dump`);
  return body.slice(0, end).split('\n').filter(Boolean);
}

export function parseRadioDump(sql: string): LibraryCatalog {
  const recipes: LibraryRecipe[] = [];
  for (const line of copyRows(sql, 'Recipe')) {
    const [id, genre, prompt, approved] = line.split('\t');
    if (!supported.has(genre)) continue;
    recipes.push({
      id,
      genre: genre as LibraryGenre,
      prompt,
      approved: approved === 't'
    });
  }

  const recipeIds = new Set(recipes.map(recipe => recipe.id));
  const tracks: LibraryTrack[] = [];
  for (const line of copyRows(sql, 'Track')) {
    const [id, title, genre, , audioPath, durationSeconds, , recipeId, , , artist] = line.split('\t');
    if (!supported.has(genre) || !recipeIds.has(recipeId)) continue;
    if (!audioPath || audioPath === '\\N') continue;
    tracks.push({
      id,
      title,
      artist,
      genre: genre as LibraryGenre,
      durationSeconds: Number(durationSeconds),
      recipeId,
      fileName: basename(audioPath)
    });
  }

  return { recipes, tracks };
}

export function libraryAudioPath(mediaDir: string, fileName: string) {
  return `${mediaDir.replace(/\/+$/, '')}/${basename(fileName)}`;
}

export function librarySourceDirectories(mediaDir: string, extraDirs: string[] = []) {
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const directory of [mediaDir, ...extraDirs]) {
    const normalized = directory.replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    directories.push(normalized);
  }
  return directories;
}

export function isLibraryAudioFile(fileName: string) {
  const name = basename(fileName);
  return /\.mp3$/i.test(name) && !name.startsWith('.') && !/^(current-title|stream-playlist)/i.test(name);
}

const genreTokens: Record<string, LibraryGenre> = {
  deep_house: 'DEEP_HOUSE',
  minimal_deep_tech: 'MINIMAL_DEEP_TECH',
  drum_and_bass: 'DRUM_AND_BASS'
};

const knownArtists = [
  'Velvet Current', 'Mira Solace', 'Night Terrace',
  'Static Parcel', 'Lumen Tool', 'Low Orbit',
  'Vector Rain', 'Subphase', 'Kinetic Vale'
];

function humanize(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()).trim();
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function inferTrackFromFileName(fileName: string): { title: string; artist: string; genre: LibraryGenre } {
  const base = basename(fileName).replace(/\.mp3$/i, '');
  const match = base.match(/^(.*)_(deep_house|minimal_deep_tech|drum_and_bass)_\d+bpm_/i);
  if (match) {
    const prefix = match[1];
    const genre = genreTokens[match[2].toLowerCase()];
    const artist = knownArtists.find(name => prefix === slug(name) || prefix.startsWith(`${slug(name)}_`));
    if (artist) {
      const title = humanize(prefix.slice(slug(artist).length).replace(/^_+/, '')) || humanize(prefix);
      return { title, artist, genre };
    }
    return { title: humanize(prefix), artist: 'Archive', genre };
  }
  return { title: humanize(base), artist: 'Archive', genre: 'DEEP_HOUSE' };
}

export function libraryTrackId(fileName: string) {
  const base = basename(fileName).replace(/\.mp3$/i, '');
  if (/^c[a-z0-9]{20,}$/i.test(base)) return base;
  return `lib_${slug(base).slice(0, 64)}`;
}
