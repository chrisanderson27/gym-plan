import { setTimeout } from 'node:timers/promises';
import { devices, type APIRequestContext, type Browser } from '@playwright/test';
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

export async function waitForMail(
  request: APIRequestContext,
  email: string,
  { subjectIncludes, timeoutMs = 15_000 }: { subjectIncludes?: string; timeoutMs?: number } = {},
) {
  const { mailUrl } = stack();
  const deadline = Date.now() + timeoutMs;
  let remaining: number;
  while ((remaining = deadline - Date.now()) > 0) {
    const response = await request.get(`${mailUrl}/api/v1/search`, {
      params: { query: `to:${email}` },
      timeout: remaining,
      failOnStatusCode: true,
    });
    const { messages } = await response.json() as { messages?: { ID: string; Subject: string }[] };
    const first = messages?.find((message) => !subjectIncludes || message.Subject.includes(subjectIncludes));
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

export function secondDevice(browser: Browser) {
  return browser.newContext({ ...devices['iPhone 14'], baseURL });
}
