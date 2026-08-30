import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config.js';
export const connection = new IORedis(config.REDIS_URL,{maxRetriesPerRequest:null});
export const generationQueue = new Queue('music-generation',{connection});
