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
  async recyclePlayed() {
    for (const track of this.tracks) {
      if (track.status === 'PLAYED') track.status = 'BUFFERED';
    }
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

  it('returns a finished track to the local rotation', async () => {
    const repository = new MemoryTracks([{ id: 'one', title: 'One', artist: 'Artist', audioPath: '/one.mp3', status: 'BUFFERED' }]);
    const track = await reserveNextTrack(repository);
    await completeTrack(repository, track!.id, { recycle: true });
    expect(repository.tracks[0].status).toBe('BUFFERED');
  });

  it('consumes a new BUFFERED track after startup', async () => {
    const repository = new MemoryTracks([]);
    expect(await reserveNextTrack(repository)).toBeNull();
    repository.tracks.push({ id: 'later', title: 'Later', artist: 'Artist', audioPath: '/later.mp3', status: 'BUFFERED' });
    expect((await reserveNextTrack(repository))?.id).toBe('later');
    expect(repository.tracks[0].status).toBe('PLAYING');
  });

  it('replays PLAYED catalog tracks when the buffer is empty', async () => {
    const repository = new MemoryTracks([
      { id: 'one', title: 'One', artist: 'Artist', audioPath: '/one.mp3', status: 'PLAYED' },
      { id: 'two', title: 'Two', artist: 'Artist', audioPath: '/two.mp3', status: 'PLAYED' }
    ]);
    expect((await reserveNextTrack(repository))?.id).toBe('one');
    expect(repository.tracks.map(track => track.status)).toEqual(['PLAYING', 'BUFFERED']);
  });
});
