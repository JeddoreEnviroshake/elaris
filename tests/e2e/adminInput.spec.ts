import { openAdmin } from './menu';
import { expect, test } from '@playwright/test';
import { openApp } from './app';

/**
 * Regression: the game binds 1–5 to hotbar slots and 0 to bare hands with
 * Phaser's key capture on, which preventDefaults those keydowns on `window`
 * even while an Admin field has focus. Every digit but 6–9 was silently
 * dropped, which on a phone made most admin values impossible to edit.
 */
test('accepts hotbar-bound digits typed into an Admin number field', async ({ page }) => {
  await openApp(page);
  await openAdmin(page);

  const coins = page.getByLabel('Coins', { exact: true });
  await expect(coins).toBeVisible();
  await coins.fill('');
  // Real key events, not a value assignment: the capture is what has to lose.
  await coins.pressSequentially('102345');
  await expect(coins).toHaveValue('102345');
});
