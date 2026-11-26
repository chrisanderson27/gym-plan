import { expect, test } from '@playwright/test';

test.skip(process.env.E2E_KEYLESS !== '1', 'Needs the keyless build');
test.use({ storageState: { cookies: [], origins: [] } });

test('keyless builds never show sign-in and only allow self connections', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('hero')).toBeVisible();
  await expect(page.getByText('Continue with Google')).toHaveCount(0);
  await page.goto('./#/sign-in');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('hero')).toBeVisible();
  await expect(page.getByText('Continue with Google')).toHaveCount(0);
  // Reading the DOM attribute decodes HTML entities.
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy?.split(';').map((directive) => directive.trim()).find((directive) => directive.startsWith('connect-src ')))
    .toBe("connect-src 'self'");
});
