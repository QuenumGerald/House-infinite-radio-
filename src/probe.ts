import { execFile } from 'node:child_process'; import { promisify } from 'node:util';
const exec=promisify(execFile);
export async function duration(path:string){const {stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path]);return Number(stdout.trim())}
