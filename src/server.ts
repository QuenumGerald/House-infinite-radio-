import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { Genre, TrackStatus } from '@prisma/client';
import { createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { db } from './db.js';
import { config } from './config.js';
import { generationQueue } from './queue.js';
import { chooseArtist, chooseVoice, genres, varyBpm } from './music.js';
import { payload } from './minimax.js';
import { generateLyricsAndPromptWithM3 } from './llm.js';

const app = Fastify({ logger: true });
await app.register(cors);
await app.register(fastifyStatic, { root: join(process.cwd(), 'public') });

app.get('/health', () => ({ ok: true }));

app.get('/api/tracks', async req => {
  const q = req.query as { status?: TrackStatus };
  return db.track.findMany({
    where: q.status ? { status: q.status } : {},
    orderBy: { createdAt: 'desc' },
    take: 100
  });
});

app.post('/api/generations', async (req, reply) => {
  const { genre } = req.body as { genre: Genre };
  if (!genres.includes(genre)) return reply.code(400).send({ error: 'Unsupported genre' });

  const voice = chooseVoice();
  const bpm = varyBpm(genre);
  const artist = chooseArtist(genre);
  const { prompt, lyrics, title } = await generateLyricsAndPromptWithM3(genre, voice, bpm, artist);

  const recipe = await db.recipe.create({ data: { genre, prompt } });
  const body = payload(prompt, lyrics);
  const track = await db.track.create({
    data: {
      title,
      artist,
      genre,
      recipeId: recipe.id,
      minimaxPayload: body as any
    }
  });

  await generationQueue.add('generate', { trackId: track.id });
  return reply.code(202).send(track);
});

app.post('/api/tracks/:id/decision', async (req, reply) => {
  const { id } = req.params as { id: string };
  const { decision } = req.body as { decision: 'KEEP' | 'REJECT' };
  if (!['KEEP', 'REJECT'].includes(decision)) return reply.code(400).send({ error: 'Invalid decision' });

  const track = await db.track.findUnique({ where: { id } });
  if (!track || track.status !== 'CALIBRATION') return reply.code(409).send({ error: 'Track is not awaiting calibration' });

  return db.$transaction([
    db.track.update({ where: { id }, data: { status: decision === 'KEEP' ? 'BUFFERED' : 'REJECTED' } }),
    ...(decision === 'KEEP' ? [db.recipe.update({ where: { id: track.recipeId }, data: { approved: true } })] : [])
  ]);
});

app.get('/media/:name', async (req, reply) => {
  const name = basename((req.params as { name: string }).name);
  return reply.type('audio/mpeg').send(createReadStream(join(config.MEDIA_DIR, name)));
});

app.listen({ host: '0.0.0.0', port: config.PORT }).catch(e => {
  app.log.error(e);
  process.exit(1);
});
