import { expect, test } from '@playwright/test';

/**
 * Garden Bed presentation wiring: the build palette lists it with its cost and
 * keeps it locked (with the discovery hint) on a fresh save, since the area-8
 * Shelter milestone has not been reached yet. Placement/growth/suspension math
 * is covered by tests/unit/gardenBed.test.ts — reaching an 8-tile enclosure
 * organically is too slow for a browser test.
 */

test('build palette lists a locked Garden Bed with its discovery hint', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Build', exact: true }).click();

  const gardenBed = page.getByRole('button', { name: /Garden Bed/ });
  await expect(gardenBed).toBeVisible();
  await expect(gardenBed).toContainText('4 wood + 2 fiber');
  await expect(gardenBed).toBeDisabled();
  await expect(gardenBed).toContainText(/8-tile Shelter/);
});
