import { expect, test } from '@playwright/test';
import { openApp, waitForDebugHandles } from './app';
import type { GameState } from '../../src/simulation/state';
import type * as THREE from 'three';

type Debug = {
  __game: { scene: { getScene(key: string): { state: GameState; snapRenderPoseToState(): void } } };
  __renderer3d: {
    worldRoot: THREE.Group; entityRoot: THREE.Group; creatureRigs: Map<string, unknown>;
    scene: THREE.Scene; firstPersonFrame: boolean;
    setCameraOrientation(orientation: {yawDegrees:number; pitchDegrees:number}): void;
    getSnapshot(): { drawCalls: number; triangles: number };
  };
};

test('Elaris streets and service entrances stay readable in both camera views', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/\[3d\] Unable|Shader Error/.test(message.text())) errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page); await waitForDebugHandles(page);
  const ids = ['weaponsmith', 'church', 'market', 'armoury', 'tavern', 'arena'];
  await expect.poll(() => page.evaluate(ids => {
    const root = (globalThis as unknown as Debug).__renderer3d.worldRoot;
    return ids.every(id => !!root.getObjectByName(`building-sign.${id}`)?.getObjectByName('building-sign.lettering')
      && !!root.getObjectByName(`entrance-props.${id}`)) && !!root.getObjectByName('batch.entrance.paving');
  }, ids)).toBe(true);
  const streets = await page.evaluate(() => {
    const renderer = (globalThis as unknown as Debug).__renderer3d;
    const batch = renderer.worldRoot.getObjectByName('batch.entrance.paving')!;
    const mesh = batch.children[0] as THREE.InstancedMesh;
    const matrix = mesh.matrix.clone(), cells: string[] = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      cells.push(`${Math.floor(matrix.elements[12]!)},${Math.floor(matrix.elements[14]!)}`);
    }
    return cells;
  });
  // All service approaches, the square and the north gate share the paving;
  // the west bridge and roads beyond the gates keep their own surfaces.
  for (const cell of ['64,81', '76,81', '82,84', '94,81', '79,85', '90,85', '73,92', '104,72']) expect(streets).toContain(cell);
  for (const cell of ['59,85', '50,85', '115,85', '104,66', '76,76']) expect(streets).not.toContain(cell);
  await page.evaluate(() => {
    const debug = globalThis as unknown as Debug;
    const scene = debug.__game.scene.getScene('world');
    scene.state.player.x = 82 * 16; scene.state.player.y = 84 * 16;
    scene.snapRenderPoseToState();
    debug.__renderer3d.setCameraOrientation({ yawDegrees: -15, pitchDegrees: 52 });
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('elaris-stone-streets-overhead.png') });
  // Compare the added art's render cost with the same loaded scene hidden.
  const artCost = await page.evaluate(async () => {
    const renderer = (globalThis as unknown as Debug).__renderer3d;
    const before = renderer.getSnapshot();
    const objects = renderer.worldRoot.children.flatMap(child => child.children.filter(part => part.name.startsWith('entrance-art.')));
    objects.push(renderer.worldRoot.getObjectByName('batch.entrance.paving')!);
    objects.forEach(object => object.visible = false);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const hidden = renderer.getSnapshot();
    objects.forEach(object => object.visible = true);
    return { addedDrawCalls: before.drawCalls - hidden.drawCalls };
  });
  expect(artCost.addedDrawCalls).toBeLessThan(85);
  await page.getByRole('button', { name: 'First person', exact: true }).click();
  for (const id of ids) {
    const info = await page.evaluate(async id => {
      const debug = globalThis as unknown as Debug;
      const scene = debug.__game.scene.getScene('world');
      const artPath = '/src/three/elarisTownArt.ts', buildingsPath = '/src/content/townBuildings.ts', lookPath = '/src/three/firstPersonView.ts';
      const { elarisEntranceFrame } = await import(artPath);
      const { townBuildingsInArea } = await import(buildingsPath);
      const { firstPersonView } = await import(lookPath);
      const building = townBuildingsInArea('0,0').find((building: { id: string }) => building.id === id)!;
      const frame = elarisEntranceFrame(building);
      const distance = id === 'arena' ? 5.5 : 4;
      scene.state.player.x = Math.round((building.footprint.tileX + building.footprint.tilesWide / 2 + frame.x + Math.sin(frame.rotation) * distance) * 16);
      scene.state.player.y = Math.round((building.footprint.tileY + building.footprint.tilesHigh / 2 + frame.z + Math.cos(frame.rotation) * distance) * 16);
      scene.snapRenderPoseToState();
      firstPersonView.look.yawDegrees = frame.rotation * 180 / Math.PI;
      firstPersonView.look.pitchDegrees = 4;
      const sign = debug.__renderer3d.worldRoot.getObjectByName(`building-sign.${id}`)!;
      const props = debug.__renderer3d.worldRoot.getObjectByName(`entrance-props.${id}`) as THREE.Mesh;
      const positions = props.geometry.getAttribute('position');
      const landscapePath = '/src/simulation/landscape.ts';
      const { terrainAt } = await import(landscapePath);
      let doorwayClear = true, grounded = true;
      for (let i = 0; i < positions.count; i++) {
        if (Math.abs(positions.getX(i)) < 1.05) doorwayClear = false;
        if (positions.getY(i) > .08) continue;
        const p = props.localToWorld(props.position.clone().fromBufferAttribute(positions, i));
        if (terrainAt(scene.state.seed, scene.state.currentArea, Math.floor(p.x), Math.floor(p.z)) !== 'ground') grounded = false;
      }
      return { name: sign.userData.buildingName, worldLabel: !!sign.userData.worldLabel, doorwayClear, grounded };
    }, id);
    expect(info.name).toBeTruthy(); expect(info.worldLabel).toBe(false); expect(info.doorwayClear).toBe(true); expect(info.grounded).toBe(true);
    await expect.poll(() => page.evaluate(id => {
      const renderer = (globalThis as unknown as Debug).__renderer3d;
      const sign = renderer.worldRoot.getObjectByName(`building-sign.${id}`)!;
      return renderer.firstPersonFrame && sign.visible && sign.parent!.visible && sign.parent!.parent!.visible;
    }, id)).toBe(true);
    await page.waitForTimeout(250);
    await page.screenshot({ path: testInfo.outputPath(`elaris-${id}-first-person.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('elaris-arena-mobile.png') });
  await page.getByRole('button', { name: 'First person', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as Debug).__renderer3d.firstPersonFrame)).toBe(false);
  expect(errors).toEqual([]);
});

for (const viewport of [{width:1440,height:900}, {width:390,height:844}]) {
  test(`Quaternius entrance loads without missing art at ${viewport.width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/\[3d\] Unable|THREE.*Error|Shader Error/.test(message.text())) errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400 && response.url().includes('/assets/3d/')) errors.push(response.url()); });
    await page.setViewportSize(viewport);
    await openApp(page,'render=3d');
    await waitForDebugHandles(page);
    await page.evaluate((mobile) => {
      const debug = globalThis as unknown as Debug;
      const scene = debug.__game.scene.getScene('world');
      scene.state.player.x = (mobile ? 73 : 66) * 16;
      scene.state.player.y = (mobile ? 82 : 83) * 16;
      scene.snapRenderPoseToState();
      debug.__renderer3d.setCameraOrientation({yawDegrees:-15,pitchDegrees:52});
    },viewport.width < 600);
    await expect.poll(() => page.evaluate(() => {
      const renderer = (globalThis as unknown as Debug).__renderer3d;
      return renderer.worldRoot.getObjectByName('town.weaponsmith')?.userData.entranceForgeReady === true
        && !!renderer.worldRoot.getObjectByName('batch.entrance.grass')
        && !!renderer.worldRoot.getObjectByName('batch.entrance.deck')
        && !!renderer.worldRoot.getObjectByName('batch.entrance.paving');
    })).toBe(true);
    await expect(page.locator('#elaris-three-canvas')).toBeVisible();
    await page.waitForTimeout(2800);
    const snapshot = await page.evaluate(() => (globalThis as unknown as Debug).__renderer3d.getSnapshot());
    await page.screenshot({path:`tmp/entrance-final-${viewport.width}.png`});
    expect(snapshot.drawCalls).toBeLessThan(750);
    expect(snapshot.triangles).toBeLessThan(600_000);
    expect(errors).toEqual([]);
  });
}

