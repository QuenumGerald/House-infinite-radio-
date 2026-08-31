import { spawn } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './db.js';
import { config } from './config.js';
import { completeTrack, reserveNextTrack, type StreamTrack } from './stream-selection.js';

type Destination = { name: 'YouTube' | 'Twitch'; target: string };
type Jingle = Pick<StreamTrack, 'audioPath' | 'title' | 'artist'>;
const PCM_SECONDS = 44_100 * 2 * 2;

function destination(url: string, key: string, name: Destination['name']): Destination | null {
  const base = url.trim().replace(/\/+$/, '');
  return base && key.trim() ? { name, target: `${base}/${key.trim()}` } : null;
}
const destinations = [destination(config.YOUTUBE_RTMPS_URL, config.YOUTUBE_STREAM_KEY, 'YouTube'), destination(config.TWITCH_RTMP_URL, config.TWITCH_STREAM_KEY, 'Twitch')].filter((item): item is Destination => item !== null);
const titleFile = join(config.MEDIA_DIR, 'current-title.txt');

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
  for await (const chunk of decoder.stdout) await writePcm(input, Buffer.from(chunk));
  const code = await new Promise<number | null>(resolve => decoder.once('close', resolve));
  if (code !== 0) throw new Error(`Audio decoder exited with ${code}: ${error.trim()}`);
}

async function loadJingles(): Promise<Jingle[]> {
  const files = await readdir(join(config.MEDIA_DIR, 'jingles')).then(files => files.filter(file => /^infinite-slop-radio-jingle-\d+\.mp3$/.test(file)).sort()).catch(() => [] as string[]);
  return files.map(file => ({ audioPath: join(config.MEDIA_DIR, 'jingles', file), artist: 'Station ID', title: 'Infinite Slop Radio' }));
}

function startEncoder() {
  const output = destinations.length === 1 ? ['-f', 'flv', destinations[0].target] : ['-f', 'tee', destinations.map(item => `[f=flv]${item.target}`).join('|')];
  const filter = `[1:a]asetpts=N/SR/TB,asplit=2[audio][wave];[wave]showwaves=s=960x200:mode=cline:colors=0x39ff14,format=rgba,colorkey=0x000000:0.01:0.0[w];[0:v]scale=1280:720,drawbox=x=24:y=24:w=710:h=120:color=black@0.42:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='INFINITE SLOP RADIO':fontcolor=0xf7fbff:fontsize=42:x=48:y=44,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile='${titleFile}':reload=1:fontcolor=0x59e5d2:fontsize=24:x=50:y=101[bg];[bg][w]overlay=160:260:shortest=1[v]`;
  const process = spawn('ffmpeg', ['-loop', '1', '-framerate', '30', '-i', config.BACKGROUND_PATH, '-thread_queue_size', '2048', '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0', '-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[v]', '-map', '[audio]', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', '20', '-g', '40', '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', ...output], { stdio: ['pipe', 'ignore', 'pipe'] });
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
  // Prime the raw PCM input before decoding the first track. This gives the
  // audio visualizer enough samples to initialise instead of stalling at frame 1.
  await writePcm(encoder.stdin, Buffer.alloc(PCM_SECONDS * 2));
  const jingles = await loadJingles(); let musicCount = 0; let jingleIndex = 0;
  while (true) {
    const track = await reserveNextTrack(repository);
    if (!track) { await writeFile(titleFile, 'WAITING FOR THE NEXT TRACK'); await writePcm(encoder.stdin, Buffer.alloc(PCM_SECONDS * 2)); await wait(2_000); continue; }
    try {
      await play(track, encoder.stdin); await completeTrack(repository, track.id); musicCount++;
      if (jingles.length && musicCount % 3 === 0) await play(jingles[jingleIndex++ % jingles.length], encoder.stdin);
    } catch (error) {
      await repository.updateStatus(track.id, 'BUFFERED'); console.error(`Could not play ${track.id}: ${error instanceof Error ? error.message : error}`); await writePcm(encoder.stdin, Buffer.alloc(PCM_SECONDS * 2));
    }
  }
}
run().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
