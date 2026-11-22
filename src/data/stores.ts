/** Store name -> primary-key field. The single source of the import merge key; export, import and tests iterate it. */
export const USER_STORES = {
  exerciseOverrides: 'exerciseId',
  equipment: 'id',
  sessions: 'id',
  sets: 'id',
  runs: 'sessionId',
  swims: 'sessionId',
  tests: 'id',
  bodyLogs: 'date',
  templates: 'id',
  feedback: 'id',
  settings: 'id',
  libraryBlocks: 'id',
} as const;

export type StoreName = keyof typeof USER_STORES;
export const STORE_NAMES = Object.keys(USER_STORES) as StoreName[];
