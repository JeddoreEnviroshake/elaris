import { test, expect } from '@playwright/test';
import type * as THREE from 'three';
import { openApp, waitForDebugHandles } from './app';
import type { GameState } from '../../src/simulation/state';

type Debug = {
  __game:{scene:{getScene(key:string):{state:GameState;snapRenderPoseToState():void;performEncounterStart():void}}};
  __renderer3d:{worldRoot:THREE.Group;entityRoot:THREE.Group;interiorStage:{root:THREE.Group};battleStage:{root:THREE.Group};
    setCameraOrientation(orientation:{yawDegrees:number;pitchDegrees:number}):void;
    getSnapshot():{drawCalls:number;triangles:number;interiorActive:boolean;battleActive:boolean}};
};

test('the remaining town buildings share the textured style', async ({page})=>{
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:900});
  await openApp(page,'render=3d'); await waitForDebugHandles(page);
  await expect.poll(()=>page.evaluate(()=>{
    const root=(globalThis as unknown as Debug).__renderer3d.worldRoot;
    return ['church','market','tavern','armoury'].every(id=>root.getObjectByName(`town.${id}`)?.userData.quaterniusReady);
  }),{timeout:15_000}).toBe(true);
  await page.evaluate(()=>{
    const debug=globalThis as unknown as Debug, scene=debug.__game.scene.getScene('world');
    scene.state.player.x=81*16;scene.state.player.y=85*16;scene.snapRenderPoseToState();
    debug.__renderer3d.setCameraOrientation({yawDegrees:-15,pitchDegrees:52});
  });
  await page.waitForTimeout(2200);
  const snapshot=await page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.getSnapshot());
  expect(snapshot.drawCalls).toBeLessThan(950);
  expect(snapshot.triangles).toBeLessThan(650_000);
  await page.screenshot({path:'tmp/world-style-town.png'});
  expect(errors).toEqual([]);
});

test('outposts and streamed regional vegetation reuse the same models',async({page})=>{
  test.setTimeout(90_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(/\[3d\] Unable|Shader Error/.test(message.text()))errors.push(message.text());});
  await openApp(page,'render=3d');await waitForDebugHandles(page);
  for(const site of [{x:1,y:0,building:'farm'},{x:2,y:0,building:'magic-shop'},{x:-1,y:3,building:'church'}]) {
    await page.evaluate(async(site)=>{
      const url='/src/simulation/areas.ts';
      const {enterWorldArea}=await import(url);
      const scene=(globalThis as unknown as Debug).__game.scene.getScene('world');
      enterWorldArea(scene.state,site.x,site.y);
      scene.state.player.x=79*16;scene.state.player.y=83*16;scene.snapRenderPoseToState();
    },site);
    await expect.poll(()=>page.evaluate(id=>(globalThis as unknown as Debug).__renderer3d.worldRoot
      .getObjectByName(`town.${id}`)?.userData.quaterniusReady===true,site.building),{timeout:15_000}).toBe(true);
    const cells=await page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.worldRoot.getObjectByName('regional-vegetation')?.children.length??0);
    expect(cells).toBeGreaterThan(0);expect(cells).toBeLessThanOrEqual(9);
    await page.waitForTimeout(900);
    const previewStyle='[data-quest-celebration] { visibility: hidden !important; }';
    if(site.building==='farm')await page.screenshot({path:'tmp/world-style-farm.png',style:previewStyle});
    if(site.building==='magic-shop')await page.screenshot({path:'tmp/world-style-arcanum.png',style:previewStyle});
    await page.evaluate(()=>{
      const scene=(globalThis as unknown as Debug).__game.scene.getScene('world');
      scene.state.player.x=110*16;scene.state.player.y=110*16;scene.snapRenderPoseToState();
    });
    await expect.poll(()=>page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.worldRoot
      .getObjectByName('regional-vegetation')?.getObjectByName('vegetation:9,9')!==undefined)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('interior stonework and timber load while room interaction remains available',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(/\[3d\] Unable|Shader Error/.test(message.text()))errors.push(message.text());});
  await page.setViewportSize({width:1280,height:900});
  await openApp(page,'render=3d');await waitForDebugHandles(page);
  await page.evaluate(()=>{
    const scene=(globalThis as unknown as Debug).__game.scene.getScene('world');
    scene.state.player.x=90.5*16;scene.state.player.y=85.5*16;scene.snapRenderPoseToState();
  });
  await page.getByRole('button',{name:'Enter Tavern',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>{
    const root=(globalThis as unknown as Debug).__renderer3d.interiorStage.root;
    const floor=root.getObjectByName('room-floor:elaris-tavern') as THREE.Mesh|undefined;
    return !!floor&&(floor.material as THREE.MeshStandardMaterial).map!==null
      && !!root.getObjectByName('batch.entrance.wall-window');
  })).toBe(true);
  await expect(page.getByRole('button',{name:'Leave the Tavern'})).toBeVisible();
  await page.screenshot({path:'tmp/world-style-tavern-interior.png'});
  await page.getByRole('button',{name:'Leave the Tavern'}).click();
  await expect.poll(()=>page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.getSnapshot().interiorActive)).toBe(false);
  expect(errors).toEqual([]);
});

test('battle scenery frames the combatants without changing the combat controls',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await openApp(page,'render=3d');await waitForDebugHandles(page);
  await page.evaluate(()=>{
    const scene=(globalThis as unknown as Debug).__game.scene.getScene('world');
    const wild=scene.state.wildCreatures[0]!;scene.state.player.x=wild.x;scene.state.player.y=wild.y;
    scene.performEncounterStart();
  });
  const dialog=page.getByRole('dialog',{name:'Wild creature encounter'});
  await expect(dialog).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>{
    const root=(globalThis as unknown as Debug).__renderer3d.battleStage.root;
    return !!root.getObjectByName('batch.entrance.fern')&&!!root.getObjectByName('expressive-eyes');
  })).toBe(true);
  await page.screenshot({path:'tmp/world-style-battle.png'});
  await dialog.getByRole('button',{name:'Move forward'}).click();
  expect(errors).toEqual([]);
});
