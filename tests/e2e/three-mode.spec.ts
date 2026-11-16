import { releaseSaveWriter } from './save';
import { expect, test } from '@playwright/test';
import { openApp, waitForDebugHandles } from './app';
import { openAdmin, openBuildPalette, grantBlueprints } from './menu';
import { createInitialState } from '../../src/simulation/state';
import { beginOpeningTrust, actOpeningTrust } from '../../src/simulation/onboarding';
import { findShelterSite } from '../../src/simulation/openingShelter';
import { createOpeningChapter } from '../../src/content/onboarding';
import { isResourceClearOfRoad } from '../../src/content/roads';
import { terrainWithoutBridgesAt } from '../../src/simulation/landscape';
import type { GameState } from '../../src/simulation/state';
import { storageBoxContents } from '../../src/simulation/storageBox';

test('3D roads stay clear and bridges cover the road only over water after a save upgrade', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, 'render=3d'); await waitForDebugHandles(page);
  const state = createInitialState(42); state.player.x = 57.5 * 16; state.player.y = 85.5 * 16; state.inventory.wood = 17;
  state.resourceNodes.push(
    { id: 'old-road-tree', kind: 'tree', x: 57.5 * 16, y: 85.5 * 16, hp: 10, maxHp: 10, respawnAtTick: null },
    { id: 'old-road-rock', kind: 'stone', x: 52.5 * 16, y: 84.5 * 16, hp: 10, maxHp: 10, respawnAtTick: null },
  );
  state.buildings.push({ id: 'player-road-box', definitionId: 'field-cache', tileX: 30, tileY: 85, storage: { ...state.inventory, wood: 12, fiber: 0, stone: 0 } });
  storageBoxContents(state.buildings[state.buildings.length - 1]!);
  await releaseSaveWriter(page);
  await page.evaluate(async (fixture) => {
    const globals = globalThis as unknown as { __controller: { prepareCriticalSave: () => void }; __game: { scene: { getScene: (key: string) => { state: GameState } } } };
    Object.assign(globals.__game.scene.getScene('world').state, fixture);
    globals.__controller.prepareCriticalSave();
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('elaris:default', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite'); const store = tx.objectStore('snapshots');
      store.put({ meta: { saveVersion: 88, contentVersion: 66, worldGenVersion: 12, appVersion: 'test', savedAt: Date.now() }, state: fixture }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    });
  }, state);
  await page.reload(); await waitForDebugHandles(page);
  const result = await page.evaluate(() => {
    type Matrix = { elements: number[]; clone: () => Matrix };
    type Mesh = { count: number; getMatrixAt: (index: number, matrix: Matrix) => void };
    const globals = globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => { state: GameState } } };
      __renderer3d: { worldRoot: { getObjectByName: (name: string) => Mesh | undefined }; camera: { matrixWorld: Matrix } };
    };
    const renderer = globals.__renderer3d; const matrix = renderer.camera.matrixWorld.clone();
    const tiles = (name: string) => { const mesh = renderer.worldRoot.getObjectByName(name); return Array.from({ length: mesh?.count ?? 0 }, (_, index) => { mesh!.getMatrixAt(index, matrix); return `${Math.floor(matrix.elements[12]!)},${Math.floor(matrix.elements[14]!)}`; }); };
    return { state: globals.__game.scene.getScene('world').state, bridges: tiles('landscape.bridge'), roads: tiles('landscape.road'), scenicBridge: !!renderer.worldRoot.getObjectByName('landmark.stream-bridge') };
  });
  expect(result.scenicBridge).toBe(false); expect(result.roads.length).toBeGreaterThan(500); expect(result.bridges.length).toBeGreaterThan(0);
  expect(result.state.resourceNodes.every((node) => isResourceClearOfRoad('0,0', node))).toBe(true);
  expect(result.state.resourceNodes.some((node) => node.id === 'old-road-tree' || node.id === 'old-road-rock')).toBe(false);
  expect(result.state.inventory.wood).toBe(17); expect(result.state.buildings.find((building) => building.id === 'player-road-box')!.storage!.wood).toBe(12);
  for (const key of result.bridges) { const [x, y] = key.split(',').map(Number); expect(['shallow-water', 'deep-water']).toContain(terrainWithoutBridgesAt(42, result.state.currentArea, x!, y!)); }
  for (let y = 83; y <= 86; y++) for (let x = 0; x < 160; x++) {
    const base = terrainWithoutBridgesAt(42, result.state.currentArea, x, y);
    expect(base === 'shallow-water' || base === 'deep-water' ? result.bridges : result.roads).toContain(`${x},${y}`);
  }
  await expect(page.locator('#elaris-three-canvas')).toBeVisible();
  await page.screenshot({ path: `tmp/roads-clean-${testInfo.project.name}.png` }); expect(errors).toEqual([]);
});

