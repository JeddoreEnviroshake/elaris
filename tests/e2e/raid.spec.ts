import { expect, test } from '@playwright/test';
import { openApp } from './app';
import { blueprintTile, buildPalette, openMenuTab } from './menu';

/**
 * Danger-minute raid presentation wiring: the Blueprints tab lists both defence
 * facilities with their costs and keeps them locked on a fresh save, so neither
 * reaches the build palette yet.
 *
 * The raid itself — wave composition, raiders breaking walls, turret fire,
 * destruction, and off-screen base settlement — is covered by
 * tests/unit/raids.test.ts. A browser test cannot reach it: the simulation
 * handle is DEV-only and e2e runs the production build, so a raid would need a
 * purified base plus a real ten-minute safe phase to arrive on its own.
 */

test('Blueprints lists a locked War Table with its cost', async ({ page }) => {
  await openApp(page);
  await openMenuTab(page, 'Blueprints');

  const warTable = blueprintTile(page, 'War Table');
  await expect(warTable).toBeVisible();
  await expect(warTable).toHaveAccessibleName(/locked, costs 8 points/);
  await warTable.click();
  // Costs read carried/required against the bag, which starts empty.
  await expect(page.getByLabel('Blueprints')).toContainText('0/12 wood + 0/6 stone');

  await openMenuTab(page, 'Craft');
  await expect(buildPalette(page).getByRole('button', { name: /War Table/ })).toBeHidden();
});

test('Blueprints lists a locked Turret gated behind the War Table', async ({ page }) => {
  await openApp(page);
  await openMenuTab(page, 'Blueprints');

  const turret = blueprintTile(page, 'Turret');
  await expect(turret).toBeVisible();
  await expect(turret).toHaveAccessibleName(/locked, costs 12 points/);
  await turret.click();
  await expect(page.getByLabel('Blueprints')).toContainText('0/8 wood + 0/6 stone + 0/1 iron-ingot');

  await openMenuTab(page, 'Craft');
  await expect(buildPalette(page).getByRole('button', { name: /Turret/ })).toBeHidden();
});
