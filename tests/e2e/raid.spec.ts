import { expect, test } from '@playwright/test';
import { openApp } from './app';
import { blueprintTile, buildPalette, openMenuTab, grantBlueprints } from './menu';

test('War Table stays hidden until discovered, then shows its materials', async ({ page }) => {
  await openApp(page);
  await openMenuTab(page, 'Blueprints');
  await expect(blueprintTile(page, 'War Table')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Undiscovered blueprint', exact: true }).first()).toBeVisible();
  await openMenuTab(page, 'Craft');
  await expect(buildPalette(page).getByRole('button', { name: /War Table/ })).toBeHidden();
  await grantBlueprints(page, 'war-table');
  await openMenuTab(page, 'Blueprints');
  const blueprint = blueprintTile(page, 'War Table');
  await expect(blueprint).toHaveAccessibleName(/known, made at/);
  await blueprint.click();
  await expect(page.getByLabel('Blueprints', { exact: true })).toContainText('0/12 wood + 0/6 stone');
  await expect(page.getByRole('button', { name: /^Unlock / })).toHaveCount(0);
});

test('Turret stays hidden until discovered, then shows its materials', async ({ page }) => {
  await openApp(page);
  await openMenuTab(page, 'Blueprints');
  await expect(blueprintTile(page, 'Turret')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Undiscovered blueprint', exact: true }).first()).toBeVisible();
  await openMenuTab(page, 'Craft');
  await expect(buildPalette(page).getByRole('button', { name: /Turret/ })).toBeHidden();
  await grantBlueprints(page, 'turret');
  await openMenuTab(page, 'Blueprints');
  const blueprint = blueprintTile(page, 'Turret');
  await expect(blueprint).toHaveAccessibleName(/known, made at/);
  await blueprint.click();
  await expect(page.getByLabel('Blueprints', { exact: true })).toContainText('0/8 wood + 0/6 stone + 0/1 iron-ingot');
  await expect(page.getByRole('button', { name: /^Unlock / })).toHaveCount(0);
});
