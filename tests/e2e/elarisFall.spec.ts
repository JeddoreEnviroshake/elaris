import { releaseSaveWriter } from './save';
import { expect, test } from '@playwright/test';
import { openApp } from './app';

/**
 * Elaris is the tutorial's safe town and nothing more. Past the last safe level
 * the player finds it in ruins, and the services it held have to be walked to.
 */
test('a character past the last safe level finds Elaris in ruins', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await expect(page.getByText(/Elaris · X \d+ +Y \d+/)).toBeVisible();

  // The initial snapshot is written on first load; give it a beat, then age the
  // character past the level that keeps the town standing.
  await page.waitForTimeout(500);
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
        const save = request.result as { state: { player: { level: number } } };
        save.state.player.level = 8;
        store.put(save, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  });
  await page.reload();

  await expect(page.getByText(/Ruins of Elaris · X \d+ +Y \d+/)).toBeVisible();
});
