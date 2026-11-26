import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importExport } from '../data/backup';
import { ensureDefaultSettings } from '../data/settings';
import { openTestDb } from '../data/test-utils';
import { markSyncApply } from './marker';
import { installOutbox, pendingCount } from './outbox';

let db: ReturnType<typeof openTestDb>;
const bodyLog = (date: string, weightLb = 150) => ({ date, weightLb, protein: false });

beforeEach(() => { db = openTestDb(); });
afterEach(async () => { await db.delete(); });

describe('outbox capture', () => {
  it('captures put, add, bulkPut, bulkDelete, and delete in commit order', async () => {
    const onCapture = vi.fn();
    installOutbox(db, { onCapture });
    await db.transaction('rw', db.bodyLogs, async () => {
      await db.bodyLogs.put(bodyLog('2026-01-01'));
      await db.bodyLogs.add(bodyLog('2026-01-02'));
      await db.bodyLogs.bulkPut([bodyLog('2026-01-03'), bodyLog('2026-01-04')]);
      await db.bodyLogs.bulkDelete(['2026-01-02', '2026-01-03']);
      await db.bodyLogs.delete('2026-01-04');
    });
    const entries = await db.syncOutbox.toArray();
    expect(entries.map(({ store, key, op }) => [store, key, op])).toEqual([
      ['bodyLogs', '2026-01-01', 'put'], ['bodyLogs', '2026-01-02', 'delete'],
      ['bodyLogs', '2026-01-03', 'delete'], ['bodyLogs', '2026-01-04', 'delete'],
    ]);
    expect(entries[1]?.clientUpdatedAt).toBe(entries[2]?.clientUpdatedAt);
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it('only captures successful keys in a partially failed bulkAdd', async () => {
    installOutbox(db);
    await db.bodyLogs.add(bodyLog('2026-01-01'));
    await db.syncOutbox.clear();
    await expect(db.bodyLogs.bulkAdd([bodyLog('2026-01-01'), bodyLog('2026-01-02')])).rejects.toMatchObject({ name: 'BulkError' });
    expect((await db.syncOutbox.toArray()).map((entry) => entry.key)).toEqual(['2026-01-02']);
  });

  it('coalesces update and modify with the same seq and a newer stamp', async () => {
    installOutbox(db);
    await db.bodyLogs.put(bodyLog('2026-01-01'));
    const before = (await db.syncOutbox.toArray())[0]!;
    await db.bodyLogs.update('2026-01-01', { weightLb: 151 });
    await db.bodyLogs.where('date').equals('2026-01-01').modify({ weightLb: 152 });
    const [after] = await db.syncOutbox.toArray();
    expect(await pendingCount(db)).toBe(1);
    expect(after?.seq).toBe(before.seq);
    expect(after!.clientUpdatedAt > before.clientUpdatedAt).toBe(true);
  });

  it('clear creates a tombstone per existing key', async () => {
    installOutbox(db);
    await db.bodyLogs.bulkAdd([bodyLog('2026-01-01'), bodyLog('2026-01-02')]);
    await db.syncOutbox.clear();
    await db.bodyLogs.clear();
    expect((await db.syncOutbox.toArray()).map(({ key, op }) => [key, op])).toEqual([
      ['2026-01-01', 'delete'], ['2026-01-02', 'delete'],
    ]);
  });

  it('serializes concurrent captures of the same key within one transaction', async () => {
    installOutbox(db);
    await db.transaction('rw', db.bodyLogs, async () => {
      await Promise.all([db.bodyLogs.put(bodyLog('2026-01-01')), db.bodyLogs.delete('2026-01-01')]);
    });
    expect(await db.syncOutbox.toArray()).toEqual([expect.objectContaining({ key: '2026-01-01', op: 'delete' })]);
  });

  it('captures a later write after a caught mutation rejection in the same transaction', async () => {
    installOutbox(db);
    const row = bodyLog('2026-01-01');
    const uncloneable = { ...row, extra: () => {} };
    await db.transaction('rw', db.bodyLogs, async () => {
      await expect(db.bodyLogs.put(uncloneable)).rejects.toMatchObject({ name: 'DataCloneError' });
      await db.bodyLogs.put(row);
    });
    expect(await db.bodyLogs.get(row.date)).toEqual(row);
    expect(await db.syncOutbox.toArray()).toEqual([expect.objectContaining({ key: row.date, op: 'put' })]);
  });

  it('rolls back outbox entries and skips notification when the user write aborts', async () => {
    const onCapture = vi.fn();
    installOutbox(db, { onCapture });
    await expect(db.transaction('rw', db.bodyLogs, async () => {
      await db.bodyLogs.add(bodyLog('2026-01-01'));
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await db.bodyLogs.count()).toBe(0);
    expect(await pendingCount(db)).toBe(0);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('importExport captures every imported row and its merged settings on an owned device', async () => {
    installOutbox(db);
    const date = '2026-01-01';
    await db.syncMeta.put({ id: 'owner', ownerId: 'signed-in-user' });
    await ensureDefaultSettings(db);
    const settings = (await db.settings.get('settings'))!;
    await importExport(db, {
      schemaVersion: 2, exportedAt: '2026-01-01T00:00:00.000Z', appVersion: 'test',
      stores: { bodyLogs: [bodyLog(date), bodyLog('2026-01-02')], settings: [settings],
        libraryBlocks: [{ id: 'block', name: 'Imported', updatedAt: '2026-01-01T00:00:00.000Z' }] },
    });
    expect((await db.syncOutbox.toArray()).map(({ store, key }) => [store, key])).toEqual([
      ['bodyLogs', date], ['bodyLogs', '2026-01-02'], ['libraryBlocks', 'block'], ['settings', 'settings'],
    ]);
  });

  it.each([3, 0.5])('captures backup imports with zone loss at dbcore level %s', async (level) => {
    // Simulate WebKit's zone loss before Hooks (3) or between Hooks and Cache (0.5).
    db.use({
      stack: 'dbcore',
      level,
      create: (down) => ({
        ...down,
        table(name) {
          const table = down.table(name);
          if (name !== 'syncOutbox') return table;
          return {
            ...table,
            mutate: (req) => Dexie.ignoreTransaction(() => table.mutate(req)),
          };
        },
      }),
    });
    installOutbox(db);
    const row = bodyLog('2026-01-01');
    await importExport(db, {
      schemaVersion: 2, exportedAt: '2026-01-01T00:00:00.000Z', appVersion: 'test',
      stores: { bodyLogs: [row] },
    });
    expect(await db.bodyLogs.get(row.date)).toEqual(row);
    expect(await db.syncOutbox.toArray()).toEqual([
      expect.objectContaining({ store: 'bodyLogs', key: row.date, op: 'put' }),
    ]);
  });

  it('a marked transaction enqueues nothing', async () => {
    installOutbox(db);
    await db.transaction('rw', db.bodyLogs, async (tx) => {
      markSyncApply(tx);
      await db.bodyLogs.put(bodyLog('2026-01-01'));
    });
    expect(await pendingCount(db)).toBe(0);
  });

  it('fresh populate and default settings creation enqueue nothing', async () => {
    installOutbox(db);
    await db.open();
    expect(await db.equipment.count()).toBeGreaterThan(0);
    expect(await pendingCount(db)).toBe(0);
    await ensureDefaultSettings(db);
    expect(await db.settings.get('settings')).toHaveProperty('updatedAt', new Date(0).toISOString());
    expect(await pendingCount(db)).toBe(0);
  });

  it('captures nothing if the middleware is absent', async () => {
    await db.bodyLogs.add(bodyLog('2026-01-01'));
    expect(await pendingCount(db)).toBe(0);
  });
});
