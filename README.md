# Infinite House Radio

An autonomous electronic music generator and radio: MiniMax creates tracks, the worker prepares them, and a permanent FFmpeg streamer broadcasts them to YouTube and/or Twitch.

## Architecture

`MiniMax M3 (GMI Serving) → MiniMax Music 3.0 (GMI Cloud) → PostgreSQL → BullMQ worker → buffer → FFmpeg → RTMP`

The streamer keeps one FFmpeg process alive. It dynamically fetches `BUFFERED` tracks, decodes each MP3 into stereo 44.1 kHz PCM, and writes it to FFmpeg stdin. A track generated after the live starts can therefore be broadcast without restarting the stream.

Track lifecycle: `BUFFERED → PLAYING → PLAYED`. On restart, unfinished `PLAYING` tracks return to `BUFFERED`; `PLAYED` tracks are never replayed. When the buffer is empty, FFmpeg stays alive and receives temporary silence.

## Genres and artists

- `DEEP_HOUSE` — Velvet Current, Lumen Tool, Mira Solace
- `MINIMAL_DEEP_TECH` — Subphase, Kinetic Vale, Cipher Bloom
- `DRUM_AND_BASS` — Voltage Veil, Neon Vector, Breakline Echo

Artist identities are fixed per genre, and prompts/BPM ranges are adapted to each style.

## Docker

```bash
cp .env.example .env
# Add secrets to .env only
docker compose up --build -d postgres redis api worker
docker compose up --build -d stream
```

Web interface: <http://localhost:3000>. Set `AUTONOMOUS=true` to let the worker maintain the buffer automatically.

## RTMP configuration

Set `GMI_API_KEY`, the YouTube variables (`YOUTUBE_RTMPS_URL`, `YOUTUBE_STREAM_KEY`) and/or Twitch variables (`TWITCH_RTMP_URL`, `TWITCH_STREAM_KEY`) in `.env`. YouTube only, Twitch only, or both destinations are supported. Secrets must never be logged or committed; `.env` must remain private.

Current stable video profile: `1280×720`, 15 FPS, ultrafast H.264 at 4.5 Mbps, and AAC at 160 kbps. The background is `assets/background-720.jpg`; track titles are written to `current-title.txt`. The visualizer is disabled to preserve encoding stability.

Jingles stored in `data/media/jingles/` are injected into the same PCM stream after every third music track. Accepted filenames are `infinite-slop-radio-jingle-N.mp3` and `house-radio-jingle-N.mp3`.

## Generation

```bash
npm run generate -- --genre MINIMAL_DEEP_TECH --bpm 124
npm run generate:jingles
```

`KEEP` preserves an approved recipe as an allowed basis for future generations; `REJECT` excludes it.

## API

- `POST /api/generations` — `{ "genre": "DEEP_HOUSE" }`
- `GET /api/tracks?status=CALIBRATION`
- `POST /api/tracks/:id/decision` — `{ "decision": "KEEP" }` or `REJECT`
- `GET /health`

## Development

Requirements outside Docker: Node.js 22, PostgreSQL, Redis, `ffmpeg`, and `ffprobe`.

```bash
npm install
npx prisma generate
npm test
npm run build
```

Tests cover dynamic selection (`BUFFERED → PLAYING → PLAYED`) and consuming new tracks added after the streamer starts.

Thanks to GMI for sponsoring the MiniMax models used by Infinite House Radio.
