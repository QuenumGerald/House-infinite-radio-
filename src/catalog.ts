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
