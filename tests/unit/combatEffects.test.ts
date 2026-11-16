import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {CombatEffects,type CombatEffectCue,type CombatEffectKind} from '../../src/three/combatEffects';
const cue=(kind:CombatEffectKind,at=100):CombatEffectCue=>({kind,at,duration:1000,from:{x:-1,y:1,z:.3},to:{x:1,y:1,z:0},color:0x91ffe0});
const batch=(effects:CombatEffects,name:string):THREE.InstancedMesh=>effects.root.getObjectByName(name) as THREE.InstancedMesh;

describe('combat effect presentation',()=>{
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