test('legacy 2D preferences still load the 3D-only game without hidden world sprites', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('elaris.presentation-mode','2d'));
  await openApp(page, 'render=2d');
  await waitForDebugHandles(page);
  await expect(page.locator('#elaris-three-canvas')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-presentation','3d');
  await expect(page.locator('#game canvas')).toBeHidden();
  expect(await page.evaluate(() => {
    const game = (globalThis as any).__game;
    return { objects:game.scene.getScene('world').children.list.length, renderer:game.renderer };
  })).toEqual({objects:0,renderer:null});
  await openAdmin(page);
  await expect(page.getByTestId('presentation-mode-toggle')).toHaveCount(0);
});

test('3D world draws an owned Tuftle follower and removes it when resting', async ({ page }) => {
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  const fixture = createInitialState(42);
  fixture.player.x = 82 * 16; fixture.player.y = 82 * 16;
  beginOpeningTrust(fixture);
  for (let index = 0; index < 4; index++) actOpeningTrust(fixture, 'steady');
  await page.evaluate((creature) => {
    const game = (globalThis as unknown as { __game: { scene: { getScene: (key: string) => { state: { ownedCreatures: unknown[] } } } } }).__game;
    game.scene.getScene('world').state.ownedCreatures.push(creature);
  }, fixture.ownedCreatures[0]!);
  const count = () => page.evaluate(() => (globalThis as unknown as { __renderer3d: { getSnapshot: () => { followerRigs: number } } }).__renderer3d.getSnapshot().followerRigs);
  await expect.poll(count).toBe(1);
  await page.evaluate(() => {
    const game = (globalThis as unknown as { __game: { scene: { getScene: (key: string) => { state: { ownedCreatures: Array<{ role: string }> } } } } }).__game;
    game.scene.getScene('world').state.ownedCreatures[0]!.role = 'rest';
  });
  await expect.poll(count).toBe(0);
});

test('3D pointer input previews and builds floor areas and wall lines', async ({ page }) => {
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  const fixture = createInitialState(42);
  fixture.resourceNodes = []; fixture.wildCreatures = [];
  fixture.onboarding = createOpeningChapter(42, true);
  fixture.inventory.fiber = 100;
  const site = findShelterSite(fixture)!;
  fixture.player.x = (site.tileX + 1.5) * 16; fixture.player.y = (site.tileY + 3) * 16;
  await page.evaluate((state) => {
    const scene = (globalThis as unknown as { __game: { scene: { getScene: (key: string) => { state: unknown; snapRenderPoseToState: () => void } } } }).__game.scene.getScene('world');
    Object.assign(scene.state as object, state);
    scene.snapRenderPoseToState();
  }, fixture);
  const aim = async (x: number, y: number) => {
    const point = await page.evaluate(({ x, y }) => {
      type Vector = { set: (x: number, y: number, z: number) => Vector; project: (camera: unknown) => { x: number; y: number } };
      const camera = (globalThis as unknown as { __renderer3d: { camera: { position: { clone: () => Vector } } } }).__renderer3d.camera;
      const projected = camera.position.clone().set(x, 0, y).project(camera);
      const bounds = document.querySelector('#elaris-three-canvas')!.getBoundingClientRect();
      return { x: bounds.left + (projected.x + 1) * bounds.width / 2, y: bounds.top + (1 - projected.y) * bounds.height / 2 };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
  };
  const palette = await openBuildPalette(page);
  await palette.getByRole('button', { name: /Thatch Floor/ }).click();
  await page.getByLabel('Placement shape', { exact: true }).selectOption('area');
  await aim(site.tileX + .5, site.tileY + .5);
  await page.getByRole('button', { name: 'Set start', exact: true }).click();
  await aim(site.tileX + 3.5, site.tileY + 1.5);
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __renderer3d: { getSnapshot: () => { batchPreviewParts: number } } }).__renderer3d.getSnapshot().batchPreviewParts)).toBe(8);
  await page.getByRole('button', { name: 'Build 8', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __game: { scene: { getScene: (key: string) => { state: { buildings: unknown[] } } } } }).__game.scene.getScene('world').state.buildings.length)).toBe(8);
  const walls = await openBuildPalette(page);
  await walls.getByRole('button', { name: /Thatch Wall/ }).click();
  await page.getByLabel('Placement shape', { exact: true }).selectOption('line');
  await aim(site.tileX + .5, site.tileY + .01);
  await page.getByRole('button', { name: 'Set start', exact: true }).click();
  await aim(site.tileX + 3.5, site.tileY + .01);
  await page.getByRole('button', { name: 'Build 4', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __game: { scene: { getScene: (key: string) => { state: { buildings: unknown[] } } } } }).__game.scene.getScene('world').state.buildings.length)).toBe(12);
});

