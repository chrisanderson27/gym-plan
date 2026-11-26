/** Backup file version, independent of the Dexie database version. */
export const SCHEMA_VERSION = 2;

/**
 * v1 is frozen once shipped. To change an index, add `this.version(2).stores(...).upgrade(...)` in db.ts
 * and a matching `EXPORT_MIGRATIONS` step. Only index strings are frozen; non-indexed row fields can be
 * added freely.
 */
export const V1_STORES = {
  exerciseOverrides: 'exerciseId',
  equipment: 'id, kind',
  sessions: 'id, date, type, templateId',
  sets: 'id, sessionId, exerciseId, equipmentId, [exerciseId+equipmentId]',
  runs: 'sessionId, kind',
  swims: 'sessionId',
  tests: 'id, kind, date',
  bodyLogs: 'date',
  templates: 'id, type, source',
  feedback: 'id, ts, kind',
  settings: 'id',
} as const;

/** Version 2 repeats every v1 store. Dropping one here drops its data on upgrade. */
export const V2_STORES = {
  ...V1_STORES,
  libraryBlocks: 'id',
} as const;

/** Sync bookkeeping stays outside USER_STORES and backups, which remain at version 2. */
export const V3_STORES = {
  ...V2_STORES,
  syncOutbox: '++seq, &[store+key]',
  syncMeta: 'id',
} as const;
