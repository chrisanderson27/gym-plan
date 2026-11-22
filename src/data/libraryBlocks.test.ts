import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { buildExport, importExport, parseExport, ImportError } from './backup';
import { GymDb } from './db';
import { newId } from './ids';
import { deleteLibraryBlock, saveLibraryBlock } from './libraryBlocks';
import { V1_STORES } from './schema';
import { openTestDb } from './test-utils';
import type { LibraryBlock } from './types';

const dbs: GymDb[] = [];
const open = () => {
  const db = openTestDb();
  dbs.push(db);
  return db;
};
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => db.delete()));
});

const settings = {
  id: 'settings', goalWeightLb: 220, daysPerWeek: 4, weightUnit: 'lb' as const, distanceUnit: 'mi' as const,
  programStart: '2026-11-01', onboardedAt: '2026-11-01T08:00:00.000Z', backupAt: null, updatedAt: '2026-11-10T08:00:00.000Z',
};

function selfPaced(over: Partial<LibraryBlock> = {}): LibraryBlock {
  return {
    id: 'lb1', name: 'Bench & Core', kind: 'self-paced', durationSec: 480,
    stations: [{ exerciseId: 'leg-press', target: { unit: 'reps', amount: 10 } }],
    recommend: false, createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z',
    ...over,
  };
}

const coached = (): LibraryBlock => ({
  ...selfPaced({ id: 'lb2', name: 'Rotation' }),
  kind: 'coached', workSec: 30, restSec: 0, transitionSec: 10,
});

const file = (stores: Record<string, unknown[]>, schemaVersion = 2) =>
  JSON.stringify({ schemaVersion, exportedAt: '2026-11-21T00:00:00.000Z', appVersion: 't', stores });

it('keeps a settings row written at schema 1', async () => {
  const name = 't-' + newId();
  const v1 = new Dexie(name);
  v1.version(1).stores({ ...V1_STORES });
  await v1.table('settings').put({ id: 'settings', goalWeightLb: 180 });
  v1.close();
  const db = new GymDb(name);
  dbs.push(db);
  expect((await db.settings.get('settings'))?.goalWeightLb).toBe(180);
  expect(await db.libraryBlocks.count()).toBe(0);
});

it('migrates a v1 export onto an empty library and round-trips both kinds', async () => {
  const migrated = parseExport(file({ settings: [settings] }, 1));
  expect(migrated.file.schemaVersion).toBe(2);
  expect(migrated.file.stores.libraryBlocks).toEqual([]);
  expect(migrated.file.stores.settings).toEqual([settings]);

  const src = open();
  await saveLibraryBlock(src, coached());
  await saveLibraryBlock(src, selfPaced());
  const text = JSON.stringify(await buildExport(src, new Date('2026-11-21T00:00:00.000Z'), 'test'));
  const dst = open();
  await importExport(dst, parseExport(text).file);
  expect(await dst.libraryBlocks.get('lb2')).toMatchObject({ kind: 'coached', workSec: 30, restSec: 0, transitionSec: 10 });
  expect(await dst.libraryBlocks.get('lb1')).toMatchObject({ kind: 'self-paced', name: 'Bench & Core' });
  expect(await dst.libraryBlocks.get('lb1')).not.toHaveProperty('workSec');
});

it('keeps a local library id the file does not mention and replaces one it does', async () => {
  const db = open();
  await saveLibraryBlock(db, selfPaced({ id: 'local', name: 'Kept' }));
  await saveLibraryBlock(db, selfPaced({ id: 'shared', name: 'Local name' }));
  await importExport(db, parseExport(file({ libraryBlocks: [selfPaced({ id: 'shared', name: 'File name' })] })).file);
  expect((await db.libraryBlocks.get('local'))?.name).toBe('Kept');
  expect((await db.libraryBlocks.get('shared'))?.name).toBe('File name');
});

it('rejects a bad library row and leaves the database unchanged', async () => {
  const db = open();
  await saveLibraryBlock(db, selfPaced());
  const before = await db.libraryBlocks.toArray();
  const bad: unknown[] = [
    selfPaced({ stations: Array.from({ length: 7 }, () => ({ exerciseId: 'leg-press', target: { unit: 'reps' as const, amount: 10 } })) }),
    selfPaced({ stations: [{ exerciseId: 'leg-press', target: { unit: 'reps', amount: 0 } }] }),
    selfPaced({ stations: [] }),
    { ...selfPaced(), restSec: 15 },
    selfPaced({ stations: [{ exerciseId: 'leg-press', target: { unit: 'sec', amount: 30 } }] }),
    selfPaced({ name: '' }),
    selfPaced({ durationSec: 59 }),
    selfPaced({ durationSec: 3660 }),
    selfPaced({ stations: [{ exerciseId: 'leg-press', target: { unit: 'reps', amount: 10 }, load: -1 }] }),
    { ...selfPaced(), kind: 'coached' as const, restSec: 0, transitionSec: 10 },
  ];
  for (const row of bad) expect(() => parseExport(file({ libraryBlocks: [row] })), JSON.stringify(row)).toThrow(ImportError);
  expect(await db.libraryBlocks.toArray()).toEqual(before);
});

it.each([
  ['a non-whole-minute duration', selfPaced({ durationSec: 481 })],
  ['duplicate exercises', selfPaced({ stations: [...selfPaced().stations, ...selfPaced().stations] })],
  ['a whitespace-only name', selfPaced({ name: '   ' })],
])('rejects importing a block with %s', (_, row) => {
  expect(() => parseExport(file({ libraryBlocks: [row] }))).toThrow(ImportError);
});

it('imports a coached row and an unknown exercise id', async () => {
  const db = open();
  const unknown = selfPaced({ id: 'legacy', stations: [{ exerciseId: 'legacy-move', target: { unit: 'reps', amount: 10 } }] });
  await importExport(db, parseExport(file({ libraryBlocks: [coached(), unknown] })).file);
  expect(await db.libraryBlocks.get('lb2')).toMatchObject({ kind: 'coached', workSec: 30 });
  expect((await db.libraryBlocks.get('legacy'))?.stations[0]?.exerciseId).toBe('legacy-move');
});

it('puts, replaces stations without moving createdAt, strips a zero load, deletes, and rejects when closed', async () => {
  const db = open();
  const createdAt = '2026-01-01T00:00:00.000Z';
  await saveLibraryBlock(db, selfPaced({
    createdAt, stations: [{ exerciseId: 'leg-press', target: { unit: 'reps', amount: 10 }, load: 0 }],
  }));
  expect((await db.libraryBlocks.get('lb1'))?.stations[0]).not.toHaveProperty('load');
  await saveLibraryBlock(db, selfPaced({
    createdAt, updatedAt: '2026-11-21T00:00:00.000Z',
    stations: [{ exerciseId: 'goblet-squat', target: { unit: 'reps', amount: 8 }, load: 20 }],
  }));
  const saved = await db.libraryBlocks.get('lb1');
  expect(saved?.createdAt).toBe(createdAt);
  expect(saved?.stations).toEqual([{ exerciseId: 'goblet-squat', target: { unit: 'reps', amount: 8 }, load: 20 }]);
  await deleteLibraryBlock(db, 'lb1');
  expect(await db.libraryBlocks.get('lb1')).toBeUndefined();

  const closed = open();
  closed.close();
  await expect(saveLibraryBlock(closed, selfPaced())).rejects.toThrow();
});
