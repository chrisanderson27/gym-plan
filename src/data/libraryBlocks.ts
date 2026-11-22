import type { GymDb } from './db';
import type { LibraryBlock, LibraryStation } from './types';

/** A zero load would reopen as "0 lb". Absent and zero are the same: no load. */
function storedStations(stations: LibraryStation[]): LibraryStation[] {
  return stations.map((station) => {
    if (station.load === undefined || station.load === 0) {
      const next = { ...station };
      delete next.load;
      return next;
    }
    return { ...station };
  });
}

/** The caller sets `createdAt` once and refreshes `updatedAt`. */
export async function saveLibraryBlock(db: GymDb, row: LibraryBlock): Promise<void> {
  await db.libraryBlocks.put({ ...row, stations: storedStations(row.stations) });
}

export async function deleteLibraryBlock(db: GymDb, id: string): Promise<void> {
  await db.libraryBlocks.delete(id);
}
