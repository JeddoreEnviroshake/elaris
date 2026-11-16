import { expect, test } from '@playwright/test';
import { openApp } from './app';
import { openAdmin } from './menu';
import { townBuildingById } from '../../src/content/townBuildings';
import { shellDoorstep, townBuildingShell } from '../../src/content/interiors';

test('walks into the Market, sells a resource at the counter, and walks back out', async ({ page }) => {
  await openApp(page);
  await openAdmin(page);
  const market = townBuildingById('market');
  const doorstep = shellDoorstep(townBuildingShell(market));
  // The Market's door is on its north wall, so the doorstep is above it on screen.
  await page.getByLabel('X', { exact: true }).fill(String(Math.round((market.footprint.tileX + doorstep.x) * 16)));
  await page.getByLabel('Y', { exact: true }).fill(String(Math.round((market.footprint.tileY + doorstep.y - 1) * 16)));
  await page.getByLabel('Wood', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Push Local Values' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const service = page.getByRole('dialog', { name: 'Market service' });
  // There is no door to "enter": the player walks straight through it.
  await expect(page.getByRole('button', { name: 'Enter Market' })).toHaveCount(0);

  // Walk down through the doorway and the aisle until Tavi is in reach.
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
  await expect(service).toBeVisible();

  await expect(service.getByText('Tavi', { exact: true })).toBeVisible();
  await expect(service.locator('[aria-label="Wood market row"]')).toContainText('Owned 4');
  await service.getByRole('button', { name: 'Sell all wood' }).click();
  await expect(service.getByText(/Coin purse: 8\b/)).toBeVisible();

  await service.getByRole('button', { name: 'Return to Elaris Market Hall' }).click();
  await expect(service).toBeHidden();
  await expect(page.locator('#elaris-three-canvas')).toBeVisible();
  // Still standing at the counter: closing the panel moves nobody.
  await expect(page.getByRole('button', { name: 'Talk to Tavi', exact: true })).toBeVisible();

  await page.keyboard.down('w');
  try {
    await expect(page.getByRole('button', { name: 'Talk to Tavi', exact: true })).toBeHidden({ timeout: 10_000 });
  } finally {
    await page.keyboard.up('w');
  }
});
