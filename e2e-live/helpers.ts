import { setTimeout } from 'node:timers/promises';
import { devices, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { readLocalStack } from '../scripts/supabase-env.mjs';

export const baseURL = 'http://127.0.0.1:4174/gym-plan/';
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

export function secondDevice(browser: Browser) {
  return browser.newContext({ ...devices['iPhone 14'], baseURL });
}
