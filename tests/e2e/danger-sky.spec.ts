import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import type { GameState } from '../../src/simulation/state';
import { openApp, waitForDebugHandles } from './app';

type Debug = {
  __game: { scene: { getScene(key: string): { state: GameState; snapRenderPoseToState(): void } } };
  __renderer3d: {
    dangerOverlay: HTMLDivElement;
    woodlandSky: { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> };
  };
};

test('danger skies keep their event inside shelter and clear exposure tint in both views', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/Shader Error|VALIDATE_STATUS|WebGL.*INVALID/.test(message.text())) errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await waitForDebugHandles(page);
  for (const firstPerson of [false, true]) {
    if (firstPerson) await page.getByRole('button', { name: 'First person', exact: true }).click();
    for (const [slot, threat] of ['fog', 'raid', 'storm'].entries()) {
      await page.evaluate(async ({ slot }) => {
        const scene = (globalThis as unknown as Debug).__game.scene.getScene('world');
        const path = '/src/simulation/survivalCycle.ts';
        const { dangerThreatFor, dangerPhaseTicks } = await import(path);
        const state = scene.state;
        if (state.onboarding.firstThreat) state.onboarding.firstThreat.mode = 'ordinary';
        let tick = 0;
        let cycle = 0;
        const wanted = ['fog', 'raid', 'storm'][slot];
        while (dangerThreatFor(cycle) !== wanted) {
          tick += state.gameBalance.raid.safePhaseSeconds * 60 + dangerPhaseTicks(state.gameBalance.raid, cycle++);
        }
        state.tick = tick + state.gameBalance.raid.safePhaseSeconds * 60 + 120;
        state.player.hp = state.player.maxHp = 100_000;
        state.player.x = 30 * 16 + 8; state.player.y = 30 * 16 + 8;
        scene.snapRenderPoseToState();
      }, { slot });
      await expect.poll(() => page.evaluate(() => Number((globalThis as unknown as Debug).__renderer3d.dangerOverlay.style.opacity))).toBeGreaterThan(.9);
      await expect.poll(() => page.evaluate(({ slot }) => {
        const sky = (globalThis as unknown as Debug).__renderer3d.woodlandSky.mesh;
        return sky.material.uniforms.eventMix!.value.getComponent(slot);
      }, { slot })).toBe(1);
      await page.screenshot({ path: testInfo.outputPath(`${firstPerson ? 'first-person' : 'overhead'}-${threat}-exposed.png`) });
      await page.evaluate(() => {
        const scene = (globalThis as unknown as Debug).__game.scene.getScene('world');
        scene.state.player.x = 80 * 16 + 8; scene.state.player.y = 82 * 16 + 8;
        scene.snapRenderPoseToState();
      });
      await expect.poll(() => page.evaluate(() => Number((globalThis as unknown as Debug).__renderer3d.dangerOverlay.style.opacity))).toBe(0);
      const sky = await page.evaluate(({ slot }) => {
        const sky = (globalThis as unknown as Debug).__renderer3d.woodlandSky.mesh;
        return { visible: sky.visible, event: sky.material.uniforms.eventMix!.value.getComponent(slot), time: sky.material.uniforms.time!.value };
      }, { slot });
      expect(sky).toEqual({ visible: firstPerson, event: 1, time: 0 });
    }
  }
  expect(errors).toEqual([]);
});
