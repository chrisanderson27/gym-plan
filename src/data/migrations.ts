import { SCHEMA_VERSION } from './schema';

export interface ExportFile {
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  stores: Record<string, unknown[]>;
}

type Stores = Record<string, unknown[]>;

/** Key N upgrades an export written at schemaVersion N to N+1. */
export const EXPORT_MIGRATIONS: Record<number, (stores: Stores) => Stores> = {
  // Copy every v1 store through. A file that predates the library gets an empty one.
  1: (stores) => ({ ...stores, libraryBlocks: stores.libraryBlocks ?? [] }),
};

export function migrateExport(file: ExportFile): ExportFile {
  let { schemaVersion, stores } = file;
  while (schemaVersion < SCHEMA_VERSION) {
    const step = EXPORT_MIGRATIONS[schemaVersion];
    if (!step) throw new Error(`No export migration from schema ${schemaVersion}`);
    stores = step(stores);
    schemaVersion += 1;
  }
  return { ...file, schemaVersion, stores };
}
