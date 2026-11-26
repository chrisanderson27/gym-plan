import { setTimeout } from 'node:timers/promises';
import { devices, expect, test as base, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readLocalStack } from '../scripts/supabase-env.mjs';

export const baseURL = 'http://127.0.0.1:4174/gym-plan/';
export const password = 'test-password-123';
const runId = Date.now().toString(36);
let emailCount = 0;
let localStack: ReturnType<typeof readLocalStack> | undefined;

export function stack() {
  return localStack ??= readLocalStack();
}

export function uniqueEmail(tag: string) {
  return `user+${runId}-${tag}-${++emailCount}@example.test`;
}

export function signUpViaApi(
  request: APIRequestContext,
  { email, password, name }: { email: string; password: string; name: string },
) {
  const { apiUrl, publishableKey } = stack();
  return request.post(`${apiUrl}/auth/v1/signup`, {
    headers: { apikey: publishableKey },
    data: { email, password, data: { name } },
  });
}

async function searchMail(request: APIRequestContext, email: string, timeout?: number) {
  const { mailUrl } = stack();
  const response = await request.get(`${mailUrl}/api/v1/search`, {
    params: { query: `to:${email}` },
    timeout,
    failOnStatusCode: true,
  });
  const { messages } = await response.json() as { messages?: { ID: string; Subject: string }[] };
  return messages ?? [];
}

export async function mailCount(request: APIRequestContext, email: string, subjectIncludes?: string) {
  const messages = await searchMail(request, email);
  return messages.filter((message) => !subjectIncludes || message.Subject.includes(subjectIncludes)).length;
}

export async function waitForMail(
  request: APIRequestContext,
  email: string,
  { subjectIncludes, timeoutMs = 15_000 }: { subjectIncludes?: string; timeoutMs?: number } = {},
) {
  const { mailUrl } = stack();
  const deadline = Date.now() + timeoutMs;
  let remaining: number;
  while ((remaining = deadline - Date.now()) > 0) {
    const messages = await searchMail(request, email, remaining);
    const first = messages.find((message) => !subjectIncludes || message.Subject.includes(subjectIncludes));
    if (first) {
      const message = await request.get(`${mailUrl}/api/v1/message/${encodeURIComponent(first.ID)}`, {
        timeout: Math.max(1, deadline - Date.now()),
        failOnStatusCode: true,
      });
      const { Text, HTML } = await message.json() as { Text: string; HTML: string };
      return { text: Text, html: HTML };
    }
    await setTimeout(Math.min(250, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`No matching mail for ${email} after ${timeoutMs}ms`);
}

export function extractAuthLink(message: { text: string; html: string }) {
  const link = `${message.text}\n${message.html}`.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/)?.[0];
  if (!link) throw new Error('Mail does not contain a Supabase verification link');
  return link.replaceAll('&amp;', '&');
}

export async function confirmViaApi(request: APIRequestContext, email: string) {
  const link = extractAuthLink(await waitForMail(request, email));
  const response = await request.get(link, { maxRedirects: 0 });
  expect([302, 303]).toContain(response.status());
  expect(response.headers().location).toBeDefined();
  const redirect = new URL(response.headers().location!);
  expect(redirect.searchParams.has('error')).toBe(false);
  expect(redirect.hash).not.toContain('error=');
}

export async function fillLogIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
}

export function secondDevice(browser: Browser, serviceWorkers?: 'allow' | 'block') {
  return browser.newContext({ ...devices['iPhone 14'], baseURL, serviceWorkers });
}

export async function signedInContext(browser: Browser, email: string, password: string, serviceWorkers?: 'allow' | 'block') {
  const context = await secondDevice(browser, serviceWorkers);
  try {
    const page = await context.newPage();
    await page.goto('./');
    await fillLogIn(page, email, password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page.getByTestId('hero')).toBeVisible();
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export const test = base.extend<{
  device: (email: string, serviceWorkers?: 'allow' | 'block') => ReturnType<typeof signedInContext>;
}>({
  device: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async (email, serviceWorkers) => {
        const result = await signedInContext(browser, email, password, serviceWorkers);
        contexts.push(result.context);
        return result;
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
});

export async function user(request: APIRequestContext, tag: string) {
  const email = uniqueEmail(tag);
  const response = await signUpViaApi(request, { email, password, name: 'Gym Plan Tester' });
  expect(response.ok()).toBe(true);
  await confirmViaApi(request, email);
  return { email, token: await accessToken(request, email, password) };
}

export async function accessToken(request: APIRequestContext, email: string, password: string) {
  const { apiUrl, publishableKey } = stack();
  const response = await request.post(`${apiUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: publishableKey }, data: { email, password },
  });
  expect(response.ok()).toBe(true);
  const { access_token: token } = await response.json() as { access_token: string };
  return token;
}

export async function serverRows(request: APIRequestContext, token: string, table: string) {
  const { apiUrl, publishableKey } = stack();
  const response = await request.get(`${apiUrl}/rest/v1/${table}?select=id,deleted_at&order=id.asc`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);
  return await response.json() as { id: string; deleted_at: string | null }[];
}

export async function foreground(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

export function localCount(page: Page, store: string) {
  return page.evaluate((name) => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('gym-plan');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(name);
      const count = transaction.objectStore(name).count();
      transaction.oncomplete = () => { db.close(); resolve(count.result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), store);
}