test('gathering retains unrelated models and replaces only the depleted resource', async ({ page }) => {
  await openApp(page,'render=3d'); await waitForDebugHandles(page);
  await page.waitForFunction(() => {
    const debug = globalThis as unknown as Debug;
    return debug.__renderer3d.worldRoot.getObjectByName('town.weaponsmith')?.userData.entranceForgeReady;
  });
  const before = await page.evaluate(() => {
    const debug = globalThis as unknown as Debug;
    const scene = debug.__game.scene.getScene('world');
    const nodes = scene.state.resourceNodes.filter(node => node.kind === 'tree' && node.hp > 1);
    const target = nodes[0]!, neighbor = nodes[1]!;
    const root = debug.__renderer3d.entityRoot;
    const creature = scene.state.wildCreatures[0]!;
    return {target:target.id,neighbor:neighbor.id,creature:creature.id,
      targetUuid:root.getObjectByName(target.id)!.uuid,neighborUuid:root.getObjectByName(neighbor.id)!.uuid,
      creatureUuid:root.getObjectByName(creature.id)!.uuid};
  });
  await page.evaluate(id => {
    (globalThis as unknown as Debug).__game.scene.getScene('world').state.resourceNodes.find(node=>node.id===id)!.hp--;
  },before.target);
  await page.waitForTimeout(550);
  let after = await page.evaluate(ids => {
    const root=(globalThis as unknown as Debug).__renderer3d.entityRoot;
    return [root.getObjectByName(ids.target)!.uuid,root.getObjectByName(ids.neighbor)!.uuid,root.getObjectByName(ids.creature)!.uuid];
  },before);
  expect(after).toEqual([before.targetUuid,before.neighborUuid,before.creatureUuid]);
  await page.evaluate(id=>{
    (globalThis as unknown as Debug).__game.scene.getScene('world').state.resourceNodes.find(node=>node.id===id)!.hp=0;
  },before.target);
  await expect.poll(()=>page.evaluate(id=>(globalThis as unknown as Debug).__renderer3d.entityRoot.getObjectByName(id)!.uuid,before.target)).not.toBe(before.targetUuid);
  after = await page.evaluate(ids=>{
    const root=(globalThis as unknown as Debug).__renderer3d.entityRoot;
    return [root.getObjectByName(ids.neighbor)!.uuid,root.getObjectByName(ids.creature)!.uuid];
  },before);
  expect(after).toEqual([before.neighborUuid,before.creatureUuid]);
});

