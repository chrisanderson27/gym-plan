import Dexie, { type Table } from 'dexie';
import { SEED_EQUIPMENT } from '../content/equipment';
import { SCHEMA_VERSION, V1_STORES, V2_STORES, V3_STORES } from './schema';
import type {
  BodyLog,
  CssTest,
  Equipment,
  ExerciseOverride,
  FeedbackRow,
  LibraryBlock,
  RunRow,
  Session,
  SetRow,
  Settings,
  SwimRow,
  SyncMeta,
  SyncOutboxEntry,
  Template,
} from './types';

export { SCHEMA_VERSION, V1_STORES };

// v1 is frozen once shipped (see schema.ts). A change means `this.version(2)` plus a migrateExport step.
export class GymDb extends Dexie {
  exerciseOverrides!: Table<ExerciseOverride, string>;
  equipment!: Table<Equipment, string>;
  sessions!: Table<Session, string>;
  sets!: Table<SetRow, string>;
  runs!: Table<RunRow, string>;
  swims!: Table<SwimRow, string>;
  tests!: Table<CssTest, string>;
  bodyLogs!: Table<BodyLog, string>;
  templates!: Table<Template, string>;
  feedback!: Table<FeedbackRow, string>;
  settings!: Table<Settings, string>;
  libraryBlocks!: Table<LibraryBlock, string>;
  syncOutbox!: Table<SyncOutboxEntry, number>;
  syncMeta!: Table<SyncMeta, string>;

  constructor(name = 'gym-plan') {
    super(name);
    this.version(1).stores(V1_STORES);
    // Data may read content; content never reads data. Populate runs only when the database is created, so an upgrade keeps the v1 equipment seed.
    this.on('populate', (tx) => tx.table('equipment').bulkAdd(SEED_EQUIPMENT));
    this.version(2).stores(V2_STORES);
    this.version(3).stores(V3_STORES);
    // A delete sets newVersion to null. Dexie's own handler runs after this one and would turn auto-open back on,
    // so the next put would recreate an empty gym and look successful. Returning false keeps that handler from running.
    this.on('versionchange', (ev) => {
      if (ev.newVersion != null) return;
      this.close();
      return false;
    });
  }
}

export const db = new GymDb();
