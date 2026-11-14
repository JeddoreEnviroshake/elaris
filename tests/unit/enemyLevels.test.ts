import { describe, expect, it } from 'vitest';
import {
  createDefaultGameBalance,
  leveledCreatureDefinition,
  leveledRaiderDefinition,
} from '../../src/config/balance';
import { TILE_SIZE, WORLD_PX } from '../../src/config/platform';
import { creatureDefinition } from '../../src/content/creatures';
import { raiderDefinition } from '../../src/content/raiders';
import { clampLevel, scaleByLevel, spawnLevel } from '../../src/simulation/enemyLevels';
import { advanceRoamers } from '../../src/simulation/raids';
import { createInitialState, type GameState, type RaiderState } from '../../src/simulation/state';

const WORLD = createDefaultGameBalance().world;
const CENTER = WORLD_PX / 2;

/** Outside Elaris and out of any building, which is where roamers operate. */
function inTheWild(): GameState {
  const state = createInitialState(9001);
  state.currentArea = { ...state.currentArea, key: '1,0', theme: 'forest', x: 1, y: 0 };
  state.player.x = 40 * TILE_SIZE;
  state.player.y = 40 * TILE_SIZE;
  return state;
}

function addRoamer(state: GameState, x: number, y: number, level = 1): RaiderState {
  const roamer: RaiderState = {
    id: `roamer-${state.raiders.length}`,
    kindId: 'drifter',
    x: Math.round(x),
    y: Math.round(y),
    hp: 24,
    maxHp: 24,
    level,
    targetBuildingId: null,
    nextAttackTick: 0,
    roaming: true,
    homeX: Math.round(x),
    homeY: Math.round(y),
  };
  state.raiders.push(roamer);
  return roamer;
}

describe('scaleByLevel', () => {
  it('adds a flat share of the base for every level past the first', () => {
    // The worked example the multiplier was specified against: 60 base health
    // at a quarter per level.
    expect(scaleByLevel(60, 1, 2_500)).toBe(60);
    expect(scaleByLevel(60, 2, 2_500)).toBe(75);
    expect(scaleByLevel(60, 3, 2_500)).toBe(90);
    expect(scaleByLevel(60, 5, 2_500)).toBe(120);
  });

  it('rounds up, so a small stat never levels without moving', () => {
    expect(scaleByLevel(1, 2, 2_500)).toBe(2);
    expect(scaleByLevel(5, 2, 2_500)).toBe(7);
  });

  it('leaves everything unchanged at level 1 or with no multiplier', () => {
    expect(scaleByLevel(37, 1, 9_999)).toBe(37);
    expect(scaleByLevel(37, 9, 0)).toBe(37);
    expect(scaleByLevel(0, 9, 2_500)).toBe(0);
  });

  it('returns whole numbers, which is what state can hold', () => {
    for (let level = 1; level <= 20; level += 1) {
      expect(Number.isInteger(scaleByLevel(43, level, 1_700))).toBe(true);
    }
  });
});

describe('spawnLevel', () => {
  it('is level 1 at the middle of the home area', () => {
    expect(spawnLevel('0,0', CENTER, CENTER, WORLD)).toBe(1);
  });

  it('climbs with distance from the middle of the area', () => {
    const near = spawnLevel('0,0', CENTER + WORLD.levelBandTiles * TILE_SIZE - 1, CENTER, WORLD);
    const oneBandOut = spawnLevel('0,0', CENTER + WORLD.levelBandTiles * TILE_SIZE, CENTER, WORLD);
    const far = spawnLevel('0,0', CENTER + WORLD.levelBandTiles * TILE_SIZE * 3, CENTER, WORLD);
    expect(near).toBe(1);
    expect(oneBandOut).toBe(2);
    expect(far).toBe(4);
  });

  it('adds a level for every ring of areas away from home', () => {
    const home = spawnLevel('0,0', CENTER, CENTER, WORLD);
    expect(spawnLevel('1,0', CENTER, CENTER, WORLD)).toBe(home + WORLD.levelsPerAreaRing);
    // Chebyshev, so a diagonal neighbour is one ring out rather than two.
    expect(spawnLevel('1,1', CENTER, CENTER, WORLD)).toBe(home + WORLD.levelsPerAreaRing);
    expect(spawnLevel('-2,1', CENTER, CENTER, WORLD)).toBe(home + WORLD.levelsPerAreaRing * 2);
  });

  it('never passes the configured ceiling', () => {
    const capped = { ...WORLD, maxEnemyLevel: 3 };
    expect(spawnLevel('9,9', WORLD_PX, WORLD_PX, capped)).toBe(3);
  });

  it('is stable for the same point, which is what replay depends on', () => {
    expect(spawnLevel('2,-1', 400, 900, WORLD)).toBe(spawnLevel('2,-1', 400, 900, WORLD));
  });

  it('clamps a level to whole numbers from one up', () => {
    expect(clampLevel(0, 20)).toBe(1);
    expect(clampLevel(4.8, 20)).toBe(4);
    expect(clampLevel(99, 6)).toBe(6);
  });
});

