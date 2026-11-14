import { expect, test } from '@playwright/test';
import { openApp } from './app';
import { blueprintTile, buildPalette, openMenuTab } from './menu';

/**
 * Garden Bed presentation wiring: the Blueprints tab lists it with its point
 * price and keeps it out of the build palette on a fresh save, since it has not
 * been unlocked yet. Placement/growth/suspension math is covered by
 * tests/unit/gardenBed.test.ts — reaching an 8-tile enclosure organically is
 * too slow for a browser test.
 */

test('Blueprints lists a locked Garden Bed the build palette does not show', async ({ page }) => {
  await openApp(page);
  await openMenuTab(page, 'Blueprints');

  const gardenBed = blueprintTile(page, 'Garden Bed');
  await expect(gardenBed).toBeVisible();
  await expect(gardenBed).toHaveAccessibleName(/locked, costs 8 points/);
  await gardenBed.click();
  // Costs read carried/required against the bag, which starts empty.
  await expect(page.getByLabel('Blueprints')).toContainText('0/4 wood + 0/2 fiber');
  // Five starting points cannot cover eight.
  await expect(page.getByRole('button', { name: 'Unlock Garden Bed' })).toBeDisabled();

  await openMenuTab(page, 'Craft');
  await expect(buildPalette(page).getByRole('button', { name: /Garden Bed/ })).toBeHidden();
});
