import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError, type AuthChangeEvent, type Session } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { AUTH_PARAMS, authErrorKind, createAuth, displayName, stripAuthParams } from './auth';
import { AUTH_STORAGE_KEY } from './client';
import { GUEST_KEY } from './guest';

const email = 'alex@example.com';
const password = 'test-password';
const session: Session = {
  access_token: 'access', token_type: 'bearer', refresh_token: 'refresh', expires_in: 3600, expires_at: 1,
  user: { id: 'user-1', aud: 'authenticated', email, user_metadata: { name: 'Alex' }, app_metadata: {}, created_at: '' },
};
const apiError = (code: string, status = 400) => new AuthApiError('test error', status, code);
const success = { error: null };

function setup({ href = 'http://h/gym-plan/', keyless = false, stored = false, guest = false } = {}) {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  if (stored) storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  if (guest) storage.setItem(GUEST_KEY, '1');
  const win = {
    location: new URL(href),
    history: { state: null, replaceState: vi.fn() },
    navigator: { onLine: true },
  };
  let listener: (event: AuthChangeEvent, session: Session | null) => void;
  const methods = {
    onAuthStateChange: vi.fn((fn: typeof listener) => { listener = fn; }),
    initialize: vi.fn().mockResolvedValue(success),
    signInWithOAuth: vi.fn().mockResolvedValue(success),
    signUp: vi.fn().mockResolvedValue({ ...success, data: { user: { identities: [{}] } } }),
    signInWithPassword: vi.fn().mockResolvedValue(success),
    resend: vi.fn().mockResolvedValue(success),
    resetPasswordForEmail: vi.fn().mockResolvedValue(success),
    updateUser: vi.fn().mockResolvedValue(success),
    signOut: vi.fn().mockResolvedValue(success),
  };
  const rpc = vi.fn().mockResolvedValue(success);
  const client = { auth: methods, rpc } as unknown as Parameters<typeof createAuth>[0]['client'];
  const auth = createAuth({ client: keyless ? null : client, storage, win, baseUrl: '/gym-plan/' });
  return { auth, methods, rpc, storage, win, emit: (event: AuthChangeEvent, value: Session | null) => listener(event, value) };
}

