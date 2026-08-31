export type StreamTrack = { id: string; title: string; artist: string; audioPath: string | null };
export type StreamTrackRepository = {
  findOldestBuffered(): Promise<StreamTrack | null>;
  updateStatus(id: string, status: 'PLAYING' | 'PLAYED' | 'BUFFERED'): Promise<void>;
};

export async function reserveNextTrack(repository: StreamTrackRepository) {
  const track = await repository.findOldestBuffered();
  if (!track) return null;
  await repository.updateStatus(track.id, 'PLAYING');
  return track;
}

export async function completeTrack(repository: StreamTrackRepository, trackId: string) {
  await repository.updateStatus(trackId, 'PLAYED');
}
