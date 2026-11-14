import { describe, expect, it } from 'vitest';
import { bagWeightHundredths, effectiveBagCapacityHundredths, formatWeight, isBagOverburdened, isBagOverweight } from '../../src/simulation/bagWeight';
import { CARRY_WEIGHT_CAPACITY_HUNDREDTHS } from '../../src/content/npcStock';
import { movementSpeed } from '../../src/simulation/characterProgression';
import { createInitialState } from '../../src/simulation/state';
import type { BagItemId } from '../../src/simulation/state';

describe('bag weight', () => {
  it('totals every configured resource and consumable exactly', () => {
    const state = createInitialState(123);
    Object.assign(state.inventory, {
      wood: 1, stone: 1, fiber: 1, 'iron-ore': 1, 'iron-ingot': 1,
      'taming-snare': 1, berry: 1, arrow: 1, 'cloth-mask': 0,
    });

    expect(bagWeightHundredths(state)).toBe(1_400);
    expect(formatWeight(bagWeightHundredths(state))).toBe('14');
  });

  it('halves movement speed only above 100% capacity', () => {
    const state = createInitialState(456);
    state.inventory.stone = 10;
    const carried = bagWeightHundredths(state);
    state.gameBalance.bagWeight.capacityHundredths = carried;

    expect(isBagOverweight(state)).toBe(false);
    expect(movementSpeed(state)).toBe(state.gameBalance.characterDefaults.walkSpeed);

    state.gameBalance.bagWeight.capacityHundredths = carried - 1;
    expect(isBagOverweight(state)).toBe(true);
    expect(movementSpeed(state)).toBe(state.gameBalance.characterDefaults.walkSpeed * 0.5);
  });

  it('crawls at 10 px/s from double capacity, sprint included', () => {
    const state = createInitialState(4242);
    for (const item of Object.keys(state.inventory) as BagItemId[]) state.inventory[item] = 0;
    state.gameBalance.bagWeight.capacityHundredths = 1_000;
    state.gameBalance.bagWeight.itemHundredths.stone = 100;
    state.inventory.stone = 19;

    expect(isBagOverburdened(state)).toBe(false);
    expect(movementSpeed(state)).toBe(state.gameBalance.characterDefaults.walkSpeed * 0.5);

    state.inventory.stone = 20;
    expect(bagWeightHundredths(state)).toBe(effectiveBagCapacityHundredths(state) * 2);
    expect(isBagOverburdened(state)).toBe(true);
    expect(movementSpeed(state)).toBe(10);
    expect(movementSpeed(state, true)).toBe(10);
  });

  it('adds two carry-weight units per Carry Weight point', () => {
    const state = createInitialState(789);
    const before = effectiveBagCapacityHundredths(state);

    state.player.attributes.carryWeight = 3;

    expect(effectiveBagCapacityHundredths(state)).toBe(before + 3 * CARRY_WEIGHT_CAPACITY_HUNDREDTHS);
    expect(formatWeight(effectiveBagCapacityHundredths(state))).toBe('106');
  });
});
