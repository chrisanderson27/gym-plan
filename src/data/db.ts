import Dexie, { type Table } from 'dexie';
import { SEED_EQUIPMENT } from '../content/equipment';
import { SCHEMA_VERSION, V1_STORES } from './schema';
import type {
  BodyLog,
  CssTest,
  Equipment,
  ExerciseOverride,
  FeedbackRow,
  RunRow,
  Session,
  SetRow,
  Settings,
  SwimRow,
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

  constructor(name = 'gym-plan') {
    super(name);
    this.version(1).stores(V1_STORES);
    // Data may read content; content never reads data.
    this.on('populate', (tx) => tx.table('equipment').bulkAdd(SEED_EQUIPMENT));
  }
}

export const db = new GymDb();
