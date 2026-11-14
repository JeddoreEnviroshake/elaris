import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import { raiderDefinition } from '../../src/content/raiders';
import {
  advanceRaid,
  advanceRoamers,
  damageRaider,
  raidWaveFor,
  ROAMER_KIND_IDS,
} from '../../src/simulation/raids';
import { createInitialState, type GameState, type RaiderState } from '../../src/simulation/state';
import { DANGER_PHASE_SECONDS, SAFE_PHASE_SECONDS } from '../../src/config/balance';

const SEED = 5150;

/** Outside Elaris and out of any building, which is where roamers operate. */
function inTheWild(): GameState {
  const state = createInitialState(SEED);
  state.currentArea = { ...state.currentArea, key: '1,0', theme: 'forest', x: 1, y: 0 };
  state.player.x = 40 * TILE_SIZE;
  state.player.y = 40 * TILE_SIZE;
  return state;
}

function addRoamer(state: GameState, x: number, y: number): RaiderState {
  const roamer: RaiderState = {
    id: 'roamer-test',
    kindId: 'drifter',
    x: Math.round(x),
    y: Math.round(y),
    hp: 24,
    maxHp: 24,
    level: 1,
    targetBuildingId: null,
    nextAttackTick: 0,
    roaming: true,
    homeX: Math.round(x),
    homeY: Math.round(y),
  };
  state.raiders.push(roamer);
  return roamer;
}

describe('roaming hostiles', () => {
  it('ships at least one roaming kind', () => {
    expect(ROAMER_KIND_IDS.length).toBeGreaterThan(0);
    for (const kindId of ROAMER_KIND_IDS) expect(raiderDefinition(kindId).roaming).toBe(true);
  });

  it('never joins a raid wave', () => {
    const state = createInitialState(SEED);
    // Roamers carry unlockCycle 0, so without an explicit filter they would
    // flood every roster with hostiles that ignore buildings.
    for (const raidNumber of [0, 3, 6, 12]) {
      const wave = raidWaveFor(SEED, '0,0', raidNumber, 40, state.gameBalance);
      for (const kindId of wave) expect(raiderDefinition(kindId).roaming).not.toBe(true);
    }
  });

  it('closes on a player who comes within aggro range', () => {
    const state = inTheWild();
    const roamer = addRoamer(state, state.player.x + 4 * TILE_SIZE, state.player.y);
    const before = Math.abs(roamer.x - state.player.x);

    advanceRoamers(state);

    expect(Math.abs(roamer.x - state.player.x)).toBeLessThan(before);
  });

  it('ignores a player who stays outside aggro range', () => {
    const state = inTheWild();
    const distance = state.gameBalance.raiders.drifter.aggroRangePx + 4 * TILE_SIZE;
    const roamer = addRoamer(state, state.player.x + distance, state.player.y);
    const startX = roamer.x;

    advanceRoamers(state);

    expect(roamer.x).toBe(startX);
  });

  it('walks home instead of chasing past its leash', () => {
    const state = inTheWild();
    const leash = state.gameBalance.defense.roamerLeashTiles * TILE_SIZE;
    // Dragged far from home but standing right on the player: the leash has to
    // win, or one roamer could be walked across the entire map.
    const roamer = addRoamer(state, state.player.x + 8, state.player.y);
    roamer.homeX = Math.round(state.player.x + leash + 6 * TILE_SIZE);
    roamer.homeY = Math.round(state.player.y);
    const distanceHome = Math.abs(roamer.x - roamer.homeX);

    advanceRoamers(state);

    expect(Math.abs(roamer.x - roamer.homeX)).toBeLessThan(distanceHome);
  });

  it('leaves buildings alone', () => {
    const state = inTheWild();
    addRoamer(state, state.player.x + 4 * TILE_SIZE, state.player.y);

    advanceRoamers(state);

    // A roamer never acquires a structure the way a raider does.
    expect(state.raiders.every((raider) => raider.targetBuildingId === null)).toBe(true);
  });

  it('drops loot on the ground when killed', () => {
    const state = inTheWild();
    const roamer = addRoamer(state, state.player.x + 8, state.player.y);
    const loot = raiderDefinition('drifter').loot!;

    const result = damageRaider(state, roamer, 999);

    expect(result.killed).toBe(true);
    for (const [resource, amount] of Object.entries(loot)) {
      const drop = state.groundDrops.find((candidate) => candidate.resource === resource);
      expect(drop?.amount).toBe(amount);
    }
  });

  it('survives the cycle-boundary sweep that clears a finished raid wave', () => {
    const state = inTheWild();
    addRoamer(state, state.player.x + 4 * TILE_SIZE, state.player.y);
    state.raiders.push({
      id: 'raider-wave', kindId: 'scavenger', x: 100, y: 100, hp: 30, maxHp: 30, level: 1,
      targetBuildingId: null, nextAttackTick: 0,
    });
    // Push the clock into a new cycle so advanceRaid settles the old round.
    state.tick = (SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * 60 * 2;

    advanceRaid(state);

    expect(state.raiders.some((raider) => raider.roaming)).toBe(true);
    expect(state.raiders.some((raider) => !raider.roaming)).toBe(false);
  });

  it('restocks an empty area up to its quota', () => {
    const state = inTheWild();
    const quota = state.gameBalance.defense.roamersPerArea;
    // Long enough to cross many respawn cadences, and the player never moves,
    // so a spawn point rejected for being too close must be re-rolled rather
    // than retried at the same rejected spot forever.
    for (let step = 0; step < state.gameBalance.defense.roamerRespawnTicks * (quota + 4); step += 1) {
      state.tick += 1;
      advanceRoamers(state);
    }

    expect(state.raiders.filter((raider) => raider.roaming)).toHaveLength(quota);
  });

  it('does not spawn roamers in Elaris', () => {
    const state = createInitialState(SEED);
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    for (let step = 0; step < state.gameBalance.defense.roamerRespawnTicks * 4; step += 1) {
      state.tick += 1;
      advanceRoamers(state);
    }

    expect(state.raiders.some((raider) => raider.roaming)).toBe(false);
  });

  it('keeps every position a whole number, as the state hash requires', () => {
    const state = inTheWild();
    const roamer = addRoamer(state, state.player.x + 3 * TILE_SIZE, state.player.y + 17);

    for (let tick = 0; tick < 30; tick += 1) {
      state.tick += 1;
      advanceRoamers(state);
    }

    expect(Number.isInteger(roamer.x)).toBe(true);
    expect(Number.isInteger(roamer.y)).toBe(true);
  });
});
