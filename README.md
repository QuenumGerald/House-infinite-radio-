# Infinite House Radio

A 24/7 electronic radio. The station now plays the local catalog of already generated MiniMax tracks. The GMI / MiniMax APIs are no longer required.

## Architecture

`deploy-export catalog → PostgreSQL → buffer → FFmpeg → RTMP`

On startup the API seeds recipes and tracks from `deploy-export/radio.sql`, copies the MP3s into `MEDIA_DIR`, and the streamer rotates that library. Finished tracks return to the buffer so the live show never runs out of music.

Optional generation path, disabled by default: `MiniMax M3 (GMI Serving) → MiniMax Music 3.0 (GMI Cloud)`. Set `LIBRARY_ONLY=false` only if you still have API access.

Track lifecycle in library mode: `BUFFERED → PLAYING → BUFFERED`. On restart, unfinished `PLAYING` tracks return to `BUFFERED`. When the buffer is empty, previously `PLAYED` catalog tracks are recycled. If nothing is available, FFmpeg stays alive and receives temporary silence.

## Genres and artists

- `DEEP_HOUSE` — Velvet Current, Mira Solace, Night Terrace
- `MINIMAL_DEEP_TECH` — Static Parcel, Lumen Tool, Low Orbit
- `DRUM_AND_BASS` — Vector Rain, Subphase, Kinetic Vale

The web UI lists the local catalog and lets you preview each MP3. Generation / calibration controls stay hidden while `LIBRARY_ONLY=true`.

## Docker

```bash
cp .env.example .env
# Add stream secrets to .env only. GMI_API_KEY is optional in library mode.
docker compose up --build -d postgres redis api worker
docker compose up --build -d stream
```

Web interface: <http://localhost:3000>. The API imports the `deploy-export` catalog automatically.

## RTMP configuration

Set the YouTube variables (`YOUTUBE_RTMPS_URL`, `YOUTUBE_STREAM_KEY`) and/or Twitch variables (`TWITCH_RTMP_URL`, `TWITCH_STREAM_KEY`) in `.env`. YouTube only, Twitch only, or both destinations are supported. Secrets must never be logged or committed; `.env` must remain private.

Current stable video profile: `1280×720`, 15 FPS, ultrafast H.264 at 4.5 Mbps, and AAC at 160 kbps. The background is `assets/background-720.jpg`; track titles are written to `current-title.txt`. The visualizer is disabled to preserve encoding stability.

Jingles stored in `data/media/jingles/` are injected into the same PCM stream after every third music track. Accepted filenames are `infinite-slop-radio-jingle-N.mp3` and `house-radio-jingle-N.mp3`.

## Local catalog

The checked-in dump and audio live in `deploy-export/`:

- `radio.sql` — recipes and track metadata
- `media/*.mp3` — 28 generated tracks

```bash
npm run seed:library
```

`LIBRARY_ONLY=true` (the default) disables `POST /api/generations` and autonomous MiniMax refill. Set `LIBRARY_ONLY=false` to restore API generation.

## API

- `GET /api/tracks` — local catalog
- `GET /health` — `{ ok, mode, tracks }`
- `POST /api/generations` — disabled in library mode
- `POST /api/tracks/:id/decision` — `{ "decision": "KEEP" }` or `REJECT`

## Development

Requirements outside Docker: Node.js 22, PostgreSQL, Redis, `ffmpeg`, and `ffprobe`.

```bash
npm install
npx prisma generate
npm test
npm run build
npm run seed:library
```

Tests cover catalog import from the SQL dump, dynamic selection (`BUFFERED → PLAYING → PLAYED`), local rotation, and consuming new tracks added after the streamer starts.
