import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './db.js';
import { config } from './config.js';

type StreamDestination = { name: 'YouTube' | 'Twitch'; target: string };

function destination(url: string, key: string, name: StreamDestination['name']): StreamDestination | null {
  const cleanUrl = url.trim().replace(/\/+$/, '');
  const cleanKey = key.trim();
  return cleanUrl && cleanKey ? { name, target: `${cleanUrl}/${cleanKey}` } : null;
}

const destinations = [
  destination(config.YOUTUBE_RTMPS_URL, config.YOUTUBE_STREAM_KEY, 'YouTube'),
  destination(config.TWITCH_RTMP_URL, config.TWITCH_STREAM_KEY, 'Twitch')
].filter((item): item is StreamDestination => item !== null);

function redactFfmpegOutput(message: string) {
  return destinations.reduce((redacted, item) => redacted.replaceAll(item.target, `[${item.name} RTMP destination]`), message);
}

async function next() {
  return db.track.findFirst({ where: { status: 'BUFFERED', audioPath: { not: null } }, orderBy: { createdAt: 'asc' } });
}

async function runFfmpeg(track: { title: string; audioPath: string }) {
  const titleFile = join(config.MEDIA_DIR, 'current-title.txt');
  await writeFile(titleFile, track.title);

  // The tee muxer copies the one encoded A/V stream to every active RTMP destination.
  const teeTarget = destinations.map(item => `[f=flv]${item.target}`).join('|');
  const filter = `[1:a]showspectrum=s=1440x300:mode=combined:color=channel:scale=cbrt:slide=scroll,format=rgba[fft];[0:v][fft]overlay=240:700,drawtext=text='INFINITE HOUSE RADIO':fontcolor=white:fontsize=54:x=60:y=60,drawtext=textfile='${titleFile}':reload=1:fontcolor=white:fontsize=34:x=60:y=130[v]`;
  const ffmpeg = spawn('ffmpeg', [
    '-re', '-loop', '1', '-i', config.BACKGROUND_PATH, '-i', track.audioPath,
    '-filter_complex', filter, '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-r', '30', '-g', '60',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-shortest', '-f', 'tee', teeTarget
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  ffmpeg.stderr.setEncoding('utf8');
  ffmpeg.stderr.on('data', chunk => process.stderr.write(redactFfmpegOutput(chunk)));
  return new Promise<number | null>(resolve => ffmpeg.on('close', resolve));
}

async function run() {
  if (!destinations.length) {
    throw new Error('No RTMP destination configured. Set a YouTube or Twitch URL and stream key.');
  }

  console.log(`Streaming to ${destinations.map(item => item.name).join(' + ')}.`);
  let started = false;
  while (true) {
    if (!started) {
      const total = await db.track.aggregate({ _sum: { durationSeconds: true }, where: { status: 'BUFFERED' } });
      if ((total._sum.durationSeconds || 0) < config.MIN_BUFFER_MINUTES * 60) {
        console.log(`Waiting for ${config.MIN_BUFFER_MINUTES} minute buffer`);
        await new Promise(resolve => setTimeout(resolve, 10_000));
        continue;
      }
      started = true;
    }

    const track = await next();
    const audioPath = track?.audioPath;
    if (!track || !audioPath) {
      await new Promise(resolve => setTimeout(resolve, 10_000));
      continue;
    }

    await db.track.update({ where: { id: track.id }, data: { status: 'PLAYING' } });
    const code = await runFfmpeg({ title: track.title, audioPath });
    await db.track.update({ where: { id: track.id }, data: { status: code === 0 ? 'PLAYED' : 'BUFFERED' } });
    if (code !== 0) await new Promise(resolve => setTimeout(resolve, 5_000));
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
