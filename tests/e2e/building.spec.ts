import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app';
import { gatherStarterTree, openAppInStarterGrove } from './gather';
import { buildPalette, openMenuTab, grantBlueprints } from './menu';
import { expectSavedState, readSavedState } from './save';

/** Build is a section of the merged Craft tab; the palette itself is scoped. */
async function openBuildTab(page: Page): Promise<void> {
  await openMenuTab(page, 'Craft');
}

const palette = buildPalette;

/**
 * Seed resources through a valid saved snapshot, then exercise ownership
 * through UI. The live save controller can flush the pre-patch state over the
 * edit on its way out, so the patch is re-applied until the reloaded game
 * actually comes up rich.
 */
async function loadRichBuilder(page: Page): Promise<void> {
  await openApp(page);
  await grantBlueprints(page, 'field-cache');
  await expectSavedState(page, (state) => state.unlockedItemIds.includes('field-cache'));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await patchRichSave(page);
    await page.reload();
    const seeded = await readSavedState(page);
    if ((seeded?.inventory.wood ?? 0) >= 90) return;
  }
  throw new Error('the rich-builder snapshot never survived a reload');
}

async function patchRichSave(page: Page): Promise<void> {
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
        const save = request.result as {
          state: {
            inventory: Record<string, number>;
            buildings: Array<{ id: string; definitionId: string; tileX: number; tileY: number }>;
          };
        };
        // Top up the carried resources rather than replacing the object: the
        // snapshot is validated against the full item list on load, and a
        // missing key sends the returning player back to a fresh save.
        Object.assign(save.state.inventory, { wood: 99, stone: 99, fiber: 99 });
        // The Workbench is a 2x1 facility that now requires player-built floor
        // under every occupied cell. This L-shaped pad covers both its default
        // orientation and the 1x2 rotation exercised below. Retries must not
        // stack duplicate ids, so the pad is replaced rather than appended.
        save.state.buildings = save.state.buildings.filter((building) => !building.id.startsWith('e2e-floor-'));
        save.state.buildings.push(
          { id: 'e2e-floor-a', definitionId: 'wood-floor', tileX: 80, tileY: 81 },
          { id: 'e2e-floor-b', definitionId: 'wood-floor', tileX: 81, tileY: 81 },
          { id: 'e2e-floor-c', definitionId: 'wood-floor', tileX: 80, tileY: 82 },
        );
        store.put(save, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  });
}

test('Blueprints masks what is undiscovered and only known ones reach the Build palette', async ({ page }) => {
  await openApp(page);
  await openMenuTab(page, 'Blueprints');
  const blueprints = page.getByLabel('Blueprints');
  await expect(blueprints.getByText(/0\/\d+ blueprints known/)).toBeVisible();

  // Undiscovered entries give up their names, and nothing is for sale.
  await expect(page.getByRole('button', { name: /^Wood Wall,/ })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Undiscovered blueprint' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Unlock / })).toHaveCount(0);
  await openBuildTab(page);
  await expect(palette(page).getByRole('button', { name: /Wood Wall/ })).toBeHidden();

  await grantBlueprints(page, 'field-cache');
  await openMenuTab(page, 'Blueprints');
  await expect(blueprints.getByText(/1\/\d+ blueprints known/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Storage Box \(small\),/ })).toBeVisible();
  await openBuildTab(page);
  // Known, so it is listed — and still disabled, because the bag lacks wood.
  await expect(palette(page).getByRole('button', { name: /Storage Box \(small\)/ })).toBeDisabled();
});

test('R rotates and a world click only aims the ghost until Place is pressed', async ({ page }) => {
  await loadRichBuilder(page);
  await grantBlueprints(page, 'workbench');
  await openBuildTab(page);
  await palette(page).getByRole('button', { name: /Workbench/ }).click();

  const place = page.getByRole('button', { name: 'Place' });
  await expect(place).toBeEnabled();
  const canvas = page.locator('#game canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas is not visible');
  const zoom = box.width > 700 ? 3 : 2;

  await page.keyboard.press('r');

  // Aiming is not building: the click moves the 1x2 ghost and spends nothing.
  await page.mouse.click(box.x + box.width / 2 + 16 * zoom, box.y + box.height / 2 + 24 * zoom);
  await expect(place).toBeVisible();
  expect((await readSavedState(page))!.buildings.some((b) => b.definitionId === 'workbench')).toBe(false);

  await place.click();
  await expectSavedState(page, (state) => state.buildings.some((b) => b.definitionId === 'workbench' && b.rotated === true));
});

test('Undo removes the latest placement and restores its full cost', async ({ page }) => {
  await loadRichBuilder(page);
  await openBuildTab(page);
  await palette(page).getByRole('button', { name: /Storage Box \(small\)/ }).click();
  const before = (await readSavedState(page))!.inventory.wood;

  await page.getByRole('button', { name: 'Place' }).click();
  await expectSavedState(page, (state) => state.buildings.some((building) => building.definitionId === 'field-cache'));
  await page.getByRole('button', { name: 'Undo' }).click();

  await expectSavedState(page, (state) => !state.buildings.some((building) => building.definitionId === 'field-cache')
    && state.inventory.wood === before);
});