describe('launch state', () => {
  it('uses guest mode and no-ops every action without a client', async () => {
    const { auth, storage, methods } = setup({ keyless: true, stored: true });
    expect(auth.getState()).toEqual({ status: 'guest', user: null, recovery: false, notice: null });
    await auth.start();
    for (const result of [
      auth.chooseGuest(), auth.signInWithGoogle(), auth.signUp({ name: 'Alex', email, password }),
      auth.signIn({ email, password }), auth.resend(email), auth.resetPassword(email),
      auth.updatePassword(password), auth.signOut(), auth.deleteAccount(),
    ]) {
      expect(await result).toEqual({ ok: false, error: 'unknown' });
    }
    expect(storage.getItem(GUEST_KEY)).toBeNull();
    expect(methods.onAuthStateChange).not.toHaveBeenCalled();
  });

  it('opens signed in before start when the stored session has expired', () => {
    const { auth } = setup({ stored: true });
    expect(auth.getState()).toMatchObject({ status: 'signed-in', user: { id: 'user-1', email, name: 'Alex' } });
  });

  it('recognizes signed out, guest, and loading before start', async () => {
    expect(setup().auth.getState().status).toBe('signed-out');
    expect(setup({ guest: true }).auth.getState().status).toBe('guest');
    const { auth } = setup({ guest: true, href: 'http://h/gym-plan/?code=x' });
    expect(auth.getState().status).toBe('loading');
    await auth.start();
    expect(auth.getState().status).toBe('guest');
  });

  it('writes the guest flag and clears it on sign-in', async () => {
    const { auth, emit, storage } = setup();
    const listener = vi.fn();
    const unsubscribe = auth.subscribe(listener);
    await auth.start();
    auth.chooseGuest();
    expect(storage.getItem('gym-plan:guest')).toBe('1');
    expect(auth.getState().status).toBe('guest');
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    emit('SIGNED_IN', session);
    expect(storage.getItem(GUEST_KEY)).toBeNull();
    expect(auth.getState().status).toBe('signed-in');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('keeps the expired offline session when INITIAL_SESSION is null', async () => {
    const { auth, emit, win } = setup({ stored: true });
    win.navigator.onLine = false;
    await auth.start();
    emit('INITIAL_SESSION', null);
    expect(auth.getState()).toMatchObject({ status: 'signed-in', user: { id: 'user-1' } });
  });
});

describe('callback handling', () => {
  it.each([
    ['?code=x#/', apiError('exchange_failed'), 'google-failed'],
    ['?error=access_denied&error_description=cancelled', null, 'google-failed'],
    ['?error_code=otp_expired', apiError('otp_expired'), 'link-expired'],
    ['?code=x', null, 'confirmed-elsewhere'],
  ])('strips %s and reports %s as %s', async (query, error, notice) => {
    const { auth, methods, win } = setup({ href: 'http://h/gym-plan/' + query });
    methods.initialize.mockResolvedValue({ error });
    await auth.start();
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/gym-plan/#/');
    expect(auth.getState()).toMatchObject({ status: 'signed-out', notice });
  });

  it('keeps unrelated URLs intact', async () => {
    const { auth, win } = setup({ href: 'http://h/gym-plan/?other=x#/settings' });
    await auth.start();
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });

  it('cleans a successful callback even when the SDK removes the query first', async () => {
    const { auth, methods, storage, win } = setup({ href: 'http://h/gym-plan/?code=x' });
    methods.initialize.mockImplementation(async () => {
      win.location.search = '';
      storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      return success;
    });
    await auth.start();
    expect(auth.getState()).toMatchObject({ status: 'signed-in', notice: null });
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/gym-plan/#/');
  });
});

describe('auth actions', () => {
  it('keeps recovery through INITIAL_SESSION and clears it after a password update', async () => {
    const { auth, emit, methods } = setup();
    await auth.start();
    emit('PASSWORD_RECOVERY', session);
    emit('INITIAL_SESSION', session);
    expect(auth.getState()).toMatchObject({ status: 'signed-in', recovery: true });
    expect(await auth.updatePassword(password)).toEqual({ ok: true });
    expect(methods.updateUser).toHaveBeenCalledWith({ password });
    expect(auth.getState().recovery).toBe(false);
  });

  it('uses the app base for Google, sign-up, resend and reset redirects', async () => {
    const { auth, methods } = setup();
    const redirectTo = 'http://h/gym-plan/';
    expect(await auth.signUp({ name: ' Alex ', email, password })).toEqual({ ok: true });
    await auth.signInWithGoogle();
    await auth.resend(email);
    await auth.resetPassword(email);
    expect(methods.signUp).toHaveBeenCalledWith({
      email, password, options: { data: { name: 'Alex' }, emailRedirectTo: redirectTo },
    });
    expect(methods.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo } });
    expect(methods.resend).toHaveBeenCalledWith({ type: 'signup', email, options: { emailRedirectTo: redirectTo } });
    expect(methods.resetPasswordForEmail).toHaveBeenCalledWith(email, { redirectTo });
  });

  it('recognizes an existing account by its empty identities', async () => {
    const { auth, methods } = setup();
    methods.signUp.mockResolvedValue({ ...success, data: { user: { identities: [] } } });
    expect(await auth.signUp({ name: 'Alex', email, password })).toEqual({ ok: false, error: 'exists' });
  });

  it('blocks short passwords before sending a request', async () => {
    const { auth, methods } = setup();
    expect(await auth.signUp({ name: 'Alex', email, password: '1234567' })).toEqual({ ok: false, error: 'weak-password' });
    expect(await auth.updatePassword('1234567')).toEqual({ ok: false, error: 'weak-password' });
    expect(methods.signUp).not.toHaveBeenCalled();
    expect(methods.updateUser).not.toHaveBeenCalled();
  });

  it('blocks network actions while offline', async () => {
    const { auth, methods, rpc, win } = setup();
    win.navigator.onLine = false;
    for (const action of [
      auth.signUp({ name: 'Alex', email, password }), auth.signIn({ email, password }),
      auth.signInWithGoogle(), auth.resend(email), auth.resetPassword(email),
      auth.updatePassword(password), auth.signOut(), auth.deleteAccount(),
    ]) {
      expect(await action).toEqual({ ok: false, error: 'offline' });
    }
    for (const method of Object.values(methods)) expect(method).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('clears the guest flag on sign-out', async () => {
    const { auth, storage } = setup({ guest: true, stored: true });
    expect(await auth.signOut()).toEqual({ ok: true });
    expect(auth.getState().status).toBe('signed-out');
    expect(storage.getItem(GUEST_KEY)).toBeNull();
  });

  it('keeps state and the guest flag when account deletion fails', async () => {
    const { auth, methods, rpc, storage } = setup({ guest: true, stored: true });
    const before = auth.getState();
    rpc.mockResolvedValue({ error: apiError('delete_failed') });
    expect(await auth.deleteAccount()).toEqual({ ok: false, error: 'unknown' });
    expect(methods.signOut).not.toHaveBeenCalled();
    expect(auth.getState()).toBe(before);
    expect(storage.getItem(GUEST_KEY)).toBe('1');
  });

  it('signs out locally and clears the guest flag after account deletion', async () => {
    const { auth, methods, rpc, storage } = setup({ guest: true, stored: true });
    expect(await auth.deleteAccount()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('delete_my_account');
    expect(methods.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.getState().status).toBe('signed-out');
    expect(storage.getItem(GUEST_KEY)).toBeNull();
  });
});

it.each([
  [apiError('invalid_credentials'), 'invalid-credentials'],
  [apiError('email_not_confirmed'), 'not-confirmed'],
  [apiError('user_already_exists'), 'exists'],
  [apiError('email_exists'), 'exists'],
  [apiError('over_email_send_rate_limit'), 'rate-limited'],
  [apiError('over_request_rate_limit'), 'rate-limited'],
  [apiError('weak_password'), 'weak-password'],
  [new AuthWeakPasswordError('weak', 422, []), 'weak-password'],
  [apiError('other', 429), 'rate-limited'],
  [new AuthRetryableFetchError('network', 0), 'offline'],
  [apiError('other'), 'unknown'],
  [new Error('unrecognized'), 'unknown'],
])('maps %j to %s', (error, kind) => {
  expect(authErrorKind(error)).toBe(kind);
});

it('prefers name, full name, then email for the display name', () => {
  expect(displayName({ email, user_metadata: { name: 'Alex', full_name: 'Alex Morgan' } })).toBe('Alex');
  expect(displayName({ email, user_metadata: { full_name: 'Alex Morgan' } })).toBe('Alex Morgan');
  expect(displayName({ email, user_metadata: {} })).toBe(email);
  expect(displayName({})).toBeNull();
});

it.each(AUTH_PARAMS)('drops the whole query and keeps the app path when %s is present', (param) => {
  expect(stripAuthParams(`http://h/gym-plan/?other=x&${param}=y#/settings`)).toBe('/gym-plan/#/');
});
