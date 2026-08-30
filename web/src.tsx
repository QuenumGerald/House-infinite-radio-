import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
type Track = { id:string; title:string; genre:string; status:string; audioPath:string; durationSeconds:number|null; createdAt:string };
function App() {
  const [tracks,setTracks]=useState<Track[]>([]); const [genre,setGenre]=useState('DEEP_HOUSE'); const [busy,setBusy]=useState(false);
  const load=()=>fetch('/api/tracks?status=CALIBRATION').then(r=>r.json()).then(setTracks);
  useEffect(load,[]);
  async function generate(){setBusy(true); await fetch('/api/generations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({genre})});setBusy(false)}
  async function vote(id:string,decision:'KEEP'|'REJECT'){await fetch(`/api/tracks/${id}/decision`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision})});load()}
  return <main><header><p>24/7 GENERATED HOUSE</p><h1>INFINITE<br/>HOUSE RADIO</h1></header><section className="controls"><select value={genre} onChange={e=>setGenre(e.target.value)}><option value="DEEP_HOUSE">Deep House</option><option value="MINIMAL_DEEP_TECH">Minimal / Deep Tech</option><option value="SOULFUL_HOUSE">Soulful House</option></select><button onClick={generate} disabled={busy}>{busy?'QUEUED…':'GENERATE CALIBRATION TRACK'}</button></section><h2>CALIBRATION DECK</h2>{tracks.length===0?<p className="empty">Generate a track, then come back when the worker has finished.</p>:tracks.map(t=><article key={t.id}><div><b>{t.title}</b><small>{t.genre.replaceAll('_',' ')} · {t.durationSeconds?Math.round(t.durationSeconds/60)+' min':'probing'}</small><audio controls src={'/media/'+t.audioPath.split('/').pop()}/></div><button className="keep" onClick={()=>vote(t.id,'KEEP')}>KEEP</button><button className="reject" onClick={()=>vote(t.id,'REJECT')}>REJECT</button></article>)}</main>;
} createRoot(document.getElementById('root')!).render(<App/>);
