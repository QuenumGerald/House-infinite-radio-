import { spawn } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './db.js';
import { config } from './config.js';
import { duration } from './probe.js';

type StreamDestination = { name: 'YouTube' | 'Twitch'; target: string };
type PlaylistTrack = {
  audioPath: string | null;
  title: string;
  artist: string;
  durationSeconds: number | null;
};

type Playlist = { path: string; tracks: PlaylistTrack[] };
const JINGLE_EVERY_TRACKS = 3;

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
    select: { audioPath: true, title: true, artist: true, durationSeconds: true }
  });
  const musicTracks = tracks as PlaylistTrack[];
  const jingleDir = join(config.MEDIA_DIR, 'jingles');
  const jingleFiles = await readdir(jingleDir).then(files => files.filter(file => /^house-radio-jingle-\d+\.mp3$/.test(file)).sort())
    .catch(() => [] as string[]);
  const jingles = await Promise.all(jingleFiles.map(async (file): Promise<PlaylistTrack | null> => {
    const audioPath = join(jingleDir, file);
    try {
      return { audioPath, title: 'Infinite House Radio', artist: 'Station ID', durationSeconds: await duration(audioPath) };
    } catch {
      return null;
    }
  }));
  const usableJingles = jingles.filter((jingle): jingle is PlaylistTrack => jingle !== null);
  const playlistTracks = musicTracks.flatMap((track, index) => {
    const jingle = usableJingles.length && (index + 1) % JINGLE_EVERY_TRACKS === 0
      ? usableJingles[Math.floor(index / JINGLE_EVERY_TRACKS) % usableJingles.length]
      : null;
    return jingle ? [track, jingle] : [track];
  });
  const playlistPath = join(config.MEDIA_DIR, 'stream-playlist.ffconcat');
  const entries = playlistTracks
    .flatMap(track => track.audioPath ? [`file '${quoteConcatPath(track.audioPath)}'`] : [])
    .join('\n');
  if (!entries) throw new Error('No buffered audio tracks available for the stream playlist.');
  await writeFile(playlistPath, `ffconcat version 1.0\n${entries}\n`);
  if (usableJingles.length) console.log(`Inserted ${usableJingles.length} station jingle(s), every ${JINGLE_EVERY_TRACKS} tracks.`);
  return { path: playlistPath, tracks: playlistTracks } satisfies Playlist;
}

function startFfmpeg(playlistPath: string) {
  // `tee` is needed only when two platforms are enabled. Using FLV directly for
  // a single destination avoids an extra muxer layer in the Twitch-only path.
  const output = destinations.length === 1
    ? ['-f', 'flv', destinations[0].target]
    : ['-f', 'tee', destinations.map(item => `[f=flv]${item.target}`).join('|')];
  const titleFile = join(config.MEDIA_DIR, 'current-title.txt');
  // A calm waveform is much lighter than a scrolling spectrum, avoiding both
  // the strobe effect and encoder starvation on a continuous live stream.
  const filter = `[1:a]asetpts=N/SR/TB,asplit=2[audio][visualizer];[visualizer]showspectrum=s=1024x260:mode=combined:color=green:scale=cbrt:slide=scroll,format=rgba[spectrum];[0:v]scale=1280:720,drawtext=text='INFINITE HOUSE RADIO':fontcolor=white:fontsize=42:x=40:y=40:shadowcolor=black:shadowx=2:shadowy=2,drawtext=textfile='${titleFile}':reload=1:fontcolor=white:fontsize=26:x=40:y=100:shadowcolor=black:shadowx=2:shadowy=2[background];[background][spectrum]overlay=128:230:shortest=1[v]`;
  const ffmpeg = spawn('ffmpeg', [
    '-loop', '1', '-framerate', '30', '-i', config.BACKGROUND_PATH,
    '-re', '-f', 'concat', '-safe', '0', '-i', playlistPath,
    '-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[v]', '-map', '[audio]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', ...output
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  ffmpeg.stderr.setEncoding('utf8');
  ffmpeg.stderr.on('data', chunk => process.stderr.write(redactFfmpegOutput(chunk)));
  return ffmpeg;
}

async function updateTitleFile(tracks: PlaylistTrack[]) {
  const titleFile = join(config.MEDIA_DIR, 'current-title.txt');
  for (const track of tracks) {
    await writeFile(titleFile, `NOW PLAYING: ${track.artist} • ${track.title}`);
    const durationMs = Math.max(1, Math.round((track.durationSeconds || 0) * 1000));
    await new Promise(resolve => setTimeout(resolve, durationMs));
  }
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

  const playlist = await buildPlaylist();
  void updateTitleFile(playlist.tracks).catch(error => {
    console.error(`Could not update the on-screen title: ${error instanceof Error ? error.message : error}`);
  });
  const ffmpeg = startFfmpeg(playlist.path);
  ffmpeg.once('close', code => {
    console.error(`FFmpeg exited with code ${code ?? 'unknown'}`);
    process.exit(1);
  });
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
