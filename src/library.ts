import { access, copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import {
  inferTrackFromFileName,
  isLibraryAudioFile,
  libraryAudioPath,
  librarySourceDirectories,
  libraryTrackId,
  parseRadioDump,
  type LibraryCatalog,
  type LibraryGenre,
  type LibraryTrack
} from './catalog.js';
import { duration } from './probe.js';

export async function loadCatalog(dumpPath = config.LIBRARY_DUMP): Promise<LibraryCatalog> {
  try {
    return parseRadioDump(await readFile(dumpPath, 'utf8'));
  } catch {
    return { recipes: [], tracks: [] };
  }
}

export async function listLibraryAudioFiles(directories = librarySourceDirectories(config.MEDIA_DIR, config.LIBRARY_DIRS)) {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const directory of directories) {
    const entries = await readdir(directory).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!isLibraryAudioFile(entry) || seen.has(entry)) continue;
      seen.add(entry);
      files.push(join(directory, entry));
    }
  }
  return files;
}

async function ensureRecipe(id: string, genre: LibraryGenre, prompt: string) {
  await db.recipe.upsert({
    where: { id },
    create: { id, genre, prompt, approved: true },
    update: { prompt, approved: true }
  });
}

async function upsertTrack(input: {
  id: string;
  title: string;
  artist: string;
  genre: LibraryGenre;
  recipeId: string;
  destination: string;
  durationSeconds: number;
}) {
  const existing = await db.track.findUnique({ where: { id: input.id }, select: { status: true } });
  await db.track.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      title: input.title,
      artist: input.artist,
      genre: input.genre,
      status: 'BUFFERED',
      audioPath: input.destination,
      durationSeconds: input.durationSeconds,
      minimaxPayload: { source: 'library' },
      recipeId: input.recipeId
    },
    update: {
      title: input.title,
      artist: input.artist,
      genre: input.genre,
      audioPath: input.destination,
      durationSeconds: input.durationSeconds,
      status: existing?.status === 'PLAYING' ? 'PLAYING' : 'BUFFERED'
    }
  });
}

function metadataFor(
  fileName: string,
  dumpByFile: Map<string, LibraryTrack>,
  dbById: Map<string, { id: string; title: string; artist: string; genre: string; recipeId: string; durationSeconds: number | null }>,
  dbByFile: Map<string, { id: string; title: string; artist: string; genre: string; recipeId: string; durationSeconds: number | null }>
) {
  const inferred = inferTrackFromFileName(fileName);
  const id = libraryTrackId(fileName);
  const dump = dumpByFile.get(fileName);
  const stored = dbById.get(id) || dbByFile.get(fileName);
  return {
    id: dump?.id || stored?.id || id,
    title: dump?.title || stored?.title || inferred.title,
    artist: dump?.artist || stored?.artist || inferred.artist,
    genre: (dump?.genre || stored?.genre || inferred.genre) as LibraryGenre,
    recipeId: dump?.recipeId || stored?.recipeId || `library-file-${inferred.genre}`,
    durationSeconds: dump?.durationSeconds || stored?.durationSeconds || 0
  };
}

export async function seedLibrary() {
  const catalog = await loadCatalog();
  await mkdir(config.MEDIA_DIR, { recursive: true });

  for (const recipe of catalog.recipes) {
    await ensureRecipe(recipe.id, recipe.genre, recipe.prompt);
  }

  const stored = await db.track.findMany({
    select: { id: true, title: true, artist: true, genre: true, recipeId: true, durationSeconds: true, audioPath: true }
  });
  const dumpByFile = new Map(catalog.tracks.map(track => [track.fileName, track]));
  const dbById = new Map(stored.map(track => [track.id, track]));
  const dbByFile = new Map(
    stored.filter(track => track.audioPath).map(track => [basename(track.audioPath as string), track])
  );

  let imported = 0;
  for (const source of await listLibraryAudioFiles()) {
    const fileName = basename(source);
    const destination = libraryAudioPath(config.MEDIA_DIR, fileName);
    if (source !== destination) {
      await copyFile(source, destination);
    }

    const meta = metadataFor(fileName, dumpByFile, dbById, dbByFile);
    if (!catalog.recipes.some(recipe => recipe.id === meta.recipeId) && !stored.some(track => track.recipeId === meta.recipeId)) {
      await ensureRecipe(meta.recipeId, meta.genre, 'Imported local audio file');
    }

    let durationSeconds = meta.durationSeconds;
    if (!durationSeconds) {
      try {
        durationSeconds = await duration(destination);
      } catch {
        console.warn(`[library] Could not probe duration for ${fileName}`);
      }
    }

    await upsertTrack({ ...meta, destination, durationSeconds });
    imported += 1;
  }

  console.log(`[library] Indexed ${imported} tracks from the server media directory`);
  return { recipes: catalog.recipes.length, tracks: imported, extras: Math.max(0, imported - catalog.tracks.length) };
}
