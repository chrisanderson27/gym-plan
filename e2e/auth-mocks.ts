import { expect, type Page, type Route } from '@playwright/test';

function fakeJwt(sub: string, exp: number) {
  const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, exp, role: 'authenticated' })}.sig`;
}

export function fakeSession({ email, name, expiresIn = 3600 }: { email: string; name: string; expiresIn?: number }) {
  const id = '00000000-0000-4000-8000-000000000001';
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  return {
    access_token: fakeJwt(id, expiresAt), token_type: 'bearer', expires_in: expiresIn, expires_at: expiresAt,
    refresh_token: 'r-e2e', user: { id, aud: 'authenticated', email, user_metadata: { name }, identities: [{}] },
  };
}

type AuthPath = 'password' | 'pkce' | 'refresh_token' | 'signup' | 'resend' | 'recover' | 'GET user' | 'PUT user' | 'logout' | 'authorize';
type Handler = (route: Route, url: URL) => Promise<void>;

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-expose-headers': 'x-supabase-api-version',
};

export function authResponse(route: Route, json: object, status = 200) {
  return route.fulfill({ status, json, headers: { ...cors, 'x-supabase-api-version': '2024-01-01' } });
}

export async function mockAuth(page: Page, handlers: Partial<Record<AuthPath, Handler>> = {}) {
  const calls: string[] = [];
  await page.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        ...cors, 'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '',
      } });
      return;
    }
    const url = new URL(request.url());
    const path = url.pathname.slice(url.pathname.indexOf('/auth/v1/') + '/auth/v1/'.length);
    const key = path === 'token' ? url.searchParams.get('grant_type') ?? path :
      path === 'user' ? `${request.method()} user` : path;
    calls.push(key);
    const handler = handlers[key as AuthPath];
    if (handler) await handler(route, url);
    else if (key === 'logout') await route.fulfill({ status: 204, headers: cors });
    else {
      const message = `unmocked ${request.method()} ${url.pathname}${url.search}`;
      await authResponse(route, { msg: message }, 500);
      expect.soft(handler, message).toBeDefined();
    }
  });
  return calls;
}

export function seedStoredSession(page: Page, session: ReturnType<typeof fakeSession>) {
  return page.addInitScript((value) => localStorage.setItem('gym-plan:auth', JSON.stringify(value)), session);
}
