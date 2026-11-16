import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import type { GameState } from '../../src/simulation/state';
import { openApp, waitForDebugHandles } from './app';

type Debug = {
  __game: { scene: { getScene(key: string): { state: GameState; snapRenderPoseToState(): void } } };
  __renderer3d: {
    scene: THREE.Scene; worldRoot: THREE.Group; entityRoot: THREE.Group;
    resourceGrounding: { root: THREE.Group }; woodlandSky: { mesh: THREE.Mesh };
    firstPersonCamera: THREE.PerspectiveCamera; firstPersonFrame: boolean;
    townGateOpenness: Map<string, number>;
    townGatePivots: Map<string, { pivot: THREE.Object3D; oppositePivot: THREE.Object3D; cx: number; cz: number }>;
    doorPivots: Map<string, { pivot: THREE.Object3D; oppositePivot?: THREE.Object3D; cx: number; cz: number }>;
    followerRigs: Map<string, { root: THREE.Group }>;
  };
};

test('first-person polish keeps ground contact and hides oversized labels across view changes', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Shader Error|VALIDATE_STATUS|\[3d\] Unable/.test(message.text())) errors.push(message.text()); });
  await page.setViewportSize({ width: 1280, height: 760 });
  await openApp(page); await waitForDebugHandles(page);
  await expect.poll(() => page.evaluate(() => {
    const renderer = (globalThis as unknown as Debug).__renderer3d;
    return !!renderer.worldRoot.getObjectByName('building.roof-underside')
      && renderer.resourceGrounding.root.children.length === 3;
  })).toBe(true);
  await page.getByRole('button', { name: 'First person', exact: true }).click();
  await expect(page.locator('[data-first-person-crosshair]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const renderer = (globalThis as unknown as Debug).__renderer3d;
    const labels: THREE.Object3D[] = [];
    renderer.scene.traverse(child => { if (child.userData.worldLabel) labels.push(child); });
    return renderer.woodlandSky.mesh.visible && labels.length > 0 && labels.every(label => !label.visible);
  })).toBe(true);
  // A rebuilt target plate must inherit first person too, not only existing labels.
  await page.evaluate(async () => {
    const debug = globalThis as unknown as Debug;
    const scene = debug.__game.scene.getScene('world');
    const path = '/src/simulation/worldGeneration.ts';
    const { starterGroveAnchor } = await import(path);
    Object.assign(scene.state.player, starterGroveAnchor(scene.state.seed));
    scene.state.wildCreatures = [];
    scene.snapRenderPoseToState();
    const lookPath = '/src/three/firstPersonView.ts';
    const { firstPersonView } = await import(lookPath);
    firstPersonView.look.yawDegrees = 0; firstPersonView.look.pitchDegrees = -12;
  });
  await expect.poll(() => page.evaluate(() => {
    const renderer = (globalThis as unknown as Debug).__renderer3d;
    const tree = renderer.entityRoot.children.find(child => child.userData.resourceKind === 'tree' && child.children.some(model => model.userData.modelAssetInstance));
    const rock = renderer.entityRoot.children.find(child => child.userData.resourceKind === 'stone' && child.children.some(model => model.userData.modelAssetInstance));
    const treeModel = tree?.children.find(child => child.userData.modelAssetInstance);
    const rockModel = rock?.children.find(child => child.userData.modelAssetInstance);
    return !!treeModel && !!rockModel && treeModel.position.y < -.08 && rockModel.position.y < -.08 && tree!.rotation.z === 0;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('first-person-ground-and-sky.png') });
  await page.evaluate(async () => {
    const debug = globalThis as unknown as Debug;
    const forge = debug.__renderer3d.worldRoot.getObjectByName('town.weaponsmith')!;
    const scene = debug.__game.scene.getScene('world');
    scene.state.player.x = Math.round(forge.position.x * 16);
    scene.state.player.y = Math.round((forge.position.z + 2.6) * 16);
    scene.snapRenderPoseToState();
    const path = '/src/three/firstPersonView.ts';
    const { firstPersonView } = await import(path);
    firstPersonView.look.yawDegrees = 0; firstPersonView.look.pitchDegrees = 48;
  });
  await expect.poll(() => page.evaluate(() =>
    (globalThis as unknown as Debug).__renderer3d.firstPersonCamera.rotation.x)).toBeCloseTo(48 * Math.PI / 180);
  await page.screenshot({ path: testInfo.outputPath('first-person-roof-underside.png') });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: testInfo.outputPath('first-person-phone-landscape.png') });
  await page.getByRole('button', { name: 'First person', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const renderer = (globalThis as unknown as Debug).__renderer3d;
    return !renderer.woodlandSky.mesh.visible && !renderer.firstPersonFrame;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('overhead-restored.png') });
  expect(errors).toEqual([]);
});

