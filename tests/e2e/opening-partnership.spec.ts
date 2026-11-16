import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/simulation/state';
import { openApp, reloadApp } from './app';
import { releaseSaveWriter, readSavedState } from './save';

test.setTimeout(60_000);

async function saved(page: Page) { return await readSavedState(page) as unknown as GameState | null; }

async function approachTuftle(page: Page) {
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await page.keyboard.down('d');
  try { await expect(page.getByRole('button', { name: 'Help Tuftle', exact: true })).toBeVisible(); }
  finally { await page.keyboard.up('d'); }
}

test('3D opening resumes trust, creates one named follower, and persists the partnership', async ({ page, isMobile }, testInfo) => {
  await openApp(page, 'render=3d');
  await expect(page.locator('#elaris-three-canvas')).toBeVisible();
  await approachTuftle(page);
  if (isMobile) await page.getByRole('button', { name: 'Help Tuftle', exact: true }).tap();
  else await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Earn the Tuftle’s trust' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: `tmp/opening-trust-${testInfo.project.name}.png` });
  await expect(dialog.getByRole('button', { name: 'Offer a berry', exact: true })).toContainText('Calm +12%');
  await dialog.getByRole('button', { name: 'Stay steady', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.onboarding.trustSession?.beatsRemaining).toBe(3);
  const beforeReload = (await saved(page))!;
  await reloadApp(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status').first()).toContainText('3 actions left');
  await expect.poll(async () => (await saved(page))?.onboarding.trustSession).toEqual(beforeReload.onboarding.trustSession);

  // Esc dismisses the view, without losing the saved interaction or granting a creature.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Help Tuftle', exact: true }).click();
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 3; index++) {
    if (isMobile) await dialog.getByRole('button', { name: 'Stay steady', exact: true }).tap();
    else await dialog.getByRole('button', { name: 'Stay steady', exact: true }).click();
  }
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
  expect(state.onboarding.status).toBe('active');
  expect(state.onboarding.completedMilestoneIds).toContain('befriend-tuftle');
  expect(state.onboarding.issuedRewardIds).toEqual(['starter-partner']);
  expect(state.ownedCreatures.filter((creature) => creature.speciesId === 'tuftle')).toHaveLength(1);
  expect(state.ownedCreatures.find((creature) => creature.id === state.onboarding.companionId)).toMatchObject({ name: 'Moss', role: 'follow' });
  expect(state.wildCreatures.some((creature) => creature.id === state.onboarding.starterWildCreatureId)).toBe(false);
});

test('trust dialog traps focus, blocks game actions, and permits a recoverable retry', async ({ page }) => {
  await openApp(page, 'render=3d');
  await approachTuftle(page);
  await page.getByRole('button', { name: 'Help Tuftle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Earn the Tuftle’s trust' });
  await expect(dialog).toBeVisible();
  const first = dialog.getByRole('button', { name: 'Stay steady', exact: true });
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Continue later', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await expect.poll(async () => Boolean((await saved(page))?.onboarding.trustSession)).toBe(true);
  const before = (await saved(page))!;
  await page.keyboard.press('e');
  await page.keyboard.press('b');
  await page.keyboard.press('Space');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Give it space', exact: true }).click();
  for (let index = 0; index < 3; index++) await dialog.getByRole('button', { name: 'Give it space', exact: true }).click();
  await expect(page.getByTestId('opening-response')).toContainText('try again');
  await expect.poll(async () => (await saved(page))?.onboarding.trustSession?.beatsRemaining).toBe(4);
  expect((await saved(page))?.ownedCreatures).toHaveLength(0);
  expect((await saved(page))?.player).toEqual(before.player);
  expect((await saved(page))?.inventory).toEqual(before.inventory);
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
