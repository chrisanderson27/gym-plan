import { GUEST_KEY } from '../src/sync/guest';

export const guestStorageState = (origin: string) => ({
  cookies: [], origins: [{ origin, localStorage: [{ name: GUEST_KEY, value: '1' }] }],
});
