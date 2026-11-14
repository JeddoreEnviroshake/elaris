import { type Page } from '@playwright/test';

/**
 * Creatures and facilities are engaged by clicking them directly (there is no
 * proximity "Encounter"/"Use facility" button anymore), so these helpers drive
 * pointer clicks against the game canvas at world positions.
 *
 * The camera follows the player at the canvas centre with an integer zoom taken
 * from the shorter canvas axis (see computeLayout / ZOOM_TIERS), so a world
 * point maps linearly from the player's world position. Fixtures that place a
 * target on the player's own tile can just use {@link tapCanvasCenter}.
 */

async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('Game canvas is not visible');
  return box;
}

/** Click the middle of the canvas — where the followed player is rendered. */
export async function tapCanvasCenter(page: Page): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Click a world-space point, given the player's world position for the offset. */
export async function tapWorld(
  page: Page,
  world: { x: number; y: number },
  player: { x: number; y: number },
): Promise<void> {
  const box = await canvasBox(page);
  const minAxis = Math.min(box.width, box.height);
  const zoom = minAxis <= 480 ? 2 : minAxis <= 1080 ? 3 : 4;
  await page.mouse.click(
    box.x + box.width / 2 + (world.x - player.x) * zoom,
    box.y + box.height / 2 + (world.y - player.y) * zoom,
  );
}
