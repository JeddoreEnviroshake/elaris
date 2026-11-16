import { navigateApp } from './app';
import { expect, test } from '@playwright/test';

test('offers Admin at the top of the Menu by default', async ({ page }) => {
  await navigateApp(page, '/?localBalance=1');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Admin', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Game menu', exact: true });
  const admin = menu.locator('.elaris-menu-header').getByRole('button', { name: 'Admin', exact: true });
  await expect(admin).toBeVisible();
  const bounds = await admin.boundingBox();
  const firstTab = await menu.getByRole('tab').first().boundingBox();
  expect(bounds!.y).toBeLessThan(firstTab!.y);
  await admin.click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Admin stat editor' })).toBeVisible();
});

test('shows the Admin menu once asked for, and remembers it', async ({ page }) => {
  await navigateApp(page, '/?localBalance=1&admin=1');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible();

  await navigateApp(page, '/?localBalance=1');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible();

  await navigateApp(page, '/?localBalance=1&admin=0');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0);
  await navigateApp(page, '/?localBalance=1');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0);
});
