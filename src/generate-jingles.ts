import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { generateMusic, payload } from './minimax.js';

const exec = promisify(execFile);
const jingles = [
  'Infinite House Radio.', 'Infinite House Radio. Stay deep.', 'Infinite House Radio. All night.',
  'Infinite House Radio. Underground.', 'Infinite House Radio. Move.', 'Infinite House Radio. After hours.',
  'Infinite House Radio. Locked in.', 'Infinite House Radio. Deep frequency.'
];

async function main() {
  const outDir = resolve('./data/media/jingles');
  await mkdir(outDir, { recursive: true });

  for (const [index, line] of jingles.entries()) {
    const rawPath = join(outDir, `.house-jingle-${index + 1}-raw.mp3`);
    const outputPath = join(outDir, `infinite-slop-radio-jingle-${index + 1}.mp3`);
    if (await access(outputPath).then(() => true).catch(() => false)) {
      console.log(`Jingle ${index + 1}/${jingles.length} already exists, skipping.`);
      continue;
    }
    console.log(`Generating jingle ${index + 1}/${jingles.length}…`);
    const audio = await generateMusic(payload(
      'A 3-second deep-house radio stinger. Start with the spoken station ID immediately, with no intro or silence. Confident processed club-radio voice, one tight 4/4 kick, warm sub hit, short Juno chord stab, vinyl stop or tape echo tail. Underground Ibiza after-hours identity. No song structure, no long instrumental, no EDM riser.',
      `[Radio stinger]\n${line}`
    ));
    await writeFile(rawPath, audio);
    await exec('ffmpeg', ['-y', '-v', 'error', '-i', rawPath, '-t', '3.2', '-af', 'afade=t=out:st=2.6:d=0.6', outputPath]);
    console.log(`Saved ${outputPath}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
