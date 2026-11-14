import { describe, expect, it } from 'vitest';
import { WORLD_PX } from '../../src/config/platform';
import { mountainElevationBand, starterBiomeAt } from '../../src/simulation/biomes';
import { createInitialState } from '../../src/simulation/state';

describe('starter grassland and forest region', () => {
  it('keeps the starter clearing open and provides a stable western forest', () => {
    expect(starterBiomeAt(123, WORLD_PX / 2, WORLD_PX / 2)).toBe('grassland');
    expect(starterBiomeAt(123, WORLD_PX * 0.15, WORLD_PX * 0.2)).toBe('forest');
    expect(starterBiomeAt(123, 200, 200)).toBe(starterBiomeAt(123, 200, 200));
  });

  it('makes trees substantially denser in forest than grassland', () => {
    const state = createInitialState(123);
    const forestTrees = state.resourceNodes.filter((node) =>
      node.kind === 'tree' && starterBiomeAt(state.seed, node.x, node.y) === 'forest').length;
    const grasslandTrees = state.resourceNodes.filter((node) =>
      node.kind === 'tree' && starterBiomeAt(state.seed, node.x, node.y) === 'grassland').length;
    expect(forestTrees).toBeGreaterThan(grasslandTrees * 2);
  });
});

describe('mountain terrain elevation', () => {
  it('is deterministic and produces all three visual bands', () => {
    expect(mountainElevationBand(987, 12, 31)).toBe(mountainElevationBand(987, 12, 31));
    const bands = new Set<number>();
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) bands.add(mountainElevationBand(987, x, y));
    }
    expect([...bands].sort()).toEqual([0, 1, 2]);
  });
});
