import { config } from './config.js';
import type { Genre } from '@prisma/client';
import { chooseArtist, type VoiceMode } from './music.js';

export interface GeneratedTrackContext {
  prompt: string;
  lyrics: string;
  title: string;
  inspiration: string;
  bpm: number;
}

/**
 * Underground Electronic Music & Techno Culture Knowledge Base
 */
const cultureKnowledge = {
  MINIMAL_DEEP_TECH: {
    name: 'Minimal / Deep Tech & Microhouse',
    genreLabel: 'Minimal / Deep Tech & Microhouse',
    pioneers: [
      'Ricardo Villalobos - "Dexter", "Easy Lee"',
      'Chris Stussy - "All Night Long", "Desire", Up The Stuss',
      'Raresh, Rhadoo, Petre Inspirescu ([a:rpia:r] Romanian Sound)',
      'East End Dubs & Fuse London collective',
      'Apollonia & Traumer (stripped-back Parisian tech-groove)'
    ],
    words: ['Space', 'Dub', 'Shift', 'Tech', 'Move', 'Pulse', 'Cut', 'Step', 'Loop', 'Check', 'Code']
  },
  DEEP_HOUSE: {
    name: 'Deep House',
    genreLabel: 'Deep House',
    pioneers: [
      'Larry Heard (Mr. Fingers) - "Can You Feel It", "Mystery of Love"',
      'Kerri Chandler - "Atmosphere", "Rain", "Bar A Thym"',
      'Frankie Knuckles & Satoshi Tomiie - "Tears", "Your Love"',
      'Theo Parrish - "Solitary Flight", "Lost Angel"',
      'Moodymann - "Black Mahogani", "I\'m Doing Fine"',
      'Ron Trent - "Altered States", "Prescription"'
    ],
    words: ['Deep', 'Soul', 'House', 'Feel', 'Rhythm', 'Move', 'Night', 'Glow', 'Shift', 'Touch']
  },
  DRUM_AND_BASS: {
    name: 'Drum & Bass',
    genreLabel: 'Underground Drum & Bass',
    pioneers: [
      'the UK soundsystem and jungle continuum',
      'late-night drum & bass club culture',
      'futurist bass-music sound design',
      'deep, atmospheric rollers'
    ],
    words: ['Velocity', 'Pressure', 'Signal', 'Shadow', 'Motion', 'System', 'Charge', 'Rush', 'Current', 'Pulse']
  }
};

/**
 * Sanitize LLM-generated lyrics:
 * - Ensures multiple progressive parts per section (each separated by line breaks)
 * - Strictly 2-3 words per cue
 * - Chorus repeated 4 times
 * - Generates extended 800-1400 chars lyrics payload for full club length
 */
function sanitizeLlmLyrics(rawLyrics: string, chosenWord: string): string {
  const cleanWord = chosenWord.replace(/[\[\]]/g, '').trim();
  const rawSections = rawLyrics.split(/(?=\[[A-Za-z\s]+\])/g);
  const formattedSections: string[] = [];

  const knownWords = ['space', 'dub', 'shift', 'tech', 'move', 'pulse', 'cut', 'step', 'loop', 'check', 'code', 'deep', 'soul', 'house', 'feel', 'rhythm', 'night', 'glow', 'touch', 'free'];

  for (const rawSec of rawSections) {
    const lines = rawSec.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const header = lines[0];
    if (!header.startsWith('[') || !header.endsWith(']')) continue;

    const tagContent = header.slice(1, -1).trim();
    const standardTags = ['Intro', 'Verse', 'Chorus', 'Hook', 'Beat', 'Bridge', 'Breakdown', 'Drop', 'Dub Interlude', 'Outro', 'Solo'];
    const matchedTag = standardTags.find(t => t.toLowerCase() === tagContent.toLowerCase()) || tagContent;

    const sectionLines: string[] = [`[${matchedTag}]`];

    // Process all sub-parts inside the section
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const rawText = line.replace(/^[(\[]+|[)\]]+$/g, '').trim();

      // If it's a known single word, skip cue handling
      if (knownWords.includes(rawText.toLowerCase()) || rawText.toLowerCase() === cleanWord.toLowerCase()) {
        continue;
      }

      // Sound cue -> strictly 2 to 3 words
      const twoOrThreeWords = rawText.split(/\s+/).slice(0, 3).join(' ');
      if (twoOrThreeWords) {
        sectionLines.push(`(${twoOrThreeWords})`);
      }
    }

    // Add multiple vocal repetitions
    const lowerTag = matchedTag.toLowerCase();
    if (lowerTag === 'chorus') {
      sectionLines.push(cleanWord, cleanWord, cleanWord, cleanWord);
    } else if (lowerTag === 'hook') {
      sectionLines.push(cleanWord, cleanWord);
    } else if (lowerTag === 'beat') {
      sectionLines.push(cleanWord);
    }

    // Join lines with double newlines so each sub-part is a distinct progressive step
    formattedSections.push(sectionLines.join('\n\n'));
  }

  return formattedSections.join('\n\n').trim();
}

