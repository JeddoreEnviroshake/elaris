import {expect,test} from '@playwright/test';
import type * as THREE from 'three';
import {creatureDefinition} from '../../src/content/creatures';
import type {GameState,OwnedCreatureState} from '../../src/simulation/state';
import type {CreatureRig,PlayerRig} from '../../src/three/characterRigs';
import {mountSeatOffset,RIDER_HIP_HEIGHT} from '../../src/three/characterRigs';
import {openApp,waitForDebugHandles} from './app';

type Debug={
  __game:{scene:{getScene(key:string):{state:GameState;snapRenderPoseToState():void}}};
  __renderer3d:{mountRig:CreatureRig|null;playerRig:PlayerRig;actorRoot:THREE.Group;creatureRigs:Map<string,CreatureRig>};
};

test('the new ranger fits both live mounts and returns to the standing pose',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await openApp(page,'render=3d');await waitForDebugHandles(page);
  for(const speciesId of ['glade-stag','bulwark-boar'] as const) {
    const creature:OwnedCreatureState={id:'model-mount',speciesId,name:'Model check',role:'follow',assignment:null,
      worksiteId:null,nextWorkTick:0,bondXp:0,selectedBattleAbilityId:creatureDefinition(speciesId).encounter.battleAbilities[0]!.id};
    await page.evaluate(creature=>{(globalThis as unknown as Debug).__game.scene.getScene('world').state.ownedCreatures=[creature];},creature);
    await expect.poll(()=>page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.mountRig?.speciesId),{timeout:15_000}).toBe(speciesId);
    await expect.poll(()=>page.evaluate(()=>Math.max((globalThis as unknown as Debug).__renderer3d.playerRig.joints.leftLeg.rotation.x,
      (globalThis as unknown as Debug).__renderer3d.playerRig.joints.rightLeg.rotation.x)),{timeout:15_000}).toBeLessThan(-.3);
    const pose=await page.evaluate(()=>{
      const r=(globalThis as unknown as Debug).__renderer3d;
      return {height:r.actorRoot.position.y,left:r.playerRig.joints.leftLeg.rotation.x,right:r.playerRig.joints.rightLeg.rotation.x,
        saddle:!!r.mountRig?.root.getObjectByName('saddle.woven-blanket-and-leather'),style:r.playerRig.root.userData.visualStyle};
    });
    expect(pose.height).toBeCloseTo(mountSeatOffset(speciesId).y-RIDER_HIP_HEIGHT);
    expect(pose.left).toBeLessThan(-.3);expect(pose.right).toBeLessThan(-.3);
    expect(pose.saddle).toBe(true);expect(pose.style).toBe('woodland-sculpt');
  }
  await page.evaluate(()=>{(globalThis as unknown as Debug).__game.scene.getScene('world').state.ownedCreatures=[];});
  await expect.poll(()=>page.evaluate(()=>{
    const r=(globalThis as unknown as Debug).__renderer3d;return {mounted:r.mountRig!==null,height:r.actorRoot.position.y};
  })).toEqual({mounted:false,height:0});
  expect(errors).toEqual([]);
});

test('the taller stag keeps its level label clear of the antlers',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await openApp(page,'render=3d');await waitForDebugHandles(page);
  const id=await page.evaluate(()=>{
    const s=(globalThis as unknown as Debug).__game.scene.getScene('world');
    const id='model-stag-label';
    s.state.wildCreatures.push({...s.state.wildCreatures[0]!,id,speciesId:'glade-stag'});
    return id;
  });
  await expect.poll(()=>page.evaluate(id=>(globalThis as unknown as Debug).__renderer3d.creatureRigs.get(id)?.speciesId,id),{timeout:15_000}).toBe('glade-stag');
  const placement=await page.evaluate(id=>{
    const rig=(globalThis as unknown as Debug).__renderer3d.creatureRigs.get(id)!;
    const plate=rig.root.children.find(part=>(part as THREE.Sprite).isSprite);
    return {height:Number(rig.root.userData.modelHeight),label:plate?.position.y??0};
  },id);
  expect(placement.height).toBeGreaterThan(2.5);expect(placement.label).toBeGreaterThan(placement.height+.15);
  expect(errors).toEqual([]);
});
