import {
  isAuthApiError, isAuthRetryableFetchError, isAuthWeakPasswordError,
  type AuthChangeEvent, type Session, type SupabaseClient, type User,
} from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, supabase } from './client';
import type { Database } from './database.types';
import { readGuest, writeGuest } from './guest';

export type AuthStatus = 'loading' | 'signed-out' | 'guest' | 'signed-in';
export type AuthUser = { id: string; email: string | null; name: string | null };
export type AuthNotice = 'google-failed' | 'link-expired' | 'confirmed-elsewhere' | null;
export type AuthState = { status: AuthStatus; user: AuthUser | null; recovery: boolean; notice: AuthNotice };
export type AuthErrorKind = 'invalid-credentials' | 'not-confirmed' | 'exists' | 'offline' | 'rate-limited' | 'weak-password' | 'unknown';
export type AuthResult = { ok: true } | { ok: false; error: AuthErrorKind };

export const AUTH_PARAMS = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'];

export function stripAuthParams(href: string): string | null {
  const url = new URL(href);
  return AUTH_PARAMS.some((param) => url.searchParams.has(param)) ? url.pathname + '#/' : null;
}

export function authErrorKind(err: unknown): AuthErrorKind {
  if (isAuthRetryableFetchError(err)) return 'offline';
  if (isAuthWeakPasswordError(err)) return 'weak-password';
  if (!isAuthApiError(err)) return 'unknown';
  if (err.status === 429) return 'rate-limited';
  switch (err.code) {
    case 'invalid_credentials': return 'invalid-credentials';
    case 'email_not_confirmed': return 'not-confirmed';
    case 'user_already_exists':
    case 'email_exists': return 'exists';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return 'rate-limited';
    case 'weak_password': return 'weak-password';
    default: return 'unknown';
  }
}

type UserProfile = Pick<User, 'id' | 'email'> & Partial<Pick<User, 'user_metadata'>>;

export function displayName(user: Omit<UserProfile, 'id'>): string | null {
  const { name, full_name: fullName } = user.user_metadata ?? {};
  if (typeof name === 'string') return name;
  if (typeof fullName === 'string') return fullName;
  return user.email ?? null;
}

const toUser = (user: UserProfile): AuthUser => ({
  id: user.id, email: user.email ?? null, name: displayName(user),
});
const failed = (error: AuthErrorKind): AuthResult => ({ ok: false, error });
const ok: AuthResult = { ok: true };

type AuthWindow = {
  location: Pick<Location, 'origin' | 'href'>;
  history: Pick<History, 'state' | 'replaceState'>;
  navigator: Pick<Navigator, 'onLine'>;
  dispatchEvent?: Window['dispatchEvent'];
};

