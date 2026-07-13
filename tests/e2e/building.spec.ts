import { expect, test, type Page } from '@playwright/test';
import { gatherStarterTree } from './gather';

/**
 * Build-mode presentation flows against the production build, on desktop and
 * mobile-emulated contexts: palette affordability, ghost placement via the
 * touch-safe Place button, spend feedback, overlap rejection, cancel, and the
 * keyboard toggles. Placement rule math is covered by unit tests.
 */

async function openBuildTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Build', exact: true }).click();
}

test('build palette lists structures with costs and disables unaffordable ones', async ({ page }) => {
  await page.goto('/');
  await openBuildTab(page);

  const wall = page.getByRole('button', { name: /Palisade Wall/ });
  await expect(wall).toBeVisible();
  await expect(wall).toContainText('1 wood');
  await expect(wall).toBeDisabled();

  await expect(page.getByRole('button', { name: /Field Cache/ })).toContainText('4 wood');
  await expect(page.getByRole('button', { name: /Workbench/ })).toContainText('8 wood');
  const planter = page.getByRole('button', { name: /Woodlot Planter/ });
  await expect(planter).toContainText('6 wood + 2 stone');
  await expect(planter).toBeDisabled();
});

test('keeps a palisade wall selected for repeated placement until cancelled', async ({ page }) => {
  await page.goto('/');
  await gatherStarterTree(page);

  await openBuildTab(page);
  await page.getByRole('button', { name: /Palisade Wall/ }).click();

  const place = page.getByRole('button', { name: 'Place' });
  await expect(place).toBeEnabled();
  await place.click();
  await expect(page.getByText('Placed Palisade Wall')).toBeVisible();
  await expect(page.locator('#app')).toContainText(/Wood 3/);
  await expect(place).toBeVisible();
  await expect(place).toBeDisabled(); // the ghost remains on the occupied tile

  // Moving the ghost to another tile enables another placement without reopening Build.
  const canvas = page.locator('#game canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas is not visible');
  const tileOffset = box.width > 700 ? 96 : 64;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1]]) {
    await page.mouse.move(
      box.x + box.width / 2 + dx! * tileOffset,
      box.y + box.height / 2 + dy! * tileOffset,
    );
    await page.waitForTimeout(50);
    if (await place.isEnabled()) break;
  }
  await expect(place).toBeEnabled();
  await place.click();
  await expect(page.locator('#app')).toContainText(/Wood 2/);
  await expect(place).toBeVisible();
  await expect(place).toBeDisabled();
  await expect(page.getByText('Blocked')).toBeVisible();

  // Cancel is the explicit way back to the palette.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: /Field Cache/ })).toBeVisible();
  await expect(page.locator('#app')).toContainText(/Wood 2/);
});

test('cancelling placement never spends resources', async ({ page }) => {
  await page.goto('/');
  await gatherStarterTree(page);

  await openBuildTab(page);
  const fieldCache = page.getByRole('button', { name: /Field Cache/ });
  await expect(fieldCache).toBeEnabled();
  await fieldCache.click();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(fieldCache).toBeVisible();
  await page.getByRole('tab', { name: 'Bag', exact: true }).click();
  await expect(page.getByText('×4', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(fieldCache).toBeHidden();
});

test('a placed structure persists across a reload', async ({ page }) => {
  await page.goto('/');
  await gatherStarterTree(page);

  await openBuildTab(page);
  await page.getByRole('button', { name: /Palisade Wall/ }).click();
  const place = page.getByRole('button', { name: 'Place' });
  await place.click();
  await expect(page.getByText('Placed Palisade Wall')).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Bag', exact: true }).click();
  await expect(page.getByText('×3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Placement is a critical save; let the IndexedDB write commit before reload
  // (same race the pick-restore smoke test guards against).
  await expect(page.getByText('Saved')).toBeVisible();
  await page.waitForTimeout(700);
  await page.reload();

  // The wall is restored onto its tile: re-entering build spawns the ghost on
  // that now-occupied front tile, so placement is blocked.
  await openBuildTab(page);
  await page.getByRole('button', { name: /Palisade Wall/ }).click();
  await expect(place).toBeDisabled();
  await expect(page.getByText('Blocked')).toBeVisible();
});

test('a facility placeable is gated until an enclosure exists', async ({ page }) => {
  await page.goto('/');
  await gatherStarterTree(page); // exactly 4 wood — affordable, so the gate is the only blocker

  await openBuildTab(page);
  const fieldCache = page.getByRole('button', { name: /Field Cache/ });
  await expect(fieldCache).toBeEnabled();
  await fieldCache.click();

  // Affordable and in range, but there is no qualifying enclosure yet.
  await expect(page.getByRole('button', { name: 'Place' })).toBeDisabled();
  await expect(page.getByText(/Needs \d+-tile area/)).toBeVisible();
});

test('keyboard toggles build mode and panels stay mutually exclusive', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts are a desktop affordance');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();

  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: /Palisade Wall/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Palisade Wall/ })).toBeHidden();

  // Opening craft closes build, and vice versa.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Build', exact: true }).click();
  await expect(page.getByRole('button', { name: /Palisade Wall/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Craft', exact: true }).click();
  await expect(page.getByText('Handcraft')).toBeVisible();
  await expect(page.getByRole('button', { name: /Palisade Wall/ })).toBeHidden();
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: /Palisade Wall/ })).toBeVisible();
  await expect(page.getByText('Handcraft')).toBeHidden();
});
