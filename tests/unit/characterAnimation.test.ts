import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {createPlayerRig,createCreatureRig,type PlayerMotion,type CreatureMotion} from '../../src/three/characterRigs';
import {MotionTracker,cycle,footCycle,solveLeg} from '../../src/three/animationMotion';
import {SoftJoints} from '../../src/three/softJoints';
import {releaseArt} from '../../src/three/quaterniusArt';
import type {SpeciesId} from '../../src/simulation/state';

const SPECIES:SpeciesId[]=['tuftle','craghopper','glade-stag','snarlfox','masonmole','slingtail','bulwark-boar','quillfinch','mistmoth'];

function posedMinimum(mesh:THREE.Mesh):number {
  const positions=mesh.geometry.getAttribute('position'),flex=mesh.userData.softJoints as SoftJoints|undefined;
  const vertex=new THREE.Vector3();let minimum=Infinity;
  for(let i=0;i<positions.count;i++){
    vertex.fromBufferAttribute(positions,i);if(flex)flex.transformPoint(vertex);
    vertex.applyMatrix4(mesh.matrixWorld);minimum=Math.min(minimum,vertex.y);
  }
  return minimum;
}

describe('articulated character animation',()=>{
  it('advances strides by travel at the same rate across frame rates and ignores teleports',()=>{
    const phases:number[]=[];
    for(const fps of [10,30,60,120]){
      const tracker=new MotionTracker(),root=new THREE.Group();tracker.sample(root,0,0,0,0);
      for(let i=1;i<=fps;i++)tracker.sample(root,i*1000/fps,i/fps,0,0,.74);
      phases.push(tracker.sample(root,1000+1,1,0,0,.74).phase!);
      const teleport=tracker.sample(root,1100,80,80,0,.74);
      expect(teleport.speed).toBe(0);expect(teleport.phase).toBeCloseTo(phases.at(-1)!);
    }
    for(const phase of phases)expect(phase).toBeCloseTo(cycle(1/.74),9);
  });

  it('keeps the planted boot on the floor throughout stance and lifts it for swing',()=>{
    const rig=createPlayerRig();let lifted=false;
    for(let i=0;i<40;i++){
      const phase=i/40;rig.animate(1200,'walk',false,{phase,speed:2});rig.root.updateMatrixWorld(true);
      for(const [leg,offset] of [[rig.joints.leftLeg,0],[rig.joints.rightLeg,.5]] as const){
        const mesh=leg.children.find(child=>child instanceof THREE.Mesh) as THREE.Mesh;
        const low=posedMinimum(mesh),contact=cycle(phase+offset)<.6;
        if(contact){expect(low,`stance ${phase}/${offset}`).toBeGreaterThan(-.025);expect(low).toBeLessThan(.045);}
        else if(low>.05)lifted=true;
      }
    }
    expect(lifted).toBe(true);releaseArt(rig.root);
  });

  it('has finite inverse-kinematic solutions even at singular and unreachable targets',()=>{
    for(const [y,z] of [[0,0],[-.56,0],[-100,20],[-.01,.1]]){
      const pose=solveLeg(y!,z!,.30,.26);expect(Number.isFinite(pose.hip)).toBe(true);expect(Number.isFinite(pose.knee)).toBe(true);
    }
    expect(footCycle(.2,.2,.1).lift).toBe(0);expect(footCycle(.8,.2,.1).lift).toBeGreaterThan(.05);
  });

  it('uses distinct axe, pick, sickle and hand-gathering poses at the same action phase',()=>{
    const poses=new Set<string>();
    for(const tool of ['axe','pickaxe','sickle','hands'] as const){
      const rig=createPlayerRig();rig.setGatherTool(tool);rig.animate(1000,'gather',false,{progress:.35});
      poses.add(JSON.stringify([rig.joints.rightArm.rotation.toArray(),rig.joints.leftArm.rotation.toArray(),rig.joints.torso.rotation.toArray()]));
      releaseArt(rig.root);
    }
    expect(poses.size).toBe(4);
  });

  it('anchors a replaced tool under the bending elbow and carries a bow in the left hand',()=>{
    const rig=createPlayerRig(),tool=new THREE.Group();rig.replaceGatherTool('axe',tool);rig.setGatherTool('axe');
    rig.animate(1000,'melee',false,{progress:.22});
    expect(rig.joints.toolHand.parent).toBe(rig.joints.rightElbow);
    expect(rig.joints.rightElbow.rotation.x).toBeLessThan(-.2);expect(tool.visible).toBe(true);
    rig.setGatherTool('bow');const bow=rig.root.getObjectByName('tool-bow')!;
    expect(bow.visible).toBe(true);expect(bow.parent?.parent).toBe(rig.joints.leftElbow);expect(tool.visible).toBe(false);
    releaseArt(rig.root);
  });

  it('blends the start of locomotion instead of snapping to an arbitrary gait phase',()=>{
    const rig=createPlayerRig();rig.animate(0,'idle',false,{deltaSeconds:.016,phase:0,speed:0});
    const from=rig.joints.leftArm.rotation.x;
    rig.animate(16,'walk',false,{deltaSeconds:.016,phase:.25,speed:2});
    expect(Math.abs(rig.joints.leftArm.rotation.x-from)).toBeLessThan(.05);
    for(let i=2;i<=5;i++)rig.animate(i*16,'walk',false,{deltaSeconds:.016,phase:.25,speed:2});
    expect(rig.joints.leftArm.rotation.x).toBeGreaterThan(.07);
    expect(rig.joints.leftArm.rotation.x).toBeLessThan(.32);
    for(let i=6;i<15;i++)rig.animate(i*16,'walk',false,{deltaSeconds:.016,phase:.25,speed:2});
    expect(Math.abs(rig.joints.leftArm.rotation.x)).toBeGreaterThan(.2);releaseArt(rig.root);
  });

  it('layers gathering, archery and spell casting over the seated legs',()=>{
    const rig=createPlayerRig();
    for(const motion of ['gather','ranged','cast'] as const){
      rig.animate(1300,motion,false,{mounted:true,progress:.30,phase:.2,speed:5});
      expect(rig.joints.leftLeg.rotation.x).toBeCloseTo(-.8);expect(rig.joints.rightLeg.rotation.x).toBeCloseTo(-.8);
      expect(rig.joints.leftLeg.rotation.z).toBeCloseTo(-.46);expect(rig.joints.rightKnee.rotation.x).toBeCloseTo(.45);
      expect(rig.joints.rightArm.rotation.x).toBeLessThan(-.1);
    }
    releaseArt(rig.root);
  });

  it.each(SPECIES)('keeps every %s clip finite and resets transient transforms',species=>{
    const rig=createCreatureRig(species);
    for(const motion of ['idle','walk','run','alert','attack','hit','dodge','defeat','capture','assist'] as CreatureMotion[]){
      for(const progress of [0,.2,.5,.8,1]){
        rig.animate(2000,motion,false,{phase:progress,progress,speed:3});rig.root.updateMatrixWorld(true);
        rig.root.traverse(part=>expect(part.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      }
    }
    rig.animate(2000,'idle',true);rig.root.updateMatrixWorld(true);
    expect(rig.joints.motion!.scale.x).toBe(1);expect(rig.joints.motion!.rotation.z).toBeCloseTo(0);
    const before=rig.joints.head?.rotation.x??rig.joints.neck?.rotation.x;
    rig.animate(7000,'idle',true);expect(rig.joints.head?.rotation.x??rig.joints.neck?.rotation.x).toBeCloseTo(before!);
    releaseArt(rig.root);
  });

  it('keeps all player clips finite and releases their matching shadow materials',()=>{
    const rig=createPlayerRig();let depthDisposed=0,distanceDisposed=0,flexMeshes=0;
    rig.root.traverse(part=>{if(!(part instanceof THREE.Mesh)||!part.customDepthMaterial)return;flexMeshes++;
      part.customDepthMaterial.addEventListener('dispose',()=>depthDisposed++);
      part.customDistanceMaterial!.addEventListener('dispose',()=>distanceDisposed++);
    });
    for(const motion of ['idle','ready','walk','run','gather','ride','melee','ranged','cast','throw','hit','dodge','defeat','celebrate'] as PlayerMotion[]){
      for(const progress of [0,.2,.5,.8,1]){
        rig.animate(2000,motion,false,{phase:progress,progress,speed:6});rig.root.updateMatrixWorld(true);
        rig.root.traverse(part=>expect(part.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      }
    }
    releaseArt(rig.root);expect(depthDisposed).toBe(flexMeshes);expect(distanceDisposed).toBe(flexMeshes);
  });

  it('freezes transient creature reactions in reduced motion while retaining terminal poses',()=>{
    for(const species of SPECIES){
      const rig=createCreatureRig(species);
      const snapshot=():string=>{rig.root.updateMatrixWorld(true);const values:number[][]=[];
        rig.root.traverse(part=>values.push([...part.matrixWorld.elements]));return JSON.stringify(values);};
      rig.animate(1000,'idle',true);const idle=snapshot();
      for(const motion of ['attack','hit','dodge','assist'] as const){rig.animate(3000,motion,true,{progress:.5});expect(snapshot()).toBe(idle);}
      rig.animate(3000,'defeat',true,{progress:.5});expect(snapshot()).not.toBe(idle);releaseArt(rig.root);
    }
  });
});
