import type { Locator, Page } from '@playwright/test';

/**
 * Shared navigation for the gameplay menu. Craft and Build merged into one tab,
 * and blueprints are no longer bought anywhere — they are earned. Specs that
 * need a recipe available seed it through `grantBlueprints` rather than
 * clicking an Unlock button that no longer exists.
 */

/** Tabs only exist while the menu is up, so open it only when they are hidden. */
export async function openMenuTab(page: Page, tab: string): Promise<void> {
  const tabButton = page.getByRole('tab', { name: tab, exact: true });
  if (!(await tabButton.isVisible())) await page.getByRole('button', { name: 'Menu' }).click();
  await tabButton.click();
}

/** The build palette section of the merged Craft tab. */
export function buildPalette(page: Page): Locator {
  return page.getByLabel('Build palette');
}

/** Open Craft and return its build palette. */
export async function openBuildPalette(page: Page): Promise<Locator> {
  await openMenuTab(page, 'Craft');
  return buildPalette(page);
}

/** A blueprint's square tile, matched on the name that starts its aria-label. */
export function blueprintTile(page: Page, displayName: string): Locator {
  return page.getByRole('button', { name: new RegExp(`^${displayName.replace(/[()]/g, '\\$&')},`) });
}

/**
 * Teach the character one or more blueprints by patching the saved snapshot.
 *
 * There is no purchase UI to drive any more, and the in-game routes (level
 * gates, quests, field finds) are all far too slow to sit in front of a spec.
 * The live save controller can flush pre-patch state over the edit on its way
 * out, so the patch is re-applied until a reloaded game actually comes up
 * knowing them.
 */
export async function grantBlueprints(page: Page, ...ids: string[]): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const known = await page.evaluate(async (wanted) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('elaris:default', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return new Promise<string[]>((resolve, reject) => {
        const transaction = db.transaction('snapshots', 'readwrite');
        const store = transaction.objectStore('snapshots');
        const request = store.get('current');
        let next: string[] = [];
        request.onsuccess = () => {
          const save = request.result as { state: { unlockedItemIds: string[] } };
          next = [...new Set([...save.state.unlockedItemIds, ...wanted])].sort();
          save.state.unlockedItemIds = next;
          store.put(save, 'current');
        };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => { db.close(); resolve(next); };
        transaction.onerror = () => reject(transaction.error);
      });
    }, ids);
    await page.reload();
    if (ids.every((id) => known.includes(id))) {
      const settled = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('elaris:default', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return new Promise<string[]>((resolve, reject) => {
          const transaction = db.transaction('snapshots', 'readonly');
          const request = transaction.objectStore('snapshots').get('current');
          request.onsuccess = () => {
            resolve((request.result as { state: { unlockedItemIds: string[] } }).state.unlockedItemIds);
          };
          request.onerror = () => reject(request.error);
          transaction.oncomplete = () => db.close();
        });
      });
      if (ids.every((id) => settled.includes(id))) return;
    }
  }
  throw new Error(`blueprints never survived a reload: ${ids.join(', ')}`);
}
