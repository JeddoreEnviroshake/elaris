import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {CombatEffects,battleEffectCues,BATTLE_TIMING,type CombatEffectCue,type CombatEffectKind} from '../../src/three/combatEffects';
import type {BattleRoundPresentation,BattlePresentationSnapshot} from '../../src/three/battleState';
import {battleActorPositions,battleTrackToWorld} from '../../src/three/battleState';

const snapshot:BattlePresentationSnapshot={encounterId:'effects-test',speciesId:'craghopper',companionSpeciesId:null,magicStaffEquipped:true,
  round:1,playerHp:100,playerMaxHp:100,creatureHp:50,creatureMaxHp:50,playerPos:35,creaturePos:65,enemyIntent:'strike'};
const event=(result:BattleRoundPresentation['result'],action:BattleRoundPresentation['action']='magic'):BattleRoundPresentation=>({
  action,before:snapshot,resolved:{...snapshot,round:2},result,
});
const cue=(kind:CombatEffectKind,at=100):CombatEffectCue=>({kind,at,duration:1000,from:{x:-1,y:1,z:.3},to:{x:1,y:1,z:0},color:0x91ffe0});
const batch=(effects:CombatEffects,name:string):THREE.InstancedMesh=>effects.root.getObjectByName(name) as THREE.InstancedMesh;

