import { GymDb } from './db';
import { newId } from './ids';

/** Each test opens its own throwaway database. */
export const openTestDb = (): GymDb => new GymDb('t-' + newId());
