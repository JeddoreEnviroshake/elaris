import { expect, test } from '@playwright/test';
import { openApp } from './app';
import { gatherStarterTree } from './gather';

test('walks into the Market, sells a resource inside, and leaves safely', async ({ page }) => {
  await openApp(page);
  await gatherStarterTree(page);

  await page.keyboard.down('s');
  const interior = page.getByRole('dialog', { name: 'Market service' });
  try {
    await expect(page.getByRole('button', { name: 'Enter Market' })).toBeVisible({ timeout: 3_000 });
  } finally {
    await page.keyboard.up('s');
  }
  await page.keyboard.press('e');
  await expect(page.locator('[data-testid="playable-interior"]')).toBeVisible();

  // Walk around the counter to Tavi's service hotspot.
  await page.keyboard.down('a');
  await page.waitForTimeout(350);
  await page.keyboard.up('a');
  await page.keyboard.down('s');
  await page.waitForTimeout(1_800);
  await page.keyboard.up('s');
  await page.keyboard.down('d');
  try {
    await expect(page.getByRole('button', { name: 'Talk to Tavi' })).toBeVisible({ timeout: 2_000 });
  } finally {
    await page.keyboard.up('d');
  }
  await page.keyboard.press('e');
  const conversation = page.getByRole('dialog', { name: 'Conversation with Tavi' });
  await expect(conversation).toBeVisible();
  await page.keyboard.press('Enter');
  await conversation.getByRole('button', { name: /Let us get to work|Show me your services/ }).click();
  await expect(interior).toBeVisible();

  await expect(interior.getByText('Tavi', { exact: true })).toBeVisible();
  await interior.getByRole('button', { name: 'Choose Wood' }).click();
  await expect(interior.getByText(/4 carried · 2 coins each · 8 coins for all/)).toBeVisible();
  await interior.getByRole('button', { name: 'Place goods on the counter' }).click();
  await expect(interior.getByText(/Choose whether to sell one or the full 4-item stack/)).toBeVisible();
  await interior.getByRole('button', { name: 'Sell all wood' }).click();
  await expect(interior.locator('[aria-live="polite"]')).toHaveText('Sold 4 wood for 8 coins');
  await expect(interior.getByText('Coin purse: 8')).toBeVisible();

  await interior.getByRole('button', { name: 'Return to Elaris Market Hall' }).click();
  await expect(interior).toBeHidden();
  await expect(page.locator('[data-testid="playable-interior"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="playable-interior"]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Enter Market' })).toBeVisible();
});
