import { expect, test, type Page } from '@playwright/test';
import { GUEST_KEY } from '../src/sync/guest';
import { authResponse, fakeSession, mockAuth, seedStoredSession } from './auth-mocks';
import { guestStorageState } from './guest';
import { pageWidth, persistedRows, seedBackup, tooSmall } from './helpers';

test.skip(process.env.E2E_KEYLESS === '1', 'Needs the configured auth build');
test.use({ serviceWorkers: 'block', storageState: { cookies: [], origins: [] }, viewport: { width: 402, height: 874 } });

const email = 'alex@example.com';
const password = 'test-password-123';
const session = fakeSession({ email, name: 'Alex Morgan' });
const appUrl = 'http://localhost:4173/gym-plan/';
const logInButton = (page: Page) => page.getByRole('button', { name: 'Log in', exact: true });
const authError = (page: Page) => page.getByTestId('auth-error');
const today = (page: Page) => page.getByTestId('hero');

async function fillLogIn(page: Page) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
}

async function fillCreate(page: Page, newPassword = password) {
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill('Alex Morgan');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(newPassword);
}

const readGuest = (page: Page) => page.evaluate((key) => localStorage.getItem(key), GUEST_KEY);

test('launch gate matches Log in frame 10:509', async ({ page }, info) => {
  await mockAuth(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.locator('nav.tab-bar')).toHaveCount(0);
  await expect(page.getByText(/preview only|sample/i)).toHaveCount(0);
  await expect(page.getByPlaceholder('Your password')).toBeVisible();
  expect(await tooSmall(page)).toEqual([]);
  expect(await pageWidth(page)).toBeLessThanOrEqual(402);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: info.outputPath('sign-in-10-509.png'), fullPage: true, scale: 'css' });
});

test('Create account matches frame 10:955', async ({ page }, info) => {
  await mockAuth(page);
  await page.goto('./');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Find your rhythm.' })).toBeVisible();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByPlaceholder('At least 8 characters')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Forgot password?' })).toHaveCount(0);
  expect(await tooSmall(page)).toEqual([]);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: info.outputPath('sign-in-10-955.png'), fullPage: true, scale: 'css' });
});

