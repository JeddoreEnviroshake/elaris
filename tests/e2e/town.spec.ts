import { expect, test } from '@playwright/test';
import { openApp } from './app';
import { openAdmin } from './menu';
import { outsideDoorTile, townBuildingById } from '../../src/content/townBuildings';

test('walks into the Market, sells a resource inside, and leaves safely', async ({ page }) => {
  await openApp(page);
  await openAdmin(page);
  const door = outsideDoorTile(townBuildingById('market'));
  await page.getByLabel('X', { exact: true }).fill(String((door.tileX + .5) * 16));
  await page.getByLabel('Y', { exact: true }).fill(String((door.tileY + .5) * 16));
  await page.getByLabel('Wood', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Push Local Values' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const interior = page.getByRole('dialog', { name: 'Market service' });
  await expect(page.getByRole('button', { name: 'Enter Market' })).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.getByRole('button', { name: 'Leave the Market', exact: true })).toBeVisible();

  // Walk down the clear aisle until Tavi can be reached, before the counter.
  await page.keyboard.down('s');
  try {
    await expect(page.getByRole('button', { name: 'Talk to Tavi' })).toBeVisible({ timeout: 10_000 });
  } finally {
    await page.keyboard.up('s');
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
  await expect(page.locator('#elaris-three-canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Talk to Tavi', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Enter Market' })).toBeVisible();
});
