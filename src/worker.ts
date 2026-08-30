import { Worker } from 'bullmq';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connection, generationQueue } from './queue.js';
import { db } from './db.js';
import { config } from './config.js';
import { generateMusic, payload } from './minimax.js';
import { duration } from './probe.js';
import { chooseArtist, chooseVoice, varyBpm } from './music.js';
import { generateLyricsAndPromptWithM3 } from './llm.js';

await mkdir(config.MEDIA_DIR, { recursive: true });

new Worker(
  'music-generation',
  async job => {
    const track = await db.track.findUniqueOrThrow({
      where: { id: job.data.trackId },
      include: { recipe: true }
    });

    try {
      const bytes = await generateMusic(track.minimaxPayload as any);
      const path = join(config.MEDIA_DIR, `${track.id}.mp3`);
      await writeFile(path, bytes);
      await db.track.update({
        where: { id: track.id },
        data: {
          audioPath: path,
          durationSeconds: await duration(path),
          status: track.recipe.approved ? 'BUFFERED' : 'CALIBRATION'
        }
      });
    } catch (e) {
      await db.track.update({ where: { id: track.id }, data: { status: 'FAILED' } });
      throw e;
    }
  },
  { connection }
);

async function refill() {
  if (!config.AUTONOMOUS) return;

  const aggregate = await db.track.aggregate({
    _sum: { durationSeconds: true },
    where: { status: 'BUFFERED' }
  });

  if ((aggregate._sum.durationSeconds || 0) >= config.TARGET_BUFFER_MINUTES * 60) return;

  const recipes = await db.recipe.findMany({ where: { approved: true } });
  if (!recipes.length) return;

  const recipe = recipes[Math.floor(Math.random() * recipes.length)];
  const voice = chooseVoice();
  const bpm = varyBpm(recipe.genre);
  const artist = chooseArtist(recipe.genre);
  const { prompt, lyrics, title } = await generateLyricsAndPromptWithM3(recipe.genre, voice, bpm, artist);
  const p = payload(prompt, lyrics);

  const track = await db.track.create({
    data: {
      title,
      artist,
      genre: recipe.genre,
      recipeId: recipe.id,
      minimaxPayload: p as any
    }
  });

  await generationQueue.add('generate', { trackId: track.id });
}

setInterval(refill, 30_000);
void refill();
