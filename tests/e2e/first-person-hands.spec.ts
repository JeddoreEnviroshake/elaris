import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import type { FirstPersonHands } from '../../src/three/firstPersonHands';
import type { GameState } from '../../src/simulation/state';
import { openApp, waitForDebugHandles } from './app';

type Debug = {
  __game: { scene: { getScene(key: string): {
    state: GameState; stickyTarget: unknown; snapRenderPoseToState(): void;
    buildResourceNodes(): void; syncWildCreatures(): void;
    performContextAction(): void; performCreatureAttack(id: string): void;
  } } };
  __renderer3d: { firstPersonHands: FirstPersonHands; firstPersonCamera: THREE.PerspectiveCamera };
};

test('first-person hands animate real gathering and combat without moving the camera', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Shader Error|VALIDATE_STATUS/.test(message.text())) errors.push(message.text()); });
  await openApp(page); await waitForDebugHandles(page);
  await page.getByRole('button', { name: 'First person', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/src/three/firstPersonView.ts';
    const { firstPersonView } = await import(path);
    firstPersonView.look.yawDegrees = 0; firstPersonView.look.pitchDegrees = 0;
    const scene = (globalThis as unknown as Debug).__game.scene.getScene('world');
    const grovePath = '/src/simulation/worldGeneration.ts';
    const { starterGroveAnchor } = await import(grovePath);
    Object.assign(scene.state.player, starterGroveAnchor(scene.state.seed));
    const onboardingPath = '/src/content/onboarding.ts';
    const { createOpeningChapter } = await import(onboardingPath);
    scene.state.onboarding = createOpeningChapter(scene.state.seed, true);
    scene.snapRenderPoseToState();
  });
  const creatureTemplate = await page.evaluate(() => (globalThis as unknown as Debug).__game.scene.getScene('world').state.wildCreatures[0]!);
  expect(creatureTemplate).toBeDefined();
  for (const [toolId, resource, expectedMotion] of [
    ['iron-axe', 'tree', 'gather'], ['iron-pick', 'stone', 'gather'], ['iron-sickle', 'plant', 'gather'],
    ['iron-sword', null, 'melee'], ['bow', null, 'ranged'], ['magic-staff', null, 'magic'],
  ] as const) {
    await page.evaluate(({ toolId, resource, creatureTemplate }) => {
      const scene = (globalThis as unknown as Debug).__game.scene.getScene('world'), state = scene.state;
      state.buildings = []; state.raiders = []; state.ownedCreatures = []; state.containers = [];
      state.tools = [{ instanceId: 'first-person-held', definitionId: toolId, durability: 200, maxDurability: 200, powerRank: 0, speedRank: 0, durabilityRank: 0 }];
      state.equippedToolId = 'first-person-held'; state.inventory.arrow = 100;
      state.inventoryStacks.arrow = [100];
      state.player.stamina = state.player.maxStamina; state.player.mana = state.player.maxMana;
      state.player.hp = state.player.maxHp; state.actionCooldownUntilTick = 0;
      scene.stickyTarget = null;
      state.resourceNodes = resource ? [{ id: 'hand-resource', kind: resource, x: state.player.x, y: state.player.y - 16, hp: 100, maxHp: 100, respawnAtTick: null }] : [];
      state.wildCreatures = resource ? [] : [{
        ...creatureTemplate,
        id: 'hand-enemy', speciesId: 'craghopper', x: state.player.x, y: state.player.y - 16,
        homeX: state.player.x, homeY: state.player.y - 16, hp: 500, maxHp: 500,
        nextAttackTick: 999999, aggroUntilTick: 0,
      }];
      scene.buildResourceNodes(); scene.syncWildCreatures();
    }, { toolId, resource, creatureTemplate });
    const tool = toolId === 'magic-staff' ? 'staff' : toolId === 'bow' ? 'bow' : toolId.slice(5);
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as Debug).__renderer3d.firstPersonHands.root.userData.tool)).toBe(tool);
    await page.screenshot({ path: testInfo.outputPath(`${tool}-ready.png`) });
    const samples = await page.evaluate(async resource => {
      const debug = globalThis as unknown as Debug, scene = debug.__game.scene.getScene('world');
      const hands = debug.__renderer3d.firstPersonHands, camera = debug.__renderer3d.firstPersonCamera;
      const cameraBefore = [...camera.position.toArray(), ...camera.quaternion.toArray(), camera.fov];
      const hp = resource ? scene.state.resourceNodes[0]!.hp : scene.state.wildCreatures[0]!.hp;
      if (resource) scene.performContextAction(); else scene.performCreatureAttack('hand-enemy');
      const damage = hp - (resource ? scene.state.resourceNodes[0]!.hp : scene.state.wildCreatures[0]!.hp);
      const frames: Array<{ motion: unknown; pose: number[]; camera: number[] }> = [];
      const start = performance.now();
      return new Promise<{ damage: number; frames: typeof frames; cameraBefore: number[] }>(resolve => {
        const sample = (): void => {
          frames.push({ motion: hands.root.userData.motion, pose: [...hands.right.root.position.toArray(), ...hands.right.root.quaternion.toArray()],
            camera: [...camera.position.toArray(), ...camera.quaternion.toArray(), camera.fov] });
          if (performance.now() - start > 750) resolve({ damage, frames, cameraBefore });
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    }, resource);
    expect(samples.damage).toBeGreaterThan(0);
    expect(samples.frames.some(frame => frame.motion === expectedMotion)).toBe(true);
    expect(new Set(samples.frames.map(frame => JSON.stringify(frame.pose))).size).toBeGreaterThan(2);
    expect(samples.frames.every(frame => JSON.stringify(frame.camera) === JSON.stringify(samples.cameraBefore))).toBe(true);
  }
  await page.getByRole('button', { name: 'First person', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as Debug).__renderer3d.firstPersonHands.root.visible)).toBe(false);
  expect(errors).toEqual([]);
});

