import { expect, test, type Page } from '@playwright/test';
import { openApp, waitForDebugHandles } from './app';

/**
 * The Arcane Storm end to end, in the running app.
 *
 * The storm is the one danger event a browser test can drive honestly: it needs
 * no base, no wave, and no ten-minute wait — only the clock moved to a storm
 * cycle. It runs on the dev server because forcing the clock needs `__game`,
 * which the production build strips. The dodge maths, rewards, and reload
 * behaviour are proved in tests/unit/arcaneStorm.test.ts; what this covers is
 * the wiring — HUD, both renderers, and the sanctuary — being fed by the same
 * authoritative records.
 */

const TICKS_PER_SECOND = 60;
const SAFE_PHASE_SECONDS = 600;
const DANGER_PHASE_SECONDS = 60;
const CYCLE_TICKS = (SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * TICKS_PER_SECOND;
/** Cycle 4 is the first storm; its danger phase starts here. */
const STORM_START_TICK = CYCLE_TICKS * 4 + SAFE_PHASE_SECONDS * TICKS_PER_SECOND;

interface QaWorldScene {
  state: {
    tick: number;
    onboarding: { firstThreat: { mode: 'guided' | 'ordinary' } | null };
    player: { x: number; y: number; hp: number; maxHp: number };
    currentArea: { key: string };
    arcaneStorm: {
      cycleIndex: number | null;
      nextStrikeIndex: number;
      strikes: Array<{
        id: string;
        areaKey: string;
        x: number;
        y: number;
        impactAtTick: number;
        rewardIronOre: number;
        resolvedAtTick: number | null;
      }>;
    };
  };
}

/** Read the live storm state out of the running scene. */
async function stormState(page: Page): Promise<{
  strikes: number;
  nextStrikeIndex: number;
  hp: number;
  maxHp: number;
}> {
  return page.evaluate(() => {
    const scene = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => QaWorldScene } };
    }).__game.scene.getScene('world');
    return {
      strikes: scene.state.arcaneStorm.strikes.length,
      nextStrikeIndex: scene.state.arcaneStorm.nextStrikeIndex,
      hp: scene.state.player.hp,
      maxHp: scene.state.player.maxHp,
    };
  });
}

interface StormNightOptions {
  tileX?: number;
  tileY?: number;
  /**
   * Ticks relative to the start of the storm's danger phase. Negative lands in
   * the safe phase before it; the 3D specs start later because a browser
   * running two renderers advances the clock at a fraction of real time.
   */
  offsetTicks?: number;
}

/** Move the clock to a storm night and stand the player somewhere. */
async function enterStormNight(page: Page, options: StormNightOptions = {}): Promise<void> {
  const { tileX = 30, tileY = 30, offsetTicks = -2 * 60 } = options;
  await page.evaluate(({ tick, x, y }) => {
    const scene = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => QaWorldScene } };
    }).__game.scene.getScene('world');
    // This fixture exercises the continuing threat rotation, beyond the guided opening.
    if (scene.state.onboarding.firstThreat) scene.state.onboarding.firstThreat.mode = 'ordinary';
    scene.state.tick = tick;
    scene.state.player.x = x * 16 + 8;
    scene.state.player.y = y * 16 + 8;
  }, { tick: STORM_START_TICK + offsetTicks, x: tileX, y: tileY });
}

const timerBadge = (page: Page) => page.locator('[data-survival-timer]');
const impactBadge = (page: Page) => page.locator('[data-danger-grace-timer]');

