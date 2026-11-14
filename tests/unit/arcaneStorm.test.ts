import { describe, expect, it } from 'vitest';
import { DANGER_PHASE_SECONDS, SAFE_PHASE_SECONDS } from '../../src/config/balance';
import { TILE_SIZE } from '../../src/config/platform';
import { ELARIS_SANCTUARY_TILE, RESPAWN_PROTECTION_SECONDS } from '../../src/simulation/survivalCycle';
import {
  ARCANE_IMPACT_AFTERMATH_TICKS,
  activeStormStrikes,
  advanceArcaneStorm,
  nextStormImpactView,
  stormStrikeSchedule,
} from '../../src/simulation/arcaneStorm';
import { ELARIS_LAST_SAFE_LEVEL } from '../../src/simulation/elarisFall';
import { enterWorldArea } from '../../src/simulation/areas';
import { type GameState } from '../../src/simulation/state';
import { createOrdinaryState as createInitialState } from './helpers/ordinaryWorld';
import { terrainAt } from '../../src/simulation/landscape';
import { enclosedEnvironment } from './helpers/buildings';

const TICKS_PER_SECOND = 60;
const CYCLE_TICKS = (SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * TICKS_PER_SECOND;
/** Cycle 4 is the first storm; its danger phase starts here. */
const STORM_START_TICK = CYCLE_TICKS * 4 + SAFE_PHASE_SECONDS * TICKS_PER_SECOND;

/**
 * A character standing in open country on the first storm night. Elaris is left
 * behind deliberately: the town is the one place the storm cannot reach, so
 * testing anything else from inside it would test nothing.
 */
function stormingState(seed = 900): GameState {
  const state = createInitialState(seed);
  expect(enterWorldArea(state, 1, 0)).toBe(true);
  state.player.x = 40 * TILE_SIZE + 8;
  state.player.y = 40 * TILE_SIZE + 8;
  state.tick = STORM_START_TICK;
  return state;
}

/** Run the storm forward to an absolute tick, reporting any defeat on the way. */
function runTo(state: GameState, tick: number) {
  let defeat = null;
  while (state.tick < tick) {
    state.tick += 1;
    defeat = advanceArcaneStorm(state).defeat ?? defeat;
  }
  return defeat;
}

function tickAt(seconds: number): number {
  return STORM_START_TICK + seconds * TICKS_PER_SECOND;
}

describe('arcane strike schedule', () => {
  const storm = createInitialState(1).gameBalance.storm;

  it('fits seven impacts into a sixty-second storm, eight seconds apart', () => {
    const schedule = stormStrikeSchedule(storm, DANGER_PHASE_SECONDS);
    expect(schedule.map((slot) => slot.impactOffsetTicks / TICKS_PER_SECOND))
      .toEqual([8, 16, 24, 32, 40, 48, 56]);
  });

  it('gives every strike a three-second telegraph', () => {
    for (const slot of stormStrikeSchedule(storm, DANGER_PHASE_SECONDS)) {
      expect(slot.impactOffsetTicks - slot.telegraphOffsetTicks).toBe(3 * TICKS_PER_SECOND);
    }
  });

  it('pays exactly two of the seven, on the third and the sixth', () => {
    const rewards = stormStrikeSchedule(storm, DANGER_PHASE_SECONDS).map((slot) => slot.rewardIronOre);
    expect(rewards).toEqual([0, 0, 1, 0, 0, 1, 0]);
  });

  it('never schedules an impact that would land after the phase ends', () => {
    for (const seconds of [30, 45, 60, 90]) {
      for (const slot of stormStrikeSchedule(storm, seconds)) {
        expect(slot.impactOffsetTicks).toBeLessThan(seconds * TICKS_PER_SECOND);
      }
    }
  });
});

describe('marker creation', () => {
  it('marks the tile the player is standing on, in whole pixels', () => {
    const state = stormingState();
    runTo(state, tickAt(5));

    const [strike] = activeStormStrikes(state);
    expect(strike).toBeDefined();
    expect(strike!.x).toBe(40 * TILE_SIZE + TILE_SIZE / 2);
    expect(strike!.y).toBe(40 * TILE_SIZE + TILE_SIZE / 2);
    expect(Number.isInteger(strike!.x) && Number.isInteger(strike!.y)).toBe(true);
    expect(strike!.areaKey).toBe(state.currentArea.key);
  });

  it('appears three seconds before it lands and counts down', () => {
    const state = stormingState();
    runTo(state, tickAt(5));
    expect(nextStormImpactView(state)).toMatchObject({ secondsRemaining: 3, progress: 0 });

    runTo(state, tickAt(7));
    const view = nextStormImpactView(state)!;
    expect(view.secondsRemaining).toBe(1);
    expect(view.progress).toBeCloseTo(2 / 3, 5);
    expect(view.playerInsideRadius).toBe(true);
  });

  it('creates no markers during the safe phase and none before the storm cycle', () => {
    const state = stormingState();
    state.tick = STORM_START_TICK - TICKS_PER_SECOND * 30;
    runTo(state, STORM_START_TICK - 1);
    expect(state.arcaneStorm.strikes).toEqual([]);
    expect(state.arcaneStorm.cycleIndex).toBeNull();
  });
});

describe('taking and dodging an impact', () => {
  it('leaves a player who walks out of the ring untouched', () => {
    const state = stormingState();
    runTo(state, tickAt(5));
    const hp = state.player.hp;
    // Three tiles clear of a two-tile radius, with two seconds still to run.
    state.player.x += 3 * TILE_SIZE;
    runTo(state, tickAt(8));

    expect(state.player.hp).toBe(hp);
    expect(state.arcaneStorm.strikes[0]!.resolvedAtTick).toBe(tickAt(8));
  });

  it('deals exactly the configured damage to a player who stays', () => {
    const state = stormingState();
    const hp = state.player.hp;
    runTo(state, tickAt(9));

    expect(state.player.hp).toBe(hp - state.gameBalance.storm.playerDamage);
  });

  it('counts the edge of the ring as inside it', () => {
    const state = stormingState();
    runTo(state, tickAt(5));
    const strike = state.arcaneStorm.strikes[0]!;
    // Exactly two tiles from the centre: on the line the renderers draw.
    state.player.x = strike.x + state.gameBalance.storm.impactRadiusTiles * TILE_SIZE;
    state.player.y = strike.y;
    const hp = state.player.hp;
    runTo(state, tickAt(9));

    expect(state.player.hp).toBe(hp - state.gameBalance.storm.playerDamage);
  });

  it('leaves a player one pixel outside the ring alone', () => {
    const state = stormingState();
    runTo(state, tickAt(5));
    const strike = state.arcaneStorm.strikes[0]!;
    state.player.x = strike.x + state.gameBalance.storm.impactRadiusTiles * TILE_SIZE + 1;
    state.player.y = strike.y;
    const hp = state.player.hp;
    runTo(state, tickAt(9));

    expect(state.player.hp).toBe(hp);
  });

  it('kills a player who ignores enough markers, once, as an arcane storm', () => {
    const state = stormingState();
    state.player.hp = state.gameBalance.storm.playerDamage * 2;
    const defeat = runTo(state, tickAt(17));

    expect(defeat).toMatchObject({ cause: 'arcane-storm', pendingRespawn: true });
    expect(state.player.hp).toBe(0);
    expect(state.pendingRespawn?.cause).toBe('arcane-storm');
    // The defeat is charged once: later slots find a player already down.
    expect(runTo(state, tickAt(33))).toBeNull();
  });

  it('cannot one-shot a healthy starting character', () => {
    const state = stormingState();
    runTo(state, tickAt(9));
    expect(state.player.hp).toBeGreaterThan(0);
  });
});

describe('what does and does not protect', () => {
  it('spends slots without marking a player inside an enclosed room', () => {
    const state = stormingState();
    // No purifier: the storm asks for walls, not clean air.
    state.buildings = enclosedEnvironment(38, 38, 6, 6, 'indoor');
    const hp = state.player.hp;
    runTo(state, tickAt(17));

    expect(state.arcaneStorm.strikes).toEqual([]);
    expect(state.player.hp).toBe(hp);
    // The storm still ran its schedule while they waited: the slots are spent,
    // so stepping outside is met by the next strike, not by every banked one.
    expect(state.arcaneStorm.nextStrikeIndex).toBe(2);
  });

  it('leaves a player who runs indoors mid-telegraph untouched', () => {
    const state = stormingState();
    runTo(state, tickAt(5));
    expect(state.arcaneStorm.strikes).toHaveLength(1);

    state.buildings = enclosedEnvironment(38, 38, 6, 6, 'indoor');
    const hp = state.player.hp;
    runTo(state, tickAt(8));

    // The ring they were standing in still landed — it simply could not reach
    // through the walls they reached in time.
    expect(state.arcaneStorm.strikes[0]!.resolvedAtTick).toBe(tickAt(8));
    expect(state.player.hp).toBe(hp);
  });

  it('spends slots without marking anyone inside the Elaris sanctuary', () => {
    const state = createInitialState(901);
    state.player.x = (ELARIS_SANCTUARY_TILE.x + 0.5) * TILE_SIZE;
    state.player.y = (ELARIS_SANCTUARY_TILE.y + 0.5) * TILE_SIZE;
    state.tick = STORM_START_TICK;
    const hp = state.player.hp;
    runTo(state, tickAt(17));

    expect(state.arcaneStorm.strikes).toEqual([]);
    expect(state.arcaneStorm.nextStrikeIndex).toBe(2);
    expect(state.player.hp).toBe(hp);
  });

  it('spends slots without marking a player inside an NPC building', () => {
    // The Verdant Reach Farm stands in the same field area the storm is
    // sweeping, so this is shelter the town is not paying for.
    const state = stormingState();
    state.player.x = (78 + 0.5) * TILE_SIZE;
    state.player.y = (81 + 0.5) * TILE_SIZE;
    const hp = state.player.hp;
    runTo(state, tickAt(17));

    expect(state.arcaneStorm.strikes).toEqual([]);
    expect(state.player.hp).toBe(hp);
    expect(state.arcaneStorm.nextStrikeIndex).toBe(2);
  });

  it('lets the storm through the doorway of a building Elaris no longer keeps', () => {
    // Past the last safe level the market is rubble. Its doorway is still
    // walkable, and standing in it is standing outside.
    const state = createInitialState(902);
    state.player.level = ELARIS_LAST_SAFE_LEVEL + 1;
    state.player.x = (79 + 0.5) * TILE_SIZE;
    state.player.y = (86 + 0.5) * TILE_SIZE;
    state.tick = STORM_START_TICK;
    const hp = state.player.hp;
    runTo(state, tickAt(8));

    expect(state.arcaneStorm.strikes).toHaveLength(1);
    expect(state.arcaneStorm.strikes[0]!.resolvedAtTick).toBe(tickAt(8));
    expect(state.player.hp).toBe(hp - state.gameBalance.storm.playerDamage);
  });

  it('spends slots without marking a player locked in an encounter', () => {
    const state = stormingState();
    state.activeEncounter = { wildCreatureId: 'creature-1' } as never;
    runTo(state, tickAt(9));

    expect(state.arcaneStorm.strikes).toEqual([]);
    expect(state.arcaneStorm.nextStrikeIndex).toBe(1);
    expect(state.player.hp).toBe(state.player.maxHp);
  });

  it('spends slots without marking a player choosing a respawn', () => {
    const state = stormingState();
    state.player.hp = 0;
    state.pendingRespawn = {
      cause: 'exposure',
      lostItemCount: 0,
      defeatedAreaKey: state.currentArea.key,
      defeatedAreaName: state.currentArea.name,
      defeatedAreaX: state.currentArea.x,
      defeatedAreaY: state.currentArea.y,
      defeatedX: state.player.x,
      defeatedY: state.player.y,
      defeatedAtTick: state.tick,
    };
    runTo(state, tickAt(9));

    expect(state.arcaneStorm.strikes).toEqual([]);
    expect(state.arcaneStorm.nextStrikeIndex).toBe(1);
  });

  it('does not damage a player still under respawn protection', () => {
    const state = stormingState();
    runTo(state, tickAt(5));
    state.respawnProtectionUntilTick = state.tick + RESPAWN_PROTECTION_SECONDS * TICKS_PER_SECOND;
    const hp = state.player.hp;
    runTo(state, tickAt(8));

    // The marker was still drawn — protection hides the damage, not the storm.
    expect(state.arcaneStorm.strikes).toHaveLength(1);
    expect(state.player.hp).toBe(hp);
  });
});

describe('charged ore', () => {
  it('drops one ore per rewarding strike, expiring with the storm', () => {
    const state = stormingState();
    // Deep enough health to stand through the whole storm: this is about what
    // the storm pays out, not about what it costs to stay still for it.
    state.player.maxHp = 1_000;
    state.player.hp = 1_000;
    runTo(state, tickAt(50));

    const ore = state.groundDrops.filter((drop) => drop.resource === 'iron-ore');
    expect(ore).toHaveLength(2);
    expect(ore.every((drop) => drop.amount === 1)).toBe(true);
    for (const drop of ore) {
      expect(drop.expiresAtTick).toBe(STORM_START_TICK + DANGER_PHASE_SECONDS * TICKS_PER_SECOND);
    }
  });

  it('leaves the ore where the strike landed, not where the player ran to', () => {
    const state = stormingState();
    runTo(state, tickAt(21));
    const strike = state.arcaneStorm.strikes.find((entry) => entry.rewardIronOre > 0)!;
    state.player.x += 5 * TILE_SIZE;
    runTo(state, tickAt(25));

    const [ore] = state.groundDrops.filter((drop) => drop.resource === 'iron-ore');
    expect(ore).toMatchObject({ x: strike.x, y: strike.y });
  });
});

describe('travel, reload, and cleanup', () => {
  it('dodges a marker by leaving its area and leaves the reward behind', () => {
    const state = stormingState();
    runTo(state, tickAt(21));
    const strike = state.arcaneStorm.strikes.find((entry) => entry.rewardIronOre > 0)!;
    const originKey = strike.areaKey;
    const hp = state.player.hp;

    expect(enterWorldArea(state, 2, 0)).toBe(true);
    runTo(state, tickAt(25));

    expect(state.player.hp).toBe(hp);
    expect(state.groundDrops.some((drop) => drop.resource === 'iron-ore')).toBe(false);
    expect(state.visitedAreas[originKey]!.groundDrops.filter((drop) => drop.resource === 'iron-ore'))
      .toHaveLength(1);
  });

  it('targets the new area with the next marker after travel', () => {
    const state = stormingState();
    runTo(state, tickAt(9));
    expect(enterWorldArea(state, 2, 0)).toBe(true);
    runTo(state, tickAt(14));

    const pending = state.arcaneStorm.strikes.find((entry) => entry.resolvedAtTick === null)!;
    expect(pending.areaKey).toBe(state.currentArea.key);
  });

  it('cannot bill the same impact twice when the tick is replayed', () => {
    const state = stormingState();
    runTo(state, tickAt(9));
    const hp = state.player.hp;
    const drops = state.groundDrops.length;
    // A reload lands on the saved tick and steps again from there.
    advanceArcaneStorm(state);
    advanceArcaneStorm(state);

    expect(state.player.hp).toBe(hp);
    expect(state.groundDrops).toHaveLength(drops);
  });

  it('does not re-create a marker whose slot was already spent', () => {
    const state = stormingState();
    runTo(state, tickAt(9));
    state.arcaneStorm.strikes = [];
    advanceArcaneStorm(state);

    expect(state.arcaneStorm.strikes).toEqual([]);
    expect(state.arcaneStorm.nextStrikeIndex).toBe(1);
  });

  it('prunes a resolved marker once its aftermath has played', () => {
    const state = stormingState();
    runTo(state, tickAt(8) + ARCANE_IMPACT_AFTERMATH_TICKS - 1);
    expect(state.arcaneStorm.strikes).toHaveLength(1);

    runTo(state, tickAt(8) + ARCANE_IMPACT_AFTERMATH_TICKS);
    expect(state.arcaneStorm.strikes).toEqual([]);
  });

  it('leaves no storm state behind for the next danger phase', () => {
    const state = stormingState();
    runTo(state, STORM_START_TICK + DANGER_PHASE_SECONDS * TICKS_PER_SECOND);

    expect(state.arcaneStorm).toEqual({ cycleIndex: null, nextStrikeIndex: 0, strikes: [] });
  });
});

describe('storm caches', () => {
  const stormCaches = (state: GameState) =>
    state.containers.filter((container) => container.kind === 'storm-cache');

  it('scatters caches when the storm breaks and sweeps them when it passes', () => {
    const state = stormingState();
    const permanent = state.containers.length;
    advanceArcaneStorm(state);

    expect(stormCaches(state)).toHaveLength(state.gameBalance.blueprints.stormCachesPerStorm);
    // Nothing that was already in the world is disturbed.
    expect(state.containers.length - stormCaches(state).length).toBe(permanent);

    runTo(state, STORM_START_TICK + DANGER_PHASE_SECONDS * TICKS_PER_SECOND);
    expect(stormCaches(state)).toEqual([]);
    expect(state.containers).toHaveLength(permanent);
  });

  it('sweeps opened caches too — weather leaves no furniture behind', () => {
    const state = stormingState();
    advanceArcaneStorm(state);
    for (const cache of stormCaches(state)) cache.opened = true;

    runTo(state, STORM_START_TICK + DANGER_PHASE_SECONDS * TICKS_PER_SECOND);
    expect(stormCaches(state)).toEqual([]);
  });

  it('places every cache somewhere a player can actually stand', () => {
    const state = stormingState();
    advanceArcaneStorm(state);
    for (const cache of stormCaches(state)) {
      expect(Number.isSafeInteger(cache.x)).toBe(true);
      expect(Number.isSafeInteger(cache.y)).toBe(true);
      expect(terrainAt(state.seed, state.currentArea, cache.x, cache.y)).toBe('ground');
    }
  });

  it('gives the next storm a different set', () => {
    const first = stormingState();
    advanceArcaneStorm(first);
    const firstPositions = stormCaches(first).map((cache) => `${cache.x},${cache.y}`).join('|');

    // Two cycles on is the next storm in the rotation.
    const second = stormingState();
    second.tick = STORM_START_TICK + CYCLE_TICKS * 3;
    advanceArcaneStorm(second);
    const secondPositions = stormCaches(second).map((cache) => `${cache.x},${cache.y}`).join('|');

    expect(secondPositions).not.toBe(firstPositions);
  });

  it('scatters none at all when an admin sets the count to zero', () => {
    const state = stormingState();
    state.gameBalance.blueprints.stormCachesPerStorm = 0;
    advanceArcaneStorm(state);
    expect(stormCaches(state)).toEqual([]);
  });
});
