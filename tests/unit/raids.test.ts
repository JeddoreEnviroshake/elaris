import { describe, expect, it } from 'vitest';
import { TILE_SIZE, WORLD_PX } from '../../src/config/platform';
import {
  createDefaultGameBalance,
  leveledRaiderDefinition,
  PLAYER_SHOT_DAMAGE,
  TURRET_AMMO_CAPACITY,
  TURRET_DAMAGE,
  TURRET_FIRE_COOLDOWN_TICKS,
} from '../../src/config/balance';
import { type BuildingState, type GameState } from '../../src/simulation/state';
import { createOrdinaryState as createInitialState } from './helpers/ordinaryWorld';
import {
  advanceRaid,
  blockingBoundary,
  damageRaider,
  firePlayerShot,
  loadTurretAmmo,
  raidTargetGroups,
  raidTargets,
  raidWaveFor,
  spawnRaidersForCurrentArea,
  unloadTurretAmmo,
} from '../../src/simulation/raids';
import { DANGER_PHASE_SECONDS, isPlayerSheltered, SAFE_PHASE_SECONDS } from '../../src/simulation/survivalCycle';
import { damageStructure, structureHp, structureMaxHp } from '../../src/simulation/gameplayCommands';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { enclosedEnvironment } from './helpers/buildings';

/** Equip a crafted Bow. The bow is an ordinary tool now, not a durable flag. */
function equipBow(state: { tools: any[]; equippedToolId: string | null }): void {
  state.tools.push({
    instanceId: 'tool-bow-test', definitionId: 'bow', durability: 120,
    maxDurability: 120, powerRank: 0, speedRank: 0, durabilityRank: 0,
  });
  state.equippedToolId = 'tool-bow-test';
}


