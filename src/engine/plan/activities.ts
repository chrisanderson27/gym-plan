import type { CandidateId, PlanSession } from './types';

export const ACTIVITIES = ['lift', 'burn', 'run', 'swim'] as const;
export type Activity = typeof ACTIVITIES[number];

export function activityOf(id: CandidateId | PlanSession['type']): Activity | undefined {
  switch (id.split('-')[0]) {
    case 'lift':
    case 'hybrid': return 'lift';
    case 'burn': return 'burn';
    case 'run': return 'run';
    case 'swim': return 'swim';
    default: return undefined;
  }
}

export const enabled = (activities?: readonly Activity[]): readonly Activity[] => activities ?? ACTIVITIES;