describe('combat effect presentation',()=>{
  it('charges, releases and impacts on ordered shared beats without changing the round',()=>{
    const round=event({ok:true,message:'hit',playerStrike:{outcome:'crit',damage:24}}),before=JSON.stringify(round);
    const cues=battleEffectCues(round);
    expect(cues.map(c=>c.kind)).toEqual(['charge','bolt','impact']);
    expect(cues[1]!.at+cues[1]!.duration).toBeCloseTo(cues[2]!.at,0);
    expect(cues[2]).toMatchObject({critical:true,at:BATTLE_TIMING.impact*BATTLE_TIMING.duration});
    expect(JSON.stringify(round)).toBe(before);
  });
  it.each(['miss','dodge'] as const)('a %s travels past the creature without a hit burst',outcome=>{
    const cues=battleEffectCues(event({ok:true,message:outcome,playerStrike:{outcome,damage:0}}));
    expect(cues.some(c=>c.kind==='impact')).toBe(false);
    expect(cues.find(c=>c.kind==='bolt')!.to.z).toBeLessThan(-.2);
    expect(cues.at(-1)!.kind).toBe(outcome==='dodge'?'dodge':'fizzle');
  });
  it('schedules the enemy impact at the reply beat and preserves an evasion',()=>{
    const cues=battleEffectCues(event({ok:true,message:'evade',creatureStrike:{outcome:'dodge',damage:0,style:'magic'}},'rest'));
    expect(cues.at(-1)).toMatchObject({kind:'dodge',at:BATTLE_TIMING.reply*BATTLE_TIMING.duration});
    expect(cues.filter(c=>c.kind==='impact')).toHaveLength(0);
  });
  it('shows bonding only for successful captures',()=>{
    expect(battleEffectCues(event({ok:true,message:'bonded',ended:true,tamed:true},'snare')).map(c=>c.kind)).toEqual(['snare','capture']);
    expect(battleEffectCues(event({ok:true,message:'escaped',snareFailed:true},'snare')).map(c=>c.kind)).toEqual(['snare','fizzle']);
  });
  it('shows a shield for a fully absorbed reply rather than a damage impact',()=>{
    const cues=battleEffectCues(event({ok:true,message:'blocked',creatureStrike:{outcome:'hit',damage:0}},'forward'));
    expect(cues.at(-1)!.kind).toBe('guard');expect(cues.some(c=>c.kind==='impact')).toBe(false);
  });
  it('uses the companion ability timing and its actual effect instead of a generic attack',()=>{
    const round=event({ok:true,message:'guard',companionAbility:{abilityId:'tuftle-guard',displayName:'Shell Guard',message:'guard',guardedDamage:4}},'rest');
    const cues=battleEffectCues({...round,before:{...snapshot,companionSpeciesId:'tuftle'}});
    expect(cues.at(-1)).toMatchObject({kind:'guard',at:.58*BATTLE_TIMING.duration,to:{y:1.05,z:.35}});
    expect(cues.at(-1)!.to.x).toBeCloseTo(-1.2);
  });
  it('aims the player spell before the enemy advances and its reply after repositioning',()=>{
    const round=event({ok:true,message:'exchange',playerStrike:{outcome:'hit',damage:12},creatureMove:{from:65,to:55},creatureStrike:{outcome:'hit',damage:4,style:'magic'}});
    const resolved={...round,resolved:{...round.resolved,creaturePos:55}},cues=battleEffectCues(resolved);
    const bolts=cues.filter(c=>c.kind==='bolt');
    expect(bolts[0]!.to.x).toBeCloseTo(battleTrackToWorld(65));
    expect(bolts[1]!.from.x).toBeCloseTo(battleActorPositions(resolved,.63).creatureX);
    expect(bolts[0]!.reducedTo!.x).toBeCloseTo(battleTrackToWorld(55));
  });
  it('animates a player move followed by a companion carry without a starting teleport',()=>{
    const round=event({ok:true,message:'advance',playerMove:{from:35,to:45},companionAbility:{abilityId:'glade-stag-forward',displayName:'Carry Forward',message:'carry',playerMove:{from:45,to:53}}},'forward');
    expect(battleActorPositions(round,0).playerX).toBeCloseTo(battleTrackToWorld(35));
    expect(battleActorPositions(round,.35).playerX).toBeCloseTo(battleTrackToWorld(45));
    expect(battleActorPositions(round,.8).playerX).toBeCloseTo(battleTrackToWorld(53));
  });
  it.each([['mistmoth','bolt'],['snarlfox','bolt'],['slingtail','arrow'],['quillfinch','arrow'],['tuftle','slash']] as const)(
    'gives %s its own reply style when the simulation does not specify one',(species,kind)=>{
      const round=event({ok:true,message:'reply',creatureStrike:{outcome:'hit',damage:4}},'forward');
      const cues=battleEffectCues({...round,before:{...snapshot,speciesId:species}});
      expect(cues[0]!.kind).toBe(kind);
    });
  it('samples identical geometry at a given age regardless of frame rate',()=>{
    const render=(fps:number):number[]=>{
      const effects=new CombatEffects();effects.emit(cue('bolt',0));
      for(let frame=0;frame<=fps;frame++)effects.update(frame*500/fps,false);
      const mesh=batch(effects,'combat-glyph-batch'),result=Array.from(mesh.instanceMatrix.array).slice(0,mesh.count*16);
      effects.dispose();return result;
    };
    expect(render(10)).toEqual(render(60));
  });
  it('reuses two batches and bounds work during an attack flood',()=>{
    const effects=new CombatEffects();const glyph=batch(effects,'combat-glyph-batch'),shards=batch(effects,'combat-shard-batch');
    const matrices=glyph.instanceMatrix.array;
    for(let i=0;i<1000;i++)effects.emit({...cue('impact',0),critical:true});
    effects.update(250,false);
    expect(effects.activeCount).toBe(24);expect(glyph.count).toBeLessThanOrEqual(192);expect(shards.count).toBeLessThanOrEqual(512);
    expect(effects.root.children).toHaveLength(2);expect(glyph.instanceMatrix.array).toBe(matrices);
    effects.update(1100,false);expect(effects.instanceCount).toBe(0);expect(effects.activeCount).toBe(0);effects.dispose();
  });
  it('keeps reduced-motion symbols stationary and omits all sparks',()=>{
    const effects=new CombatEffects();effects.emit(cue('bolt',0));effects.update(250,true);
    const glyph=batch(effects,'combat-glyph-batch'),matrix=new THREE.Matrix4();glyph.getMatrixAt(0,matrix);const before=matrix.clone();
    effects.update(650,true);glyph.getMatrixAt(0,matrix);
    expect(matrix.elements).toEqual(before.elements);expect(batch(effects,'combat-shard-batch').count).toBe(0);effects.dispose();
  });
  it('renders finite transforms for every effect, respects future starts, and clears all instances',()=>{
    const effects=new CombatEffects();
    const kinds:CombatEffectKind[]=['charge','bolt','arrow','slash','impact','fizzle','snare','capture','guard','heal','wind','stone','dodge'];
    for(const kind of kinds)effects.emit(cue(kind));
    effects.update(0,false);expect(effects.instanceCount).toBe(0);
    for(const t of [100,250,500,800,1099]){
      effects.update(t,false);expect(effects.instanceCount).toBeGreaterThan(0);
      for(const child of effects.root.children){const mesh=child as THREE.InstancedMesh;
        expect(Array.from(mesh.instanceMatrix.array).slice(0,mesh.count*16).every(Number.isFinite)).toBe(true);}
    }
    effects.clear();expect(effects.instanceCount).toBe(0);expect(effects.activeCount).toBe(0);effects.dispose();
  });
  it('releases instance buffers and owned resources once and ignores subsequent emissions',()=>{
    const effects=new CombatEffects(),glyph=batch(effects,'combat-glyph-batch'),dispose=vi.fn(),geometry=vi.fn();
    glyph.addEventListener('dispose',dispose);glyph.geometry.addEventListener('dispose',geometry);
    effects.dispose();effects.dispose();effects.emit(cue('impact'));
    expect(dispose).toHaveBeenCalledTimes(1);expect(geometry).toHaveBeenCalledTimes(1);expect(effects.activeCount).toBe(0);
  });
});
