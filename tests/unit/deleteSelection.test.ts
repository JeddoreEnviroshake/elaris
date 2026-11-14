import { describe, expect, it } from 'vitest';
import { nearestBuilding, nextBuildingInDirection } from '../../src/scenes/deleteSelection';
import type { BuildingState } from '../../src/simulation/state';
import { TILE_SIZE } from '../../src/config/platform';

/** A row of workbenches at y=4, one every two tiles from x=4. */
const row: BuildingState[] = [4, 6, 8].map((tileX, index) => ({
  id: `bench-${index}`, definitionId: 'workbench', tileX, tileY: 4,
}));
const northBench: BuildingState = { id: 'bench-north', definitionId: 'workbench', tileX: 6, tileY: 1 };

describe('delete-mode cursor selection', () => {
  it('anchors on the placed part nearest the player', () => {
    const nearest = nearestBuilding(row, 8.5 * TILE_SIZE, 4.5 * TILE_SIZE);
    expect(nearest?.id).toBe('bench-2');
    expect(nearestBuilding([], 0, 0)).toBeNull();
  });

  it('hops one part per d-pad press along the step direction', () => {
    expect(nextBuildingInDirection(row, row[0]!, 1, 0)?.id).toBe('bench-1');
    expect(nextBuildingInDirection(row, row[1]!, 1, 0)?.id).toBe('bench-2');
    expect(nextBuildingInDirection(row, row[2]!, -1, 0)?.id).toBe('bench-1');
  });

  it('stays put when nothing lies that way', () => {
    expect(nextBuildingInDirection(row, row[2]!, 1, 0)).toBeNull();
    expect(nextBuildingInDirection(row, row[0]!, 0, -1)).toBeNull();
    expect(nextBuildingInDirection([row[0]!], row[0]!, 1, 0)).toBeNull();
  });

  it('prefers the part actually in front over a nearer one off to the side', () => {
    const buildings = [...row, northBench];
    // Straight up from the left bench, the north bench is the only candidate
    // even though two row benches sit closer in raw distance.
    expect(nextBuildingInDirection(buildings, row[0]!, 0, -1)?.id).toBe('bench-north');
    // Stepping right from the left bench still takes the neighbour in the row,
    // not the diagonal one above it.
    expect(nextBuildingInDirection(buildings, row[0]!, 1, 0)?.id).toBe('bench-1');
  });
});
