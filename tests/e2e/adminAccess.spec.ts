import { expect, test } from '@playwright/test';

/**
 * The public build hides the Admin rail button; `?admin=1` turns it on for
 * this browser and `?admin=0` turns it off again (src/config/adminAccess.ts).
 */
test('hides the Admin menu from a public visitor', async ({ page }) => {
  await page.goto('/?localBalance=1');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0);
});

test('shows the Admin menu once asked for, and remembers it', async ({ page }) => {
  await page.goto('/?localBalance=1&admin=1');
  await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible();

  await page.goto('/?localBalance=1');
  await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible();

  await page.goto('/?localBalance=1&admin=0');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0);
});
