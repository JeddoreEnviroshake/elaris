import { describe, expect, it } from 'vitest';
import { PLACEABLES } from '../../src/config/areaGates';
import {
  evaluateAreaGate,
  evaluatePlaceableGate,
  recordHighestAreaTier,
  type EnvironmentMeasurement,
} from '../../src/simulation/environmentProgress';
import { createInitialState } from '../../src/simulation/state';

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
    expect(recordHighestAreaTier(state, enclosedIndoor(16, 4))).toBe(16);
    expect(state.highestAreaTierEver).toBe(16);

    expect(recordHighestAreaTier(state, enclosedIndoor(4, 2))).toBe(4);
    expect(state.highestAreaTierEver).toBe(16);
  });

  it('returns an exact placement reason for current geometry and environment kind', () => {
    const workbench = PLACEABLES.find((placeable) => placeable.id === 'workbench')!;
    expect(evaluatePlaceableGate(workbench, enclosedIndoor(4, 2))).toEqual({
      ok: false,
      reason: 'Needs 8-tile area; current valid area is 4',
    });
    expect(evaluatePlaceableGate(workbench, { ...enclosedIndoor(8, 2), kind: 'paddock' })).toEqual({
      ok: false,
      reason: 'Requires a indoor environment',
    });
    expect(evaluatePlaceableGate(workbench, enclosedIndoor(8, 2))).toEqual({ ok: true });
  });
});
