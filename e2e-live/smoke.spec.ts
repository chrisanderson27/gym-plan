import { expect, test } from '@playwright/test';
import { baseURL, extractAuthLink, signUpViaApi, stack, uniqueEmail, waitForMail } from './helpers';

test('harness: sign up → confirm via mail catcher → session from the built app', async ({ page, request }) => {
  const { apiUrl, publishableKey } = stack();
  const email = uniqueEmail('smoke');
  const password = 'test-password-123';
  const name = 'Live smoke';
  const tokenUrl = `${apiUrl}/auth/v1/token?grant_type=password`;

  const signup = await signUpViaApi(request, { email, password, name });
  expect(signup.status()).toBe(200);
  expect((await signup.json()).access_token).toBeUndefined();

  const unconfirmed = await request.post(tokenUrl, {
    headers: { apikey: publishableKey },
    data: { email, password },
  });
  expect(unconfirmed.status()).toBe(400);
  expect((await unconfirmed.json()).error_code).toBe('email_not_confirmed');

  const link = extractAuthLink(await waitForMail(request, email));
  const confirmed = await request.get(link, { maxRedirects: 0 });
  expect([302, 303]).toContain(confirmed.status());
  expect(confirmed.headers().location?.startsWith(baseURL)).toBe(true);

  await page.goto('./');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain(`connect-src 'self' ${new URL(apiUrl).origin};`);

  const session = await page.evaluate(async ({ tokenUrl, publishableKey, email, password }) => {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { apikey: publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return { status: response.status, body: await response.json() };
  }, { tokenUrl, publishableKey, email, password });
  expect(session.status).toBe(200);
  expect(session.body.access_token?.length).toBeGreaterThan(0);
  expect(session.body.user.email).toBe(email);
  expect(session.body.user.user_metadata.name).toBe(name);

  const result = await page.evaluate(async ({ apiUrl, publishableKey, token }) => {
    const response = await fetch(`${apiUrl}/rest/v1/sessions?select=id`, {
      headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: await response.json() };
  }, { apiUrl, publishableKey, token: session.body.access_token });
  expect(result.status).toBe(200);
  expect(result.body).toEqual([]);
});
