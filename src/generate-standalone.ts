import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { config } from './config.js';
import { generateMusic, payload } from './minimax.js';
import { chooseArtist, chooseVoice, genres, varyBpm, type VoiceMode } from './music.js';
import { generateLyricsAndPromptWithM3 } from './llm.js';
import { duration } from './probe.js';
import type { Genre } from '@prisma/client';

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = 'true';
      }
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs();

  // Genre selection
  let selectedGenre: Genre = genres[Math.floor(Math.random() * genres.length)];
  if (args.genre) {
    const matched = genres.find(
      g => g.toLowerCase() === args.genre.toLowerCase() || g.toLowerCase().replaceAll('_', '-') === args.genre.toLowerCase()
    );
    if (matched) {
      selectedGenre = matched;
    } else {
      console.warn(`[!] Genre inconnu "${args.genre}". Genres valides: ${genres.join(', ')}. Sélection aléatoire parmi ces genres.`);
    }
  }

  // Voice mode selection
  let voice: VoiceMode = chooseVoice();
  if (args.voice && ['instrumental', 'single_word', 'short_hook'].includes(args.voice)) {
    voice = args.voice as VoiceMode;
  }

  // BPM selection
  const bpm = args.bpm ? parseInt(args.bpm, 10) : varyBpm(selectedGenre);
  const artist = args.artist || chooseArtist(selectedGenre);

  console.log('==============================================');
  console.log('🤖 ÉTAPE 1 : GÉNÉRATION DU TEXTE & PROMPT VIA MiniMaxAI/MiniMax-M3');
  console.log('==============================================');
  console.log(`• Genre demandé : ${selectedGenre}`);
  console.log(`• Mode vocal    : ${voice}`);
  console.log(`• BPM           : ${bpm}`);
  console.log(`• Artiste       : ${artist}`);

  let prompt = args.prompt;
  let lyrics = args.lyrics;
  let trackTitle = `${selectedGenre.replaceAll('_', ' ')} ${bpm} BPM`;

  let inspiration = '';

  if (!prompt || !lyrics) {
    const llmResult = await generateLyricsAndPromptWithM3(selectedGenre, voice, bpm, artist);
    prompt = prompt || llmResult.prompt;
    lyrics = lyrics || llmResult.lyrics;
    trackTitle = llmResult.title;
    inspiration = llmResult.inspiration;
  }

  console.log(`• Titre généré  : "${trackTitle}"`);
  if (inspiration) console.log(`• Inspiration   : ${inspiration}`);
  console.log(`• Prompt musical: "${prompt}"`);
  console.log(`• Paroles/Tags  :\n${lyrics}`);

  console.log('\n==============================================');
  console.log('🎵 ÉTAPE 2 : GÉNÉRATION AUDIO VIA MiniMax Music 3.0');
  console.log('==============================================');
  console.log('⏳ Envoi de la requête audio à GMI Cloud...');

  const startTime = Date.now();
  const body = payload(prompt, lyrics);

  try {
    const audioBytes = await generateMusic(body);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Audio reçu avec succès en ${elapsed}s (${(audioBytes.length / 1024 / 1024).toFixed(2)} Mo)`);

    // Determine output directory & filename
    const outDir = resolve(args.outdir || './data/media');
    await mkdir(outDir, { recursive: true });

    const safeTitle = trackTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeArtist = artist.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const filename = args.out || `${safeArtist}_${safeTitle}_${selectedGenre.toLowerCase()}_${bpm}bpm_${timestamp}.mp3`;
    const outputPath = join(outDir, filename);

    await writeFile(outputPath, audioBytes);
    console.log(`💾 Fichier enregistré : ${outputPath}`);

    // Probe track duration with ffprobe if available
    try {
      const durSec = await duration(outputPath);
      const minutes = Math.floor(durSec / 60);
      const seconds = Math.round(durSec % 60);
      console.log(`⏱️  Durée mesurée    : ${minutes}m ${seconds < 10 ? '0' : ''}${seconds}s (${durSec.toFixed(1)}s)`);
    } catch {
      console.log(`⏱️  ffprobe n'a pas pu mesurer la durée.`);
    }

    console.log('==============================================');
    console.log(`🎉 Morceau généré avec succès !`);
    console.log(`Fichier disponible : ${outputPath}`);
  } catch (err: any) {
    console.error(`❌ Échec de la génération :`, err?.message || err);
    process.exit(1);
  }
}

main();
