import fs from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { openApp, waitForDebugHandles } from '../e2e/app';

/**
 * Open-world Phase 0 baseline: what a walking area change costs today, and what
 * a steady frame costs mid-area and at an area corner, overhead and first
 * person. Results land in tmp/perf/area-baseline-<project>.json and are printed
 * as a table for open-world-plan.md.
 */

const AREAS = [
  { x: 0, y: 0 },  // Elaris
  { x: 1, y: 0 },  // Verdant Reach (meadow)
  { x: 2, y: 0 },  // Sylvaren (forest)
  { x: -1, y: 1 }, // generated; theme comes from the seed
  { x: 1, y: -2 }, // generated
] as const;

const SAMPLE_MS = 4_000;
const SETTLE_MS = 1_500;
const TILE = 16;

interface FrameSample {
  rafP50: number; rafP95: number; rafMax: number; fps: number;
  workP50: number | null; workP95: number | null; workMax: number | null;
  drawCalls: number; triangles: number; models: number;
}

interface AreaResult {
  key: string; name: string; theme: string;
  rebuildMs: number | null; transitionMs: number | null;
  overheadMid: FrameSample; firstPersonMid: FrameSample; overheadCorner: FrameSample;
}

async function travel(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(async ({ x, y }) => {
    const areas = await import('/src/simulation/areas.ts' as string);
    const scene = (globalThis as any).__game.scene.getScene('world');
    if (scene.state.currentArea.x === x && scene.state.currentArea.y === y) {
      // Leave and come back so every area is measured through the same path.
      areas.enterWorldArea(scene.state, x + (x < 3 ? 1 : -1), y);
      scene.snapRenderPoseToState();
      scene.beginAreaTransition();
      await new Promise<void>((resolve) => {
        const poll = (): void => { if (!scene.transitioningArea) resolve(); else setTimeout(poll, 50); };
        poll();
      });
    }
    areas.enterWorldArea(scene.state, x, y);
    scene.snapRenderPoseToState();
    scene.beginAreaTransition();
  }, { x, y });
  await page.waitForFunction(() => {
    const g = globalThis as any;
    const scene = g.__game.scene.getScene('world');
    return !scene.transitioningArea && g.__renderer3d.areaKey === scene.state.currentArea.key;
  }, undefined, { timeout: 30_000 });
}

async function placePlayer(page: Page, tileX: number, tileY: number): Promise<void> {
  await page.evaluate(({ px, py }) => {
    const scene = (globalThis as any).__game.scene.getScene('world');
    scene.state.player.x = px;
    scene.state.player.y = py;
    scene.snapRenderPoseToState();
  }, { px: tileX * TILE + TILE / 2, py: tileY * TILE + TILE / 2 });
}

async function setFirstPerson(page: Page, on: boolean): Promise<void> {
  await page.evaluate(async (on) => {
    const { firstPersonView } = await import('/src/three/firstPersonView.ts' as string);
    firstPersonView.setRequested(on ? 'first-person' : 'overhead');
  }, on);
}

async function sample(page: Page): Promise<FrameSample> {
  await page.waitForTimeout(SETTLE_MS);
  return page.evaluate(async (sampleMs) => {
    const renderer = (globalThis as any).__renderer3d;
    // Fresh window so the stats cover only this scenario.
    renderer.frameWorkTimes = new renderer.frameWorkTimes.constructor(2_000);
    const deltas: number[] = [];
    await new Promise<void>((resolve) => {
      let last = performance.now();
      const end = last + sampleMs;
      const step = (time: number): void => {
        deltas.push(time - last);
        last = time;
        if (time < end) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    deltas.shift();
    const sorted = [...deltas].sort((a, b) => a - b);
    const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    const snapshot = renderer.getSnapshot();
    return {
      rafP50: pick(0.5), rafP95: pick(0.95), rafMax: sorted[sorted.length - 1]!, fps: 1000 / mean,
      workP50: snapshot.frameWork.p50Ms, workP95: snapshot.frameWork.p95Ms, workMax: snapshot.frameWork.maxMs,
      drawCalls: snapshot.drawCalls, triangles: snapshot.triangles, models: snapshot.visibleModels,
    };
  }, SAMPLE_MS);
}

test('area load and frame-time baseline', async ({ page }, testInfo) => {
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  await setFirstPerson(page, false);

  const results: AreaResult[] = [];
  for (const area of AREAS) {
    await travel(page, area.x, area.y);
    const loaded = await page.evaluate(() => {
      const g = globalThis as any;
      const scene = g.__game.scene.getScene('world');
      return {
        key: scene.state.currentArea.key as string,
        name: scene.state.currentArea.name as string,
        theme: scene.state.currentArea.theme as string,
        rebuildMs: g.__renderer3d.getSnapshot().areaRebuild.latestMs as number | null,
        transitionMs: scene.getPerformanceSnapshot().areaTransitions.latestMs as number | null,
      };
    });
    await placePlayer(page, 80, 80);
    const overheadMid = await sample(page);
    await setFirstPerson(page, true);
    const firstPersonMid = await sample(page);
    await setFirstPerson(page, false);
    await placePlayer(page, 3, 3);
    const overheadCorner = await sample(page);
    results.push({ ...loaded, overheadMid, firstPersonMid, overheadCorner });
  }

  const outDir = path.join(process.cwd(), 'tmp', 'perf');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `area-baseline-${testInfo.project.name}.json`), JSON.stringify(results, null, 2));

  const ms = (value: number | null): string => (value == null ? '—' : value.toFixed(1));
  const row = (r: AreaResult): string => [
    `${r.name} (${r.theme})`,
    ms(r.rebuildMs), ms(r.transitionMs),
    `${ms(r.overheadMid.workP50)} / ${ms(r.overheadMid.workP95)}`,
    `${ms(r.firstPersonMid.workP50)} / ${ms(r.firstPersonMid.workP95)}`,
    `${ms(r.overheadCorner.workP50)} / ${ms(r.overheadCorner.workP95)}`,
    `${r.overheadMid.fps.toFixed(0)} / ${r.firstPersonMid.fps.toFixed(0)}`,
    `${r.overheadMid.drawCalls} / ${r.firstPersonMid.drawCalls}`,
    `${Math.round(r.overheadMid.triangles / 1000)}k / ${Math.round(r.firstPersonMid.triangles / 1000)}k`,
  ].join(' | ');
  console.log(`\n### ${testInfo.project.name}\n`);
  console.log('| Area | 3D rebuild ms | Transition ms | Overhead mid work p50/p95 | FP mid work p50/p95 | Overhead corner work p50/p95 | FPS overhead/FP | Draws overhead/FP | Tris overhead/FP |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const result of results) console.log(`| ${row(result)} |`);
});
