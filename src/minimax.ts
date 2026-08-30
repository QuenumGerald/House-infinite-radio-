import { config } from './config.js';
export type MiniMaxPayload={model:string;prompt:string;output_format:'mp3';sample_rate:44100};
export function payload(prompt:string):MiniMaxPayload{return {model:config.MINIMAX_MODEL,prompt,output_format:'mp3',sample_rate:44100}}
export async function generateMusic(body:MiniMaxPayload):Promise<Uint8Array>{
  const response=await fetch(`${config.GMI_BASE_URL}/v1/music/generations`,{method:'POST',headers:{authorization:`Bearer ${config.GMI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok) throw new Error(`GMI generation failed (${response.status}): ${await response.text()}`);
  const type=response.headers.get('content-type')||'';
  if(type.startsWith('audio/')) return new Uint8Array(await response.arrayBuffer());
  const result=await response.json() as {audio_url?:string;data?:{audio_url?:string}}; const url=result.audio_url||result.data?.audio_url;
  if(!url) throw new Error('GMI response did not contain audio'); const audio=await fetch(url); if(!audio.ok) throw new Error(`Audio download failed (${audio.status})`); return new Uint8Array(await audio.arrayBuffer());
}
