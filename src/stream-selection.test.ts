import { describe, expect, it } from 'vitest';
import { completeTrack, reserveNextTrack, type StreamTrack } from './stream-selection.js';

class MemoryTracks {
  constructor(public tracks: Array<StreamTrack & { status: 'BUFFERED' | 'PLAYING' | 'PLAYED' }>) {}
  async findOldestBuffered() { return this.tracks.find(track => track.status === 'BUFFERED') || null; }
  async updateStatus(id: string, status: 'BUFFERED' | 'PLAYING' | 'PLAYED') {
    const track = this.tracks.find(item => item.id === id);
    if (!track) throw new Error('Track not found');
    track.status = status;
  }
}

describe('stream selection', () => {
  it('transitions BUFFERED → PLAYING → PLAYED', async () => {
    const repository = new MemoryTracks([{ id: 'one', title: 'One', artist: 'Artist', audioPath: '/one.mp3', status: 'BUFFERED' }]);
    const track = await reserveNextTrack(repository);
    expect(repository.tracks[0].status).toBe('PLAYING');
    await completeTrack(repository, track!.id);
    expect(repository.tracks[0].status).toBe('PLAYED');
  });

  it('consumes a new BUFFERED track after startup', async () => {
    const repository = new MemoryTracks([]);
    expect(await reserveNextTrack(repository)).toBeNull();
    repository.tracks.push({ id: 'later', title: 'Later', artist: 'Artist', audioPath: '/later.mp3', status: 'BUFFERED' });
    expect((await reserveNextTrack(repository))?.id).toBe('later');
    expect(repository.tracks[0].status).toBe('PLAYING');
  });
});
