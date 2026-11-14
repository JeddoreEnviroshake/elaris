import {expect,test} from '@playwright/test';
import type {GameState,OwnedCreatureState} from '../../src/simulation/state';
import type {PlayerRig,CreatureRig} from '../../src/three/characterRigs';
import {openApp,waitForDebugHandles} from './app';

type Debug={__game:{scene:{getScene(key:string):{state:GameState;scene:{pause():void};snapRenderPoseToState():void;performContextAction():void}}};
  __renderer3d:{playerRig:PlayerRig;mountRig:CreatureRig|null;creatureRigs:Map<string,CreatureRig>}};

test('locomotion bends the ranger knees while moving and settles when released',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await openApp(page,'render=3d');await waitForDebugHandles(page);
  await page.evaluate(()=>{const s=(globalThis as unknown as Debug).__game.scene.getScene('world');s.state.player.x=66*16;s.state.player.y=83*16;s.snapRenderPoseToState();});
  await page.keyboard.down('d');
  try{
    await expect.poll(()=>page.evaluate(()=>{
      const d=globalThis as unknown as Debug,r=d.__renderer3d.playerRig;
      return d.__game.scene.getScene('world').state.player.x>66*16+2
        &&['walk','run'].includes(r.root.userData.animationMotion as string)
        &&Math.max(r.joints.leftKnee.rotation.x,r.joints.rightKnee.rotation.x)>.1;
    }),{timeout:15_000}).toBe(true);
  }finally{await page.keyboard.up('d');}
  await expect.poll(()=>page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.playerRig.root.userData.animationMotion),{timeout:15_000}).toBe('idle');
  expect(errors).toEqual([]);
});

test('a moving wild creature keeps its model and follows simulation positions',async({page})=>{
  await openApp(page,'render=3d');await waitForDebugHandles(page);
  await page.evaluate(()=>{
    const s=(globalThis as unknown as Debug).__game.scene.getScene('world'),template=s.state.wildCreatures[0]!;
    s.state.wildCreatures.push({...template,id:'animation-wander',speciesId:'tuftle',x:66*16,y:84*16,homeX:66*16,homeY:84*16});
    // Isolate renderer reconciliation from the animal's own wander controller.
    s.scene.pause();
  });
  await expect.poll(()=>page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.creatureRigs.has('animation-wander'))).toBe(true);
  const uuid=await page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.creatureRigs.get('animation-wander')!.root.uuid);
  const ticker=await page.evaluate(()=>window.setInterval(()=>{
    const wild=(globalThis as unknown as Debug).__game.scene.getScene('world').state.wildCreatures.find(c=>c.id==='animation-wander')!;
    wild.x++;wild.homeX=wild.x;
  },50));
  try{
    await expect.poll(()=>page.evaluate(()=>{
      const rig=(globalThis as unknown as Debug).__renderer3d.creatureRigs.get('animation-wander')!;
      return rig.root.position.x>66.4&&['walk','run'].includes(rig.root.userData.animationMotion as string);
    }),{timeout:15_000}).toBe(true);
  }finally{await page.evaluate(id=>clearInterval(id),ticker);}
  expect(await page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.creatureRigs.get('animation-wander')!.root.uuid)).toBe(uuid);
});

test('gathering from a mount keeps the seated legs and animates the upper body',async({page})=>{
  await openApp(page,'render=3d');await waitForDebugHandles(page);
  const owned:OwnedCreatureState={id:'animation-stag',speciesId:'glade-stag',name:'Fern',role:'follow',assignment:null,
    worksiteId:null,nextWorkTick:0,bondXp:0,selectedBattleAbilityId:'glade-stag-forward'};
  await page.evaluate(owned=>{
    const s=(globalThis as unknown as Debug).__game.scene.getScene('world');
    s.state.ownedCreatures=[owned];s.state.wildCreatures=[];
    const node=s.state.resourceNodes.find(n=>n.kind==='tree'&&n.hp>0)!;
    s.state.player.x=node.x+14;s.state.player.y=node.y;s.snapRenderPoseToState();
  },owned);
  await expect.poll(()=>page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.mountRig?.speciesId)).toBe('glade-stag');
  await page.evaluate(()=>(globalThis as unknown as Debug).__game.scene.getScene('world').performContextAction());
  await expect.poll(()=>page.evaluate(()=>{
    const r=(globalThis as unknown as Debug).__renderer3d;
    return r.playerRig.root.userData.animationMotion==='gather'&&r.mountRig?.speciesId==='glade-stag'
      &&Math.abs(r.playerRig.joints.leftLeg.rotation.x+.8)<.05;
  }),{timeout:15_000}).toBe(true);
});
