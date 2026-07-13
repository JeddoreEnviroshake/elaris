import { expect, test, type Page } from '@playwright/test';

/**
 * Inventory panel and hotbar presentation flows against the production build,
 * on desktop and mobile-emulated contexts: the Menu panel's slot grid, panel
 * mutual exclusion, hotbar equip via tap and 1–5 keys, and hotbar suppression
 * while a build ghost is out. Slot-model math is covered by unit tests.
 */

/** Deplete the nearest starter tree (6 bare-hand hits) for exactly 4 wood. */
async function gatherStarterTree(page: Page): Promise<void> {
  const gather = page.getByRole('button', { name: 'Gather' });
  await expect(gather).toBeVisible();
  // Leave headroom beyond the 500ms fixed-step cooldown for loaded CI hosts.
  for (let hit = 0; hit < 6; hit += 1) {
    await gather.click();
    await page.waitForTimeout(700);
  }
}

test('bag panel shows the slot grid and stays exclusive with craft and build', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByLabel('Quest log')).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByText('0/20 slots')).toBeVisible();

  await page.getByRole('tab', { name: 'Quests', exact: true }).click();
  await expect(page.getByLabel('Quest log')).toBeVisible();
  await expect(page.getByText(/0\/9 complete/)).toBeVisible();
  await expect(page.getByText(/Next: Gather wood/)).toBeVisible();

  // Panels are mutually exclusive in both directions.
  await page.getByRole('tab', { name: 'Craft', exact: true }).click();
  await expect(page.getByText('Handcraft')).toBeVisible();
  await expect(page.getByText('0/20 slots')).toBeHidden();
  await page.getByRole('tab', { name: 'Bag', exact: true }).click();
  await expect(page.getByText('0/20 slots')).toBeVisible();
  await expect(page.getByText('Handcraft')).toBeHidden();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('0/20 slots')).toBeHidden();

  // Gathered resources appear as a stack and count against slots.
  await gatherStarterTree(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByText('1/20 slots')).toBeVisible();
  await expect(page.getByText('wood', { exact: true })).toBeVisible();
  await expect(page.getByText('×4')).toBeVisible();
});

test('hotbar shows the crafted pick and equips by tap', async ({ page }) => {
  await page.goto('/');

  // Empty hotbar: five disabled slots.
  const slot1 = page.getByRole('button', { name: /Hotbar slot 1/ });
  await expect(slot1).toHaveAccessibleName('Hotbar slot 1: empty');
  await expect(slot1).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Hotbar slot 5: empty' })).toBeDisabled();

  // The two in-range starter trees give 8 wood — one pick (5 wood).
  await gatherStarterTree(page);
  await gatherStarterTree(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByText('×8')).toBeVisible();
  await page.getByRole('tab', { name: 'Craft', exact: true }).click();
  await page.getByRole('button', { name: 'Craft & equip' }).click();

  await expect(slot1).toHaveAccessibleName(/Hotbar slot 1: Wooden Pick 48\/48/);
  await expect(slot1).toHaveAttribute('aria-pressed', 'true');

  // Tapping the slot routes to the equip command (explicit feedback).
  await slot1.click();
  await expect(page.getByText('Equipped Wooden Pick', { exact: true })).toBeVisible();
});

test('keyboard: I toggles the menu and 1–5 switches between picks', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts are a desktop affordance');
  await page.goto('/');

  // Navigation can finish before Phaser creates the scene and registers its
  // keyboard keys. The Menu control is mounted by that same scene setup.
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.keyboard.press('i');
  await expect(page.getByText('0/20 slots')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('0/20 slots')).toBeHidden();

  // Two picks need 10 wood. The two in-range starter trees give 8; the third
  // sits just outside interaction range, so step up briefly to reach it.
  await gatherStarterTree(page);
  await gatherStarterTree(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(150);
  await page.keyboard.up('w');
  await gatherStarterTree(page);
  await page.keyboard.press('i');
  await expect(page.getByText('×12')).toBeVisible();

  await page.getByRole('tab', { name: 'Craft', exact: true }).click();
  await page.getByRole('button', { name: 'Craft & equip' }).click();
  await page.getByRole('button', { name: 'Craft & equip' }).click();
  await page.keyboard.press('Escape');

  // The second pick auto-equipped on craft; key 1 switches back to the first.
  const slot1 = page.getByRole('button', { name: /Hotbar slot 1/ });
  const slot2 = page.getByRole('button', { name: /Hotbar slot 2/ });
  await expect(slot2).toHaveAttribute('aria-pressed', 'true');
  await expect(slot1).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('1');
  await expect(slot1).toHaveAttribute('aria-pressed', 'true');
  await expect(slot2).toHaveAttribute('aria-pressed', 'false');
});

test('hotbar hides while a build ghost is out', async ({ page }) => {
  await page.goto('/');
  await gatherStarterTree(page);

  const slot1 = page.getByRole('button', { name: /Hotbar slot 1/ });
  await expect(slot1).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Build', exact: true }).click();
  await page.getByRole('button', { name: /Palisade Wall/ }).click();
  await expect(page.getByRole('button', { name: 'Place' })).toBeVisible();
  await expect(slot1).toBeHidden();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(slot1).toBeVisible();
});
