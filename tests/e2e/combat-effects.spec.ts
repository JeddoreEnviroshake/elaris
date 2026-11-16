import {expect,test,type Page} from '@playwright/test';
import type {GameState} from '../../src/simulation/state';
import type {CombatEffects} from '../../src/three/combatEffects';
import {openApp,waitForDebugHandles} from './app';

type Debug={__game:{scene:{getScene(key:string):{state:GameState;performHotbarItem(item:'taming-snare'):void;lastAim:{x:number;y:number};
  performCreatureAttack(id:string):void;snapRenderPoseToState():void}}};
  __renderer3d:{combatEffects:CombatEffects;creatureRigs:Map<string,unknown>;getSnapshot():{combatEffectInstances:number}}};

async function seedFight(page:Page):Promise<void>{
  await openApp(page,'render=3d');await waitForDebugHandles(page);
  await page.evaluate(()=>{
    const scene=(globalThis as unknown as Debug).__game.scene.getScene('world'),s=scene.state;
    s.player.x=40*16;s.player.y=40*16;s.player.hp=s.player.maxHp;s.player.mana=s.player.maxMana;
    s.wildCreatures=[{...s.wildCreatures[0]!,id:'effects-enemy',speciesId:'craghopper',x:s.player.x+12,y:s.player.y,
      homeX:s.player.x+12,homeY:s.player.y,hp:500,maxHp:500,aggroUntilTick:0,nextAttackTick:999999}];
    s.buildings=[];s.resourceNodes=[];scene.snapRenderPoseToState();
  });
  await expect.poll(()=>page.evaluate(()=>(globalThis as unknown as Debug).__renderer3d.creatureRigs.has('effects-enemy'))).toBe(true);
}

for(const reduced of [false,true])test(`a snare throw arcs over and resolves on the creature ${reduced?'on a phone with reduced motion':'on desktop'}`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(/Shader Error|VALIDATE_STATUS/.test(m.text()))errors.push(m.text());});
  await page.setViewportSize(reduced?{width:390,height:844}:{width:1280,height:800});
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
  await seedFight(page);
  const samples=await page.evaluate(async()=>{
    const d=globalThis as unknown as Debug,scene=d.__game.scene.getScene('world');
    scene.state.inventory['taming-snare']=1;
    scene.lastAim={x:1,y:0};
    scene.performHotbarItem('taming-snare');
    const started=performance.now(),result:{age:number;instances:number}[]=[];
    return await new Promise<{frames:typeof result;snares:number}>(resolve=>{
      const sample=():void=>{
        const age=performance.now()-started;
        result.push({age,instances:d.__renderer3d.getSnapshot().combatEffectInstances});
        if(age>1800){resolve({frames:result,snares:scene.state.inventory['taming-snare']});return;}requestAnimationFrame(sample);
      };requestAnimationFrame(sample);
    });
  });
  expect(samples.snares).toBe(0);
  expect(samples.frames.some(f=>f.instances>0)).toBe(true);
  expect(samples.frames.at(-1)!.instances).toBe(0);
  await page.screenshot({path:`tmp/snare-throw-${reduced?'mobile-reduced':'desktop'}.png`});
  expect(errors).toEqual([]);
});

test('an overworld strike emits one trail and burst, then releases its instances',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await seedFight(page);
  await page.evaluate(()=>{
    const scene=(globalThis as unknown as Debug).__game.scene.getScene('world'),s=scene.state;
    s.tools=[{instanceId:'effects-sword',definitionId:'iron-sword',durability:230,maxDurability:230,powerRank:0,speedRank:0,durabilityRank:0}];
    s.equippedToolId='effects-sword';s.actionCooldownUntilTick=0;
  });
  const frames=await page.evaluate(async()=>{
    const d=globalThis as unknown as Debug,scene=d.__game.scene.getScene('world'),hp=scene.state.wildCreatures[0]!.hp;
    scene.performCreatureAttack('effects-enemy');
    if(scene.state.wildCreatures[0]!.hp>=hp)throw new Error('Fixture did not land a strike');
    const started=performance.now(),result:number[]=[];
    return await new Promise<number[]>(resolve=>{
      const sample=():void=>{result.push(d.__renderer3d.getSnapshot().combatEffectInstances);
        if(performance.now()-started>1000){resolve(result);return;}requestAnimationFrame(sample);};requestAnimationFrame(sample);
    });
  });
  expect(Math.max(...frames)).toBeGreaterThan(0);expect(frames.at(-1)).toBe(0);expect(errors).toEqual([]);
});
