import { expect, test } from '@playwright/test';
import { openApp } from './app';
import { gatherStarterTree, openAppInStarterGrove } from './gather';
import { openBuildPalette, openMenuTab, grantBlueprints } from './menu';
import { releaseSaveWriter, readSavedState } from './save';

async function seedEquippedPick(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.waitForTimeout(500);
  // Complete the app's normal teardown save before patching IndexedDB; its
  // pagehide flush must not replace the fixture with the prior empty loadout.
  await releaseSaveWriter(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite');
      const store = transaction.objectStore('snapshots');
      const request = store.get('current');
      request.onsuccess = () => {
        const save = request.result as { state: Record<string, any> };
        save.state.tools = [{
          instanceId: 'tool-e2e-pick',
          definitionId: 'wooden-pick',
          durability: 48,
          maxDurability: 48,
          powerRank: 0,
          speedRank: 0,
          durabilityRank: 0,
        }];
        save.state.equippedToolId = 'tool-e2e-pick';
        store.put(save, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  });
  await page.reload();
}

/**
 * A half-worn pick and enough wood to pay for one repair of it.
 *
 * The write is retried until the reloaded page is actually holding it: this
 * project's dist build has no writer-lease handle to hand back, so the live
 * controller's flush on `pagehide` can land on top of a fixture and silently
 * replace it with the world the fixture was meant to override.
 */
async function seedWornPick(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.waitForTimeout(500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await putWornPick(page);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
    const seeded = await readSavedState(page);
    if (seeded && seeded.inventory['wood'] === 9) return;
  }
  throw new Error('worn pick fixture never survived a reload');
}

async function putWornPick(page: import('@playwright/test').Page): Promise<void> {
  await releaseSaveWriter(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite');
      const store = transaction.objectStore('snapshots');
      const request = store.get('current');
      request.onsuccess = () => {
        const save = request.result as { state: Record<string, any> };
        save.state.tools = [{
          instanceId: 'tool-e2e-worn-pick',
          definitionId: 'wooden-pick',
          durability: 12,
          maxDurability: 48,
          powerRank: 0,
          speedRank: 0,
          durabilityRank: 0,
        }];
        save.state.equippedToolId = 'tool-e2e-worn-pick';
        save.state.inventory.wood = 9;
        save.state.inventoryStacks.wood = [9];
        store.put(save, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  });
}

async function seedWoodStack(page: import('@playwright/test').Page, amount: number): Promise<void> {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await releaseSaveWriter(page);
  await page.evaluate(async (wood) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite');
      const store = transaction.objectStore('snapshots');
      const request = store.get('current');
      request.onsuccess = () => {
        const save = request.result as { state: Record<string, any> };
        save.state.inventory.wood = wood;
        save.state.inventoryStacks.wood = [wood];
        store.put(save, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, amount);
  await page.reload();
}

/**
 * Inventory panel and hotbar presentation flows against the production build,
 * on desktop and mobile-emulated contexts: the Menu panel's slot grid, panel
 * mutual exclusion, hotbar equip via tap and 1–5 keys, and hotbar suppression
 * while a build ghost is out. Slot-model math is covered by unit tests.
 */

test('bag panel shows occupied supply stacks and omits zero stock', async ({ page }) => {
  await openApp(page);

  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Berry stack, 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arrow stack, 5', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Snare stack, 0/ })).toHaveCount(0);
});

test('empty hotbar slots and 0 switch to bare hands', async ({ page, isMobile }) => {
  await seedEquippedPick(page);

  const slot1 = page.getByRole('button', { name: /Hotbar slot 1: Wooden Pick/ });
  const emptySlot = page.getByRole('button', { name: 'Hotbar slot 2: empty' });
  await expect(slot1).toHaveAttribute('aria-pressed', 'true');
  await expect(emptySlot).toBeEnabled();

  await emptySlot.click();
  await expect(slot1).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Switched to bare hands', { exact: true })).toBeVisible();

  if (!isMobile) {
    await page.keyboard.press('1');
    await expect(slot1).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('0');
    await expect(slot1).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await expect(slot1).toHaveAttribute('aria-pressed', 'false');
  }
});

test('bag panel shows the slot grid and stays exclusive with craft and build', async ({ page }) => {
  await openApp(page);

  await expect(page.getByRole('tabpanel', { name: 'Quests', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('.elaris-bag-capacity')).toBeVisible();

  await page.getByRole('tab', { name: 'Quests', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Quests', exact: true })).toBeVisible();
  await expect(page.getByText(/\d+\/\d+ complete/)).toBeVisible();
  await expect(page.locator('.elaris-quest-objective')).not.toBeEmpty();

  // Panels are mutually exclusive in both directions.
  await page.getByRole('tab', { name: 'Craft', exact: true }).click();
  await expect(page.getByText('Handcraft')).toBeVisible();
  await expect(page.locator('.elaris-bag-capacity')).toBeHidden();
  await page.getByRole('tab', { name: 'Bag', exact: true }).click();
  await expect(page.locator('.elaris-bag-capacity')).toBeVisible();
  await expect(page.getByText('Handcraft')).toBeHidden();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.elaris-bag-capacity')).toBeHidden();

});

test('resource stacks can be split and dropped from the Bag', async ({ page }) => {
  await seedWoodStack(page, 4);
  await page.getByRole('button', { name: 'Menu' }).click();

  await page.getByRole('button', { name: 'wood stack, 4' }).click();
  await expect(page.getByRole('dialog', { name: 'wood stack actions' })).toBeVisible();
  await page.getByRole('button', { name: 'Split Stack' }).click();
  const amount = page.getByRole('spinbutton', { name: 'Split amount' });
  await expect(amount).toHaveValue('2');
  await page.getByRole('button', { name: 'Split', exact: true }).click();

  await expect(page.getByRole('button', { name: 'wood stack, 2' })).toHaveCount(2);
  await page.getByRole('button', { name: 'wood stack, 2' }).first().click();
  await page.getByRole('button', { name: 'Drop', exact: true }).click();
  await expect(page.getByText('Dropped 2 wood', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'wood stack, 2' })).toHaveCount(1);
});

test('tools repair and drop from their Bag card', async ({ page }) => {
  await seedWornPick(page);
  await page.getByRole('button', { name: 'Menu' }).click();

  await page.getByRole('button', { name: 'Wooden Pick 12/48, equipped', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Wooden Pick actions' })).toBeVisible();
  // Priced carried-over-required, from the same numbers repairTool charges.
  await page.getByRole('button', { name: 'Repair (9/3 wood)' }).click();
  const repaired = page.getByRole('button', { name: 'Wooden Pick 48/48, equipped', exact: true });
  await expect(repaired).toBeVisible();
  await expect(page.getByText('×6')).toBeVisible();

  // Dropping takes the tool out of the bag, and the loadout with it.
  await repaired.click();
  await page.getByRole('button', { name: 'Drop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Wooden Pick 48/48', exact: true })).toHaveCount(0);
  await expect(repaired).toHaveCount(0);

  // And it is still there to walk back to: the pickup restores the same tool,
  // unequipped, because putting it down was a loadout decision too.
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Gather' }).click();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Wooden Pick 48/48', exact: true })).toBeVisible();
});

test('hotbar shows the crafted pick and equips by tap', async ({ page }) => {
  test.setTimeout(120_000);
  await openAppInStarterGrove(page);

  // Empty hotbar slots stay clickable so they can select bare hands.
  const slot1 = page.getByRole('button', { name: /Hotbar slot 1/ });
  await expect(slot1).toHaveAccessibleName('Hotbar slot 1: empty');
  await expect(slot1).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Hotbar slot 5: empty' })).toBeEnabled();

  // The two in-range starter trees give 8 wood — one pick (5 wood).
  await gatherStarterTree(page);
  await gatherStarterTree(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByText('×8')).toBeVisible();
  await grantBlueprints(page, 'wooden-pick');
  await openMenuTab(page, 'Craft');
  const pickRecipe = page.getByRole('button', { name: 'Craft & equip' });
  await pickRecipe.click();

  await expect(slot1).toHaveAccessibleName(/Hotbar slot 1: Wooden Pick 48\/48/);
  await expect(slot1).toHaveAttribute('aria-pressed', 'true');

  // Tapping an empty slot switches back to bare hands.
  await page.getByRole('button', { name: 'Hotbar slot 2: empty' }).click();
  await expect(page.getByText('Switched to bare hands', { exact: true })).toBeVisible();
  await expect(slot1).toHaveAttribute('aria-pressed', 'false');

  // Tapping the slot routes to the equip command (explicit feedback).
  await slot1.click();
  await expect(page.getByText('Equipped Wooden Pick', { exact: true })).toBeVisible();
});

test('keyboard: I toggles the menu and 1–5 switches between picks', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  test.skip(isMobile, 'keyboard shortcuts are a desktop affordance');
  await openAppInStarterGrove(page);

  // Navigation can finish before Phaser creates the scene and registers its
  // keyboard keys. The Menu control is mounted by that same scene setup.
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.keyboard.press('i');
  await expect(page.getByText('2/20 slots')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('2/20 slots')).toBeHidden();

  // Two picks need 10 wood. The two in-range grove trees give 8; the third
  // sits just outside interaction range, so step up briefly to reach it.
  await gatherStarterTree(page);
  await gatherStarterTree(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(150);
  await page.keyboard.up('w');
  await gatherStarterTree(page);
  await page.keyboard.press('i');
  await expect(page.getByText('×12')).toBeVisible();

  await grantBlueprints(page, 'wooden-pick');
  await openMenuTab(page, 'Craft');
  const pickRecipe = page.getByRole('button', { name: 'Craft & equip' });
  await pickRecipe.click();
  await pickRecipe.click();
  await page.keyboard.press('Escape');

  // The second pick auto-equipped on craft; key 1 switches back to the first.
  const slot1 = page.getByRole('button', { name: /Hotbar slot 1/ });
  const slot2 = page.getByRole('button', { name: /Hotbar slot 2/ });
  await expect(slot2).toHaveAttribute('aria-pressed', 'true');
  await expect(slot1).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('1');
  await expect(slot1).toHaveAttribute('aria-pressed', 'true');
  await expect(slot2).toHaveAttribute('aria-pressed', 'false');

  // Both 0 and an empty numbered slot select bare hands.
  await page.keyboard.press('0');
  await expect(slot1).toHaveAttribute('aria-pressed', 'false');
  await expect(slot2).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Switched to bare hands', { exact: true })).toBeVisible();
  await page.keyboard.press('2');
  await expect(slot2).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('3');
  await expect(slot2).toHaveAttribute('aria-pressed', 'false');
});

test('hotbar hides while a build ghost is out', async ({ page }) => {
  await openAppInStarterGrove(page);
  await gatherStarterTree(page);

  const slot1 = page.getByRole('button', { name: /Hotbar slot 1/ });
  await expect(slot1).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await grantBlueprints(page, 'field-cache');
  const palette = await openBuildPalette(page);
  await palette.getByRole('button', { name: /Storage Box \(small\)/ }).click();
  await expect(page.getByRole('button', { name: 'Place' })).toBeVisible();
  await expect(slot1).toBeHidden();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(slot1).toBeVisible();
});
