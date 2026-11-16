import { expect, test, type Page } from '@playwright/test';
import { openApp, waitForDebugHandles } from './app';

// Walk-in rooms in Elaris (the Farm and the Arcanum stand in other areas).
const BUILDINGS = [
  ['weaponsmith', 'weaponsmith-forge', 'interior-forge'],
  ['market', 'elaris-market', 'interior-market'],
  ['church', 'elaris-church', 'interior-sanctuary'],
  ['armoury', 'elaris-armoury', 'interior-armoury'],
  ['tavern', 'elaris-tavern', 'interior-tavern'],
  ['arena', 'elaris-arena', 'interior-arena'],
] as const;

type BuildingId = typeof BUILDINGS[number][0];

type QaWorldScene = {
  previewTownInteriorForQa: (buildingId: BuildingId) => void;
  getInteriorAudioSnapshot: () => { activeSoundscape: string | null };
  state: { player: { x: number; y: number } };
  snapRenderPoseToState: () => void;
};

type Debug = {
  __game: { scene: { getScene: (key: string) => QaWorldScene } };
  __renderer3d: { getSnapshot: () => { interiorActive: boolean; interiorId: string | null } };
};

async function preview(page: Page, buildingId: BuildingId): Promise<void> {
  await page.evaluate((id) => (globalThis as unknown as Debug).__game.scene.getScene('world').previewTownInteriorForQa(id), buildingId);
}

const soundscape = (page: Page) => page.evaluate(() =>
  (globalThis as unknown as Debug).__game.scene.getScene('world').getInteriorAudioSnapshot().activeSoundscape);

test('captures every walk-in room at desktop and portrait release sizes', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  for (const [buildingId, interiorId, ambience] of BUILDINGS) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await preview(page, buildingId);
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as Debug).__renderer3d.getSnapshot().interiorId))
      .toBe(interiorId);
    await expect.poll(() => soundscape(page)).toBe(ambience);
    await page.screenshot({ path: testInfo.outputPath(`${interiorId}-desktop.png`) });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.screenshot({ path: testInfo.outputPath(`${interiorId}-portrait.png`) });
  }
  expect(errors).toEqual([]);
});

test('the room ambience follows the player through the doorway, with no scene cut', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  await preview(page, 'tavern');
  await expect.poll(() => soundscape(page)).toBe('interior-tavern');
  // There is no transition overlay and nothing to "leave": the world stays drawn.
  await expect(page.locator('[data-testid="interior-transition"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Leave the / })).toHaveCount(0);
  await expect(page.locator('#elaris-three-canvas')).toBeVisible();

  // The Tavern's door is on its north wall: walk up and out of it.
  await page.keyboard.down('w');
  try {
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as Debug).__renderer3d.getSnapshot().interiorActive),
      { timeout: 10_000 }).toBe(false);
  } finally {
    await page.keyboard.up('w');
  }
  await expect.poll(() => soundscape(page)).toBeNull();
});
