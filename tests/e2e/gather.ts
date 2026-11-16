import { releaseSaveWriter } from './save';
import { expect, type Page } from '@playwright/test';
import { openApp, reloadApp } from './app';
import { DEFAULT_WORLD_SEED } from '../../src/config/platform';
import { starterGroveAnchor } from '../../src/simulation/worldGeneration';

type ResourceKind = 'tree' | 'stone' | 'metal' | 'plant' | 'berry-bush';

/**
 * Open the app with the player standing in the starter grove.
 *
 * Nothing generates inside the Elaris walls, so a character at spawn has
 * nothing in reach: the tutorial cluster is the grove out past the west gate,
 * and these tests would otherwise spend a minute walking to it. Only the player
 * moves — the grove is the world's own, so hp, yields, and the spacing that
 * puts two trees in range and the third a step away are all real.
 */
export async function openAppInStarterGrove(page: Page): Promise<void> {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.waitForTimeout(500);
  await releaseSaveWriter(page);
  await page.evaluate(async (grove) => {
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
        const save = request.result as { state: Record<string, any> };
        save.state.player.x = grove.x;
        save.state.player.y = grove.y;
        store.put(save, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, starterGroveAnchor(DEFAULT_WORLD_SEED));
  await reloadApp(page);
  await expect(page.locator('[data-action-button]')).toBeVisible();
}

interface ResourceSnapshot {
  id: string;
  hp: number;
  maxHp: number;
}

/** Read the invisible resource target metadata maintained by the normal HUD. */
async function nearestResource(page: Page, kind?: ResourceKind): Promise<ResourceSnapshot> {
  const hint = page.locator('[data-target-hint]');
  await expect(hint).toHaveAttribute('data-resource-target-id', /.+/);
  if (kind) await expect(hint).toHaveAttribute('data-resource-target-kind', kind);
  return hint.evaluate((element) => ({
    id: (element as HTMLElement).dataset.resourceTargetId!,
    hp: Number((element as HTMLElement).dataset.resourceTargetHp),
    maxHp: Number((element as HTMLElement).dataset.resourceTargetMaxHp),
  }));
}

async function resourceHp(page: Page, id: string): Promise<number> {
  return page.locator('[data-target-hint]').evaluate((element, targetId) => {
    const data = (element as HTMLElement).dataset;
    return data.resourceTargetId === targetId ? Number(data.resourceTargetHp) : 0;
  }, id);
}

/**
 * Deplete the nearest live resource without depending on the intentionally
 * hidden proximity and hit/cooldown text. Returns HP after each successful hit.
 */
export async function gatherNearestResource(page: Page, kind?: ResourceKind): Promise<number[]> {
  // Selected by its stable data hook rather than its label: once a target is
  // locked the button renames itself after that target ("Chop Tree"), so the
  // accessible name is not a handle a click loop can hold on to.
  const gather = page.locator('[data-action-button]');
  await expect(gather).toBeVisible();
  const target = await nearestResource(page, kind);

  const hitPoints: number[] = [];
  let previousHp = target.hp;
  while (previousHp > 0) {
    let nextHp = previousHp;
    for (let attempt = 0; attempt < 15 && nextHp >= previousHp; attempt += 1) {
      await gather.click();
      await page.waitForTimeout(200);
      nextHp = await resourceHp(page, target.id);
    }
    if (nextHp >= previousHp) throw new Error(`Resource ${target.id} never took damage`);
    hitPoints.push(nextHp);
    previousHp = nextHp;
  }
  return hitPoints;
}

/** Deplete the nearest untouched starter tree and wait for every hit to land. */
export async function gatherStarterTree(page: Page): Promise<void> {
  await gatherNearestResource(page, 'tree');
}
