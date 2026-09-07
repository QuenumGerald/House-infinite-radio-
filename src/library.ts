import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { libraryAudioPath, parseRadioDump, type LibraryCatalog } from './catalog.js';

export async function loadCatalog(dumpPath = config.LIBRARY_DUMP): Promise<LibraryCatalog> {
  return parseRadioDump(await readFile(dumpPath, 'utf8'));
}

export async function seedLibrary() {
  const catalog = await loadCatalog();
  await mkdir(config.MEDIA_DIR, { recursive: true });

  for (const recipe of catalog.recipes) {
    await db.recipe.upsert({
      where: { id: recipe.id },
      create: { id: recipe.id, genre: recipe.genre, prompt: recipe.prompt, approved: true },
      update: { prompt: recipe.prompt, approved: true }
    });
  }

  let imported = 0;
  for (const track of catalog.tracks) {
    const source = join(config.LIBRARY_DIR, track.fileName);
    const destination = libraryAudioPath(config.MEDIA_DIR, track.fileName);
    try {
      await access(source);
    } catch {
      console.warn(`[library] Missing audio ${source}, skipping ${track.id}`);
      continue;
    }

    await copyFile(source, destination);
    const existing = await db.track.findUnique({ where: { id: track.id }, select: { status: true } });
    await db.track.upsert({
      where: { id: track.id },
      create: {
        id: track.id,
        title: track.title,
        artist: track.artist,
        genre: track.genre,
        status: 'BUFFERED',
        audioPath: destination,
        durationSeconds: track.durationSeconds,
        minimaxPayload: { source: 'library' },
        recipeId: track.recipeId
      },
      update: {
        title: track.title,
        artist: track.artist,
        genre: track.genre,
        audioPath: destination,
        durationSeconds: track.durationSeconds,
        status: existing?.status === 'PLAYING' ? 'PLAYING' : 'BUFFERED'
      }
    });
    imported += 1;
  }

  console.log(`[library] Seeded ${imported} local tracks`);
  return { recipes: catalog.recipes.length, tracks: imported };
}