export function createAuth({ client, storage, win, baseUrl }: {
  client: Pick<SupabaseClient<Database>, 'auth' | 'rpc'> | null;
  storage?: Parameters<typeof readGuest>[0];
  win?: AuthWindow;
  baseUrl: string;
}) {
  const listeners = new Set<() => void>();
  const redirectTo = win ? win.location.origin + baseUrl : baseUrl;
  const signedOutStatus = () => readGuest(storage) ? 'guest' : 'signed-out';

  function readStoredUser(): AuthUser | null {
    try {
      const raw = storage?.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as Partial<Session> | null;
      const user = session?.user;
      return typeof session?.refresh_token === 'string' && session.refresh_token &&
        typeof user?.id === 'string' && user.id ? toUser(user) : null;
    } catch {
      return null;
    }
  }

  const stored = client ? readStoredUser() : null;
  let state: AuthState = {
    status: !client ? 'guest' : stored ? 'signed-in' :
      win && stripAuthParams(win.location.href) ? 'loading' : signedOutStatus(),
    user: stored,
    recovery: false,
    notice: null,
  };

  function update(patch: Partial<AuthState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function signedIn(user: AuthUser, recovery = state.recovery) {
    update({ status: 'signed-in', user, recovery, notice: null });
  }

  function signedOut(status: 'guest' | 'signed-out') {
    update({ status, user: null, recovery: false });
  }

  function onAuthChange(event: AuthChangeEvent, session: Session | null) {
    switch (event) {
      case 'SIGNED_IN':
        if (session) {
          writeGuest(storage, false);
          signedIn(toUser(session.user));
        }
        break;
      case 'PASSWORD_RECOVERY':
        if (session) signedIn(toUser(session.user), true);
        break;
      case 'TOKEN_REFRESHED':
      case 'USER_UPDATED':
        if (session) signedIn(toUser(session.user));
        break;
      case 'INITIAL_SESSION': {
        const user = session ? toUser(session.user) : readStoredUser();
        if (user) signedIn(user);
        else if (state.status !== 'loading') signedOut(signedOutStatus());
        break;
      }
      case 'SIGNED_OUT':
        signedOut(signedOutStatus());
        break;
    }
  }

  async function initialize() {
    if (!client) return;
    const href = win?.location.href;
    client.auth.onAuthStateChange(onAuthChange);
    const { error } = await client.auth.initialize();
    const cleanUrl = href ? stripAuthParams(href) : null;
    if (win && href && cleanUrl) {
      const original = new URL(href);
      const params = original.searchParams;
      const hasError = error || ['error', 'error_code', 'error_description'].some((param) => params.has(param));
      const user = state.user ?? readStoredUser();
      const notice = params.get('error_code') === 'otp_expired' ? 'link-expired' : hasError ? 'google-failed' :
        params.has('code') && !user ? 'confirmed-elsewhere' : null;
      const before = win.location.href;
      win.history.replaceState(win.history.state, '', cleanUrl);
      // replaceState changes the hash without notifying the mounted hash router.
      if (new URL(before).hash !== '#/') {
        win.dispatchEvent?.(new HashChangeEvent('hashchange', { oldURL: before, newURL: win.location.href }));
      }
      if (notice) update({ notice });
    }
    if (state.status === 'loading') {
      const user = readStoredUser();
      if (user) signedIn(user);
      else signedOut(signedOutStatus());
    }
  }

  let started: Promise<void> | undefined;
  const run = async (action: (cloud: NonNullable<typeof client>) => Promise<AuthResult>): Promise<AuthResult> => {
    if (!client) return failed('unknown');
    if (win?.navigator.onLine === false) return failed('offline');
    try {
      return await action(client);
    } catch (error) {
      return failed(authErrorKind(error));
    }
  };
  const result = (error: unknown): AuthResult => error ? failed(authErrorKind(error)) : ok;

  async function signOut(): Promise<AuthResult> {
    if (!client) return failed('unknown');
    writeGuest(storage, false);
    // The SDK removes the local session before attempting to revoke it.
    try { await client.auth.signOut({ scope: 'local' }); } catch { /* Revocation is best-effort. */ }
    signedOut('signed-out');
    return ok;
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start: () => started ??= initialize(),
    chooseGuest(): AuthResult {
      if (!client) return failed('unknown');
      writeGuest(storage, true);
      if (state.status !== 'signed-in') update({ status: 'guest', notice: null });
      return ok;
    },
    signInWithGoogle: () => run(async ({ auth }) =>
      result((await auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })).error)),
    signUp: ({ name, email, password }: { name: string; email: string; password: string }) => run(async ({ auth }) => {
      if (password.length < 8) return failed('weak-password');
      const { data, error } = await auth.signUp({
        email, password, options: { data: { name: name.trim() }, emailRedirectTo: redirectTo },
      });
      if (!error && data.user?.identities?.length === 0) return failed('exists');
      return result(error);
    }),
    signIn: (credentials: { email: string; password: string }) => run(async ({ auth }) =>
      result((await auth.signInWithPassword(credentials)).error)),
    resend: (email: string) => run(async ({ auth }) =>
      result((await auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } })).error)),
    resetPassword: (email: string) => run(async ({ auth }) =>
      result((await auth.resetPasswordForEmail(email, { redirectTo })).error)),
    updatePassword: (password: string) => run(async ({ auth }) => {
      if (password.length < 8) return failed('weak-password');
      const { error } = await auth.updateUser({ password });
      if (!error) update({ recovery: false });
      return result(error);
    }),
    signOut,
    deleteAccount: (onDeleted?: () => Promise<unknown>) => run(async (cloud) => {
      const { error } = await cloud.rpc('delete_my_account');
      if (error) return result(error);
      try {
        await onDeleted?.();
      } catch (error) {
        console.warn('Could not clear local data after account deletion', error);
      }
      return signOut();
    }),
  };
}

function browserStorage() {
  try {
    return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const auth = createAuth({
  client: supabase,
  storage: typeof globalThis.window === 'undefined' ? undefined : browserStorage(),
  win: typeof globalThis.window === 'undefined' ? undefined : globalThis.window,
  baseUrl: import.meta.env.BASE_URL,
});