describe('levelled definitions', () => {
  it('leaves a level 1 enemy exactly as it shipped', () => {
    const state = createInitialState(11);
    const creature = { speciesId: 'snarlfox' as const, level: 1 };
    const raider = { kindId: 'poacher' as const, level: 1 };
    expect(leveledCreatureDefinition(state, creature).encounter)
      .toEqual(creatureDefinition('snarlfox').encounter);
    expect(leveledRaiderDefinition(state, raider)).toEqual(raiderDefinition('poacher'));
  });

  it('scales health and damage, and nothing that would make an enemy harder to escape', () => {
    const state = createInitialState(11);
    const base = creatureDefinition('snarlfox').encounter;
    const levelled = leveledCreatureDefinition(state, { speciesId: 'snarlfox', level: 3 }).encounter;
    expect(levelled.maxHp).toBe(scaleByLevel(base.maxHp, 3, base.levelMultiplierBps));
    expect(levelled.attackPower).toBe(scaleByLevel(base.attackPower, 3, base.levelMultiplierBps));
    expect(levelled.speedPxPerTick).toBe(base.speedPxPerTick);
    expect(levelled.aggroRangePx).toBe(base.aggroRangePx);
    expect(levelled.leashPx).toBe(base.leashPx);
    expect(levelled.tameEaseBps).toBe(base.tameEaseBps);
    expect(levelled.dodgeBps).toBe(base.dodgeBps);
  });

  it('pays a bigger bounty for a levelled raider', () => {
    const state = createInitialState(11);
    const base = leveledRaiderDefinition(state, { kindId: 'scavenger', level: 1 });
    const levelled = leveledRaiderDefinition(state, { kindId: 'scavenger', level: 4 });
    expect(levelled.maxHp).toBeGreaterThan(base.maxHp);
    expect(levelled.playerDamage).toBeGreaterThan(base.playerDamage);
    expect(levelled.aggroRangePx).toBe(base.aggroRangePx);
  });
});

describe('per-kind aggression zones', () => {
  it('chases a player who steps inside the zone', () => {
    const state = inTheWild();
    const zone = state.gameBalance.raiders.drifter.aggroRangePx;
    const roamer = addRoamer(state, state.player.x + zone - TILE_SIZE, state.player.y);
    const before = Math.abs(roamer.x - state.player.x);

    advanceRoamers(state);

    expect(Math.abs(roamer.x - state.player.x)).toBeLessThan(before);
  });

  it('ignores a player just outside it', () => {
    const state = inTheWild();
    const zone = state.gameBalance.raiders.drifter.aggroRangePx;
    const roamer = addRoamer(state, state.player.x + zone + TILE_SIZE, state.player.y);
    const startX = roamer.x;

    advanceRoamers(state);

    expect(roamer.x).toBe(startX);
  });

  it('never gives chase when the zone is zero, however close the player stands', () => {
    const state = inTheWild();
    state.gameBalance.raiders.drifter.aggroRangePx = 0;
    const roamer = addRoamer(state, state.player.x + 8, state.player.y);
    const startX = roamer.x;

    advanceRoamers(state);

    expect(roamer.x).toBe(startX);
  });

  it('keeps the zone at its base size however high the level', () => {
    const state = inTheWild();
    const zone = state.gameBalance.raiders.drifter.aggroRangePx;
    const roamer = addRoamer(state, state.player.x + zone + TILE_SIZE, state.player.y, 6);
    const startX = roamer.x;

    advanceRoamers(state);

    expect(roamer.x).toBe(startX);
  });
});