test('Admin stages the camera tilt as a global value and previews it live', async ({ page }) => {
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  const orientation = () => page.evaluate(() => (
    globalThis as unknown as { __renderer3d: { getCameraOrientation: () => { yawDegrees: number; pitchDegrees: number } } }
  ).__renderer3d.getCameraOrientation());
  const publishedCamera = () => page.evaluate(() => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => { state: { gameBalance: { camera: { yawTenths: number; pitchTenths: number } } } } } };
    }).__game;
    return game.scene.getScene('world').state.gameBalance.camera;
  });

  // The angle is published balance now, so it is edited on the Global Values
  // tab rather than as a per-device preference above the tabs.
  await openAdmin(page);
  await page.getByRole('tab', { name: 'Global Values' }).click();
  const yaw = page.getByTestId('admin-camera-yaw');
  const pitch = page.getByTestId('admin-camera-pitch');
  await expect(yaw).toHaveValue('20');
  await expect(pitch).toHaveValue('47');
  expect(await publishedCamera()).toEqual({ yawTenths: 200, pitchTenths: 474 });

  // Flattening the side angle is the whole point: it takes the lean out of
  // walking left and right. Dragging previews it without publishing it.
  await yaw.fill('0');
  await pitch.fill('70');
  expect(await orientation()).toMatchObject({ yawDegrees: 0, pitchDegrees: 70 });
  expect(await publishedCamera()).toEqual({ yawTenths: 200, pitchTenths: 474 });

  // Dragging still clears the menu out of the way so the tilt is judged against
  // the running world — now by hiding the rest of the Global Values list.
  const startingValues = page.getByText('Character starting values');
  await expect(startingValues).toBeVisible();
  await yaw.hover();
  await page.mouse.down();
  await expect(startingValues).toBeHidden();
  await expect(pitch).toBeVisible();
  await page.mouse.up();
  await expect(startingValues).toBeVisible();

  // Closing without publishing drops the preview back onto the published angle.
  await page.getByRole('dialog', { name: 'Admin stat editor' }).getByRole('button', { name: 'Close', exact: true }).click();
  expect(await orientation()).toMatchObject({ yawDegrees: 20 });
});

test('3D presentation mirrors the authoritative build-placement ghost', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  await page.evaluate(() => {
    const game = (globalThis as unknown as { __game: { scene: { getScene: (key: string) => { state: { inventory: { fiber: number } } } } } }).__game;
    game.scene.getScene('world').state.inventory.fiber = 20;
  });

  await page.getByRole('button', { name: 'Menu' }).click();
  // The palette lists owned blueprints only, so buy it on Blueprints first.
  await grantBlueprints(page, 'thatch-floor');
  const palette = await openBuildPalette(page);
  await palette.getByRole('button', { name: /Thatch Floor/ }).click();

  await expect.poll(() => page.evaluate(() => {
    const renderer = (globalThis as unknown as {
      __renderer3d: { getSnapshot: () => {
        placementActive: boolean; placementValid: boolean | null; placementTileX: number | null; placementTileY: number | null;
      } };
    }).__renderer3d;
    return renderer.getSnapshot();
  })).toMatchObject({ placementActive: true, placementValid: true });

  const canvas = page.locator('#elaris-three-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Game canvas is not visible');
  await page.mouse.click(bounds.x + bounds.width * 0.12, bounds.y + bounds.height * 0.2);
  await expect.poll(() => page.evaluate(() => (
    globalThis as unknown as { __renderer3d: { getSnapshot: () => {
      placementValid: boolean | null; placementTileX: number | null; placementTileY: number | null;
    } } }
  ).__renderer3d.getSnapshot())).toMatchObject({ placementValid: false });

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(() => page.evaluate(() => (
    globalThis as unknown as { __renderer3d: { getSnapshot: () => { placementActive: boolean } } }
  ).__renderer3d.getSnapshot().placementActive)).toBe(false);
});

