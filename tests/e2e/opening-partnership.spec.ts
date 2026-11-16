import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/simulation/state';
import { openApp, reloadApp } from './app';
import { releaseSaveWriter, readSavedState } from './save';
import { openMenuTab } from './menu';
import { createInitialState } from '../../src/simulation/state';
import { prepareOpeningTaming } from '../helpers/openingJourney';

test.setTimeout(60_000);

async function saved(page: Page) { return await readSavedState(page) as unknown as GameState | null; }

async function approachTuftle(page: Page) {
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  const help = page.getByRole('button', { name: 'Help Tuftle', exact: true });
  await page.keyboard.down('d');
  try { await expect(help).toBeVisible(); }
  finally { await page.keyboard.up('d'); }
  // Releasing the key can coast the player past the Tuftle's reach on a slow
  // frame; step back until the prompt is up again.
  await page.waitForTimeout(400);
  if (!(await help.isVisible())) {
    await page.keyboard.down('a');
    try { await expect(help).toBeVisible(); }
    finally { await page.keyboard.up('a'); }
  }
}

const fedTuftle = (state: GameState | null) => state?.wildCreatures
  .find((creature) => creature.id === state.onboarding.starterWildCreatureId)?.captureBonusBps ?? 0;

/** Bag → tap the stack → Add to Hotbar, the route the tutorial tells the player to take. */
async function addToHotbar(page: Page, label: string) {
  await openMenuTab(page, 'Bag');
  await page.getByRole('button', { name: new RegExp(`^${label} stack`) }).first().click();
  await page.getByRole('dialog', { name: `${label} stack actions` }).getByRole('button', { name: 'Add to Hotbar', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}

/** A fresh world whose player has already picked berries and crafted an axe and a snare. */
async function loadPreparedWorld(page: Page) {
  await openApp(page, 'render=3d');
  await expect(page.locator('#elaris-three-canvas')).toBeVisible();
  await expect.poll(async () => Boolean(await saved(page))).toBe(true);
  const fixture = createInitialState(42);
  prepareOpeningTaming(fixture);
  await releaseSaveWriter(page);
  await page.evaluate(async (state) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite'); const store = tx.objectStore('snapshots'); const request = store.get('current');
      request.onsuccess = () => {
        const current = request.result as { meta: Record<string, unknown> };
        store.put({ meta: { ...current.meta, savedAt: Date.now() }, state }, 'current');
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    });
  }, fixture);
  await reloadApp(page);
  await expect(page.locator('#elaris-three-canvas')).toBeVisible();
}

test('the Tuftle waits until the player has foraged and crafted a snare', async ({ page }) => {
  await openApp(page, 'render=3d');
  await approachTuftle(page);
  await page.keyboard.press('e');
  await expect(page.getByText('Too nervous for now', { exact: false }).first()).toBeVisible();
  expect((await saved(page))?.onboarding.completedMilestoneIds ?? []).not.toContain('meet-tuftle');
});

test('3D opening teaches berry-then-snare from the hotbar and persists the partnership', async ({ page, isMobile }, testInfo) => {
  await loadPreparedWorld(page);
  await approachTuftle(page);
  if (isMobile) await page.getByRole('button', { name: 'Help Tuftle', exact: true }).tap();
  else await page.keyboard.press('e');
  // No dialog: the hint says to put the berry and snare the player made on the hotbar.
  await expect(page.getByTestId('opening-partnership')).toBeHidden();
  await expect.poll(async () => (await saved(page))?.onboarding.completedMilestoneIds.includes('meet-tuftle')).toBe(true);
  const before = (await saved(page))!;
  expect(before.inventory['taming-snare']).toBeGreaterThan(0);

  await addToHotbar(page, 'Berry');
  await addToHotbar(page, 'Taming Snare');
  const toolbar = page.getByRole('toolbar', { name: 'Hotbar' });
  const berrySlot = toolbar.getByRole('button', { name: /Berry ×/ });
  const snareSlot = toolbar.getByRole('button', { name: /Taming Snare ×/ });
  await expect(berrySlot).toBeVisible();
  await expect(snareSlot).toBeVisible();
  await page.screenshot({ path: `tmp/opening-hotbar-${testInfo.project.name}.png` });

  // Snaring before feeding is refused and costs nothing.
  await snareSlot.click();
  await berrySlot.click();
  await expect.poll(async () => fedTuftle(await saved(page))).toBeGreaterThan(0);
  await snareSlot.click();

  const naming = page.getByRole('dialog', { name: 'A new friend' });
  await expect(naming).toBeVisible();
  await naming.getByLabel('Your companion’s name').fill('Moss');
  await naming.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(naming).toBeHidden();
  await expect.poll(async () => (await saved(page))?.ownedCreatures.filter((creature) => creature.speciesId === 'tuftle')).toMatchObject([{ name: 'Moss', role: 'follow' }]);
  await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect(page.getByTestId('opening-partnership')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Help Tuftle', exact: true })).toBeHidden();
  const state = (await saved(page))!;
  expect(state.onboarding.completedMilestoneIds).toContain('befriend-tuftle');
  expect(state.onboarding.issuedRewardIds).toEqual(['starter-partner']);
  expect(state.ownedCreatures.filter((creature) => creature.speciesId === 'tuftle')).toHaveLength(1);
  expect(state.ownedCreatures.find((creature) => creature.id === state.onboarding.companionId)).toMatchObject({ name: 'Moss', role: 'follow' });
  expect(state.wildCreatures.some((creature) => creature.id === state.onboarding.starterWildCreatureId)).toBe(false);
  // The lesson spends one berry and the one snare the player crafted.
  expect(state.inventory.berry).toBe(before.inventory.berry - 1);
  expect(state.inventory['taming-snare']).toBe(before.inventory['taming-snare'] - 1);
});

test('an existing v81 save keeps its progress and does not receive the new introduction', async ({ page }) => {
  await openApp(page, 'render=3d');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect.poll(async () => Boolean(await saved(page))).toBe(true);
  await releaseSaveWriter(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite');
      const store = transaction.objectStore('snapshots');
      const request = store.get('current');
      request.onsuccess = () => {
        const save = request.result as { meta: { saveVersion: number; savedAt: number }; state: GameState };
        save.meta.saveVersion = 81;
        save.meta.savedAt = Date.now();
        save.state.tick = 1234;
        save.state.coins = 37;
        save.state.completedQuestIds = ['gather-fiber'];
        save.state.claimedQuestRewardIds = ['gather-fiber'];
        save.state.wildCreatures = save.state.wildCreatures.filter((wild) => wild.id !== save.state.onboarding.starterWildCreatureId);
        delete (save.state as Partial<GameState>).onboarding;
        store.put(save, 'current');
      };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  });
  await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page))?.onboarding.status).toBe('legacy');
  const state = (await saved(page))!;
  expect(state.coins).toBe(37);
  expect(state.tick).toBeGreaterThanOrEqual(1234);
  expect(state.claimedQuestRewardIds).toEqual(['gather-fiber']);
  expect(state.ownedCreatures).toHaveLength(0);
  expect(state.wildCreatures.some((wild) => wild.id.startsWith('opening-tuftle-'))).toBe(false);
  await expect(page.getByTestId('opening-partnership')).toBeHidden();
});
