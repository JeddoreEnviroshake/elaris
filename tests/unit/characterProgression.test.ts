import { describe, expect, it } from 'vitest';
import {
  actionCooldown,
  attackPower,
  attributePointDetail,
  battleMoveDistance,
  doubleDropChanceBps,
  defensePower,
  gatheringPowerBonus,
  grantXp,
  healthRegeneration,
  inventoryCapacity,
  manaRegeneration,
  movementSpeed,
  recoverPlayer,
  spendAttributePoint,
  spendAttributePoints,
  staminaRegeneration,
  xpToNextLevel,
} from '../../src/simulation/characterProgression';
import { createInitialState } from '../../src/simulation/state';

describe('character levels and attributes', () => {
  it('carries overflow XP across levels, raises every stat, and grants two spendable points per level', () => {
    const state = createInitialState(123);
    expect(grantXp(state, 260)).toEqual({ levelsGained: 2, pointsGained: 4 });
    expect(state.player).toMatchObject({
      level: 3, xp: 10, attributePoints: 4,
      attributes: {
        strength: 2, dexterity: 2, magic: 2, luck: 2, speed: 2,
        health: 2, healthRegen: 2, stamina: 2, staminaRegen: 2, carryWeight: 2, mana: 2, manaRegen: 2,
      },
      maxHp: 120, hp: 120, maxStamina: 120, stamina: 120, maxMana: 50, mana: 50,
    });
    expect(xpToNextLevel(3)).toBe(200);
  });

  it('uses the Admin-configured level-up rewards', () => {
    const state = createInitialState(456);
    state.gameBalance.levelUp.attributePointsPerStat = 3;
    state.gameBalance.levelUp.spendableAttributePoints = 5;

    expect(grantXp(state, 100)).toEqual({ levelsGained: 1, pointsGained: 5 });
    expect(state.player.attributePoints).toBe(5);
    expect(state.player.attributes).toEqual({
      strength: 3, dexterity: 3, magic: 3, luck: 3, speed: 3,
      health: 3, healthRegen: 3, stamina: 3, staminaRegen: 3, carryWeight: 3, mana: 3, manaRegen: 3,
    });
    expect(state.player).toMatchObject({ maxHp: 130, maxStamina: 130, maxMana: 60 });
  });

  it('spends points atomically and increases matching derived stats', () => {
    const state = createInitialState(123);
    state.player.attributePoints = 8;
    expect(spendAttributePoint(state, 'health')).toBe(true);
    expect(state.player).toMatchObject({ maxHp: 110, hp: 110, attributePoints: 7 });
    spendAttributePoint(state, 'strength');
    spendAttributePoint(state, 'dexterity');
    spendAttributePoint(state, 'magic');
    spendAttributePoint(state, 'luck');
    spendAttributePoint(state, 'speed');
    spendAttributePoint(state, 'stamina');
    spendAttributePoint(state, 'mana');
    expect(attackPower(state)).toBe(12);
    expect(attackPower(state, 'ranged')).toBe(12);
    expect(attackPower(state, 'magic')).toBe(12);
    expect(defensePower(state)).toBe(1);
    expect(movementSpeed(state)).toBe(state.gameBalance.characterDefaults.walkSpeed + 10);
    expect(battleMoveDistance(state, 10)).toBe(11);
    expect(doubleDropChanceBps(state)).toBe(250);
    expect(actionCooldown(state, 30)).toBe(30);
    expect(inventoryCapacity(state)).toBe(20);
    expect(state.player).toMatchObject({ maxStamina: 110, stamina: 110, maxMana: 40, mana: 40, attributePoints: 0 });
  });

  it('applies a staged multi-stat allocation atomically', () => {
    const state = createInitialState(123);
    state.player.attributePoints = 3;

    expect(spendAttributePoints(state, { health: 2, strength: 2 })).toBe(false);
    expect(state.player).toMatchObject({ attributePoints: 3, maxHp: 100, hp: 100 });
    expect(state.player.attributes).toMatchObject({ health: 0, strength: 0 });

    expect(spendAttributePoints(state, { health: 2, strength: 1 })).toBe(true);
    expect(state.player).toMatchObject({ attributePoints: 0, maxHp: 120, hp: 120 });
    expect(state.player.attributes).toMatchObject({ health: 2, strength: 1 });
  });

  it('adds equipped Magic Staff power and its upgrade rank to magic damage only', () => {
    const state = createInitialState(123);
    state.tools.push({
      instanceId: 'staff-test', definitionId: 'magic-staff', durability: 240, maxDurability: 240,
      powerRank: 2, speedRank: 0, durabilityRank: 0,
    });
    state.equippedToolId = 'staff-test';

    expect(attackPower(state, 'magic')).toBe(10 + 18 + 2 * 3);
    expect(attackPower(state, 'melee')).toBe(10);
    state.tools[0]!.durability = 0;
    expect(attackPower(state, 'magic')).toBe(10);
  });

  it('rejects spending without a point', () => {
    const state = createInitialState(123);
    expect(spendAttributePoint(state, 'strength')).toBe(false);
    expect(state.player.attributes.strength).toBe(0);
  });

  it('adds 10 px/s of walk speed for every Speed point', () => {
    const state = createInitialState(123);
    const baseWalkSpeed = state.gameBalance.characterDefaults.walkSpeed;

    expect(movementSpeed(state)).toBe(baseWalkSpeed);
    state.player.attributes.speed = 1;
    expect(movementSpeed(state)).toBe(baseWalkSpeed + 10);
    state.player.attributes.speed = 4;
    expect(movementSpeed(state)).toBe(baseWalkSpeed + 40);
  });

  it('only Health, Stamina, and Mana change maximum stats', () => {
    const state = createInitialState(123);
    state.player.attributePoints = 6;
    expect(spendAttributePoint(state, 'health')).toBe(true);
    expect(spendAttributePoint(state, 'stamina')).toBe(true);
    expect(spendAttributePoint(state, 'mana')).toBe(true);
    expect(state.player).toMatchObject({ maxHp: 110, maxStamina: 110, maxMana: 40 });

    // Their recovery twins buy a rate, never a pool.
    expect(spendAttributePoint(state, 'healthRegen')).toBe(true);
    expect(spendAttributePoint(state, 'staminaRegen')).toBe(true);
    expect(spendAttributePoint(state, 'manaRegen')).toBe(true);
    expect(state.player).toMatchObject({ maxHp: 110, maxStamina: 110, maxMana: 40 });
  });

  it('recovers a quarter point per second for every regeneration point', () => {
    const state = createInitialState(123);
    state.player.hp = 50; state.player.stamina = 50; state.player.mana = 10;
    state.player.attributes.healthRegen = 1;
    state.player.attributes.staminaRegen = 2;
    state.player.attributes.manaRegen = 3;
    expect(healthRegeneration(state)).toBe(0.25);
    expect(staminaRegeneration(state)).toBe(5.5);
    expect(manaRegeneration(state)).toBe(2.75);

    // A quarter a second is one health on the fourth pulse and none before it.
    for (const second of [0, 1, 2]) {
      state.tick = second * 60;
      recoverPlayer(state);
      expect(state.player.hp).toBe(50);
    }
    state.tick = 3 * 60;
    expect(recoverPlayer(state)).toBe(true);
    expect(state.player.hp).toBe(51);
  });

  it('recovers on the whole-second cadence', () => {
    const state = createInitialState(123);
    state.tick = 60;
    state.player.hp = 50; state.player.stamina = 50; state.player.mana = 10;
    expect(recoverPlayer(state)).toBe(true);
    expect(state.player).toMatchObject({ hp: 50, stamina: 55, mana: 12 });
  });

  it('reads every per-point value from the published balance', () => {
    const state = createInitialState(123);
    const gains = state.gameBalance.attributeGains;
    gains.strengthMeleeDamage = 5;
    gains.strengthGatherDamage = 3;
    gains.dexterityRangedDamage = 4;
    gains.speedWalkPxPerSecond = 25;
    gains.speedBattleTiles = 2;
    gains.speedBattleTilesMax = 3;
    gains.luckDoubleDropChanceBps = 400;
    gains.healthRegenHundredths = 40;
    gains.healthMaxHp = 30;
    state.player.attributes = {
      ...state.player.attributes, strength: 2, dexterity: 2, luck: 2, speed: 2, health: 2, healthRegen: 2,
    };

    expect(attackPower(state)).toBe(10 + 2 * 5);
    expect(attackPower(state, 'ranged')).toBe(10 + 2 * 4);
    expect(gatheringPowerBonus(state)).toBe(6);
    expect(movementSpeed(state)).toBe(state.gameBalance.characterDefaults.walkSpeed + 50);
    // Two points at two spaces each, clamped by the retuned maximum of three.
    expect(battleMoveDistance(state, 10)).toBe(13);
    expect(doubleDropChanceBps(state)).toBe(800);
    expect(healthRegeneration(state)).toBe(0.8);

    // A retuned Max HP gain applies to the next point spent, not to past ones.
    const maxHpBefore = state.player.maxHp;
    state.player.attributePoints = 1;
    expect(spendAttributePoint(state, 'health')).toBe(true);
    expect(state.player.maxHp).toBe(maxHpBefore + 30);
  });

  it('describes each point using the published values', () => {
    const state = createInitialState(123);
    state.gameBalance.attributeGains.speedWalkPxPerSecond = 25;
    state.gameBalance.attributeGains.luckHitChanceBps = 250;

    expect(attributePointDetail(state.gameBalance, 'speed')).toContain('25 px/s');
    expect(attributePointDetail(state.gameBalance, 'luck')).toContain('2.5% hit chance');
    // The fixed-point rate is described as the decimal it promises.
    expect(attributePointDetail(state.gameBalance, 'healthRegen')).toContain('0.25 more health per second');
  });
});
