import { test } from '@playwright/test';
import { openApp, waitForDebugHandles } from '../e2e/app';

/**
 * Splits a walking-path area change into its parts: the Phaser-side
 * `rebuildAreaWorld`, the 3D `rebuildWorld`, and the slowest 3D frames after
 * it (shader compiles, texture uploads, model loads landing).
 */
test('area transition breakdown', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  const rows: string[] = [];
  for (const [x, y] of [[1, 0], [2, 0], [1, 0], [0, 0], [-1, 1]] as const) {
    const result = await page.evaluate(async ({ x, y }) => {
      const g = globalThis as any;
      const scene = g.__game.scene.getScene('world');
      const renderer = g.__renderer3d;
      const areas = await import('/src/simulation/areas.ts' as string);
      let sceneRebuildMs = 0;
      const original = scene.rebuildAreaWorld;
      scene.rebuildAreaWorld = function (...args: unknown[]) {
        const startedAt = performance.now();
        try { return original.apply(this, args); } finally { sceneRebuildMs = performance.now() - startedAt; }
      };
      renderer.frameWorkTimes = new renderer.frameWorkTimes.constructor(2_000);
      const startedAt = performance.now();
      areas.enterWorldArea(scene.state, x, y);
      scene.snapRenderPoseToState();
      scene.beginAreaTransition();
      await new Promise<void>((resolve) => {
        const poll = (): void => { if (!scene.transitioningArea) resolve(); else setTimeout(poll, 20); };
        poll();
      });
      const totalMs = performance.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      scene.rebuildAreaWorld = original;
      const work = renderer.getSnapshot().frameWork;
      return {
        name: scene.state.currentArea.name as string,
        sceneRebuildMs,
        threeRebuildMs: renderer.getSnapshot().areaRebuild.latestMs as number,
        transitionMs: scene.getPerformanceSnapshot().areaTransitions.latestMs as number,
        coverMs: totalMs,
        worstFrameMs: work.maxMs as number,
        framesOver50: (renderer.frameWorkTimes.values as Float64Array).slice(0, work.count).filter((v: number) => v > 50).length,
      };
    }, { x, y });
    rows.push(`| ${result.name} | ${result.sceneRebuildMs.toFixed(0)} | ${result.threeRebuildMs.toFixed(0)} | ${result.transitionMs.toFixed(0)} | ${result.coverMs.toFixed(0)} | ${result.worstFrameMs.toFixed(0)} | ${result.framesOver50} |`);
  }
  console.log('\n| Destination | Phaser rebuildAreaWorld ms | 3D rebuildWorld ms | Transition (to first frame) ms | Cover shown ms | Worst 3D frame in 2s after ms | 3D frames >50ms |');
  console.log('|---|---|---|---|---|---|---|');
  for (const row of rows) console.log(row);
});