test('3D presentation opens and animates the deterministic battle arena', async ({ page }) => {
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  await page.evaluate(() => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => {
        state: { player: { x: number; y: number }; wildCreatures: Array<{ x: number; y: number }> };
        performEncounterStart: () => void;
      } } };
    }).__game;
    const scene = game.scene.getScene('world');
    const wild = scene.state.wildCreatures[0]!;
    scene.state.player.x = wild.x;
    scene.state.player.y = wild.y;
    scene.performEncounterStart();
  });

  const encounter = page.getByRole('dialog', { name: 'Wild creature encounter' });
  await expect(encounter).toBeVisible();
  await expect(encounter).toHaveCSS('background-image', 'none');
  await expect.poll(() => page.evaluate(() => (
    globalThis as unknown as { __renderer3d: { getSnapshot: () => { battleActive: boolean } } }
  ).__renderer3d.getSnapshot().battleActive)).toBe(true);

  // The button's accessible name is its aria-label, not its "Forward · N SP" text.
  await encounter.getByRole('button', { name: 'Move forward' }).click();
  await expect.poll(() => page.evaluate(() => (
    globalThis as unknown as { __renderer3d: { getSnapshot: () => { battleRoundAnimating: boolean } } }
  ).__renderer3d.getSnapshot().battleRoundAnimating)).toBe(true);
});

test('3D presentation enters the playable Weaponsmith forge explicitly', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  await page.evaluate(() => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => {
        state: {
          player: { x: number; y: number };
          inventory: { wood: number };
          tools: Array<{ instanceId: string; definitionId: 'wooden-axe'; durability: number; maxDurability: number; powerRank: number; speedRank: number; durabilityRank: number }>;
        };
        snapRenderPoseToState: () => void;
      } } };
    }).__game;
    const scene = game.scene.getScene('world');
    scene.state.player.x = 75.5 * 16;
    scene.state.player.y = 80.5 * 16;
    scene.state.inventory.wood = 10;
    scene.state.tools = [{
      instanceId: 'tool-forge-e2e', definitionId: 'wooden-axe', durability: 24, maxDurability: 48,
      powerRank: 0, speedRank: 0, durabilityRank: 0,
    }];
    scene.snapRenderPoseToState();
  });

  const enterWeaponsmith = page.getByRole('button', { name: 'Enter Weaponsmith' });
  await expect(enterWeaponsmith).toBeVisible();
  await enterWeaponsmith.click();
  await expect.poll(() => page.evaluate(() => (
    globalThis as unknown as { __renderer3d: { getSnapshot: () => { interiorActive: boolean; interiorId: string | null } } }
  ).__renderer3d.getSnapshot())).toMatchObject({ interiorActive: true, interiorId: 'weaponsmith-forge' });
  await expect(page.getByRole('button', { name: 'Leave the Weaponsmith' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => { getGameplayMode: () => { kind: string } } } };
    }).__game;
    return game.scene.getScene('world').getGameplayMode().kind;
  })).toBe('interior');

  await page.keyboard.down('d');
  try {
    await expect.poll(() => page.evaluate(() => {
      const game = (globalThis as unknown as {
        __game: { scene: { getScene: (key: string) => { get3DPresentationState: () => { interior: { pose: { x: number } } | null } } } };
      }).__game;
      return game.scene.getScene('world').get3DPresentationState().interior?.pose.x ?? 0;
    }), {timeout:15_000}).toBeGreaterThan(7.25);
  } finally {
    await page.keyboard.up('d');
  }
  await expect.poll(() => page.evaluate(() => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => { getGameplayMode: () => { kind: string } } } };
    }).__game;
    return game.scene.getScene('world').getGameplayMode().kind;
  })).toBe('interior');
  await page.keyboard.down('w');
  try {
    await expect.poll(() => page.evaluate(() => {
      const game = (globalThis as unknown as {
        __game: { scene: { getScene: (key: string) => { get3DPresentationState: () => { interior: { pose: { y: number } } | null } } } };
      }).__game;
      return game.scene.getScene('world').get3DPresentationState().interior?.pose.y ?? 99;
    }), {timeout:15_000}).toBeLessThan(5.9);
  } finally {
    await page.keyboard.up('w');
  }
  // Slow combined runs can let a held key travel past the interaction radius
  // between polling samples. Nudge back into Mara's authored service hotspot.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const pose = await page.evaluate(() => {
      const game = (globalThis as unknown as {
        __game: { scene: { getScene: (key: string) => { get3DPresentationState: () => { interior: { pose: { x: number; y: number } } | null } } } };
      }).__game;
      return game.scene.getScene('world').get3DPresentationState().interior!.pose;
    });
    const key = pose.x > 8 ? 'a' : pose.x < 7 ? 'd' : pose.y > 6 ? 'w' : pose.y < 5 ? 's' : null;
    if (!key) break;
    await page.keyboard.down(key);
    await page.waitForTimeout(100);
    await page.keyboard.up(key);
  }
  await expect(page.getByRole('button', { name: 'Talk to Mara' })).toBeVisible();
  await page.keyboard.press('e');
  const conversation = page.getByRole('dialog', { name: 'Conversation with Mara' });
  await expect(conversation).toBeVisible();
  await page.keyboard.press('Enter');
  await conversation.getByRole('button', { name: /What are you working on/ }).click();
  await expect(conversation).toHaveAttribute('data-node-id', 'work');
  await page.keyboard.press('Enter');
  await conversation.getByRole('button', { name: /Can you work on mine/ }).click();
  const service = page.getByRole('dialog', { name: 'Weaponsmith service' });
  await expect(service).toBeVisible();
  await service.getByRole('button', { name: 'Repair Wooden Axe' }).click();
  await expect(service.locator('[aria-live="polite"]')).toHaveText(/Repaired \d+ durability to full/);
  await expect.poll(() => page.evaluate(() => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => { state: { tools: Array<{instanceId: string; durability: number}> } } } };
    }).__game;
    return game.scene.getScene('world').state.tools.find((tool) => tool.instanceId === 'tool-forge-e2e')?.durability;
  })).toBe(48);
  await service.getByRole('button', { name: "Return to Mara's Forge" }).click();
  await expect(service).toBeHidden();

  const beforeTouchMove = await page.evaluate(() => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => { get3DPresentationState: () => { interior: { pose: { x: number; y: number } } | null } } } };
    }).__game;
    return game.scene.getScene('world').get3DPresentationState().interior!.pose;
  });
  await page.mouse.move(68, 650);
  await page.mouse.down();
  await page.mouse.move(112, 650, { steps: 6 });
  await page.waitForTimeout(450);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => { get3DPresentationState: () => { interior: { pose: { x: number; y: number } } | null } } } };
    }).__game;
    return game.scene.getScene('world').get3DPresentationState().interior!.pose.x;
  })).toBeGreaterThan(beforeTouchMove.x);
});

