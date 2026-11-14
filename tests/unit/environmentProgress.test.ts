import { describe, expect, it } from 'vitest';
import { PLACEABLES } from '../../src/config/areaGates';
import {
  evaluateAreaGate,
  evaluateFacilityGate,
  evaluatePlaceableGate,
  enclosureGaps,
  boundaryRemovalMergeConflict,
  buildOccupancy,
  floodSurfaceRegion,
  recordHighestAreaTier,
  type EnvironmentMeasurement,
} from '../../src/simulation/environmentProgress';
import { createInitialState } from '../../src/simulation/state';
import { enclosedEnvironment } from './helpers/buildings';

const enclosedIndoor = (area: number, largestFilledCore: number): EnvironmentMeasurement => ({
  kind: 'indoor',
  area,
  largestFilledCore,
  enclosed: true,
});

describe('environment progress', () => {
  it('requires enclosure, area, and a filled core for each tier', () => {
    expect(evaluateAreaGate({ ...enclosedIndoor(64, 8), enclosed: false }).tier).toBe(0);
    expect(evaluateAreaGate(enclosedIndoor(16, 2)).tier).toBe(8);
    expect(evaluateAreaGate(enclosedIndoor(16, 4)).tier).toBe(16);
    expect(evaluateAreaGate(enclosedIndoor(63, 8)).tier).toBe(32);
  });

  it('records the highest area reached without revoking it after a shrink', () => {
    const state = createInitialState(123);
    state.buildings = enclosedEnvironment(10, 10, 4, 4, 'indoor');
    expect(recordHighestAreaTier(state)).toBe(16);
    expect(state.highestAreaTierEver).toBe(16);

    state.buildings = enclosedEnvironment(10, 10, 2, 2, 'indoor');
    expect(recordHighestAreaTier(state)).toBe(4);
    expect(state.highestAreaTierEver).toBe(16);
  });

  it('recognizes an enclosed room without requiring an Environment Marker', () => {
    const state = createInitialState(123);
    state.buildings = enclosedEnvironment(10, 10, 4, 2, 'indoor')
      .filter((building) => building.definitionId !== 'environment-marker');

    expect(recordHighestAreaTier(state)).toBe(8);
    expect(state.highestAreaTierEver).toBe(8);
  });

  it('recognizes a wall ring with one wood door as an enclosed room', () => {
    const state = createInitialState(124);
    state.buildings = enclosedEnvironment(10, 10, 5, 6, 'indoor')
      .filter((building) => building.definitionId !== 'environment-marker');
    const doorway = state.buildings.find((building) =>
      building.definitionId === 'wood-wall' &&
      building.tileX === 12 && building.tileY === 15 && building.boundaryEdge === 'south'
    )!;
    doorway.definitionId = 'wood-door';

    expect(recordHighestAreaTier(state)).toBe(16);
    expect(state.highestAreaTierEver).toBe(16);
    expect(enclosureGaps(state.buildings)).toEqual([]);
  });

  it('reports the exact canonical edge left open in an enclosure', () => {
    const buildings = enclosedEnvironment(20, 20, 2, 2, 'indoor')
      .filter((building) => building.definitionId !== 'environment-marker');
    const missing = buildings.find((building) =>
      building.tileX === 20 && building.tileY === 20 && building.boundaryEdge === 'west'
    )!;

    expect(enclosureGaps(buildings.filter((building) => building.id !== missing.id))).toEqual([{
      tileX: 20,
      tileY: 20,
      edge: 'west',
      surfaceKind: 'floor',
      reason: 'missing',
    }]);
  });

  it('awards the Nook tier for any four enclosed floor tiles, including a narrow room with a door', () => {
    const state = createInitialState(125);
    state.buildings = enclosedEnvironment(10, 10, 4, 1, 'indoor')
      .filter((building) => building.definitionId !== 'environment-marker');
    const doorway = state.buildings.find((building) =>
      building.definitionId === 'wood-wall'
      && building.tileX === 11 && building.tileY === 10 && building.boundaryEdge === 'south'
    )!;
    doorway.definitionId = 'wood-door';

    expect(recordHighestAreaTier(state)).toBe(4);
    expect(state.highestAreaTierEver).toBe(4);
  });

  it('returns an exact placement reason for current geometry and environment kind', () => {
    const gardenBed = PLACEABLES.find((placeable) => placeable.id === 'garden-bed')!;
    expect(evaluatePlaceableGate(gardenBed, { ...enclosedIndoor(4, 2), kind: 'workYard' })).toEqual({
      ok: false,
      reason: 'Needs 8-tile area; current valid area is 4',
    });
    expect(evaluatePlaceableGate(gardenBed, enclosedIndoor(8, 2))).toEqual({
      ok: false,
      reason: 'Requires a work yard (prepared ground)',
    });
    expect(evaluatePlaceableGate(gardenBed, { ...enclosedIndoor(8, 2), kind: 'workYard' })).toEqual({ ok: true });
  });

  it('requires floor beneath the whole Workbench footprint without requiring enclosure', () => {
    const workbench = PLACEABLES.find((placeable) => placeable.id === 'workbench')!;
    const furnace = PLACEABLES.find((placeable) => placeable.id === 'furnace')!;
    const purifier = PLACEABLES.find((placeable) => placeable.id === 'air-purifier')!;
    const openFloors = [
      { id: 'floor-a', definitionId: 'wood-floor' as const, tileX: 10, tileY: 10 },
      { id: 'floor-b', definitionId: 'thatch-floor' as const, tileX: 11, tileY: 10 },
    ];

    expect(workbench).toMatchObject({ requiredSurface: 'floor' });
    expect(evaluateFacilityGate([], workbench, 10, 10, 2, 1)).toEqual({
      ok: false,
      reason: 'Place it on a floor',
    });
    expect(evaluateFacilityGate(openFloors.slice(0, 1), workbench, 10, 10, 2, 1)).toEqual({
      ok: false,
      reason: 'Place it on a floor',
    });
    expect(evaluateFacilityGate(openFloors, workbench, 10, 10, 2, 1)).toEqual({ ok: true });
    expect(evaluateFacilityGate(openFloors, purifier, 10, 10, 1, 1)).toEqual({ ok: true });
    expect(evaluateFacilityGate(openFloors, furnace, 10, 10, 2, 1)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^Enclose the space fully/),
    });
  });

  it('treats doors and gates as logical flood boundaries and protects marked-region merges', () => {
    const buildings = [
      { id: 'left', definitionId: 'wood-floor' as const, tileX: 10, tileY: 10 },
      { id: 'right', definitionId: 'wood-floor' as const, tileX: 11, tileY: 10 },
      { id: 'door', definitionId: 'wood-door' as const, tileX: 10, tileY: 10, boundaryEdge: 'east' as const },
      { id: 'marker-left', definitionId: 'environment-marker' as const, tileX: 10, tileY: 10, environmentKind: 'indoor' as const },
      { id: 'marker-right', definitionId: 'environment-marker' as const, tileX: 11, tileY: 10, environmentKind: 'indoor' as const },
    ];
    expect(floodSurfaceRegion(buildOccupancy(buildings), 10, 10)?.cells.size).toBe(1);
    expect(boundaryRemovalMergeConflict(buildings, buildings[2]!)).toBe(true);
  });
});
