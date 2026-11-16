import { expect, test } from '@playwright/test';
import { openApp } from './app';
import { blueprintTile, buildPalette, openMenuTab, grantBlueprints } from './menu';

test('Garden Bed stays hidden until discovered, then shows its materials', async ({ page }) => {
  await openApp(page);
  await openMenuTab(page, 'Blueprints');
  await expect(blueprintTile(page, 'Garden Bed')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Undiscovered blueprint', exact: true }).first()).toBeVisible();
  await openMenuTab(page, 'Craft');
  await expect(buildPalette(page).getByRole('button', { name: /Garden Bed/ })).toBeHidden();
  await grantBlueprints(page, 'garden-bed');
  await openMenuTab(page, 'Blueprints');
  const blueprint = blueprintTile(page, 'Garden Bed');
  await expect(blueprint).toHaveAccessibleName(/known, made at/);
  await blueprint.click();
  await expect(page.getByRole('tabpanel', { name: 'Blueprints', exact: true })).toContainText('0/4 wood + 0/2 fiber');
  await expect(page.getByRole('button', { name: /^Unlock / })).toHaveCount(0);
});
