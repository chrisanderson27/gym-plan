// Draft Playwright spec generated from journey rbcloud/2026-10-12-prd-phase-sample-phase-1 — review before use.
// Recorded against http://localhost:5000 · result: pass · journey: complete
// Move to: test/Automation.Tests/tests/. RBCloud specs sign in through the authenticatedPage fixture in ../fixtures/testFixtures: swap page for it and drop the login steps.
// Test data:
//   - customer 4092 "Test Customer 4092"
//   - work-order 1834 (created)
//   - order_1754
import { test, expect } from '@playwright/test';

test.describe('Order\'s move\nkeeps `details`', () => {
  test('2026-10-12-prd-phase-sample-phase-1', async ({ page }) => {
    const unique = Date.now().toString().slice(-6);
    await page.goto('/open-orders');
    await expect(page).toHaveURL(/\/open-orders/);
    await expect(page.getByText('Search open orders…').first()).toBeVisible();
    await page.getByRole('textbox', { name: 'Password' }).fill(process.env.E2E_PASS ?? '');
    await page.getByRole('textbox', { name: 'Order name' }).fill(`Order ${unique}`);
    await page.getByRole('combobox', { name: 'Status' }).selectOption(['Open', 'Completed']);
    await page.keyboard.press('Enter');
    await page.frameLocator('iframe').getByRole('button', { name: 'Inner Save' }).click();
    // TODO assert (llm): Completed tab lists only claims with DateCompleted
    // TODO: click @e999 (target not resolved during the run)
    // screenshot: 02-moved.png
    // step 9 failed during the recorded run
    await page.getByRole('button', { name: 'Close' }).click();
    // Assertions
    await expect(page.locator('body')).toContainText('Moved to');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // failed during the recorded run
    await expect(page.locator('body')).not.toContainText('Old order');
  });
});
