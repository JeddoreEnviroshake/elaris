import { expect, test } from '@playwright/test';
import { openApp, waitForDebugHandles } from './app';

for (const sprint of [false, true]) {
test(`startup at 20 FPS preserves ${sprint ? 'sprint' : 'walking'} speed and presents the interpolated pose`, async ({ page }) => {
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  if (sprint) await page.locator('[data-sprint-toggle]').click();
  await page.keyboard.down('d');
  try {
    const result = await page.evaluate(() => {
      const { __game: game, __renderer3d: renderer } = globalThis as any;
      const scene = game.scene.getScene('world');
      game.loop.stop();
      scene.state.wildCreatures = [];
      scene.state.player.x = 40 * 16;
      scene.state.player.y = 40 * 16;
      scene.state.gameBalance.camera.yawTenths = 0;
      scene.snapRenderPoseToState();
      const startX = scene.state.player.x;
      const startTick = scene.state.tick;
      // Drive real engine frames at a controlled rate, including its startup
      // cooldown. Skip GPU submission while testing the clocks and pose bridge.
      const render = renderer.finish.render;
      renderer.finish.render = () => {};
      game.loop._coolDown = 120;
      let time = game.loop.lastTime;
      for (let frame = 0; frame < 20; frame++) game.loop.step(time += 50);
      const presentation = scene.get3DPresentationState();
      renderer.finish.render = render;
      return {
        ticks: scene.state.tick - startTick,
        distance: scene.state.player.x - startX,
        presentedX: renderer.playerRoot.position.x * 16,
        sharedX: presentation.playerPosition.x,
        previousX: scene.previousPlayerX,
        currentX: scene.state.player.x,
      };
    });
    expect(result.ticks).toBe(60);
    expect(result.distance).toBeCloseTo(96 * (sprint ? 1.5 : 1), 6);
    expect(result.presentedX).toBeCloseTo(result.sharedX, 7);
    expect(result.presentedX).toBeGreaterThanOrEqual(result.previousX);
    expect(result.presentedX).toBeLessThanOrEqual(result.currentX);
  } finally {
    await page.keyboard.up('d');
  }
});
}

test('a queued d-pad tap stays one tile during a frame with multiple simulation steps', async ({ page }) => {
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  const distance = await page.evaluate(() => {
    const { __game: game, __renderer3d: renderer } = globalThis as any;
    const scene = game.scene.getScene('world');
    game.loop.stop();
    scene.state.wildCreatures = [];
    scene.state.player.x = 40 * 16;
    scene.state.player.y = 40 * 16;
    scene.state.gameBalance.camera.yawTenths = 0;
    scene.snapRenderPoseToState();
    scene.queueStep(1, 0);
    const startX = scene.state.player.x;
    const render = renderer.finish.render;
    renderer.finish.render = () => {};
    let time = game.loop.lastTime;
    for (let frame = 0; frame < 4; frame++) game.loop.step(time += 250);
    renderer.finish.render = render;
    return scene.state.player.x - startX;
  });
  expect(distance).toBe(16);
});
