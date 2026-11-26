import type { GymDb } from './db';
import { ImportError } from './errors';
import { validateRows } from './validate';
import { migrateExport, type ExportFile } from './migrations';
import { reconcileMixedSets } from './mixedSets';
import { SCHEMA_VERSION } from './schema';
import { STORE_NAMES, USER_STORES, type StoreName } from './stores';
import type { Equipment, Session, Settings } from './types';

/** "Identical user-store contents" excludes exactly this field: importing stamps a fresh backupAt. */
export const ROUND_TRIP_EXCLUDE = [['settings', 'backupAt']] as const;

export { ImportError };

/** Reads every user store; writes nothing. */
export async function buildExport(db: GymDb, now: Date | undefined, appVersion: string): Promise<ExportFile> {
  return db.transaction('r', STORE_NAMES.map((n) => db.table(n)), async () => {
    const stores: Record<string, unknown[]> = {};
    for (const name of STORE_NAMES) stores[name] = await db.table(name).toArray();
    return { schemaVersion: SCHEMA_VERSION, exportedAt: (now ?? new Date()).toISOString(), appVersion, stores };
  });
}

/** Call only after share/download succeeded, so the exported file holds the previous backupAt. */
export async function markBackedUp(db: GymDb, exportedAt: string): Promise<void> {
  await db.settings.update('settings', { backupAt: exportedAt });
}

export function parseExport(text: string): { file: ExportFile; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('This file is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null) throw new ImportError('This is not a gym-plan backup.');
  const obj = raw as Record<string, unknown>;
  const version = obj.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new ImportError('This is not a gym-plan backup (no schemaVersion).');
  }
  if (version > SCHEMA_VERSION) {
    throw new ImportError('This backup was made by a newer app. Update gym-plan and try again.');
  }
  if (typeof obj.stores !== 'object' || obj.stores === null || Array.isArray(obj.stores)) {
    throw new ImportError('This backup has no stores.');
  }
  let file: ExportFile = {
    schemaVersion: version,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date(0).toISOString(),
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : 'unknown',
    stores: obj.stores as Record<string, unknown[]>,
  };
  if (version < SCHEMA_VERSION) {
    try {
      file = migrateExport(file);
    } catch (e) {
      throw new ImportError(e instanceof Error ? e.message : 'Could not migrate this backup.');
    }
  }

  const warnings: string[] = [];
  const stores: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(file.stores)) {
    if (!(name in USER_STORES)) {
      warnings.push(`Ignored unknown store "${name}".`);
      continue;
    }
    if (!Array.isArray(rows)) throw new ImportError(`Store "${name}" is not a list.`);
    const pk = USER_STORES[name as StoreName];
    for (const row of rows) {
      const key = typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[pk] : undefined;
      if (typeof key !== 'string' || key === '') {
        throw new ImportError(`A row in "${name}" is missing its "${pk}".`);
      }
    }
    if (name === 'settings') {
      if (rows.length > 1) throw new ImportError('Settings may hold at most one row.');
      if (rows[0] && (rows[0] as Settings).id !== 'settings') throw new ImportError('Settings row has the wrong id.');
    }
    if (name !== 'sessions') validateRows(name as StoreName, rows);
    stores[name] = rows;
  }
  if (stores.sessions) {
    const equipment = (stores.equipment ?? []) as Equipment[];
    validateRows('sessions', stores.sessions, {
      exportedAt: obj.exportedAt, restoreAt: Date.now(), equipment: new Map(equipment.map((row) => [row.id, row])),
    });
  }
  return { file: { ...file, stores }, warnings };
}

const maxIso = (...xs: (string | null | undefined)[]): string | null =>
  xs.reduce<string | null>((a, b) => (b && (!a || Date.parse(b) > Date.parse(a)) ? b : a), null);

/** Atomic merge: incoming wins on a key clash, local rows absent from the file are never deleted. */
export async function importExport(db: GymDb, file: ExportFile): Promise<{ written: Record<string, number> }> {
  const written: Record<string, number> = {};
  await db.transaction('rw', STORE_NAMES.map((n) => db.table(n)), async () => {
    const byId = new Map(((file.stores.sessions ?? []) as Session[]).map((session) => [session.id, session]));
    const mixed = [...byId.values()].filter((session) => session.mixed);
    const previous = await db.sessions.bulkGet(mixed.map((session) => session.id));
    for (const name of STORE_NAMES) {
      if (name === 'settings') continue;
      const rows = file.stores[name] ?? [];
      if (rows.length) await db.table(name).bulkPut(rows);
      written[name] = rows.length;
    }
    for (const [i, incomingSession] of mixed.entries()) {
      const rows = await db.sets.where('sessionId').equals(incomingSession.id).toArray();
      const session = structuredClone(incomingSession);
      if (reconcileMixedSets(session, rows, previous[i])) await db.sessions.put(session);
    }
    const incoming = (file.stores.settings?.[0] as Settings | undefined) ?? undefined;
    const local = await db.settings.get('settings');
    const backupAt = maxIso(local?.backupAt, incoming?.backupAt, file.exportedAt);
    if (incoming && (!local || Date.parse(incoming.updatedAt) > Date.parse(local.updatedAt))) {
      await db.settings.put({ ...incoming, backupAt });
    } else if (local) {
      await db.settings.update('settings', { backupAt });
    }
    written.settings = incoming ? 1 : 0;
  });
  return { written };
}
