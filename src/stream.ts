import { spawn } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './db.js';
import { config } from './config.js';
import { completeTrack, reserveNextTrack, type StreamTrack } from './stream-selection.js';

type Destination = { name: 'YouTube' | 'Twitch'; target: string };
type Jingle = Pick<StreamTrack, 'audioPath' | 'title' | 'artist'>;
const PCM_BYTES_PER_SECOND = 44_100 * 2 * 2;

function destination(url: string, key: string, name: Destination['name']): Destination | null {
  const base = url.trim().replace(/\/+$/, '');
  return base && key.trim() ? { name, target: `${base}/${key.trim()}` } : null;
}
const destinations = [destination(config.YOUTUBE_RTMPS_URL, config.YOUTUBE_STREAM_KEY, 'YouTube'), destination(config.TWITCH_RTMP_URL, config.TWITCH_STREAM_KEY, 'Twitch')].filter((item): item is Destination => item !== null);
const titleFile = join(config.MEDIA_DIR, 'current-title.txt');
const VIDEO_OVERLAY_FILTER = [
  "[1:v][wave]overlay=x=(W-w)/2:y=(H-h)/2+65:format=auto,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='INFINITE SLOP RADIO':x=58:y=46:fontsize=32:fontcolor=white@0.92:shadowcolor=black@0.7:shadowx=2:shadowy=2",
  `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile=${titleFile}:reload=1:x=60:y=95:fontsize=19:fontcolor=white@0.95:shadowcolor=black@0.8:shadowx=2:shadowy=2`,
  "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='LIVE':x=w-112:y=52:fontsize=20:fontcolor=white:box=1:boxcolor=red@0.95:boxborderw=8[v]"
].join(',');
const AUDIO_VISUAL_FILTER = [
  '[0:a]asplit=2[audio][visual]',
  '[visual]showwaves=s=420x72:mode=cline:draw=full:colors=0x00ff66[wave]'
].join(';') + ';' + VIDEO_OVERLAY_FILTER;

function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
function redact(value: string) { return destinations.reduce((text, item) => text.replaceAll(item.target, `[${item.name} RTMP destination]`), value); }

async function writePcm(input: NodeJS.WritableStream, bytes: Buffer) {
  if (input.write(bytes)) return;
  await new Promise<void>((resolve, reject) => {
    const done = () => { input.off('error', fail); resolve(); };
    const fail = (error: Error) => { input.off('drain', done); reject(error); };
    input.once('drain', done);
    input.once('error', fail);
  });
}

async function decodeInto(audioPath: string, input: NodeJS.WritableStream) {
  const decoder = spawn('ffmpeg', ['-v', 'error', '-i', audioPath, '-f', 's16le', '-ar', '44100', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (!decoder.stdout) throw new Error('Could not open decoder audio output.');
  let error = '';
  decoder.stderr.setEncoding('utf8');
  decoder.stderr.on('data', chunk => { error += chunk; });
  const closed = new Promise<number | null>(resolve => decoder.once('close', resolve));
  for await (const chunk of decoder.stdout) {
    const pcm = Buffer.from(chunk);
    await writePcm(input, pcm);
    // Keep the permanent encoder fed at audio speed. Depending on FFmpeg's
    // stdout buffering, -re on the decoder can still arrive in bursts.
    await wait(Math.round((pcm.length / PCM_BYTES_PER_SECOND) * 1_000));
  }
  const code = await closed;
  if (code !== 0) throw new Error(`Audio decoder exited with ${code}: ${error.trim()}`);
}

async function loadJingles(): Promise<Jingle[]> {
  const files = await readdir(join(config.MEDIA_DIR, 'jingles')).then(files => files.filter(file => /^infinite-slop-radio-jingle-\d+\.mp3$/.test(file)).sort()).catch(() => [] as string[]);
  return files.map(file => ({ audioPath: join(config.MEDIA_DIR, 'jingles', file), artist: 'Station ID', title: 'Infinite Slop Radio' }));
}

function startEncoder() {
  const output = destinations.length === 1
    ? ['-flvflags', 'no_duration_filesize', '-f', 'flv', destinations[0].target]
    : ['-f', 'tee', destinations.map(item => `[f=flv]${item.target}`).join('|')];
  // The pipe must be FFmpeg's first input. With a looping still image first,
  // FFmpeg 5.1 can wait indefinitely before producing the initial frame.
  const process = spawn('ffmpeg', ['-thread_queue_size', '4096', '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0', '-re', '-loop', '1', '-framerate', '15', '-i', config.BACKGROUND_PATH, '-filter_complex', AUDIO_VISUAL_FILTER, '-map', '[v]', '-map', '[audio]', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', '15', '-g', '30', '-b:v', '2000k', '-maxrate', '2000k', '-bufsize', '4000k', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', ...output], { stdio: ['pipe', 'ignore', 'pipe'] });
  process.stderr.setEncoding('utf8'); process.stderr.on('data', chunk => globalThis.process.stderr.write(redact(chunk)));
  if (!process.stdin) throw new Error('Could not open main FFmpeg PCM input.');
  return process;
}

const repository = {
  findOldestBuffered: () => db.track.findFirst({ where: { status: 'BUFFERED', audioPath: { not: null } }, orderBy: { createdAt: 'asc' }, select: { id: true, title: true, artist: true, audioPath: true } }),
  updateStatus: async (id: string, status: 'PLAYING' | 'PLAYED' | 'BUFFERED') => { await db.track.update({ where: { id }, data: { status } }); }
};

async function play(item: Jingle | StreamTrack, input: NodeJS.WritableStream) {
  if (!item.audioPath) throw new Error('Missing audio path');
  await writeFile(titleFile, `NOW PLAYING: ${item.artist} • ${item.title}`);
  await decodeInto(item.audioPath, input);
}

async function run() {
  if (!destinations.length) throw new Error('No RTMP destination configured.');
  await db.track.updateMany({ where: { status: 'PLAYING' }, data: { status: 'BUFFERED' } });
  await writeFile(titleFile, 'WAITING FOR THE NEXT TRACK');
  const encoder = startEncoder();
  encoder.once('close', code => { console.error(`FFmpeg exited with code ${code ?? 'unknown'}`); process.exit(1); });
  if (!encoder.stdin) throw new Error('Missing FFmpeg PCM input.');
  // Two seconds are enough for the initial audio/video timestamps to lock.
  await writePcm(encoder.stdin, Buffer.alloc(PCM_BYTES_PER_SECOND * 2));
  await wait(2_000);
  const jingles = await loadJingles(); let musicCount = 0; let jingleIndex = 0;
  while (true) {
    const track = await reserveNextTrack(repository);
    if (!track) { await writeFile(titleFile, 'WAITING FOR THE NEXT TRACK'); await writePcm(encoder.stdin, Buffer.alloc(PCM_BYTES_PER_SECOND)); await wait(1_000); continue; }
    try {
      console.error(`Playing: ${track.artist} - ${track.title}`);
      await play(track, encoder.stdin); await completeTrack(repository, track.id); musicCount++;
      if (jingles.length && musicCount % 3 === 0) await play(jingles[jingleIndex++ % jingles.length], encoder.stdin);
    } catch (error) {
      await repository.updateStatus(track.id, 'BUFFERED'); console.error(`Could not play ${track.id}: ${error instanceof Error ? error.message : error}`); await writePcm(encoder.stdin, Buffer.alloc(PCM_BYTES_PER_SECOND)); await wait(1_000);
    }
  }
}
run().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
