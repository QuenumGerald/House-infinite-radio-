import { seedLibrary } from './library.js';
import { db } from './db.js';

const result = await seedLibrary();
console.log(`Library ready: ${result.tracks} tracks (${result.extras} extra files), ${result.recipes} recipes`);
await db.$disconnect();
