import { expect, test } from '@playwright/test';
import { openApp } from './app';

test('Bag displays carried weight, capacity, and total stack weights', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Menu' }).click();

  await expect(page.getByText(/0\/20 slots · Weight 1\.75\/100/)).toBeVisible();
  await expect(page.getByText('×2 · Weight 0.5')).toBeVisible();
  await expect(page.getByText('×5 · Weight 1.25')).toBeVisible();
});

test('Admin exposes Weight Limit and all item weights', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Admin' }).click();
  await page.getByRole('tab', { name: 'Global Values' }).click();

  await expect(page.getByLabel('Weight Limit')).toHaveValue('100');
  await expect(page.getByLabel('Taming Snare Weight')).toHaveValue('1');
  await expect(page.getByLabel('Berry Weight')).toHaveValue('0.25');
  await expect(page.getByLabel('Arrows Weight')).toHaveValue('0.25');
  await expect(page.getByLabel('Wood Weight')).toHaveValue('1');
  await expect(page.getByLabel('Stone Weight')).toHaveValue('3');
  await expect(page.getByLabel('Fiber Weight')).toHaveValue('0.5');
  await expect(page.getByLabel('Iron Ingot Weight')).toHaveValue('5');
  await expect(page.getByLabel('Iron Ore Weight')).toHaveValue('3');
});
