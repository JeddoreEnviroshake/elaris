import { expect, test, type Page } from '@playwright/test';
import { openAppInStarterGrove } from './gather';
import { readSavedState } from './save';

/**
 * Free movement: the overworld player walks at any angle, in the default
 * overhead view and in opt-in first person. Positions come from the saved
 * snapshot, never the canvas, so these prove the walk reached the simulation.
 */

async function savedPosition(page: Page): Promise<{ x: number; y: number }> {
  await expect.poll(async () => (await readSavedState(page))?.player.x ?? null).not.toBe(null);
  return (await readSavedState(page))!.player;
}

/** Hold keys, then wait for the snapshot to settle on where the walk ended. */
async function walk(page: Page, keys: string[], ms: number): Promise<{ dx: number; dy: number }> {
  const before = await savedPosition(page);
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  for (const key of keys) await page.keyboard.up(key);
  let after = before;
  await expect.poll(async () => {
    const next = (await readSavedState(page))!.player;
    const settled = next.x === after.x && next.y === after.y && (next.x !== before.x || next.y !== before.y);
    after = next;
    return settled;
  }, { timeout: 10_000, intervals: [400] }).toBe(true);
  return { dx: after.x - before.x, dy: after.y - before.y };
}

function angleBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const cosine = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

/** Ground forward for a look yaw, the convention of screenToCameraWorldIntent. */
function forwardForYaw(yawDegrees: number): { x: number; y: number } {
  const yaw = yawDegrees * Math.PI / 180;
  return { x: -Math.sin(yaw), y: -Math.cos(yaw) };
}

/** The published default overhead yaw; `localBalance=1` pins it. */
const CAMERA_YAW_DEGREES = 20;

test('walks a diagonal in the overhead view', async ({ page }) => {
  await openAppInStarterGrove(page);
  const { dx, dy } = await walk(page, ['w', 'd'], 1_000);
  // A grid step moves along one axis only; a diagonal moves along both.
  expect(Math.abs(dx)).toBeGreaterThan(12);
  expect(Math.abs(dy)).toBeGreaterThan(12);
  // Screen up-right through the 20° camera lean.
  const up = forwardForYaw(CAMERA_YAW_DEGREES);
  const right = forwardForYaw(CAMERA_YAW_DEGREES - 90);
  const expected = { x: up.x + right.x, y: up.y + right.y };
  expect(angleBetween({ x: dx, y: dy }, expected)).toBeLessThan(12);
  // Whole pixels only: the save never holds a fraction.
  const player = await savedPosition(page);
  expect(Number.isInteger(player.x) && Number.isInteger(player.y)).toBe(true);
});

test('first person turns with a drag and walks along the look direction', async ({ page }) => {
  await openAppInStarterGrove(page);
  const toggle = page.getByRole('button', { name: 'First person' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-first-person-crosshair]')).toBeVisible();

  // Entering first person looks down the overhead view's "up".
  const ahead = await walk(page, ['w'], 900);
  expect(angleBetween({ x: ahead.dx, y: ahead.dy }, forwardForYaw(CAMERA_YAW_DEGREES))).toBeLessThan(10);

  // Drag right across the world canvas: 300 px at the default 0.3°/px is a
  // 90° turn to the right.
  const viewport = page.viewportSize()!;
  const startX = viewport.width / 2 - 150;
  const y = viewport.height / 2 - 40;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 300, y, { steps: 15 });
  await page.mouse.up();

  const turned = await walk(page, ['w'], 900);
  expect(angleBetween({ x: turned.dx, y: turned.dy }, forwardForYaw(CAMERA_YAW_DEGREES - 90))).toBeLessThan(10);

  // The view mode is a per-device preference that survives a reload, and the
  // toggle puts the overhead view back.
  await page.reload();
  await expect(page.locator('[data-first-person-crosshair]')).toBeVisible();
  await page.getByRole('button', { name: 'First person' }).click();
  await expect(page.locator('[data-first-person-crosshair]')).toBeHidden();
});
