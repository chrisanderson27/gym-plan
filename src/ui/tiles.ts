export interface TileDef {
  id: string;
  title: string;
  subtitle: string;
  why?: string;
  route: string;
  /** Later phases flip this one flag. */
  ready: boolean;
  phase: 'P2' | 'P3' | 'P4';
}

export const TILES: TileDef[] = [
  { id: 'pick', title: "★ Today's pick", subtitle: 'Lower A (calibration)', why: 'No history yet — calibrate first', route: '#/lift/calibrate/lower-a', ready: true, phase: 'P2' },
  { id: 'lift', title: 'Lift', subtitle: 'Upper / Lower', route: '#/lift', ready: true, phase: 'P2' },
  { id: 'burn', title: 'Burn class', subtitle: '55 min', route: '#/burn', ready: true, phase: 'P3' },
  { id: 'run', title: 'Run', subtitle: 'Easy, long, intervals', route: '#/run', ready: true, phase: 'P3' },
  { id: 'swim', title: 'Swim', subtitle: 'Pool session', route: '#/swim', ready: true, phase: 'P3' },
  { id: 'hybrid', title: 'Hybrid', subtitle: 'Lift + cardio', route: '#/hybrid', ready: false, phase: 'P4' },
];

export const ACTIONS: TileDef[] = [
  { id: 'weigh-in', title: 'Weigh-in', subtitle: '', route: '#/weigh-in', ready: false, phase: 'P4' },
  { id: 'history', title: 'History', subtitle: '', route: '#/history', ready: false, phase: 'P4' },
  { id: 'builder', title: '+', subtitle: '', route: '#/builder', ready: false, phase: 'P4' },
];
