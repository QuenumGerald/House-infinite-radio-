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

function startFfmpeg() {
  const titleFile = join(config.MEDIA_DIR, 'current-title.txt');
  const teeTarget = destinations.map(item => `[f=flv]${item.target}`).join('|');
  const filter = `[1:a]showspectrum=s=1440x300:mode=combined:color=channel:scale=cbrt:slide=scroll,format=rgba[fft];[0:v][fft]overlay=240:700,drawtext=text='INFINITE HOUSE RADIO':fontcolor=white:fontsize=54:x=60:y=60,drawtext=textfile='${titleFile}':reload=1:fontcolor=white:fontsize=34:x=60:y=130[v]`;
  const ffmpeg = spawn('ffmpeg', [
    '-stream_loop', '-1', '-framerate', '30', '-i', config.BACKGROUND_PATH,
    '-thread_queue_size', '512', '-re', '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0',
    '-filter_complex', filter, '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-b:v', '4500k', '-maxrate', '4500k', '-bufsize', '9000k',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-f', 'tee', teeTarget
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  ffmpeg.stderr.setEncoding('utf8');
  ffmpeg.stderr.on('data', chunk => process.stderr.write(redactFfmpegOutput(chunk)));
  return ffmpeg;
}

async function feedTrack(audioPath: string, input: NodeJS.WritableStream) {
  const decoder = spawn('ffmpeg', [
    '-v', 'error', '-i', audioPath, '-f', 's16le', '-ar', '44100', '-ac', '2', 'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (!decoder.stdout) throw new Error('Could not open audio decoder output');

  let decoderError = '';
  decoder.stderr.setEncoding('utf8');
  decoder.stderr.on('data', chunk => { decoderError += chunk; });

  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error);
    decoder.stdout.once('error', fail);
    input.once('error', fail);
    decoder.stdout.once('end', resolve);
    decoder.stdout.pipe(input, { end: false });
  });

  const code = await new Promise<number | null>(resolve => decoder.once('close', resolve));
  if (code !== 0) throw new Error(`Audio decoder exited with code ${code}: ${decoderError.trim()}`);
}

async function run() {
  if (!destinations.length) throw new Error('No RTMP destination configured. Set a YouTube or Twitch URL and stream key.');

  // A forced restart can interrupt FFmpeg before the current track is re-buffered.
  const recovered = await db.track.updateMany({ where: { status: 'PLAYING' }, data: { status: 'BUFFERED' } });
  if (recovered.count) console.log(`Recovered ${recovered.count} interrupted track(s) to the buffer.`);

  console.log(`Streaming to ${destinations.map(item => item.name).join(' + ')}.`);
  while (true) {
    const total = await db.track.aggregate({ _sum: { durationSeconds: true }, where: { status: 'BUFFERED' } });
    if ((total._sum.durationSeconds || 0) >= config.MIN_BUFFER_MINUTES * 60) break;
    console.log(`Waiting for ${config.MIN_BUFFER_MINUTES} minute buffer`);
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }

  // Keep this one FFmpeg/RTMP session alive across every track. Concatenated MP3 bytes
  // are fed through stdin, so Twitch sees a continuous broadcast instead of short sessions.
  await writeFile(join(config.MEDIA_DIR, 'current-title.txt'), 'Now playing');
  const ffmpeg = startFfmpeg();
  if (!ffmpeg.stdin) throw new Error('Could not open FFmpeg audio input');
  ffmpeg.once('close', code => {
    console.error(`FFmpeg exited with code ${code ?? 'unknown'}`);
    process.exit(1);
  });

  while (true) {
    const track = await next();
    const audioPath = track?.audioPath;
    if (!track || !audioPath) {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      continue;
    }

    await db.track.update({ where: { id: track.id }, data: { status: 'PLAYING' } });
    await writeFile(join(config.MEDIA_DIR, 'current-title.txt'), track.title);
    try {
      await feedTrack(audioPath, ffmpeg.stdin);
      await db.track.update({ where: { id: track.id }, data: { status: 'PLAYED' } });
    } catch (error) {
      await db.track.update({ where: { id: track.id }, data: { status: 'BUFFERED' } });
      throw error;
    }
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