const TICKS_PER_SECOND = 60;
const CYCLE_TICKS = (SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * TICKS_PER_SECOND;
/**
 * The first danger phase that is actually a raid. Cycle 0 brings poison fog, so
 * every raid test lives in cycle 1 — the earliest raid night the game has.
 */
const DANGER_START_TICK = CYCLE_TICKS + SAFE_PHASE_SECONDS * TICKS_PER_SECOND;
/** A fog night's danger phase: the same clock position, one cycle earlier. */
const FOG_DANGER_START_TICK = SAFE_PHASE_SECONDS * TICKS_PER_SECOND;

/** A purified room: the only thing a raid is ever aimed at. */
function purifiedBase(left = 10, top = 10): BuildingState[] {
  const buildings = enclosedEnvironment(left, top, 3, 2, 'indoor');
  buildings.push({ id: 'building-901', definitionId: 'air-purifier', tileX: left + 1, tileY: top });
  return buildings;
}

const BALANCE = createDefaultGameBalance();
/** The wave lands only after the warning window, so tests start there. */
const RAID_ARRIVAL_TICK = DANGER_START_TICK + BALANCE.raid.spawnDelaySeconds * TICKS_PER_SECOND;

function baseState(seed = 7): GameState {
  const state = createInitialState(seed);
  state.buildings = purifiedBase();
  state.tick = RAID_ARRIVAL_TICK;
  return state;
}

describe('raid wave composition', () => {
  it('is pure and stable for the same seed, area, and cycle', () => {
    const first = raidWaveFor(1234, '0,0', 3, 40, BALANCE);
    const second = raidWaveFor(1234, '0,0', 3, 40, BALANCE);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('differs by area and grows with the cycle', () => {
    expect(raidWaveFor(1234, '0,0', 3, 40, BALANCE)).not.toEqual(raidWaveFor(1234, '1,0', 3, 40, BALANCE));
    expect(raidWaveFor(1234, '0,0', 12, 40, BALANCE).length).toBeGreaterThan(raidWaveFor(1234, '0,0', 0, 40, BALANCE).length);
  });

  it('holds the tougher kinds back until a base has survived a few rounds', () => {
    expect(new Set(raidWaveFor(99, '0,0', 0, 0, BALANCE))).toEqual(new Set(['scavenger']));
  });
});

describe('raid spawning', () => {
  it('spawns only during a danger phase and only for a purified base', () => {
    const safe = baseState();
    safe.tick = 0;
    expect(advanceRaid(safe).changed).toBe(true); // first cycle bookkeeping
    expect(safe.raiders).toHaveLength(0);

    const unpurified = baseState();
    unpurified.buildings = enclosedEnvironment(10, 10, 3, 2, 'indoor');
    advanceRaid(unpurified);
    expect(unpurified.raiders).toHaveLength(0);

    const danger = baseState();
    advanceRaid(danger);
    expect(danger.raiders.length).toBeGreaterThan(0);
  });

  it('spawns raiders on integer coordinates so the state hash stays valid', () => {
    const state = baseState();
    advanceRaid(state);
    for (const raider of state.raiders) {
      expect(Number.isSafeInteger(raider.x)).toBe(true);
      expect(Number.isSafeInteger(raider.y)).toBe(true);
    }
    expect(() => canonicalizeGameState(state)).not.toThrow();
  });

  it('does not spawn a second wave for the same base in the same cycle', () => {
    const state = baseState();
    advanceRaid(state);
    const spawned = state.raiders.length;
    state.raiders = [];
    advanceRaid(state);
    expect(state.raiders).toHaveLength(0);
    expect(spawned).toBeGreaterThan(0);
  });

  it('holds the wave off-map for the warning window at the start of the phase', () => {
    const state = baseState();
    state.tick = DANGER_START_TICK;
    advanceRaid(state);
    expect(state.raiders).toHaveLength(0);

    state.tick = RAID_ARRIVAL_TICK;
    advanceRaid(state);
    expect(state.raiders.length).toBeGreaterThan(0);
  });

  it('clears raiders when the danger minute ends', () => {
    const state = baseState();
    advanceRaid(state);
    expect(state.raiders.length).toBeGreaterThan(0);
    state.tick = DANGER_START_TICK + 60 * TICKS_PER_SECOND;
    advanceRaid(state);
    expect(state.raiders).toHaveLength(0);
  });

  it('never spawns during a poison-fog danger phase', () => {
    const state = baseState();
    state.tick = FOG_DANGER_START_TICK + BALANCE.raid.spawnDelaySeconds * TICKS_PER_SECOND;
    advanceRaid(state);
    expect(state.raiders).toHaveLength(0);
  });

  it('leaves an absent base alone for the fog cycle it was never raided in', () => {
    const state = baseState();
    state.currentArea = { key: '5,5', x: 5, y: 5, name: 'Away', theme: 'forest', seed: 4 };
    state.buildings = [];
    state.visitedAreas['0,0'] = {
      key: '0,0', x: 0, y: 0, name: 'Elaris', theme: 'elaris', seed: state.seed,
      resourceNodes: [], wildCreatures: [], groundDrops: [], containers: [], raiders: [], buildings: purifiedBase(),
    };
    const before = state.visitedAreas['0,0']!.buildings.length;

    // Sit through cycle 0 — a fog night — and cross its danger→safe boundary.
    state.tick = FOG_DANGER_START_TICK;
    advanceRaid(state);
    state.tick = FOG_DANGER_START_TICK + 60 * TICKS_PER_SECOND;
    const result = advanceRaid(state);

    expect(result.absentReports).toBeUndefined();
    expect(state.visitedAreas['0,0']!.buildings).toHaveLength(before);
  });
});

describe('hunting the player', () => {
  /** Drop the player just outside the base, well inside aggro range. */
  function exposePlayer(state: GameState): void {
    const raider = state.raiders[0]!;
    state.player.x = raider.x + TILE_SIZE * 2;
    state.player.y = raider.y;
  }

  it('walks toward an unsheltered player instead of the base', () => {
    const state = baseState();
    advanceRaid(state);
    exposePlayer(state);
    const raider = state.raiders[0]!;
    const before = Math.abs(raider.x - state.player.x);

    advanceRaid(state);

    expect(Math.abs(raider.x - state.player.x)).toBeLessThan(before);
    expect(raider.targetBuildingId).toBeNull();
  });

  it('ignores a player sealed inside an enclosed room and goes back to the base', () => {
    const state = baseState();
    advanceRaid(state);
    const raider = state.raiders[0]!;
    // Inside the purified room from purifiedBase(), which is also enclosed.
    state.player.x = 11 * TILE_SIZE + TILE_SIZE / 2;
    state.player.y = 10 * TILE_SIZE + TILE_SIZE / 2;
    raider.x = Math.round(state.player.x) + TILE_SIZE;
    raider.y = Math.round(state.player.y);

    const hpBefore = state.player.hp;
    advanceRaid(state);

    expect(state.player.hp).toBe(hpBefore);
    expect(raider.targetBuildingId).not.toBeNull();
  });

  it('hits the wall rather than the player standing behind it, who can still shoot back', () => {
    const state = baseState();
    advanceRaid(state);
    const raider = state.raiders[0]!;
    // A lone wall segment far from the base: no enclosure, so the player is a
    // legal target in every way except that this wall is in the way.
    state.buildings.push({
      id: 'building-cover', definitionId: 'wood-wall', tileX: 40, tileY: 40, boundaryEdge: 'east',
    });
    state.player.x = 40 * TILE_SIZE + TILE_SIZE / 2;
    state.player.y = 40 * TILE_SIZE + TILE_SIZE / 2;
    raider.x = 41 * TILE_SIZE + 4;
    raider.y = Math.round(state.player.y);
    raider.nextAttackTick = state.tick;

    const hpBefore = state.player.hp;
    advanceRaid(state);

    expect(state.player.hp).toBe(hpBefore);
    expect(raider.targetBuildingId).toBe('building-cover');

    // The player's side of the same wall: cover works in one direction only.
    state.inventory.arrow = 3;
    equipBow(state);
    expect(firePlayerShot(state, raider.id)).toMatchObject({ ok: true });
  });

  it('ignores an exposed player standing beyond aggro range', () => {
    const state = baseState();
    advanceRaid(state);
    const raider = state.raiders[0]!;
    state.player.x = raider.x;
    state.player.y = raider.y;
    // One tile past the aggro ring, on the axis the raider would walk.
    state.player.x = raider.x + (BALANCE.defense.raiderAggroRangeTiles + 1) * TILE_SIZE;

    const hpBefore = state.player.hp;
    advanceRaid(state);
    expect(state.player.hp).toBe(hpBefore);
  });

  it('crosses the whole map for the player under the player-first priority', () => {
    const state = baseState();
    state.gameBalance.raid.targetPriority = 'player-first';
    advanceRaid(state);
    const raider = state.raiders[0]!;
    // Far past the aggro ring: ignored by every other priority, chased by this one.
    state.player.x = raider.x + (BALANCE.defense.raiderAggroRangeTiles + 10) * TILE_SIZE;
    state.player.y = raider.y;
    const before = Math.abs(raider.x - state.player.x);

    advanceRaid(state);

    expect(Math.abs(raider.x - state.player.x)).toBeLessThan(before);
    expect(raider.targetBuildingId).toBeNull();
  });

  it('falls back to the base under player-first once the player is sealed in', () => {
    const state = baseState();
    state.gameBalance.raid.targetPriority = 'player-first';
    advanceRaid(state);
    const raider = state.raiders[0]!;
    state.player.x = 11 * TILE_SIZE + TILE_SIZE / 2;
    state.player.y = 10 * TILE_SIZE + TILE_SIZE / 2;
    raider.x = Math.round(state.player.x) + TILE_SIZE;
    raider.y = Math.round(state.player.y);

    const hpBefore = state.player.hp;
    advanceRaid(state);

    expect(state.player.hp).toBe(hpBefore);
    expect(raider.targetBuildingId).not.toBeNull();
  });

  it('raids a base-less player under player-first, who has nothing else to lose', () => {
    const state = baseState();
    state.gameBalance.raid.targetPriority = 'player-first';
    state.buildings = [];
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;

    advanceRaid(state);

    expect(state.raiders.length).toBeGreaterThan(0);
    expect(() => canonicalizeGameState(state)).not.toThrow();
  });

  it('damages a player it reaches, using playerDamage rather than structure damage', () => {
    const state = baseState();
    advanceRaid(state);
    const raider = state.raiders[0]!;
    state.player.x = raider.x;
    state.player.y = raider.y;
    raider.nextAttackTick = state.tick;
    // Levelled: a wave takes the rank of the ground its target base stands on,
    // so the damage the player actually takes is this raider's, not the kind's.
    const definition = leveledRaiderDefinition(state, raider);
    const hpBefore = state.player.hp;

    advanceRaid(state);

    expect(state.player.hp).toBe(hpBefore - definition.playerDamage);
    expect(definition.playerDamage).not.toBe(definition.damage);
  });

  it('keeps raider positions whole while chasing a player on fractional pixels', () => {
    const state = baseState();
    advanceRaid(state);
    const raider = state.raiders[0]!;
    // The player walks on interpolated pixels between tiles, so mid-move
    // player.x really is fractional; a raider must not inherit that fraction,
    // because unlike the player it never snaps back to a tile centre and the
    // canonical state hash would stay broken for the rest of the raid.
    state.player.x = raider.x + TILE_SIZE * 2 + 0.37;
    state.player.y = raider.y + 0.91;

    advanceRaid(state);

    expect(Number.isSafeInteger(raider.x)).toBe(true);
    expect(Number.isSafeInteger(raider.y)).toBe(true);
    // Settle the player onto a whole pixel, as the end of a move does, so the
    // check below is about the raider rather than the player's own interpolation.
    state.player.x = Math.round(state.player.x);
    state.player.y = Math.round(state.player.y);
    expect(() => canonicalizeGameState(state)).not.toThrow();
  });

  it('persists a respawn choice when a raider lands the killing blow', () => {
    const state = baseState();
    advanceRaid(state);
    const raider = state.raiders[0]!;
    state.player.x = raider.x;
    state.player.y = raider.y;
    raider.nextAttackTick = state.tick;
    state.player.hp = 1;

    const result = advanceRaid(state);

    expect(result.defeat).toBeDefined();
    expect(result.defeat).toMatchObject({ cause: 'raider', pendingRespawn: true });
    expect(state.pendingRespawn).toMatchObject({ cause: 'raider' });
    expect(state.player.hp).toBe(0);
    expect(state.dangerExposureStartedAtTick).toBeNull();
  });

  it('does not hunt the player during post-respawn protection', () => {
    const state = baseState();
    advanceRaid(state);
    const raider = state.raiders[0]!;
    state.player.x = raider.x;
    state.player.y = raider.y;
    state.player.hp = 1;
    state.respawnProtectionUntilTick = state.tick + 60;
    raider.nextAttackTick = state.tick;

    const result = advanceRaid(state);

    expect(result.defeat).toBeUndefined();
    expect(state.player.hp).toBe(1);
  });
});

describe('raider crowding', () => {
  /** The tightest gap between any two hostiles, in pixels. */
  function tightestGap(state: GameState): number {
    let tightest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < state.raiders.length; i += 1) {
      for (let j = i + 1; j < state.raiders.length; j += 1) {
        const a = state.raiders[i]!;
        const b = state.raiders[j]!;
        tightest = Math.min(tightest, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    return tightest;
  }

  it('keeps a wave walking the same line from melting into one raider', () => {
    const state = baseState();
    advanceRaid(state);
    // Parked out of reach, so this is about the wave converging on the base
    // rather than about a hunt that ends in a defeat.
    state.player.x = WORLD_PX - TILE_SIZE;
    state.player.y = WORLD_PX - TILE_SIZE;
    expect(state.raiders.length).toBeGreaterThan(4);

    for (let step = 0; step < 10 * TICKS_PER_SECOND; step += 1) {
      state.tick += 1;
      advanceRaid(state);
      // Never at any point during the approach, not merely once it settles.
      expect(tightestGap(state)).toBeGreaterThan(12);
    }
    // Converged on the base and still spread out to about the full radius.
    expect(tightestGap(state)).toBeGreaterThan(17);
  });

  it('shoves a perfectly stacked pair apart on whole pixels', () => {
    const state = baseState();
    advanceRaid(state);
    const [first, second] = state.raiders;
    second!.x = first!.x;
    second!.y = first!.y;

    state.tick += 1;
    advanceRaid(state);

    expect(Math.hypot(first!.x - second!.x, first!.y - second!.y)).toBeGreaterThan(0);
    expect(() => canonicalizeGameState(state)).not.toThrow();
  });
});

describe('raiders breaking in', () => {
  it('reports a wall in the way rather than routing around it', () => {
    const state = baseState();
    // Standing just west of the room's west wall, walking east.
    const wall = blockingBoundary(state.buildings, 9 * TILE_SIZE + 8, 10 * TILE_SIZE + 8, 1, 0);
    expect(wall?.definitionId).toBe('wood-wall');
  });

  it('walks through a doorway, because an unwalled opening is a real hole', () => {
    const state = baseState();
    const west = state.buildings.find((b) => b.boundaryEdge === 'west' && b.tileX === 10 && b.tileY === 10)!;
    west.definitionId = 'wood-door';
    expect(blockingBoundary(state.buildings, 9 * TILE_SIZE + 8, 10 * TILE_SIZE + 8, 1, 0)).toBeNull();
  });

  it('destroys a wall it chews through and then reaches the facility behind it', () => {
    const state = baseState();
    advanceRaid(state);
    const standing = state.buildings.length;

    // Run the raid until the wave breaks something. Which part gives first is
    // emergent: personal space spreads the wave along the face it arrives at,
    // so no single panel is guaranteed to be the one that falls.
    for (let step = 0; step < 60 * TICKS_PER_SECOND && state.buildings.length === standing; step += 1) {
      state.tick += 1;
      advanceRaid(state);
    }
    expect(state.buildings.length).toBeLessThan(standing);
    // Destroyed means removed, never a husk left behind at 0 hp.
    expect(state.buildings.some((b) => b.hp === 0)).toBe(false);
  });
});

describe('structure destruction', () => {
  it('removes a facility at 0 hp instead of disabling it', () => {
    const state = baseState();
    const purifier = state.buildings.find((b) => b.definitionId === 'air-purifier')!;
    const max = structureMaxHp(purifier)!;

    expect(damageStructure(state, purifier.id, max - 1)).toMatchObject({ destroyed: false, remaining: 1 });
    expect(structureHp(state.buildings.find((b) => b.id === purifier.id)!)).toBe(1);
    expect(damageStructure(state, purifier.id, 1)).toMatchObject({ destroyed: true });
    expect(state.buildings.some((b) => b.id === purifier.id)).toBe(false);
  });

  it('ends shelter the moment the Air Purifier is destroyed', () => {
    const state = baseState();
    state.player.x = 11 * TILE_SIZE + 8;
    state.player.y = 10 * TILE_SIZE + 8;
    expect(isPlayerSheltered(state)).toBe(true);

    const purifier = state.buildings.find((b) => b.definitionId === 'air-purifier')!;
    damageStructure(state, purifier.id, structureMaxHp(purifier)!);
    expect(isPlayerSheltered(state)).toBe(false);
  });

  it('spills a destroyed storage box rather than deleting its contents', () => {
    const state = baseState();
    const box: BuildingState = {
      id: 'building-950', definitionId: 'field-cache', tileX: 11, tileY: 11,
      storage: { wood: 12, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 },
    };
    state.buildings.push(box);

    damageStructure(state, box.id, structureMaxHp(box)!);
    expect(state.buildings.some((b) => b.id === box.id)).toBe(false);
    expect(state.groundDrops.find((drop) => drop.resource === 'wood')?.amount).toBe(12);
  });

  it('never lowers the sticky area tier or rating when a base is destroyed', () => {
    const state = baseState();
    // Destroying the first wall re-derives progress, so the peaks recorded
    // there are the ones the rest of the demolition must not walk back.
    damageStructure(state, state.buildings.find((b) => b.definitionId === 'wood-wall')!.id, 9_999);
    const peakTier = state.highestAreaTierEver;
    const peakRating = state.highestRatingEverTenths;
    expect(peakRating).toBeGreaterThan(0);

    for (const building of [...state.buildings]) damageStructure(state, building.id, 9_999);
    // Floors have no health pool and survive: a raid strips a base back to its
    // bare foundations, it does not unbuild the ground.
    expect(state.buildings.every((b) => b.definitionId === 'wood-floor')).toBe(true);
    expect(state.highestAreaTierEver).toBe(peakTier);
    expect(state.highestRatingEverTenths).toBe(peakRating);
  });
});

describe('turrets', () => {
  function withTurret(state: GameState, ammo: number): BuildingState {
    const turret: BuildingState = {
      id: 'building-960', definitionId: 'turret', tileX: 11, tileY: 11,
      turret: { ammo, nextFireTick: 0 },
    };
    state.buildings.push(turret);
    return turret;
  }

  it('fires exactly one arrow per shot and stops when dry', () => {
    const state = baseState();
    const turret = withTurret(state, 2);
    advanceRaid(state);
    const victim = state.raiders[0]!;
    victim.x = 11 * TILE_SIZE + 8;
    victim.y = 12 * TILE_SIZE + 8;
    victim.hp = victim.maxHp = 500;

    advanceRaid(state);
    expect(turret.turret!.ammo).toBe(1);
    expect(victim.hp).toBe(500 - TURRET_DAMAGE);

    state.tick += TURRET_FIRE_COOLDOWN_TICKS;
    advanceRaid(state);
    expect(turret.turret!.ammo).toBe(0);

    state.tick += TURRET_FIRE_COOLDOWN_TICKS;
    advanceRaid(state);
    expect(turret.turret!.ammo).toBe(0);
    expect(victim.hp).toBe(500 - TURRET_DAMAGE * 2);
  });

  it('loads and unloads the player’s own arrows', () => {
    const state = baseState();
    const turret = withTurret(state, 0);
    state.inventory.arrow = 10;

    expect(loadTurretAmmo(state, turret.id, 4).ok).toBe(true);
    expect(turret.turret!.ammo).toBe(4);
    expect(state.inventory.arrow).toBe(6);

    expect(loadTurretAmmo(state, turret.id, 999).ok).toBe(true);
    expect(turret.turret!.ammo).toBe(10);
    expect(state.inventory.arrow).toBe(0);
    expect(loadTurretAmmo(state, turret.id, 1)).toMatchObject({ ok: false });

    expect(unloadTurretAmmo(state, turret.id, 3).ok).toBe(true);
    expect(state.inventory.arrow).toBe(3);
    expect(turret.turret!.ammo).toBe(7);
  });

  it('never loads past capacity', () => {
    const state = baseState();
    const turret = withTurret(state, 0);
    state.inventory.arrow = TURRET_AMMO_CAPACITY + 25;
    loadTurretAmmo(state, turret.id, TURRET_AMMO_CAPACITY + 25);
    expect(turret.turret!.ammo).toBe(TURRET_AMMO_CAPACITY);
    expect(state.inventory.arrow).toBe(25);
  });

  it('returns loaded arrows to the player when the turret is destroyed', () => {
    const state = baseState();
    const turret = withTurret(state, 9);
    state.inventory.arrow = 0;
    damageStructure(state, turret.id, structureMaxHp(turret)!);
    expect(state.groundDrops).toContainEqual(expect.objectContaining({ resource: 'arrow', amount: 9 }));
  });
});

describe('the player’s shot', () => {
  it('spends an arrow, damages a raider, and respects the action cooldown', () => {
    const state = baseState();
    spawnRaidersForCurrentArea(state);
    const target = state.raiders[0]!;
    target.hp = target.maxHp = 500;
    state.player.x = target.x;
    state.player.y = target.y;
    state.inventory.arrow = 3;
    equipBow(state);

    expect(firePlayerShot(state)).toMatchObject({ ok: true, killed: false });
    expect(state.inventory.arrow).toBe(2);
    expect(target.hp).toBe(500 - PLAYER_SHOT_DAMAGE);
    expect(firePlayerShot(state)).toMatchObject({ ok: false, message: 'Not ready yet' });
  });

  it('fires out of a sealed room, because the player shoots through walls', () => {
    const state = baseState();
    spawnRaidersForCurrentArea(state);
    const target = state.raiders[0]!;
    target.hp = target.maxHp = 500;
    state.inventory.arrow = 3;
    equipBow(state);
    // Standing inside the purified room, with a raider close enough to hit.
    state.player.x = 11 * TILE_SIZE + TILE_SIZE / 2;
    state.player.y = 10 * TILE_SIZE + TILE_SIZE / 2;
    target.x = Math.round(state.player.x) + TILE_SIZE;
    target.y = Math.round(state.player.y);

    expect(firePlayerShot(state)).toMatchObject({ ok: true, killed: false });
    expect(state.inventory.arrow).toBe(2);
    expect(target.hp).toBe(500 - PLAYER_SHOT_DAMAGE);
  });

  it('refuses without a bow in hand, without arrows, or without a target in range', () => {
    const state = baseState();
    spawnRaidersForCurrentArea(state);
    state.inventory.arrow = 5;
    expect(firePlayerShot(state)).toMatchObject({ ok: false, message: 'Equip a bow to shoot' });

    equipBow(state);
    state.inventory.arrow = 0;
    expect(firePlayerShot(state)).toMatchObject({ ok: false, message: 'Out of arrows' });

    // Well clear of the base, so the only reason nothing can be hit is range.
    state.inventory.arrow = 5;
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    expect(firePlayerShot(state)).toMatchObject({ ok: false, message: 'No raider in range' });
  });

  it('shoots as far as the Bow’s Range global value allows', () => {
    const state = baseState();
    spawnRaidersForCurrentArea(state);
    const target = state.raiders[0]!;
    target.hp = target.maxHp = 500;
    state.inventory.arrow = 5;
    equipBow(state);
    // Clear of the base, so range is the only thing under test here.
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    const bowRangePx = state.gameBalance.tools.bow.rangePx;
    target.x = Math.round(state.player.x + bowRangePx + 4 * TILE_SIZE);
    target.y = Math.round(state.player.y);

    expect(firePlayerShot(state)).toMatchObject({ ok: false, message: 'No raider in range' });

    state.gameBalance.tools.bow.rangePx = bowRangePx + 8 * TILE_SIZE;

    expect(firePlayerShot(state)).toMatchObject({ ok: true });
    expect(target.hp).toBe(500 - PLAYER_SHOT_DAMAGE);
  });

  it('pays a bounty of half the raider’s health and never touches the encounter system', () => {
    const state = baseState();
    spawnRaidersForCurrentArea(state);
    const target = state.raiders[0]!;
    const coinsBefore = state.coins;

    const result = damageRaider(state, target, target.maxHp);

    // blueprintId is whatever this raider's seeded roll produced; the bounty
    // contract is what this test is about.
    expect(result).toMatchObject({ killed: true, bounty: Math.floor(target.maxHp / 2) });
    expect(state.raiders).not.toContain(target);
    expect(state.coins).toBe(coinsBefore + Math.floor(target.maxHp / 2));
    expect(state.activeEncounter).toBeNull();
  });

  it('pays nothing for a hit that leaves the raider standing', () => {
    const state = baseState();
    spawnRaidersForCurrentArea(state);
    const target = state.raiders[0]!;
    const coinsBefore = state.coins;

    expect(damageRaider(state, target, 1)).toEqual({ killed: false, bounty: 0, blueprintId: null });
    expect(state.coins).toBe(coinsBefore);
  });
});

describe('absent bases', () => {
  it('settles an off-screen base at the end of the round and reports its losses', () => {
    const state = baseState();
    state.currentArea = { key: '5,5', x: 5, y: 5, name: 'Away', theme: 'forest', seed: 4 };
    state.buildings = [];
    state.visitedAreas['0,0'] = {
      key: '0,0', x: 0, y: 0, name: 'Elaris', theme: 'elaris', seed: state.seed,
      resourceNodes: [], wildCreatures: [], groundDrops: [], containers: [], raiders: [], buildings: purifiedBase(),
    };
    const before = state.visitedAreas['0,0']!.buildings.length;

    advanceRaid(state); // enters the danger round in the away area
    state.tick = DANGER_START_TICK + 60 * TICKS_PER_SECOND;
    const result = advanceRaid(state);

    expect(result.absentReports).toHaveLength(1);
    expect(result.absentReports![0]).toMatchObject({ areaKey: '0,0', areaName: 'Elaris' });
    expect(result.absentReports![0]!.destroyed.length).toBeGreaterThan(0);
    expect(state.visitedAreas['0,0']!.buildings.length).toBeLessThan(before);
  });

  it('never bills a base the player defended in person', () => {
    const state = baseState();
    state.visitedAreas['0,0'] = {
      key: '0,0', x: 0, y: 0, name: 'Elaris', theme: 'elaris', seed: state.seed,
      resourceNodes: [], wildCreatures: [], groundDrops: [], containers: [], raiders: [], buildings: state.buildings,
    };
    advanceRaid(state);
    expect(state.raidSettledAreaKeys).toContain('0,0');

    state.tick = DANGER_START_TICK + 60 * TICKS_PER_SECOND;
    expect(advanceRaid(state).absentReports).toBeUndefined();
  });

  it('spends turret ammunition to kill raiders before they reach the walls', () => {
    const state = baseState();
    state.currentArea = { key: '5,5', x: 5, y: 5, name: 'Away', theme: 'forest', seed: 4 };
    state.buildings = [];
    const defended = purifiedBase();
    defended.push({
      id: 'building-980', definitionId: 'turret', tileX: 11, tileY: 11,
      turret: { ammo: TURRET_AMMO_CAPACITY, nextFireTick: 0 },
    });
    state.visitedAreas['0,0'] = {
      key: '0,0', x: 0, y: 0, name: 'Elaris', theme: 'elaris', seed: state.seed,
      resourceNodes: [], wildCreatures: [], groundDrops: [], containers: [], raiders: [], buildings: defended,
    };

    advanceRaid(state);
    state.tick = DANGER_START_TICK + 60 * TICKS_PER_SECOND;
    const report = advanceRaid(state).absentReports![0]!;

    expect(report.raidersDefeated).toBeGreaterThan(0);
    const turret = state.visitedAreas['0,0']!.buildings.find((b) => b.definitionId === 'turret');
    expect(turret?.turret?.ammo).toBeLessThan(TURRET_AMMO_CAPACITY);
  });
});

describe('raid targets', () => {
  it('leaves the Air Purifier for last by default, so a breach is not a death', () => {
    const state = baseState();
    state.buildings.push({ id: 'building-970', definitionId: 'bed', tileX: 11, tileY: 11 });
    const targets = raidTargets(state.buildings);
    expect(targets.at(-1)!.definitionId).toBe('air-purifier');
    expect(targets.map((target) => target.definitionId)).toContain('bed');
  });

  it('takes the whole first group before touching the next, not just the nearest', () => {
    const state = baseState();
    state.buildings.push({ id: 'building-970', definitionId: 'bed', tileX: 11, tileY: 11 });

    // A purifier standing closer than the bed is still spared under
    // 'purifier-last', which is the difference between a ranked priority and a
    // tiebreak between equally distant candidates.
    const groups = raidTargetGroups(state.buildings, 'purifier-last');
    expect(groups[0]!.map((target) => target.definitionId)).not.toContain('air-purifier');
    expect(groups.at(-1)!.map((target) => target.definitionId)).toEqual(['air-purifier']);

    expect(raidTargetGroups(state.buildings, 'purifier-first')[0]!.map((t) => t.definitionId)).toEqual(['air-purifier']);
    expect(raidTargetGroups(state.buildings, 'nearest')).toHaveLength(1);
  });

  it('has nothing to aim at without a purified room', () => {
    expect(raidTargets(enclosedEnvironment(10, 10, 3, 2, 'indoor'))).toEqual([]);
  });
});
