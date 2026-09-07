import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Track = {
  id: string;
  title: string;
  artist: string;
  genre: string;
  status: string;
  audioPath: string | null;
  durationSeconds: number | null;
  createdAt: string;
};

const GENRES = [
  { value: 'ALL', label: 'All genres' },
  { value: 'DEEP_HOUSE', label: 'Deep House' },
  { value: 'MINIMAL_DEEP_TECH', label: 'Minimal / Deep Tech' },
  { value: 'DRUM_AND_BASS', label: 'Drum & Bass' }
];

function formatDuration(seconds: number | null) {
  if (!seconds) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

function fileName(path: string | null) {
  return path?.split('/').pop() || '';
}

function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [genre, setGenre] = useState('ALL');
  const [mode, setMode] = useState('library');

  useEffect(() => {
    const load = () => {
      fetch('/api/tracks').then(r => r.json()).then(setTracks);
      fetch('/health').then(r => r.json()).then(info => setMode(info.mode || 'library'));
    };
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, []);

  const visible = useMemo(
    () => tracks.filter(track => (genre === 'ALL' || track.genre === genre) && track.audioPath),
    [tracks, genre]
  );
  const minutes = Math.round(visible.reduce((sum, track) => sum + (track.durationSeconds || 0), 0) / 60);

  return (
    <main>
      <header>
        <p>24/7 LOCAL CATALOG</p>
        <h1>INFINITE<br/>RADIO</h1>
      </header>
      <section className="controls">
        <select value={genre} onChange={e => setGenre(e.target.value)}>
          {GENRES.map(item => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <p className="library-meta">{visible.length} tracks · {minutes} min · {mode}</p>
      </section>
      <h2>LIBRARY</h2>
      {visible.length === 0 ? (
        <p className="empty">No local tracks found. Seed the catalog from deploy-export.</p>
      ) : visible.map(track => (
        <article key={track.id}>
          <div>
            <b>{track.artist} — {track.title}</b>
            <small>{track.genre.replaceAll('_', ' ')} · {formatDuration(track.durationSeconds)} · {track.status}</small>
            <audio controls src={'/media/' + fileName(track.audioPath)} />
          </div>
        </article>
      ))}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
