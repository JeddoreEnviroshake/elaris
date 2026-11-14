import { describe, expect, it } from 'vitest';
import { isRoadPosition } from '../../src/content/roads';
import { terrainAt } from '../../src/simulation/landscape';
import { entrancePlanting, isTownEntrance } from '../../src/three/townEntrance';
import {
  composeHeroEnvironment,
  distanceToSegment,
  isGroundOccluder,
  isInsideBufferedFootprint,
} from '../../src/three/environmentComposition';

const footprints = [
  { tileX: 72, tileY: 74, tilesWide: 7, tilesHigh: 6 },
  { tileX: 82, tileY: 84, tilesWide: 9, tilesHigh: 6 },
];

describe('3D hero environment composition', () => {
  it('keeps the Quaternius planting inside the entrance and away from roads, water, and doors for different saves', () => {
    for (const seed of [42, 99, 1234, 0xe1a71]) {
      const plants = entrancePlanting(seed, footprints);
      expect(plants).toEqual(entrancePlanting(seed, footprints));
      expect(plants.length).toBeGreaterThan(150);
      expect(plants.length).toBeLessThan(1000);
      expect(new Set(plants.map((plant) => plant.key)).size).toBeGreaterThan(4);
      for (const plant of plants) {
        expect(isTownEntrance(plant.x, plant.z)).toBe(true);
        expect(isInsideBufferedFootprint(plant, footprints, .7)).toBe(false);
        expect(isRoadPosition('0,0', plant.x, plant.z, .55)).toBe(false);
        expect(terrainAt(seed, { x: 0, y: 0, theme: 'elaris' }, Math.floor(plant.x), Math.floor(plant.z))).toBe('ground');
        expect(plant.scale).toBeGreaterThan(0);
      }
    }
  });
  it('is deterministic and keeps ground details clear of buildings', () => {
    const first = composeHeroEnvironment(1234, footprints);
    const second = composeHeroEnvironment(1234, footprints);
    expect(first).toEqual(second);
    expect(first.groundDetails.length).toBeGreaterThan(70);
    expect(first.groundDetails.every((point) => !isInsideBufferedFootprint(point, footprints, 1.6))).toBe(true);
  });

  it('keeps decorative rocks and plants off roads and water without a separate scenic bridge', () => {
    const composition = composeHeroEnvironment(99, footprints);
    for (const point of composition.groundDetails) {
      expect(isRoadPosition('0,0', point.x, point.z, .5)).toBe(false);
      expect(terrainAt(99, { x: 0, y: 0, theme: 'elaris' }, Math.floor(point.x), Math.floor(point.z))).toBe('ground');
    }
    expect(composition).not.toHaveProperty('bridge');
  });

  it('measures ground-plane occlusion only between camera and target', () => {
    expect(distanceToSegment({ x: 5, z: 1 }, { x: 0, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(1);
    expect(isGroundOccluder({ x: 5, z: 0.4 }, 1, { x: 0, z: 0 }, { x: 10, z: 0 })).toBe(true);
    expect(isGroundOccluder({ x: 12, z: 0 }, 2, { x: 0, z: 0 }, { x: 10, z: 0 })).toBe(false);
    expect(isGroundOccluder({ x: 5, z: 3 }, 1, { x: 0, z: 0 }, { x: 10, z: 0 })).toBe(false);
  });
});
