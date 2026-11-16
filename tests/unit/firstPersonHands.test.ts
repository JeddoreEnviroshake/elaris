import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createInitialState, type ToolDefinitionId } from '../../src/simulation/state';
import { FirstPersonHands, firstPersonHandsFrame, type FirstPersonHandsFrame } from '../../src/three/firstPersonHands';
import type { ThreePresentationState } from '../../src/three/presentationState';

const rigs: FirstPersonHands[] = [];
const rig = (): FirstPersonHands => { const model = new FirstPersonHands(); rigs.push(model); return model; };
afterEach(() => { rigs.splice(0).forEach(model => model.dispose()); });
const frame = (overrides: Partial<FirstPersonHandsFrame> = {}): FirstPersonHandsFrame => ({
  tool: 'axe', tier: 'iron', motion: 'idle', progress: 0, resourceKind: null, arrowsAvailable: true,
  reducedMotion: false, ...overrides,
});
const presentation = (overrides: Partial<ThreePresentationState> = {}): ThreePresentationState => ({
  placement: null, selection: null, target: null, gathering: false, prefersReducedMotion: false, interior: null, ...overrides,
});
function equip(definitionId: ToolDefinitionId) {
  const state = createInitialState(42);
  state.tools = [{ instanceId: 'held', definitionId, durability: 100, maxDurability: 100, powerRank: 0, speedRank: 0, durabilityRank: 0 }];
  state.equippedToolId = 'held';
  return state;
}
const pose = (root: THREE.Object3D): number[] => [...root.position.toArray(), ...root.quaternion.toArray()];

describe('first-person hands and equipped tools', () => {
  it('shows the actual equipped tool, preserves a depleted node kind, and never invents a gathering tool', () => {
    const state = equip('iron-sword');
    const before = JSON.stringify(state);
    const hit = presentation({ gathering: true, gatherKind: 'tree', gatherProgress: .4 });
    expect(firstPersonHandsFrame(state, hit)).toMatchObject({ tool: 'sword', motion: 'gather', resourceKind: 'tree', progress: .4 });
    expect(JSON.stringify(state)).toBe(before);
    state.equippedToolId = null;
    expect(firstPersonHandsFrame(state, hit).tool).toBe('hands');
    state.equippedToolId = 'held'; state.tools[0]!.durability = 0;
    expect(firstPersonHandsFrame(state, presentation()).tool).toBe('hands');
  });

  it('selects bow, staff and bare-hand spells from the real combat presentation', () => {
    const action = { id: 1, kind: 'magic' as const, progress: .3, x: 0, y: 0, arrowTracked: false };
    expect(firstPersonHandsFrame(equip('magic-staff'), presentation({ playerAction: action })).tool).toBe('staff');
    expect(firstPersonHandsFrame(equip('iron-sword'), presentation({ playerAction: action })).tool).toBe('hands');
    expect(firstPersonHandsFrame(equip('bow'), presentation({ playerAction: { ...action, kind: 'ranged' } })))
      .toMatchObject({ tool: 'bow', motion: 'ranged', progress: .3 });
  });

  it.each(['axe', 'pick', 'sickle', 'sword', 'staff', 'bow', 'hands'] as const)('keeps %s still at rest and within a small visible geometry budget', tool => {
    const model = rig(); model.setVisible(true); model.resize(1280, 760);
    model.update(frame({ tool }));
    const left = pose(model.left.root), right = pose(model.right.root);
    model.update(frame({ tool, progress: .8 }));
    expect(pose(model.left.root)).toEqual(left);
    expect(pose(model.right.root)).toEqual(right);
    let triangles = 0;
    model.scene.traverseVisible(child => {
      if (child instanceof THREE.Mesh) triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3;
    });
    expect(triangles).toBeGreaterThan(100);
    expect(triangles).toBeLessThan(15_000);
  });

  it.each(['gather', 'melee', 'ranged', 'magic'] as const)('animates %s using action progress and leaves the camera untouched', motion => {
    const model = rig();
    const tool = motion === 'ranged' ? 'bow' : motion === 'magic' ? 'staff' : 'axe';
    const camera = [...pose(model.camera), model.camera.fov];
    model.update(frame({ tool, motion, progress: 0 }));
    const start = pose(model.right.root);
    model.update(frame({ tool, motion, progress: .16 }));
    expect(pose(model.right.root)).not.toEqual(start);
    model.update(frame({ tool, motion, progress: .47 }));
    expect([...pose(model.camera), model.camera.fov]).toEqual(camera);
    model.update(frame({ tool, motion, progress: 1 }));
    expect(pose(model.right.root)).toEqual(start);
  });

  it('keeps action poses stable under reduced motion and clears tool visibility on unequip', () => {
    const model = rig();
    for (const motion of ['gather', 'melee', 'ranged', 'magic'] as const) {
      const tool = motion === 'ranged' ? 'bow' : 'staff';
      model.update(frame({ tool, motion, progress: .1, reducedMotion: true }));
      const before = [pose(model.left.root), pose(model.right.root)];
      model.update(frame({ tool, motion, progress: .7, reducedMotion: true }));
      expect([pose(model.left.root), pose(model.right.root)]).toEqual(before);
    }
    model.update(frame({ tool: 'hands' }));
    const visible: string[] = [];
    model.root.traverse(child => { if (child.name.startsWith('first-person.tool-') && child.visible) visible.push(child.name); });
    // Grip meshes have a similar name but no equipped tool group should survive.
    expect(visible.filter(name => name !== 'first-person.tool-grip')).toEqual([]);
  });

  it('draws the bowstring, releases its nocked arrow, and never shows an arrow for an empty quiver', () => {
    const model = rig(); model.update(frame({ tool: 'bow', motion: 'ranged', progress: .16 }));
    const string = model.root.getObjectByName('first-person.bowstring') as THREE.Line;
    const arrow = model.root.getObjectByName('first-person.nocked-arrow')!;
    expect(string.geometry.getAttribute('position').getZ(1)).toBeGreaterThan(0);
    expect(arrow.visible).toBe(true);
    model.update(frame({ tool: 'bow', motion: 'ranged', progress: .3 }));
    expect(arrow.visible).toBe(false);
    model.update(frame({ tool: 'bow', arrowsAvailable: false }));
    expect(arrow.visible).toBe(false);
  });
});