/**
 * Generate dynamically varied, multi-part track prompt & lyrics using MiniMax-M3 LLM
 */
export async function generateLyricsAndPromptWithM3(
  genre: Genre,
  voice: VoiceMode,
  bpm: number,
  artist = chooseArtist(genre)
): Promise<{ prompt: string; lyrics: string; title: string; inspiration: string; artist: string }> {
  const genreData = cultureKnowledge[genre] || cultureKnowledge.MINIMAL_DEEP_TECH;
  const pioneersList = genreData.pioneers.map(p => `- ${p}`).join('\n');
  const randomPioneer = genreData.pioneers[Math.floor(Math.random() * genreData.pioneers.length)];
  const defaultWord = genreData.words[Math.floor(Math.random() * genreData.words.length)];

  const systemPrompt = `You are an elite underground electronic music producer and sound architect.
You generate rich, extended multi-part track structures and prompts for MiniMax Music 3.0.

RULES FOR EXTENDED FULL-LENGTH CLUB TRACKS (3 to 5 minutes):
1. "prompt": Concise style roadmap (max 280 chars):
   - Mention genre, ${bpm} BPM and the original fictional artist identity "${artist}". Adapt the rhythmic language to the genre: 4/4 house for house styles; rolling two-step breakbeats, ghost snares and reese sub-bass for Drum & Bass. Include a DJ-mixable intro, progressive groove changes, sound design and clean outro. No EDM drops, no supersaws.

2. "lyrics": MUST CONTAIN MULTIPLE SUB-PARTS IN EVERY SECTION (3-4 separate cues per section) with double line breaks (\\n\\n) so the track develops into a full 3 to 4+ minute arrangement!
   - STRICTLY 2 OR 3 WORDS PER PARENTHESIS CUE.
   - Example format with multiple sub-parts per section:
[Intro]
(clean kick)

(hats enter)

(vinyl crackle)

(shaker groove)

[Verse]
(rolling sub bass)

(woodblock clicks)

(modular pulse)

[Chorus]
(dub delay)

(filter open)

${defaultWord}
${defaultWord}
${defaultWord}
${defaultWord}

[Hook]
${defaultWord}

${defaultWord}

[Bridge]
(stripped low-end)

(ambient wash)

(tape delay)

[Drop]
(heavy sub drops)

(kick re-locks)

(full percussions)

[Verse]
(sub bassline evolves)

(closed hats shuffle)

(dub stabs)

[Chorus]
(full harmonic groove)

(resonant filter)

${defaultWord}
${defaultWord}
${defaultWord}
${defaultWord}

[Breakdown]
(kick drops out)

(cavernous echo)

(reverb tails)

[Drop]
(sub-bass return)

(crisp 909 kick)

(driving hats)

[Outro]
(instruments filter out)

(isolated kick)

(hats fade)

(clean tail)

Available words for ${genreData.name}: ${genreData.words.join(', ')}.

Output strictly valid JSON:
{
  "title": "Creative title (2-3 words)",
  "word": "Chosen single word (e.g. ${defaultWord})",
  "inspiration": "Inspiration note (e.g. 'Inspired by ${randomPioneer}')",
  "prompt": "Complete prompt (max 280 chars)",
  "lyrics": "Extended lyrics structure with 3-4 sub-parts per section, 2-3 words per cue, 4x chorus repeats, and \\n\\n double line breaks throughout"
}`;

  const userPrompt = `Generate an extended full-length ${genreData.name} track at ${bpm} BPM for the original fictional artist ${artist}. Use 3-4 sub-parts per section, double line breaks, and strictly 2-3 words per cue. Do not imitate a real artist.`;

  try {
    const res = await fetch('https://api.gmi-serving.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.GMI_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'MiniMaxAI/MiniMax-M3',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.85,
        max_tokens: 850
      })
    });

    if (!res.ok) {
      console.warn(`[LLM M3] Request failed (${res.status}): ${await res.text()}`);
      throw new Error(`LLM M3 status ${res.status}`);
    }

    const data: any = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```json\s*|^```\s*|```$/gm, '').trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch {}
      }
    }

    if (parsed && parsed.prompt && parsed.lyrics) {
      const chosenWord = parsed.word || defaultWord;
      const cleanLyrics = sanitizeLlmLyrics(parsed.lyrics, chosenWord);

      console.log(`🤖 [LLM MiniMax-M3] Structure multi-parties générée (${cleanLyrics.length} caractères) !`);

      return {
        title: parsed.title || `${genreData.name} ${bpm} BPM`,
        inspiration: parsed.inspiration || `Inspired by ${randomPioneer}`,
        artist,
        prompt: parsed.prompt,
        lyrics: cleanLyrics
      };
    }
    throw new Error('Could not parse valid JSON from LLM response');
  } catch (err: any) {
    console.warn(`[LLM M3] Fallback:`, err?.message || err);
    throw err;
  }
}
