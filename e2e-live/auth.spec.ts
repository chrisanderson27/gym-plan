import { setTimeout } from 'node:timers/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { confirmViaApi, extractAuthLink, fillLogIn, mailCount, secondDevice, signUpViaApi, uniqueEmail, waitForMail } from './helpers';

const password = 'test-password-123';
const name = 'Alex Morgan';
const logInButton = (page: Page) => page.getByRole('button', { name: 'Log in', exact: true });
const today = (page: Page) => page.getByTestId('hero');

async function signUp(page: Page, email: string) {
  await page.goto('./');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
}

async function createConfirmedUser(request: APIRequestContext, email: string) {
  const response = await signUpViaApi(request, { email, password, name });
  expect(response.status()).toBe(200);
  await confirmViaApi(request, email);
}

test('email sign-up confirms in the original browser and log-in works on a second device', async ({ page, browser, request }) => {
  const email = uniqueEmail('confirm');
  await signUp(page, email);
  const mail = await waitForMail(request, email, { subjectIncludes: 'Confirm' });
  await page.goto(extractAuthLink(mail));
  await expect(today(page)).toBeVisible();
  await expect(page).toHaveURL(/\/gym-plan\/#\/$/);
  expect(await page.evaluate(() => localStorage.getItem('gym-plan:auth'))).toBeTruthy();
  await page.reload();
  await expect(today(page)).toBeVisible();

  const second = await secondDevice(browser);
  try {
    const fresh = await second.newPage();
    await fresh.goto('./');
    await expect(fresh.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await fillLogIn(fresh, email, password);
    await logInButton(fresh).click();
    await expect(today(fresh)).toBeVisible();
  } finally {
    await second.close();
  }
});

test('an unconfirmed log-in shows the error and resend delivers a second email', async ({ page, request }) => {
  const email = uniqueEmail('resend');
  await signUp(page, email);
  await page.getByRole('button', { name: 'Back to log in' }).click();
  await fillLogIn(page, email, password);
  await logInButton(page).click();
  await expect(page.getByTestId('auth-error')).toHaveText('Confirm your email first — check your inbox for the link.');
  await waitForMail(request, email);
  // The local Auth config requires at least one second between emails to the same address.
  await setTimeout(1000);
  await page.getByRole('button', { name: 'Resend email' }).click();
  await expect.poll(() => mailCount(request, email)).toBeGreaterThanOrEqual(2);
});

test('a wrong password leaves inline feedback on the launch gate', async ({ page, request }) => {
  const email = uniqueEmail('wrong-password');
  await createConfirmedUser(request, email);
  await page.goto('./');
  await fillLogIn(page, email, 'wrong-password');
  await logInButton(page).click();
  await expect(page.getByTestId('auth-error')).toHaveText('That email and password don’t match.');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});

test('password reset signs in the original browser and the new password works on a second device', async ({ page, browser, request }) => {
  const email = uniqueEmail('reset');
  const newPassword = 'new-test-password-123';
  await createConfirmedUser(request, email);
  await page.goto('./');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const mail = await waitForMail(request, email, { subjectIncludes: 'Reset' });
  await page.goto(extractAuthLink(mail));
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(today(page)).toBeVisible();

  const second = await secondDevice(browser);
  try {
    const fresh = await second.newPage();
    await fresh.goto('./');
    await fillLogIn(fresh, email, newPassword);
    await logInButton(fresh).click();
    await expect(today(fresh)).toBeVisible();
  } finally {
    await second.close();
  }
});
