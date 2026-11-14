import { expect, test } from '@playwright/test';
import { gatherStarterTree, openAppInStarterGrove } from './gather';
import { grantBlueprints } from './menu';

/**
 * Recipe cards used to print a bare cost ("1 wood + 1 stone") and, for the
 * consumables, never disabled themselves — so an empty bag still looked
 * craftable. Every priced action now prints carried/required per resource and
 * greys itself out until the bag covers the whole cost: the merged Craft tab
 * (handcraft + build palette) and the facility panels read from ui/costs.ts.
 */
test('recipe cards show carried/required and disable when unaffordable', async ({ page }) => {
  await openAppInStarterGrove(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  // Craft lists known blueprints only, so teach it the three this test prices.
  await grantBlueprints(
    page,
    'wooden-pick', 'thatch-floor', 'field-cache',
    'arrow', 'taming-snare', 'cloth-mask',
  );
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Craft', exact: true }).click();

  // Starting bag is empty: arrows need wood and stone and can afford neither.
  const arrows = page.getByRole('button', { name: 'Craft Arrows' });
  await expect(arrows).toContainText('0/1 wood + 0/1 stone');
  await expect(arrows).toBeDisabled();

  const snare = page.getByRole('button', { name: 'Craft Taming Snare' });
  await expect(snare).toContainText('0/1 wood + 0/2 fiber');
  await expect(snare).toBeDisabled();

  const mask = page.getByRole('button', { name: 'Craft Cloth Mask' });
  await expect(mask).toContainText('0/4 fiber');
  await expect(mask).toBeDisabled();

  // Four wood from a grove tree covers the wood line of each recipe, but
  // arrows still want stone and the snare still wants fiber.
  // The open panel covers the Menu button on mobile, so close it by its own
  // Close control rather than by toggling the rail button.
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await gatherStarterTree(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Craft', exact: true }).click();
  await expect(arrows).toContainText('4/1 wood + 0/1 stone');
  await expect(arrows).toBeDisabled();
  await expect(snare).toContainText('4/1 wood + 0/2 fiber');
  await expect(snare).toBeDisabled();

  // The Wooden Pick costs 5 wood, so its card reads short and stays disabled.
  const pick = page.getByRole('button', { name: 'Craft & equip' });
  await expect(pick).toContainText('4/5 wood');
  await expect(pick).toBeDisabled();

  // The Build section of the same tab prices its blueprints the same way, from
  // the same bag.
  const palette = page.getByLabel('Build palette');
  const thatchFloor = palette.getByRole('button', { name: /Thatch Floor/ });
  await expect(thatchFloor).toContainText('0/1 fiber');
  await expect(thatchFloor).toBeDisabled();
  const storageBox = palette.getByRole('button', { name: /Storage Box \(small\)/ });
  await expect(storageBox).toContainText('4/4 wood');
  await expect(storageBox).toBeEnabled();
});
