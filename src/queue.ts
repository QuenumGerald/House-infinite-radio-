import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';
export const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
export const generationQueue = new Queue('music-generation',{connection});