test('the HUD predicts an Arcane Storm and counts its impacts down', async ({ page }) => {
  await openApp(page);
  await waitForDebugHandles(page);
  await enterStormNight(page);

  await expect(timerBadge(page)).toHaveText(/ARCANE STORM IN/);
  // The storm brings no wave: nothing about it should read as a raid.
  await expect(timerBadge(page)).not.toHaveText(/NIGHT RAID|POISON FOG/);

  await expect
    .poll(async () => (await stormState(page)).strikes, {
      message: 'the storm never scheduled a strike',
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  await expect(timerBadge(page)).toHaveText(/^ARCANE STORM {2}0:\d\d$/);
  await expect(impactBadge(page)).toHaveText(/IMPACT {2}0:0\d/);
  await expect(impactBadge(page)).toHaveAttribute('aria-label', /Arcane impact in \d seconds/);
});

test('walking out of the ring costs no health, and standing in one does', async ({ page }) => {
  await openApp(page);
  await waitForDebugHandles(page);
  await enterStormNight(page);

  // Dodge: step five tiles clear the moment the first marker appears.
  const dodged = await page.evaluate(async () => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => QaWorldScene } };
    }).__game;
    const scene = game.scene.getScene('world');
    const waitForStrike = async (): Promise<QaWorldScene['state']['arcaneStorm']['strikes'][number]> => {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const pending = scene.state.arcaneStorm.strikes.find((strike) => strike.resolvedAtTick === null);
        if (pending) return pending;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('no strike appeared');
    };

    const strike = await waitForStrike();
    const before = scene.state.player.hp;
    scene.state.player.x = strike.x + 5 * 16;
    while (strike.resolvedAtTick === null) await new Promise((resolve) => setTimeout(resolve, 50));
    return { before, after: scene.state.player.hp };
  }) as { before: number; after: number };
  expect(dodged.after).toBe(dodged.before);

  // Stay: sit on the next marker's centre and take exactly one hit.
  const caught = await page.evaluate(async () => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => QaWorldScene } };
    }).__game;
    const scene = game.scene.getScene('world');
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const pending = scene.state.arcaneStorm.strikes.find((strike) => strike.resolvedAtTick === null);
      if (pending) {
        const before = scene.state.player.hp;
        scene.state.player.x = pending.x;
        scene.state.player.y = pending.y;
        while (pending.resolvedAtTick === null) await new Promise((resolve) => setTimeout(resolve, 50));
        return { before, after: scene.state.player.hp };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('no strike appeared');
  }) as { before: number; after: number };
  expect(caught.after).toBe(caught.before - 35);
});

test('the 3D renderer rigs the same markers the simulation scheduled', async ({ page }) => {
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  // Four seconds into the storm: the first telegraph is one second away, which
  // matters because a browser driving both renderers ticks well below realtime.
  await enterStormNight(page, { offsetTicks: 4 * 60 });

  await expect
    .poll(async () => page.evaluate(() => (
      globalThis as unknown as { __renderer3d: { getSnapshot: () => { stormMarkers: number } } }
    ).__renderer3d.getSnapshot().stormMarkers), { message: 'no marker was rigged in 3D', timeout: 30_000 })
    .toBeGreaterThan(0);

  const [rigged, scheduled] = await Promise.all([
    page.evaluate(() => (
      globalThis as unknown as { __renderer3d: { getSnapshot: () => { stormMarkers: number } } }
    ).__renderer3d.getSnapshot().stormMarkers),
    stormState(page).then((storm) => storm.strikes),
  ]);
  expect(rigged).toBe(scheduled);
});

test('the Elaris sanctuary is never given a marker to dodge', async ({ page }) => {
  await openApp(page);
  await waitForDebugHandles(page);
  // The permanent sanctuary tile: protected ground, in the protected town.
  await enterStormNight(page, { tileX: 70, tileY: 90 });

  await expect(timerBadge(page)).toHaveText(/ARCANE STORM/);
  await expect
    .poll(async () => (await stormState(page)).nextStrikeIndex, {
      message: 'the storm never spent a strike slot',
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  // Slots are spent, no marker is placed, and no health is lost.
  const inside = await stormState(page);
  expect(inside.strikes).toBe(0);
  expect(inside.hp).toBe(inside.maxHp);
  await expect(timerBadge(page)).toHaveText(/UNDER COVER/);
});
