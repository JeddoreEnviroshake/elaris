import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app';
import { openAppInStarterGrove } from './gather';
import { readSavedState } from './save';

/**
 * The movement pad is a d-pad everywhere now, and outside Build a tapped arrow
 * is worth exactly one tile. Both halves of that are asserted against the saved
 * snapshot rather than the canvas: the tile has to reach the simulation, and it
 * has to stop there instead of becoming a walk.
 */

const TILE = 16;
const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

async function playerPosition(page: Page): Promise<{ x: number; y: number }> {
  await expect.poll(async () => (await readSavedState(page))?.player.x ?? null).not.toBe(null);
  return (await readSavedState(page))!.player;
}

/** Tap an arrow the way a thumb does: press and release without drifting. */
async function tapArrow(page: Page, direction: string): Promise<void> {
  const box = await page.locator(`[data-dpad-arrow="${direction}"]`).boundingBox();
  if (!box) throw new Error(`d-pad arrow ${direction} has no box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Tap arrows until one is accepted. Which directions are open depends on the
 * terrain the seed put around the spawn, so the test asks rather than assumes;
 * a spawn walled in on all four sides would be the real failure.
 */
async function tapUntilMoved(page: Page): Promise<{ before: { x: number; y: number }; after: { x: number; y: number } }> {
  for (const direction of DIRECTIONS) {
    const before = await playerPosition(page);
    await tapArrow(page, direction);
    try {
      await expect
        .poll(async () => {
          const player = (await readSavedState(page))?.player;
          return player ? player.x !== before.x || player.y !== before.y : false;
        }, { timeout: 4_000 })
        .toBe(true);
    } catch {
      continue;
    }
    return { before, after: await playerPosition(page) };
  }
  throw new Error('no d-pad direction moved the player');
}

test('shows the d-pad arrows outside Build mode', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();
  for (const direction of DIRECTIONS) {
    await expect(page.locator(`[data-dpad-arrow="${direction}"]`)).toBeVisible();
  }
});

test('moves the character exactly one tile per d-pad tap', async ({ page }) => {
  await openAppInStarterGrove(page);
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();

  const { before, after } = await tapUntilMoved(page);
  const travelled = Math.hypot(after.x - before.x, after.y - before.y);
  expect(travelled).toBeCloseTo(TILE, 3);
  // One axis only: a tap is cardinal, never a diagonal drift.
  expect(after.x === before.x || after.y === before.y).toBe(true);

  // And the tile is where it ends — a tap must not leave the character walking.
  // Compared loosely: a snapshot taken as the tile lands can carry the last
  // sub-pixel of float travel that the next one has already rounded away.
  await page.waitForTimeout(1_500);
  const settled = await playerPosition(page);
  expect(Math.hypot(settled.x - after.x, settled.y - after.y)).toBeLessThan(1);
});
