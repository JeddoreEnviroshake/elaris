import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createCreatureRig,
  createPlayerRig,
  createSaddle,
  gatherToolForNode,
  mountSeatOffset,
  RIDER_HIP_HEIGHT,
} from '../../src/three/characterRigs';
import type { SpeciesId } from '../../src/simulation/state';

const SPECIES:readonly SpeciesId[]=['tuftle','craghopper','glade-stag','snarlfox','masonmole','slingtail',
  'bulwark-boar','quillfinch','mistmoth'];

function poseSnapshot(root:THREE.Group):number[][] {
  root.updateMatrixWorld(true);
  const matrices:number[][]=[];
  root.traverse(part=>matrices.push(part.matrixWorld.elements.map(value=>Math.abs(value)<1e-12?0:value)));
  return matrices;
}

describe('articulated 3D character rigs', () => {
  it('selects a readable gathering tool for every resource node kind', () => {
    expect(gatherToolForNode('tree')).toBe('axe');
    expect(gatherToolForNode('stone')).toBe('pickaxe');
    expect(gatherToolForNode('metal')).toBe('pickaxe');
    expect(gatherToolForNode('plant')).toBe('sickle');
    expect(gatherToolForNode('berry-bush')).toBe('sickle');
    expect(gatherToolForNode(null)).toBe('hands');
  });

  it('counter-swings the arms, bends knees while walking and honors reduced motion', () => {
    const rig = createPlayerRig();
    rig.animate(125, 'walk', false);
    expect(rig.joints.leftArm.rotation.x).not.toBe(0);
    expect(rig.joints.leftArm.rotation.x).toBeCloseTo(-rig.joints.rightArm.rotation.x);
    expect(rig.joints.leftKnee.rotation.x).toBeGreaterThan(0);
    expect(rig.joints.rightKnee.rotation.x).toBeGreaterThanOrEqual(0);

    rig.animate(125, 'walk', true);
    expect(rig.joints.leftArm.rotation.x).toBeCloseTo(0);
    expect(rig.joints.rightLeg.rotation.x).toBeCloseTo(0);
  });

  it('shows only the selected gathering tool and drives the tool arm', () => {
    const rig = createPlayerRig();
    rig.setGatherTool('pickaxe');
    const tools = Object.fromEntries(rig.joints.toolHand.children.map((tool) => [tool.name, tool.visible]));
    expect(tools).toEqual({ 'tool-axe': false, 'tool-pickaxe': true, 'tool-sickle': false, 'tool-staff': false });
    rig.setGatherTool('staff');
    expect(rig.joints.toolHand.getObjectByName('tool-staff')?.visible).toBe(true);
    expect(rig.joints.toolHand.getObjectByName('tool-pickaxe')?.visible).toBe(false);
    rig.animate(200, 'gather', false);
    expect(rig.joints.rightArm.rotation.x).toBeLessThan(-0.2);
  });

  it('accepts an authored tool while retaining an invisible procedural fallback', () => {
    const rig = createPlayerRig();
    const authored = new THREE.Group();
    rig.replaceGatherTool('axe', authored);
    rig.setGatherTool('axe');
    expect(authored.name).toBe('tool-axe');
    expect(authored.visible).toBe(true);
    expect(rig.joints.toolHand.getObjectByName('fallback-tool-axe')?.visible).toBe(false);
  });

  it('keeps the cloak behind the player instead of wedged across the front', () => {
    const rig = createPlayerRig();
    const cloak = rig.root.getObjectByName('player.cloak') as THREE.Mesh | undefined;
    expect(cloak).toBeDefined();
    // The player faces +z, so every cloak vertex must stay on the -z side.
    const position = cloak!.geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(
        new THREE.Matrix4().compose(cloak!.position, new THREE.Quaternion().setFromEuler(cloak!.rotation), cloak!.scale),
      );
      maxZ = Math.max(maxZ, vertex.z);
    }
    expect(maxZ).toBeLessThan(0);
  });

  it('seats a rider astride the mount with both legs splayed forward', () => {
    const rig = createPlayerRig();
    rig.animate(400, 'ride', false);
    expect(rig.joints.leftLeg.rotation.x).toBeLessThan(-0.3);
    expect(rig.joints.leftLeg.rotation.x).toBeCloseTo(rig.joints.rightLeg.rotation.x);
    expect(rig.joints.leftLeg.rotation.z).toBeCloseTo(-rig.joints.rightLeg.rotation.z);
    expect(rig.joints.leftLeg.rotation.z).toBeLessThan(0);

    rig.animate(400, 'idle', false);
    expect(rig.joints.leftLeg.rotation.x).toBeCloseTo(0);
    expect(rig.joints.torso.rotation.x).toBeCloseTo(0);
  });

  it('places every saddle just under the rider hips of its species', () => {
    for (const speciesId of ['tuftle', 'craghopper', 'glade-stag', 'snarlfox'] as const) {
      const seat = mountSeatOffset(speciesId);
      expect(seat.y).toBeGreaterThan(RIDER_HIP_HEIGHT);
      const saddle = createSaddle(speciesId);
      expect(saddle.children.length).toBeGreaterThan(0);
      for (const part of saddle.children) expect(part.position.y).toBeLessThan(seat.y + 0.1);
      expect(new THREE.Box3().setFromObject(saddle).max.y).toBeLessThan(seat.y+.1);
    }
  });

  it.each(SPECIES)(
    'creates and poses a distinct %s rig',
    (speciesId) => {
      const rig = createCreatureRig(speciesId);
      expect(rig.root.name).toBe(`${speciesId}-rig`);
      expect(Object.keys(rig.joints).length).toBeGreaterThanOrEqual(3);
      expect(rig.root.children.length).toBeGreaterThan(0);
      expect(() => rig.animate(500, 'alert', false)).not.toThrow();
      expect(() => rig.animate(500, 'walk', true)).not.toThrow();
    },
  );

  it.each(SPECIES)('keeps the %s sculpt grounded, finite, inexpensive and stable across repeated poses',speciesId=>{
    const rig=createCreatureRig(speciesId);
    const bounds=new THREE.Box3().setFromObject(rig.root);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-.025);
    expect(bounds.max.y).toBeLessThanOrEqual(3);
    expect(rig.root.userData.modelHeight).toBeCloseTo(bounds.max.y);
    let meshes=0,triangles=0;
    rig.root.traverse(part=>{
      if(!(part instanceof THREE.Mesh))return;
      meshes++;
      const geometry=part.geometry;
      triangles+=(geometry.index?.count??geometry.getAttribute('position').count)/3;
      for(const name of ['position','normal','color']) {
        const attribute=geometry.getAttribute(name);
        expect(attribute.count).toBe(geometry.getAttribute('position').count);
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
    });
    expect(meshes).toBeLessThanOrEqual(12);
    expect(triangles).toBeLessThanOrEqual(8_000);
    rig.animate(1234,'walk',false);const walking=poseSnapshot(rig.root);
    rig.animate(1234,'walk',false);expect(poseSnapshot(rig.root)).toEqual(walking);
    rig.animate(500,'alert',false);rig.animate(900,'idle',true);const still=poseSnapshot(rig.root);
    rig.animate(4900,'idle',true);expect(poseSnapshot(rig.root)).toEqual(still);
  });

  it('resets the new player outfit after tool use and riding without accumulating transforms',()=>{
    const rig=createPlayerRig();
    rig.setGatherTool('axe');rig.animate(1400,'gather',false);
    rig.animate(1700,'ride',false);rig.animate(1100,'idle',true);const still=poseSnapshot(rig.root);
    rig.animate(4100,'idle',true);expect(poseSnapshot(rig.root)).toEqual(still);
  });
});
