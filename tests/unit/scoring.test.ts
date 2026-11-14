import { describe, expect, it } from 'vitest';
import { homesteadRating, recordHighestRating } from '../../src/simulation/scoring';
import { createInitialState, type BuildingState } from '../../src/simulation/state';

const part = (id: string, definitionId: BuildingState['definitionId'], tileX: number, tileY: number, boundaryEdge?: BuildingState['boundaryEdge']): BuildingState => ({
  id, definitionId, tileX, tileY, ...(boundaryEdge ? { boundaryEdge } : {}),
});

describe('Homestead Rating', () => {
  it('uses materialValue * N^0.4 for each canonical surface component', () => {
    const buildings = [
      part('floor-a', 'wood-floor', 0, 0),
      part('floor-b', 'thatch-floor', 1, 0),
      part('wall', 'wood-wall', 0, 0, 'north'),
      part('unattached', 'wood-wall', 10, 10, 'north'),
      part('marker', 'environment-marker', 0, 0),
    ];
    const rating = homesteadRating(buildings);
    expect(rating.structures).toHaveLength(1);
    expect(rating.structures[0]).toMatchObject({ surfaceCells: 2, boundaryParts: 1, n: 3, totalMaterialValue: 7 });
    expect(rating.total).toBeCloseTo(7 * Math.pow(3, 0.4), 10);
  });

  it('merges and splits components without repeating sticky highest-ever progress', () => {
    const state = createInitialState(1);
    state.buildings = [part('a', 'wood-floor', 0, 0), part('b', 'wood-floor', 2, 0)];
    expect(homesteadRating(state.buildings).structures).toHaveLength(2);
    state.buildings.push(part('bridge', 'wood-floor', 1, 0));
    expect(homesteadRating(state.buildings).structures).toHaveLength(1);
    const peak = recordHighestRating(state);
    state.buildings = state.buildings.filter((building) => building.id !== 'bridge');
    expect(homesteadRating(state.buildings).structures).toHaveLength(2);
    recordHighestRating(state);
    expect(state.highestRatingEverTenths).toBe(Math.round(peak * 10));
  });

  it('scores Stone at 8 and Metal at 20 in the same canonical component', () => {
    const buildings = [
      part('stone', 'stone-floor', 0, 0),
      part('metal', 'metal-floor', 1, 0),
      part('stone-wall', 'stone-wall', 0, 0, 'north'),
      part('metal-wall', 'metal-wall', 1, 0, 'north'),
    ];
    const rating = homesteadRating(buildings);
    expect(rating.structures).toHaveLength(1);
    expect(rating.structures[0]).toMatchObject({ n: 4, totalMaterialValue: 56 });
    expect(rating.total).toBeCloseTo(56 * Math.pow(4, 0.4), 10);
    const reloaded = JSON.parse(JSON.stringify(buildings)) as BuildingState[];
    expect(homesteadRating(reloaded).total).toBeCloseTo(rating.total, 10);
  });
});
