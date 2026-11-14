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

/** The saved state, or null before the first snapshot lands. */
export async function readSavedState(page: Page): Promise<SavedState | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elaris:default', 1);
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