for (const key of ['e', 'Space']) {
  test(`${key} confirms the active placement ghost`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcuts are a desktop affordance');
    await loadRichBuilder(page);
    await grantBlueprints(page, 'workbench');
    await openBuildTab(page);
    await palette(page).getByRole('button', { name: /Workbench/ }).click();
    await expect(page.getByRole('button', { name: 'Place' })).toBeEnabled();

    await page.keyboard.press(key);

    await expectSavedState(page, (state) => state.buildings.some((b) => b.definitionId === 'workbench'));
  });
}

test('placing hides the thumb controls and offers the material family as quick swaps', async ({ page }) => {
  await loadRichBuilder(page);
  await grantBlueprints(page, 'thatch-wall');
  await grantBlueprints(page, 'thatch-floor');
  await openBuildTab(page);
  await palette(page).getByRole('button', { name: /Thatch Wall/ }).click();
  await expect(page.getByRole('button', { name: 'Place' })).toBeEnabled();

  // Sprint and the thumb action are dead weight while a ghost is out.
  await expect(page.locator('[data-action-button]')).toBeHidden();
  await expect(page.locator('[data-sprint-toggle]')).toBeHidden();

  // The row swaps within the material without a trip back to the palette.
  const related = page.getByRole('group', { name: 'Related parts' });
  await expect(related.getByRole('button', { name: 'Wall' })).toHaveAttribute('aria-pressed', 'true');
  await related.getByRole('button', { name: 'Floor' }).click();
  await expect(page.locator('[data-placing-title]')).toHaveText(/Thatch Floor/);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-action-button]')).toBeVisible();
});

test('tapping the d-pad walks the ghost up-screen before Place commits it', async ({ page }) => {
  await loadRichBuilder(page);
  await openBuildTab(page);
  await palette(page).getByRole('button', { name: /Storage Box \(small\)/ }).click();
  await expect(page.getByRole('button', { name: 'Place' })).toBeEnabled();
  const start = (await readSavedState(page))!;
  const playerTileY = Math.floor(start.player.y / 16);

  // The pad rests 16px in and 32px up from the corner with a 56px radius; the
  // up arrow sits near the top of that circle.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('No viewport');
  const centerX = 16 + 56;
  const centerY = viewport.height - (32 + 56);
  for (let taps = 0; taps < 3; taps += 1) {
    await page.mouse.click(centerX, centerY - 40);
  }
  await page.getByRole('button', { name: 'Place' }).click();

  // The ghost starts one tile in front of a down-facing player, so three
  // upward nudges must land it above them.
  await expectSavedState(page, (state) => state.buildings.some(
    (building) => building.definitionId === 'field-cache' && building.tileY < playerTileY,
  ));
});

test('Cancel exits build mode and returns to the main game', async ({ page }) => {
  await loadRichBuilder(page);
  await openBuildTab(page);
  await palette(page).getByRole('button', { name: /Storage Box \(small\)/ }).click();
  await expect(page.getByRole('button', { name: 'Place' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('button', { name: 'Place' })).toBeHidden();
  await expect(page.getByLabel('Build palette')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();
});

test('the touch Place button confirms and placement persists across reload', async ({ page }) => {
  await openAppInStarterGrove(page);
  await gatherStarterTree(page);
  await grantBlueprints(page, 'field-cache');
  await openBuildTab(page);
  await palette(page).getByRole('button', { name: /Storage Box \(small\)/ }).click();
  await page.getByRole('button', { name: 'Place' }).click();
  await expectSavedState(page, (state) => state.buildings.some((b) => b.definitionId === 'field-cache'));
  await page.reload();

  const persisted = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').get('current');
      request.onsuccess = () => {
        const save = request.result as { state?: { buildings?: Array<{ definitionId: string }> } };
        db.close();
        resolve(save.state?.buildings?.some((building) => building.definitionId === 'field-cache') ?? false);
      };
      request.onerror = () => reject(request.error);
    });
  });
  expect(persisted).toBe(true);
});

test('keyboard opens the merged Craft tab and tabs stay mutually exclusive', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts are a desktop affordance');
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  // C and B are now the same tab: handcraft recipes above the build palette.
  await page.keyboard.press('b');
  await expect(page.getByText('Handcraft')).toBeVisible();
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();

  await page.keyboard.press('c');
  await expect(palette(page)).toBeVisible();
  await page.getByRole('tab', { name: 'Blueprints', exact: true }).click();
  await expect(page.getByLabel('Blueprints')).toBeVisible();
  await expect(palette(page)).toBeHidden();
});
