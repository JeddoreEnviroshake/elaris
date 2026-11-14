import { expect, test } from '@playwright/test';
import { openApp, waitForDebugHandles } from './app';

const BUILDINGS = [
  ['weaponsmith', 'weaponsmith-forge'],
  ['farm', 'verdant-reach-farm'],
  ['market', 'elaris-market'],
  ['church', 'elaris-church'],
  ['armoury', 'elaris-armoury'],
  ['magic-shop', 'sylvaren-arcanum'],
  ['tavern', 'elaris-tavern'],
  ['arena', 'elaris-arena'],
] as const;

type QaWorldScene = {
  previewTownInteriorForQa: (buildingId: typeof BUILDINGS[number][0]) => void;
  getInteriorAudioSnapshot: () => { activeSoundscape: string | null };
  get3DPresentationState: () => { interior: { pose: { x: number; y: number } } | null };
};

async function preview(page: import('@playwright/test').Page, buildingId: typeof BUILDINGS[number][0]): Promise<void> {
  await page.evaluate((id) => {
    const game = (globalThis as unknown as { __game: { scene: { getScene: (key: string) => QaWorldScene } } }).__game;
    game.scene.getScene('world').previewTownInteriorForQa(id);
  }, buildingId);
}

test('captures every room at desktop and portrait release sizes', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  for (const [buildingId, interiorId] of BUILDINGS) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await preview(page, buildingId);
    await expect.poll(() => page.evaluate(() => (
      globalThis as unknown as { __renderer3d: { getSnapshot: () => { interiorId: string | null } } }
    ).__renderer3d.getSnapshot().interiorId)).toBe(interiorId);
    await expect(page).toHaveScreenshot(`${interiorId}-desktop.png`, { animations: 'disabled', maxDiffPixelRatio: 0.015 });

    await page.setViewportSize({ width: 412, height: 915 });
    await expect(page).toHaveScreenshot(`${interiorId}-portrait.png`, { animations: 'disabled', maxDiffPixelRatio: 0.015 });
    await testInfo.attach(`${interiorId} viewport`, { body: Buffer.from('1280x800 and 412x915'), contentType: 'text/plain' });
  }
});

test('honours reduced motion, accessible labels, touch targets, and audio lifecycle', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  await preview(page, 'magic-shop');
  const transitionSeconds = await page.locator('[data-testid="interior-transition"]').evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration));
  expect(transitionSeconds).toBeLessThanOrEqual(0.001);
  await expect(page.getByRole('button', { name: 'Leave the Arcanum' })).toBeVisible();
  const leaveTarget = await page.getByRole('button', { name: 'Leave the Arcanum' }).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(leaveTarget.width).toBeGreaterThanOrEqual(44);
  expect(leaveTarget.height).toBeGreaterThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => {
    const game = (globalThis as unknown as { __game: { scene: { getScene: (key: string) => QaWorldScene } } }).__game;
    return game.scene.getScene('world').getInteriorAudioSnapshot().activeSoundscape;
  })).toBe('interior-arcanum');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => {
    const game = (globalThis as unknown as { __game: { scene: { getScene: (key: string) => QaWorldScene } } }).__game;
    return game.scene.getScene('world').getInteriorAudioSnapshot().activeSoundscape;
  })).toBeNull();
});

test('keeps up screen-relative inside a building whose door is on the far wall', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  await preview(page, 'market');
  await expect(page.getByRole('button', { name: 'Leave the Market' })).toBeVisible();

  const pose = async (): Promise<{ x: number; y: number }> => page.evaluate(() => {
    const game = (globalThis as unknown as { __game: { scene: { getScene: (key: string) => QaWorldScene } } }).__game;
    return game.scene.getScene('world').get3DPresentationState().interior!.pose;
  });
  const spawn = await pose();

  // The player spawns a tile from the door, so walk down into the room first
  // rather than pressing up straight through the exit.
  await page.keyboard.down('s');
  try {
    await expect.poll(async () => (await pose()).y >= spawn.y + 2).toBe(true);
  } finally {
    await page.keyboard.up('s');
  }
  const before = await pose();

  await page.keyboard.down('w');
  try {
    // Every room is shot from the overworld orientation, so screen-up walks
    // toward decreasing local y here exactly as it does outside, even though
    // this room's door sits on the far wall. The angled x component is
    // discarded by the same cardinal grid snap as outside.
    await expect.poll(async () => (await pose()).y < before.y).toBe(true);
  } finally {
    await page.keyboard.up('w');
  }
  const after = await pose();
  expect(after.x).toBeCloseTo(before.x);
});