test('leaving and returning to Elaris retires old scenery and creature rigs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror',error=>errors.push(error.message));
  await openApp(page,'render=3d'); await waitForDebugHandles(page);
  await page.waitForFunction(() => (globalThis as unknown as Debug).__renderer3d.worldRoot
    .getObjectByName('town.weaponsmith')?.userData.entranceForgeReady);
  const original = await page.evaluate(() => {
    const debug = globalThis as unknown as Debug;
    const state = debug.__game.scene.getScene('world').state;
    const original = { area: state.currentArea, nodes: state.resourceNodes, creatures: state.wildCreatures };
    state.currentArea = { ...state.currentArea, key: '1,0', x: 1, theme: 'meadow' };
    state.resourceNodes = []; state.wildCreatures = [];
    return original;
  });
  await expect.poll(() => page.evaluate(() => {
    const renderer = (globalThis as unknown as Debug).__renderer3d;
    return !renderer.worldRoot.getObjectByName('town-entrance') && renderer.creatureRigs.size === 0;
  })).toBe(true);
  await page.evaluate(original=>{
    const state=(globalThis as unknown as Debug).__game.scene.getScene('world').state;
    state.currentArea=original.area;state.resourceNodes=original.nodes;state.wildCreatures=original.creatures;
  },original);
  await expect.poll(() => page.evaluate(() => {
    const debug = globalThis as unknown as Debug;
    return !!debug.__renderer3d.worldRoot.getObjectByName('town.weaponsmith')?.userData.entranceForgeReady
      && debug.__renderer3d.creatureRigs.size === debug.__game.scene.getScene('world').state.wildCreatures.length;
  })).toBe(true);
  expect(errors).toEqual([]);
});
