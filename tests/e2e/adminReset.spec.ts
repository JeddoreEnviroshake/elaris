import { openAdmin } from './menu';
import { expect, test } from '@playwright/test';
import { openApp } from './app';
import { expectSavedState, readSavedState } from './save';

/**
 * Reset Game is the one Local Value that cannot be staged and pushed: it wipes
 * the save outright, so the confirm has to actually gate it. Both answers are
 * checked against the persisted snapshot rather than the panel.
 */
const MOVED_X = 900;

async function stagePlayerX(page: import('@playwright/test').Page): Promise<void> {
  const x = page.getByLabel('X', { exact: true });
  await expect(x).toBeVisible();
  await x.fill('');
  await x.pressSequentially(String(MOVED_X));
  await page.getByRole('button', { name: 'Push Local Values' }).click();
  await expectSavedState(page, (state) => Math.round(state.player.x) === MOVED_X);
}

test('cancelling the confirm leaves the game untouched', async ({ page }) => {
  await openApp(page);
  await openAdmin(page);
  await stagePlayerX(page);

  page.once('dialog', (dialog) => { void dialog.dismiss(); });
  await page.getByTestId('admin-reset-game').click();

  await expect(page.getByTestId('admin-reset-game')).toBeVisible();
  const state = await readSavedState(page);
  expect(Math.round(state!.player.x)).toBe(MOVED_X);
});

test('confirming Reset Game wipes the save and closes the panel', async ({ page }) => {
  await openApp(page);
  await openAdmin(page);
  await stagePlayerX(page);

  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByTestId('admin-reset-game').click();

  await expect(page.getByTestId('admin-reset-game')).toBeHidden();
  await expectSavedState(page, (state) => Math.round(state.player.x) !== MOVED_X, 'save was never reset');
});
