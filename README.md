# Infinite House Radio — V1

Pipeline minimal : **MiniMax Music 3.0 (GMI Cloud) → MP3 → PostgreSQL → KEEP/REJECT → buffer → FFmpeg → YouTube Live RTMPS**.

## Démarrage

Prérequis : Docker Compose et une clé API GMI. Copiez la configuration et ajoutez un fond JPEG 1920×1080 :

```bash
cp .env.example .env
# renseigner GMI_API_KEY et YOUTUBE_STREAM_KEY
cp /chemin/vers/fond.jpg assets/background.jpg
docker compose up --build postgres redis api worker
```

L'interface est sur <http://localhost:3000>. Une fois au moins 30 minutes conservées dans le buffer, activez le mode autonome si souhaité puis lancez la diffusion :

```bash
docker compose up stream
```

> Le connecteur appelle `POST GMI_BASE_URL/v1/music/generations`. Il accepte une réponse audio directe ou un JSON contenant `audio_url` à la racine ou sous `data`. Ajustez `GMI_BASE_URL` si la passerelle de votre déploiement diffère.

## Fonctionnement

1. `POST /api/generations` crée une recette, sauvegarde le **payload exact** dans `Track.minimaxPayload`, puis publie un job BullMQ.
2. Le worker télécharge le MP3, mesure sa durée avec `ffprobe`, puis le place en calibration.
3. KEEP approuve la recette et place le morceau au buffer; REJECT l'écarte.
4. Avec `AUTONOMOUS=true`, le worker choisit une recette approuvée au hasard. Seuls le BPM (120–126) et le mode vocal 65/20/15 varient. Il remplit le buffer jusqu'à 60 minutes par défaut.
5. Le streamer lit en FIFO et compose fond, visualizer réactif, nom et titre avec FFmpeg avant l'envoi RTMPS. Un échec remet le morceau au buffer.

Seuls Deep House, Minimal / Deep Tech et Soulful House sont acceptés. Aucun ML, embedding ou scoring n'est utilisé.

## API

- `POST /api/generations` — `{ "genre": "DEEP_HOUSE" }`
- `GET /api/tracks?status=CALIBRATION`
- `POST /api/tracks/:id/decision` — `{ "decision": "KEEP" }` ou `REJECT`
- `GET /health`

## Développement et tests

```bash
npm install
npx prisma generate
npm test
npm run build
```

Hors Docker, PostgreSQL, Redis, `ffmpeg` et `ffprobe` sont requis. API (`npm run dev`), worker (`npm run worker`) et streamer (`npm run stream`) sont des processus distincts.
