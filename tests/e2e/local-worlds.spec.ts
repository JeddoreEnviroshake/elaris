import { expect, test, type Page } from '@playwright/test';
import { createInitialState } from '../../src/simulation/state';

const menu = (page: Page) => page.getByRole('main', { name: 'World menu' });
async function createWorld(page: Page, name: string): Promise<void> {
  await menu(page).getByRole('button', { name: 'New Game', exact: true }).click();
  await menu(page).getByLabel('World name', { exact: true }).fill(name);
  await menu(page).getByRole('button', { name: 'Create world', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect(menu(page)).toBeHidden();
}
async function quit(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Quit to Menu', exact: true }).click();
  await expect(menu(page)).toBeVisible();
  await expect(page.locator('#elaris-three-canvas')).toHaveCount(0);
}

test('menu creates, switches and resumes independent worlds offline', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?localBalance=1');
  await expect(menu(page)).toBeVisible();
  await expect(page.locator('#elaris-three-canvas')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('world-menu-empty.png') });
  await menu(page).getByRole('button', { name: 'Join Game' }).click();
  await expect(menu(page).getByRole('status')).toContainText('Online play is not available yet');
  await createWorld(page, 'Moss cottage');
  const firstDb = await page.locator('html').getAttribute('data-world-database');
  await quit(page);
  // A saved-progress fixture makes restoration observable independently of ticks.
  await page.evaluate(async (database) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(database!); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite'); const store = tx.objectStore('snapshots'); const request = store.get('current');
      request.onsuccess = () => { const save = request.result; save.state.inventory.wood = 37; store.put(save, 'current'); };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, firstDb);
  await createWorld(page, 'Hill camp');
  expect(await page.locator('html').getAttribute('data-world-database')).not.toBe(firstDb);
  await quit(page);
  await expect(menu(page).getByRole('button', { name: /^Continue / })).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('world-menu-populated.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('[data-session-menu]')!.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(menu(page)).toBeVisible();
  await expect(page.locator('#elaris-three-canvas')).toHaveCount(0);
  await menu(page).getByRole('button', { name: 'Continue Moss cottage', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Wood stack, 37', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quit to Menu', exact: true }).click();
  await expect(menu(page)).toBeVisible();
  await createWorld(page, 'Offline camp');
  await quit(page);
  await expect(menu(page).getByRole('button', { name: 'Continue Offline camp', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('adopts existing progress as the first world and preserves its original backup', async ({ page }) => {
  await page.goto('/?localBalance=1'); await expect(menu(page)).toBeVisible();
  const state = createInitialState(42); state.inventory.wood = 23;
  const save = { meta: { saveVersion: 0, worldGenVersion: 1, contentVersion: 1, appVersion: 'legacy-fixture', savedAt: Date.now() }, state };
  await page.evaluate(async (save) => {
    const open = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const db = await open('elaris:default');
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(save, 'current');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
    const catalog = await open('elaris-worlds:default');
    await new Promise<void>((resolve, reject) => {
      const tx = catalog.transaction('settings', 'readwrite'); tx.objectStore('settings').delete('legacyAdopted');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); catalog.close();
  }, save);
  await page.reload(); await expect(menu(page)).toBeVisible();
  const resume = menu(page).getByRole('button', { name: /^Continue .*Level 1$/ });
  await expect(resume).toHaveCount(1); await resume.click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Wood stack, 23', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quit to Menu', exact: true }).click(); await expect(menu(page)).toBeVisible();
  const backup = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('elaris:default'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const result = await new Promise<unknown>((resolve, reject) => { const request = db.transaction('snapshots').objectStore('snapshots').get('preMigrationBackup'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close(); return result;
  });
  expect(backup).toEqual(save);
});

test('blocks a duplicate writer while allowing another world in a second window', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto('/?localBalance=1'); await expect(menu(page)).toBeVisible();
  await createWorld(page, 'One');
  // Keep the first world's journal open while using the other window.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const second = await context.newPage(); await second.goto('/?localBalance=1'); await expect(menu(second)).toBeVisible();
  await menu(second).getByRole('button', { name: 'Continue One', exact: true }).click();
  await expect(menu(second).getByRole('alert')).toContainText('another window');
  await expect(second.locator('#elaris-three-canvas')).toHaveCount(0);
  await createWorld(second, 'Two');
  await second.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.bringToFront();
  await page.getByRole('button', { name: 'Quit to Menu', exact: true }).click(); await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole('button', { name: /^Continue / })).toHaveCount(2);
  await menu(page).getByRole('button', { name: 'Continue Two', exact: true }).click();
  await expect(menu(page).getByRole('alert')).toContainText('another window');
  await second.bringToFront();
  await second.getByRole('button', { name: 'Quit to Menu', exact: true }).click(); await expect(menu(second)).toBeVisible();
  await page.bringToFront(); await menu(page).getByRole('button', { name: 'Continue Two', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await quit(page);
  await second.close();
});