test('double gates fill two blocks and swing both panels apart', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/\[3d\] Unable/.test(message.text())) errors.push(message.text()); });
  await openApp(page); await waitForDebugHandles(page);
  await page.evaluate(() => {
    const scene = (globalThis as unknown as Debug).__game.scene.getScene('world');
    scene.state.player.x = 90 * 16; scene.state.player.y = 85 * 16;
    scene.state.buildings.push(
      { id: 'double-gate-north', definitionId: 'wood-gate', tileX: 80, tileY: 80, boundaryEdge: 'north' },
      { id: 'double-gate-east', definitionId: 'metal-gate', tileX: 80, tileY: 76, boundaryEdge: 'east' },
      { id: 'double-gate-south', definitionId: 'stone-gate', tileX: 80, tileY: 72, boundaryEdge: 'south' },
      { id: 'double-gate-west', definitionId: 'thatch-gate', tileX: 80, tileY: 68, boundaryEdge: 'west' },
    );
    scene.snapRenderPoseToState();
  });
  await expect.poll(() => page.evaluate(async () => {
    const renderer = (globalThis as unknown as Debug).__renderer3d;
    const path = '/node_modules/three/build/three.module.js';
    const { Box3, Vector3 } = await import(path);
    const gates = [...renderer.townGatePivots.values(), ...[...renderer.doorPivots]
      .filter(([id]) => id.startsWith('double-gate-')).map(([, opening]) => opening)];
    if (gates.length !== 7) return false;
    return gates.every(({ pivot, oppositePivot }) => {
      if (!oppositePivot || pivot.rotation.y !== 0 || oppositePivot.rotation.y !== 0) return false;
      const meshes: THREE.Mesh[] = [];
      pivot.parent!.traverse(child => { if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh); });
      if (meshes.length !== 2 || meshes.some(mesh => mesh.name !== 'gate')) return false;
      const size = new Box3().setFromObject(pivot.parent!).getSize(new Vector3());
      return Math.abs(Math.max(size.x, size.z) - 2) < .001
        && Math.abs(pivot.position.x + 1) < .001 && Math.abs(oppositePivot.position.x - 1) < .001;
    });
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('double-gates-closed.png') });

  // Exercise both the municipal and placed-gate animation paths.
  for (const kind of ['town', 'placed'] as const) {
    const center = await page.evaluate(kind => {
      const renderer = (globalThis as unknown as Debug).__renderer3d;
      const opening = kind === 'town'
        ? [...renderer.townGatePivots.values()].find(opening => opening.cz === 70)!
        : renderer.doorPivots.get('double-gate-north')!;
      const scene = (globalThis as unknown as Debug).__game.scene.getScene('world');
      scene.state.player.x = opening.cx * 16; scene.state.player.y = (opening.cz + 1) * 16;
      scene.snapRenderPoseToState();
      return { x: opening.cx, z: opening.cz };
    }, kind);
    await expect.poll(() => page.evaluate(center => {
      const renderer = (globalThis as unknown as Debug).__renderer3d;
      const opening = [...renderer.townGatePivots.values(), ...renderer.doorPivots.values()]
        .find(opening => opening.cx === center.x && opening.cz === center.z)!;
      return [opening.pivot.rotation.y, opening.oppositePivot?.rotation.y];
    }, center)).toEqual([-Math.PI / 2, Math.PI / 2]);
    const clearance = await page.evaluate(async center => {
      const renderer = (globalThis as unknown as Debug).__renderer3d;
      const opening = [...renderer.townGatePivots.values(), ...renderer.doorPivots.values()]
        .find(opening => opening.cx === center.x && opening.cz === center.z)!;
      const path = '/node_modules/three/build/three.module.js';
      const { Box3 } = await import(path);
      const left = new Box3().setFromObject(opening.pivot);
      const right = new Box3().setFromObject(opening.oppositePivot!);
      return {
        gap: right.min.x - left.max.x,
        sameSide: left.min.z >= center.z - .001 && right.min.z >= center.z - .001
          && left.max.z > center.z + .99 && right.max.z > center.z + .99,
      };
    }, center);
    expect(clearance.gap).toBeGreaterThan(1.9);
    expect(clearance.sameSide).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`double-gates-${kind}-open.png`) });
    await page.evaluate(() => {
      const scene = (globalThis as unknown as Debug).__game.scene.getScene('world');
      scene.state.player.x = 90 * 16; scene.state.player.y = 85 * 16;
      scene.snapRenderPoseToState();
    });
    await expect.poll(() => page.evaluate(center => {
      const renderer = (globalThis as unknown as Debug).__renderer3d;
      const opening = [...renderer.townGatePivots.values(), ...renderer.doorPivots.values()]
        .find(opening => opening.cx === center.x && opening.cz === center.z)!;
      return Math.abs(opening.pivot.rotation.y) + Math.abs(opening.oppositePivot!.rotation.y);
    }, center)).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('first-person polish opens gates ahead and gives companions space behind the player', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openApp(page); await waitForDebugHandles(page);
  await page.evaluate(async () => {
    const scene = (globalThis as unknown as Debug).__game.scene.getScene('world');
    const path = '/src/simulation/onboarding.ts';
    const { beginOpeningTrust, offerOpeningTuftle, throwOpeningSnare } = await import(path);
    scene.state.player.x = 82 * 16; scene.state.player.y = 82 * 16;
    beginOpeningTrust(scene.state);
    offerOpeningTuftle(scene.state); throwOpeningSnare(scene.state);
    scene.state.player.x = 104.5 * 16; scene.state.player.y = 73.5 * 16;
    scene.state.player.facing = 'up'; scene.state.wildCreatures = [];
    scene.snapRenderPoseToState();
  });
  await page.getByRole('button', { name: 'First person', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const renderer = (globalThis as unknown as Debug).__renderer3d;
    const gate = [...renderer.townGatePivots].find(([, point]) => point.cz === 70);
    return gate ? renderer.townGateOpenness.get(gate[0]) : null;
  })).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const debug = globalThis as unknown as Debug;
    const state = debug.__game.scene.getScene('world').state;
    return [...debug.__renderer3d.followerRigs.values()].map(({ root }) =>
      Math.hypot(root.position.x - state.player.x / 16, root.position.z - state.player.y / 16));
  })).toEqual([expect.any(Number)]);
  const distance = await page.evaluate(() => {
    const debug = globalThis as unknown as Debug, state = debug.__game.scene.getScene('world').state;
    const root = [...debug.__renderer3d.followerRigs.values()][0]!.root;
    return Math.hypot(root.position.x - state.player.x / 16, root.position.z - state.player.y / 16);
  });
  expect(distance).toBeGreaterThan(3);
  await page.screenshot({ path: testInfo.outputPath('gate-opens-ahead.png') });
  for (const [y, expected] of [[74.5, 1], [76, 0]] as const) {
    await page.evaluate(y => {
      const scene = (globalThis as unknown as Debug).__game.scene.getScene('world');
      scene.state.player.y = y * 16; scene.snapRenderPoseToState();
    }, y);
    await expect.poll(() => page.evaluate(() => {
      const renderer = (globalThis as unknown as Debug).__renderer3d;
      const gate = [...renderer.townGatePivots].find(([, point]) => point.cz === 70)!;
      return renderer.townGateOpenness.get(gate[0]);
    })).toBe(expected);
  }
  expect(errors).toEqual([]);
});
