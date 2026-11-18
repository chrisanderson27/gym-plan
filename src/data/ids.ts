import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

/** Sortable even within one millisecond. */
export const newId = (): string => ulid();
