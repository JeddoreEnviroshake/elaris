import { expect, type Page } from '@playwright/test';

/**
 * Read the persisted snapshot the way the app writes it. Browser tests used to
 * wait on a "Saved" toast, but the toast is only raised for the offline-progress
 * summary now, so waits like that hung until timeout. Polling the snapshot the
 * save controller actually wrote is state-driven and cannot drift from the UI.
 */
export interface SavedState {
  unlockedItemIds: string[];
  inventory: Record<string, number>;
  buildings: Array<{
    id: string;
    definitionId: string;
    tileX: number;
    tileY: number;
    rotated?: boolean;
    housing?: { bin: { fiber: number; berry: number } };
    producer?: { bin: { stone: number } };
    cartDock?: { linkedStorageId: string | null; playerInside: boolean; lastTransferMessage: string | null };
    storage?: Record<string, number>;
  }>;
  player: { x: number; y: number };
  workerResourcesProduced: number;
}

/** Finish the app's normal save/release before replacing a browser fixture. */
export async function releaseSaveWriter(page: Page): Promise<void> {
  // Stop expensive world drawing while the browser fixture is being replaced.
  // The journal keeps the simulation running and provides a still backdrop.
  const journal = page.getByRole('dialog', { name: 'Game menu', exact: true });
  const open = page.getByRole('button', { name: 'Menu', exact: true });
  if (!(await journal.isVisible()) && await open.isVisible()) await open.click();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<number>((resolve, reject) => {
      const request = db.transaction('lease').objectStore('lease').count();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  })).toBe(0);
}

/** The saved state, or null before the first snapshot lands. */
export async function readSavedState(page: Page): Promise<SavedState | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<SavedState | null>((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').get('current');
      request.onsuccess = () => {
        const save = request.result as { state?: SavedState } | undefined;
        db.close();
        resolve(save?.state ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Wait until the persisted snapshot satisfies `predicate` — the state-driven
 * replacement for sleeping and hoping the write landed.
 */
export async function expectSavedState(
  page: Page,
  predicate: (state: SavedState) => boolean,
  message = 'saved snapshot never reached the expected state',
): Promise<void> {
  await expect
    .poll(async () => {
      const state = await readSavedState(page);
      return state !== null && predicate(state);
    }, { message })
    .toBe(true);
}
