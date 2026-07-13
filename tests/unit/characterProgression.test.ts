import { describe, expect, it } from 'vitest';
import {
  actionCooldown,
  attackPower,
  defensePower,
  grantXp,
  inventoryCapacity,
  movementSpeed,
  spendAttributePoint,
  xpToNextLevel,
} from '../../src/simulation/characterProgression';
import { createInitialState } from '../../src/simulation/state';

describe('character levels and attributes', () => {
  it('carries overflow XP across levels and grants one point per level', () => {
    const state = createInitialState(123);
    expect(grantXp(state, 260)).toEqual({ levelsGained: 2, pointsGained: 2 });
    expect(state.player).toMatchObject({ level: 3, xp: 10, attributePoints: 2, maxHp: 110, maxStamina: 106 });
    expect(xpToNextLevel(3)).toBe(200);
  });

  it('spends points atomically and increases matching derived stats', () => {
    const state = createInitialState(123);
    state.player.attributePoints = 8;
    expect(spendAttributePoint(state, 'vitality')).toBe(true);
    expect(state.player).toMatchObject({ maxHp: 110, hp: 110, attributePoints: 7 });
    spendAttributePoint(state, 'strength');
    spendAttributePoint(state, 'defense');
    spendAttributePoint(state, 'agility');
    spendAttributePoint(state, 'dexterity');
    spendAttributePoint(state, 'capacity');
    expect(attackPower(state)).toBe(12);
    expect(defensePower(state)).toBe(2);
    expect(movementSpeed(state)).toBeGreaterThan(96);
    expect(actionCooldown(state, 30)).toBe(29);
    expect(inventoryCapacity(state)).toBe(22);
  });

  it('rejects spending without a point', () => {
    const state = createInitialState(123);
    expect(spendAttributePoint(state, 'strength')).toBe(false);
    expect(state.player.attributes.strength).toBe(0);
  });
});
