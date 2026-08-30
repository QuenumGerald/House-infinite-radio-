import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './db.js';
import { config } from './config.js';

type StreamDestination = { name: 'YouTube' | 'Twitch'; target: string };
type PlaylistTrack = { audioPath: string | null };

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

function quoteConcatPath(path: string) {
  return path.replaceAll("'", "'\\\\''");
}

async function buildPlaylist() {
  const tracks = await db.track.findMany({
    where: { status: 'BUFFERED', audioPath: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { audioPath: true }
  });
  const playlistPath = join(config.MEDIA_DIR, 'stream-playlist.ffconcat');
  const entries = (tracks as PlaylistTrack[])
    .flatMap(track => track.audioPath ? [`file '${quoteConcatPath(track.audioPath)}'`] : [])
    .join('\n');
  if (!entries) throw new Error('No buffered audio tracks available for the stream playlist.');
  await writeFile(playlistPath, `ffconcat version 1.0\n${entries}\n`);
  return playlistPath;
}

function startFfmpeg(playlistPath: string) {
  const titleFile = join(config.MEDIA_DIR, 'current-title.txt');
  const teeTarget = destinations.map(item => `[f=flv]${item.target}`).join('|');
  // Keep the RTMP transport deliberately simple and stable. The audio timestamps from
  // concat MP3 files are normalised before encoding; the visualiser is not on this
  // critical path, so it cannot stall the broadcast.
  const filter = `[0:v]drawtext=text='INFINITE HOUSE RADIO':fontcolor=white:fontsize=54:x=60:y=60,drawtext=textfile='${titleFile}':reload=1:fontcolor=white:fontsize=34:x=60:y=130[v];[1:a]asetpts=N/SR/TB[a]`;
  const ffmpeg = spawn('ffmpeg', [
    '-loop', '1', '-framerate', '30', '-i', config.BACKGROUND_PATH,
    '-re', '-f', 'concat', '-safe', '0', '-i', playlistPath,
    '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-b:v', '4500k', '-maxrate', '4500k', '-bufsize', '9000k',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-f', 'tee', teeTarget
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  ffmpeg.stderr.setEncoding('utf8');
  ffmpeg.stderr.on('data', chunk => process.stderr.write(redactFfmpegOutput(chunk)));
  return ffmpeg;
}

async function run() {
  if (!destinations.length) throw new Error('No RTMP destination configured. Set a YouTube or Twitch URL and stream key.');

  const recovered = await db.track.updateMany({ where: { status: 'PLAYING' }, data: { status: 'BUFFERED' } });
  if (recovered.count) console.log(`Recovered ${recovered.count} interrupted track(s) to the buffer.`);

  console.log(`Streaming to ${destinations.map(item => item.name).join(' + ')}.`);
  while (true) {
    const total = await db.track.aggregate({ _sum: { durationSeconds: true }, where: { status: 'BUFFERED' } });
    if ((total._sum.durationSeconds || 0) >= config.MIN_BUFFER_MINUTES * 60) break;
    console.log(`Waiting for ${config.MIN_BUFFER_MINUTES} minute buffer`);
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }

  await writeFile(join(config.MEDIA_DIR, 'current-title.txt'), 'Continuous mix');
  const ffmpeg = startFfmpeg(await buildPlaylist());
  ffmpeg.once('close', code => {
    console.error(`FFmpeg exited with code ${code ?? 'unknown'}`);
    process.exit(1);
  });
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
