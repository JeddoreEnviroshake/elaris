import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { INTERIOR_DEFINITIONS } from '../../src/content/interiors';
import { INTERIOR_MOBILE_BUDGET, ThreeInteriorStage } from '../../src/three/ThreeInteriorStage';

let stage: ThreeInteriorStage | null = null;
let canvasContextSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  canvasContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    fillStyle: '', font: '', textAlign: 'center', textBaseline: 'middle',
    roundRect: () => {}, fill: () => {}, fillText: () => {},
  } as unknown as CanvasRenderingContext2D));
});

afterAll(() => canvasContextSpy.mockRestore());

afterEach(() => {
  stage?.dispose();
  stage = null;
});

describe('data-driven Three.js interiors', () => {
  it('composes every room from its authored props, NPC, ambience, and hotspots', () => {
    stage = new ThreeInteriorStage();
    const floorColors = new Set<number>();
    for (const definition of INTERIOR_DEFINITIONS) {
      stage.show({
        definition,
        pose: {
          x: definition.playerSpawn.tileX + 0.5,
          y: definition.playerSpawn.tileY + 0.5,
          facing: definition.playerSpawn.facing,
        },
        focusedHotspotId: definition.hotspots.find((hotspot) => hotspot.kind === 'service')?.id ?? null,
      }, 1_000, false);
      const snapshot = stage.getCompositionSnapshot();
      expect(snapshot.definitionId).toBe(definition.id);
      expect(snapshot.propPrefabs).toEqual(definition.props.map((prop) => prop.prefab));
      expect(snapshot.npcIds).toEqual(definition.npcSpawns.map((spawn) => spawn.npcId));
      expect(snapshot.effectParticles).toBeGreaterThan(0);
      expect(stage.root.getObjectByName(`room-floor:${definition.id}`)).toBeDefined();
      for (const prop of definition.props) {
        expect(stage.root.getObjectByName(`interior-prop:${prop.prefab}:${prop.id}`)).toBeDefined();
      }
      const floor = stage.root.getObjectByName(`room-floor:${definition.id}`) as THREE.Mesh;
      floorColors.add((floor.material as THREE.MeshStandardMaterial).color.getHex());
    }
    expect(floorColors.size).toBe(INTERIOR_DEFINITIONS.length);
  });

  it('adds visible ambient actors to rooms whose identity depends on local activity', () => {
    stage = new ThreeInteriorStage();
    for (const buildingId of ['farm', 'market', 'tavern', 'arena'] as const) {
      const definition = INTERIOR_DEFINITIONS.find((interior) => interior.buildingId === buildingId)!;
      stage.show({
        definition,
        pose: { x: 1.5, y: 1.5, facing: 'down' },
        focusedHotspotId: null,
      }, 2_000, false);
      expect(stage.getCompositionSnapshot().ambientActors).toBeGreaterThan(0);
    }
  });

  it('suppresses nonessential particles in reduced-motion mode', () => {
    stage = new ThreeInteriorStage();
    const arcanum = INTERIOR_DEFINITIONS.find((interior) => interior.buildingId === 'magic-shop')!;
    stage.show({ definition: arcanum, pose: { x: 5.5, y: 9.5, facing: 'up' }, focusedHotspotId: null }, 3_000, true);
    const particles = stage.root.children.filter((child) => child instanceof THREE.Mesh && child.geometry.type === 'TetrahedronGeometry');
    expect(particles.every((particle) => !particle.visible)).toBe(true);
  });

  it('stays within the authored mobile animation and rendering budgets', () => {
    stage = new ThreeInteriorStage();
    for (const definition of INTERIOR_DEFINITIONS) {
      stage.show({
        definition,
        pose: { x: definition.playerSpawn.tileX + 0.5, y: definition.playerSpawn.tileY + 0.5, facing: definition.playerSpawn.facing },
        focusedHotspotId: null,
      }, 4_000, false, true);
      const snapshot = stage.getCompositionSnapshot();
      expect(snapshot.mobileProfile).toBe(true);
      expect(snapshot.visibleEffectParticles).toBeLessThanOrEqual(INTERIOR_MOBILE_BUDGET.effectParticles);
      expect(snapshot.ambientActors).toBeLessThanOrEqual(INTERIOR_MOBILE_BUDGET.ambientActors);
      expect(snapshot.animatedObjects).toBeLessThanOrEqual(INTERIOR_MOBILE_BUDGET.animatedObjects);
      expect(snapshot.dynamicLights).toBeLessThanOrEqual(INTERIOR_MOBILE_BUDGET.dynamicLights);
      expect(snapshot.triangleCount,definition.id).toBeLessThanOrEqual(INTERIOR_MOBILE_BUDGET.triangles);
      expect(stage.root.children.every((child) => child.frustumCulled)).toBe(true);
    }
  });

  it('disposes unique geometries, materials, and label textures when rooms change', () => {
    stage = new ThreeInteriorStage();
    const [forge, farm] = INTERIOR_DEFINITIONS;
    stage.show({ definition: forge!, pose: { x: 5.5, y: 8.5, facing: 'up' }, focusedHotspotId: null }, 1_000, false);
    const before = stage.getCompositionSnapshot().disposedResources;
    stage.show({ definition: farm!, pose: { x: 6.5, y: 9.5, facing: 'up' }, focusedHotspotId: null }, 2_000, false);
    expect(stage.getCompositionSnapshot().disposedResources).toBeGreaterThan(before);
  });
});