test('first-person hands remain steady and readable in portrait and landscape', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page); await waitForDebugHandles(page);
  await page.evaluate(() => {
    const scene = (globalThis as unknown as Debug).__game.scene.getScene('world');
    scene.state.tools = [{ instanceId: 'phone-sword', definitionId: 'iron-sword', durability: 230, maxDurability: 230, powerRank: 0, speedRank: 0, durabilityRank: 0 }];
    scene.state.equippedToolId = 'phone-sword';
  });
  await page.getByRole('button', { name: 'First person', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as Debug).__renderer3d.firstPersonHands.root.visible)).toBe(true);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const wrists = await page.evaluate(() => {
      const hands = (globalThis as unknown as Debug).__renderer3d.firstPersonHands;
      hands.scene.updateMatrixWorld(true);
      return [hands.left.root, hands.right.root].map(hand => hand.getWorldPosition(hand.position.clone()).project(hands.camera).toArray());
    });
    for (const [x, y] of wrists) {
      expect(Math.abs(x!)).toBeLessThan(.95);
      expect(y!).toBeGreaterThan(-1);
      expect(y!).toBeLessThan(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`hands-${viewport.width}x${viewport.height}.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const frames = await page.evaluate(async () => {
    const renderer = (globalThis as unknown as Debug).__renderer3d, result: number[][] = [];
    const started = performance.now();
    return new Promise<number[][]>(resolve => {
      const sample = (): void => {
        result.push([...renderer.firstPersonHands.right.root.position.toArray(), ...renderer.firstPersonHands.right.root.quaternion.toArray(), renderer.firstPersonCamera.position.y, renderer.firstPersonCamera.fov]);
        if (performance.now() - started > 450) resolve(result); else requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
  });
  expect(new Set(frames.map(frame => JSON.stringify(frame))).size).toBe(1);
  expect(errors).toEqual([]);
});

test('Mine Stone hits the rock in the crosshair instead of a closer rock behind the player', async ({ page }) => {
  await openApp(page); await waitForDebugHandles(page);
  await page.evaluate(async () => {
    const scene = (globalThis as unknown as Debug).__game.scene.getScene('world'), state = scene.state;
    const path = '/src/simulation/worldGeneration.ts';
    const { starterGroveAnchor } = await import(path);
    Object.assign(state.player, starterGroveAnchor(state.seed));
    state.buildings = []; state.raiders = []; state.wildCreatures = []; state.containers = [];
    state.resourceNodes = [
      { id: 'rock-ahead', kind: 'stone', x: state.player.x, y: state.player.y - 24, hp: 1000, maxHp: 1000, respawnAtTick: null },
      { id: 'rock-behind', kind: 'stone', x: state.player.x, y: state.player.y + 12, hp: 100, maxHp: 100, respawnAtTick: null },
    ];
    state.tools = [{ instanceId: 'mining-pick', definitionId: 'iron-pick', durability: 240, maxDurability: 240, powerRank: 0, speedRank: 0, durabilityRank: 0 }];
    state.equippedToolId = 'mining-pick'; state.player.stamina = state.player.maxStamina;
    scene.stickyTarget = null;
    scene.buildResourceNodes(); scene.syncWildCreatures(); scene.snapRenderPoseToState();
  });
  await page.getByRole('button', { name: 'First person', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/src/three/firstPersonView.ts';
    const { firstPersonView } = await import(path);
    firstPersonView.look.yawDegrees = 0;
  });
  await expect(page.locator('[data-first-person-target]')).toHaveText('Stone');
  await page.getByRole('button', { name: 'Mine Stone', exact: true }).click();
  const hp = await page.evaluate(() => (globalThis as unknown as Debug).__game.scene.getScene('world').state.resourceNodes.map(node => [node.id, node.hp]));
  const hitHp = Number(hp.find(([id]) => id === 'rock-ahead')![1]);
  expect(hitHp).toBeLessThan(1000);
  expect(hp.find(([id]) => id === 'rock-behind')![1]).toBe(100);
  const button = page.getByRole('button', { name: 'Mine Stone', exact: true });
  await button.hover(); await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  const heldHp = await page.evaluate(() => (globalThis as unknown as Debug).__game.scene.getScene('world').state.resourceNodes.map(node => node.hp));
  expect(heldHp[0]).toBeLessThan(hitHp);
  expect(heldHp[1]).toBe(100);
  await page.evaluate(() => {
    const state = (globalThis as unknown as Debug).__game.scene.getScene('world').state;
    state.equippedToolId = null;
    state.actionCooldownUntilTick = state.tick;
  });
  await button.click();
  await expect(page.getByRole('status').filter({ hasText: 'Stone needs a pick' })).toHaveText('Stone needs a pick');
});
