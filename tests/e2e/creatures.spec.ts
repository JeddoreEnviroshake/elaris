import { expect, test, type Page } from '@playwright/test';
import { openApp, reloadApp } from './app';
import { openMenuTab } from './menu';
import { releaseSaveWriter } from './save';
import { createInitialState, type GameState, type SpeciesId } from '../../src/simulation/state';
import { newWildCreature } from '../../src/simulation/worldGeneration';
import { createOpeningChapter } from '../../src/content/onboarding';

/** Ordinary wildlife, outside the protected introduction and town buildings. */
async function seedEncounter(page: Page, species: SpeciesId, companion = false, weakened = false): Promise<void> {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  const state = createInitialState(123);
  state.onboarding = createOpeningChapter(123, true);
  state.player.x = 640;
  state.player.y = 640;
  const wild = newWildCreature('wild-e2e', species, 648, 640);
  if (weakened) wild.hp = 1;
  state.wildCreatures = [wild];
  state.resourceNodes = [];
  state.raiders = [];
  state.inventory['taming-snare'] = 10;
  state.inventoryStacks['taming-snare'] = [10];
  if (companion) {
    state.ownedCreatures.push({ id: 'companion-e2e', speciesId: 'tuftle', name: 'Moss', role: 'follow', assignment: null,
      worksiteId: null, nextWorkTick: 0, bondXp: 36, selectedBattleAbilityId: 'tuftle-heal' });
    state.battleCompanionId = 'companion-e2e';
  }
  await releaseSaveWriter(page);
  await page.evaluate(async (fixture: GameState) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite'); const store = tx.objectStore('snapshots');
      const request = store.get('current');
      request.onsuccess = () => store.put({ ...request.result, state: fixture }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    });
  }, state);
  await reloadApp(page);
  await page.getByRole('button', { name: 'Throw snare at creature' }).click();
  await expect(page.getByRole('dialog', { name: 'Wild creature encounter' })).toBeVisible();
}

for (const [species, name, habitat] of [
  ['craghopper', 'Craghopper', 'hills'], ['glade-stag', 'Glade Stag', 'forest'],
] as const) {
  test(`uses the 3D ${habitat} arena for a ${name} encounter`, async ({ page }) => {
    await seedEncounter(page, species, species === 'craghopper');
    const encounter = page.getByRole('dialog', { name: 'Wild creature encounter' });
    await expect(encounter).toHaveAttribute('data-habitat', habitat);
    await expect(encounter).toHaveCSS('background-image', 'none');
    await expect(page.locator('#elaris-three-canvas')).toBeVisible();
    await expect(encounter.getByText(`Wild ${name}`, { exact: true })).toBeVisible();
    if (species === 'craghopper') {
      await expect(encounter.getByText(/Intent: Advance/)).toBeVisible();
      await expect(encounter.getByRole('button', { name: /Moss: Gentle Mend/ })).toHaveAttribute('aria-pressed', 'true');
    }
  });
}

test('tames a weakened Tuftle, assigns Follow and Battle Companion, and restores both after reload', async ({ page }) => {
  test.setTimeout(90_000);
  await seedEncounter(page, 'tuftle', false, true);
  const encounter = page.getByRole('dialog', { name: 'Wild creature encounter' });
  await expect(encounter.getByRole('button', { name: 'Melee attack' })).toBeDisabled();
  await expect(encounter.getByRole('button', { name: 'Magic attack' })).toBeEnabled();
  for (let attempt = 0; attempt < 10 && await encounter.isVisible(); attempt += 1) {
    const snare = encounter.getByRole('button', { name: 'Throw Snare' });
    await expect(snare).toBeEnabled();
    await snare.click();
    await expect.poll(async () => !(await encounter.isVisible()) || await snare.isEnabled()).toBe(true);
  }
  await expect(encounter).toBeHidden();
  await openMenuTab(page, 'Creatures');
  await expect(page.getByText('Creature roster', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Follow selected creature/ }).click();
  await page.getByRole('button', { name: 'Set as Battle Companion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear Battle Companion' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Select Tuftle, Tuftle, currently follow/ })).toBeVisible();
  await releaseSaveWriter(page);
  await reloadApp(page);
  await openMenuTab(page, 'Creatures');
  await expect(page.getByRole('button', { name: /Select Tuftle, Tuftle, currently follow/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear Battle Companion' })).toHaveAttribute('aria-pressed', 'true');
});
