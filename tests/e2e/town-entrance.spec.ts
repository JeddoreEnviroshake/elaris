import { expect, test } from '@playwright/test';
import { openApp, waitForDebugHandles } from './app';
import type { GameState } from '../../src/simulation/state';
import type * as THREE from 'three';

type Debug = {
  __game: { scene: { getScene(key: string): { state: GameState; snapRenderPoseToState(): void } } };
  __renderer3d: {
    worldRoot: THREE.Group; entityRoot: THREE.Group; creatureRigs: Map<string, unknown>;
    setCameraOrientation(orientation: {yawDegrees:number; pitchDegrees:number}): void;
    getSnapshot(): { drawCalls: number; triangles: number };
  };
};

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
    expect(snapshot.drawCalls).toBeLessThan(750);
    expect(snapshot.triangles).toBeLessThan(600_000);
    await page.screenshot({path:`tmp/entrance-final-${viewport.width}.png`});
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