test('3D presentation opens every remaining Elaris interior as a playable room', async ({ page }) => {
  await openApp(page, 'render=3d');
  await waitForDebugHandles(page);
  const rooms = [
    { building: 'Church', interiorId: 'elaris-church', x: 64.5, y: 80.5, leave: 'Leave the Church' },
    { building: 'Armoury', interiorId: 'elaris-armoury', x: 94.5, y: 80.5, leave: 'Leave the Armoury' },
    { building: 'Market', interiorId: 'elaris-market', x: 79.5, y: 85.5, leave: 'Leave the Market' },
    { building: 'Tavern', interiorId: 'elaris-tavern', x: 90.5, y: 85.5, leave: 'Leave the Tavern' },
    { building: 'Arena', interiorId: 'elaris-arena', x: 72.5, y: 93.5, leave: 'Leave the Arena' },
  ] as const;

  for (const room of rooms) {
    await page.evaluate(({ x, y }) => {
      const game = (globalThis as unknown as {
        __game: { scene: { getScene: (key: string) => {
          state: { player: { x: number; y: number } };
          snapRenderPoseToState: () => void;
        } } };
      }).__game;
      const scene = game.scene.getScene('world');
      scene.state.player.x = x * 16;
      scene.state.player.y = y * 16;
      scene.snapRenderPoseToState();
    }, room);
    const enter = page.getByRole('button', { name: `Enter ${room.building}` });
    await expect(enter).toBeVisible();
    await enter.click();
    await expect.poll(() => page.evaluate(() => (
      globalThis as unknown as { __renderer3d: { getSnapshot: () => { interiorId: string | null } } }
    ).__renderer3d.getSnapshot().interiorId)).toBe(room.interiorId);
    const leave = page.getByRole('button', { name: room.leave });
    await expect(leave).toBeVisible();
    await leave.click();
    await expect.poll(() => page.evaluate(() => (
      globalThis as unknown as { __renderer3d: { getSnapshot: () => { interiorActive: boolean } } }
    ).__renderer3d.getSnapshot().interiorActive)).toBe(false);
  }
});
