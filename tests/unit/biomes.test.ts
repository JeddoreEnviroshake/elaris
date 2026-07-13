import { describe, expect, it } from 'vitest';
import { WORLD_PX } from '../../src/config/platform';
import { starterBiomeAt } from '../../src/simulation/biomes';
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