test('both guest actions persist the same device-local choice', async ({ page, browser }) => {
  await mockAuth(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(today(page)).toBeVisible();
  expect(await readGuest(page)).toBe('1');
  await page.reload();
  await expect(today(page)).toBeVisible();

  const fresh = await browser.newPage({ serviceWorkers: 'block' });
  try {
    await mockAuth(fresh);
    await fresh.goto(appUrl);
    await fresh.getByRole('button', { name: 'Explore the app' }).click();
    await expect(today(fresh)).toBeVisible();
    expect(await readGuest(fresh)).toBe('1');
  } finally {
    await fresh.close();
  }
});

test('password log-in persists a session for reload', async ({ page }) => {
  const calls = await mockAuth(page, { password: (route) => authResponse(route, session) });
  await page.goto('./');
  await fillLogIn(page);
  await logInButton(page).click();
  await expect(today(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('gym-plan:auth'))).toBeTruthy();
  await page.reload();
  await expect(today(page)).toBeVisible();
  expect(calls).toEqual(['password']);
});

test('invalid credentials show an inline error', async ({ page }) => {
  await mockAuth(page, { password: (route) => authResponse(route, { code: 'invalid_credentials' }, 400) });
  await page.goto('./');
  await fillLogIn(page);
  await logInButton(page).click();
  await expect(authError(page)).toHaveText('That email and password don’t match.');
});

test('an unconfirmed log-in can resend the confirmation email', async ({ page }) => {
  const calls = await mockAuth(page, {
    password: (route) => authResponse(route, { code: 'email_not_confirmed' }, 400),
    resend: (route) => authResponse(route, {}),
  });
  await page.goto('./');
  await fillLogIn(page);
  await logInButton(page).click();
  await expect(authError(page)).toHaveText('Confirm your email first — check your inbox for the link.');
  await page.getByRole('button', { name: 'Resend email' }).click();
  await expect(page.getByRole('status')).toHaveText('Email sent. Check your inbox for the link.');
  expect(calls).toEqual(['password', 'resend']);
});

test('an existing account switches to Log in and retains the email', async ({ page }) => {
  await mockAuth(page, { signup: (route) => authResponse(route, { ...session.user, identities: [] }) });
  await page.goto('./');
  await fillCreate(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('tab', { name: 'Log in' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Email address')).toHaveValue(email);
  await expect(authError(page)).toHaveText('You already have an account with this email. Log in instead.');
});

test('offline submission shows the offline choice without sending a request', async ({ page, context }) => {
  const calls = await mockAuth(page);
  await page.goto('./');
  await fillLogIn(page);
  await context.setOffline(true);
  await logInButton(page).click();
  await expect(authError(page)).toHaveText('You’re offline — sign in when you have signal, or continue as guest');
  expect(calls).toEqual([]);
});

test('rate limiting shows a retry message', async ({ page }) => {
  await mockAuth(page, { password: (route) => authResponse(route, { code: 'over_request_rate_limit' }, 429) });
  await page.goto('./');
  await fillLogIn(page);
  await logInButton(page).click();
  await expect(authError(page)).toHaveText('Too many tries. Wait a minute, then try again.');
});

test('a short create password is rejected without a request', async ({ page }) => {
  const calls = await mockAuth(page);
  await page.goto('./');
  await fillCreate(page, '1234567');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(authError(page)).toHaveText('Use at least 8 characters.');
  expect(calls).toEqual([]);
});

test('a pending log-in marks the submit button busy and disables all controls', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await mockAuth(page, { password: async (route) => {
    await pending;
    await authResponse(route, session);
  } });
  await page.goto('./');
  await fillLogIn(page);
  await logInButton(page).click();
  try {
    await expect(logInButton(page)).toHaveAttribute('aria-busy', 'true');
    for (const control of await page.locator('main input, main button').all()) await expect(control).toBeDisabled();
  } finally {
    release();
  }
  await expect(today(page)).toBeVisible();
});

test('sign-up shows the check-email state and supports resend', async ({ page }) => {
  const calls = await mockAuth(page, {
    signup: (route) => authResponse(route, session.user),
    resend: (route) => authResponse(route, {}),
  });
  await page.goto('./');
  await fillCreate(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText(`We sent a link to ${email}.`)).toBeVisible();
  await page.getByRole('button', { name: 'Resend', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Email sent. Check your inbox for the link.');
  expect(calls).toEqual(['signup', 'resend']);
  await page.getByRole('button', { name: 'Back to log in' }).click();
  await expect(page.getByRole('tab', { name: 'Log in' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});

test('forgot password sends a reset link and recovery can set a new password', async ({ page }) => {
  let recoveryRedirect: URL;
  const calls = await mockAuth(page, {
    recover: (route, url) => {
      recoveryRedirect = new URL(url.searchParams.get('redirect_to')!);
      return authResponse(route, {});
    },
    pkce: (route) => authResponse(route, session),
    'PUT user': (route) => authResponse(route, session.user),
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.locator('form input')).toHaveCount(1);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  expect(calls).toEqual(['recover']);
  recoveryRedirect!.searchParams.set('code', 'fake-recovery');
  await page.goto(recoveryRedirect!.href);
  await page.getByLabel('New password', { exact: true }).fill('new-test-password');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(today(page)).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  expect(calls).toEqual(['recover', 'pkce', 'PUT user']);
});

test('Google PKCE returns to Today and strips the query', async ({ page }) => {
  const calls = await mockAuth(page, {
    authorize: (route, url) => {
      const redirect = new URL(url.searchParams.get('redirect_to')!);
      expect(redirect.origin + redirect.pathname).toBe(appUrl);
      redirect.searchParams.set('code', 'fake-google');
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<script>location.replace(${JSON.stringify(redirect.href)})</script>`,
      });
    },
    pkce: (route) => authResponse(route, session),
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(today(page)).toBeVisible();
  await expect(page).toHaveURL(appUrl + '#/');
  const { search, hash } = new URL(page.url());
  expect(search).toBe('');
  expect(hash).toBe('#/');
  expect(calls).toEqual(['authorize', 'pkce']);
});

test('Google cancellation returns to the gate and strips the query', async ({ page }) => {
  await mockAuth(page);
  await page.goto('./?error=access_denied&error_description=cancelled');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Google sign-in didn’t finish. Try again, or use email.');
  expect(new URL(page.url()).search).toBe('');
});

test('an expired stored session opens Today when refresh cannot connect', async ({ page }) => {
  const calls = await mockAuth(page, { refresh_token: (route) => route.abort('internetdisconnected') });
  await seedStoredSession(page, fakeSession({ email, name: 'Alex Morgan', expiresIn: -3600 }));
  await page.goto('./');
  await expect(today(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toHaveCount(0);
  await expect.poll(() => calls.includes('refresh_token')).toBe(true);
});

test.describe('service-worker offline relaunch', () => {
  test.use({
    serviceWorkers: 'allow',
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(appUrl).origin,
        localStorage: [{ name: 'gym-plan:auth', value: JSON.stringify(session) }],
      }],
    },
  });

  test('a signed-in service-worker relaunch stays signed in offline', async ({ page, context }) => {
    await page.goto('./');
    await expect(today(page)).toBeVisible();
    if (!await page.evaluate(() => 'serviceWorker' in navigator)) {
      test.info().annotations.push({ type: 'skip-reason', description: 'no SW in Playwright WebKit' });
      return;
    }
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await context.setOffline(true);
    await page.reload();
    await expect(today(page)).toBeVisible();
  });
});

test.describe('sign-in route from guest mode', () => {
  test.use({ storageState: guestStorageState(new URL(appUrl).origin) });

  test('signing in retains local sessions', async ({ page }) => {
    await mockAuth(page, { password: (route) => authResponse(route, session) });
    await seedBackup(page, { sessions: [{
      id: 'guest-session', date: new Date().toISOString(), type: 'lift', variant: 'lower-a', blocks: [],
      hard: false, hardCardio: false, rpe: null, durationMin: 0, notes: '', completedAt: new Date().toISOString(),
    }] });
    await page.goto('./#/sign-in');
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await fillLogIn(page);
    await logInButton(page).click();
    await expect(today(page)).toBeVisible();
    expect(await persistedRows(page, 'sessions')).toHaveLength(1);
  });

  test('continuing as guest returns to Today', async ({ page }) => {
    await mockAuth(page);
    await page.goto('./#/sign-in');
    await page.getByRole('button', { name: 'Continue as guest' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(today(page)).toBeVisible();
  });
});
