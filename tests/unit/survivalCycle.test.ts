import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import { type GameState, type ToolInstance } from '../../src/simulation/state';
import { createOrdinaryState as createInitialState } from './helpers/ordinaryWorld';
import { CLOTH_MASK_PROTECTION_SECONDS } from '../../src/config/balance';
import {
  advanceSurvivalCycle,
  airPurifierProtectedCells,
  chooseRespawn,
  clothMaskSecondsRemaining,
  dangerGraceTimer,
  DANGER_EXPOSURE_DAMAGE_PER_SECOND,
  DANGER_GRACE_SECONDS,
  DANGER_PHASE_SECONDS,
  dangerThreatFor,
  exposureDamagePerSecond,
  isPlayerSheltered,
  isRespawnProtected,
  raidNumberFor,
  respawnDestinations,
  SAFE_PHASE_SECONDS,
  startDangerPhaseNow,
  survivalCycleIndex,
  survivalTimerAtTick,
} from '../../src/simulation/survivalCycle';
import { enclosedEnvironment } from './helpers/buildings';

const TICKS_PER_SECOND = 60;
const DANGER_START_TICK = SAFE_PHASE_SECONDS * TICKS_PER_SECOND;

/** The Bed anchors respawn; the Air Purifier is what makes the room safe. */
function baseWithBed() {
  const buildings = enclosedEnvironment(10, 10, 3, 2, 'indoor');
  buildings.push({ id: 'building-900', definitionId: 'bed', tileX: 10, tileY: 10 });
  buildings.push({ id: 'building-901', definitionId: 'air-purifier', tileX: 12, tileY: 11 });
  return buildings;
}

function carriedTool(): ToolInstance {
  return {
    instanceId: 'tool-carried', definitionId: 'wooden-axe', durability: 10, maxDurability: 10,
    powerRank: 0, speedRank: 0, durabilityRank: 0,
  };
}

function drainExposureToDefeat(state: GameState) {
  expect(advanceSurvivalCycle(state)).toBeNull();
  expect(dangerGraceTimer(state)).toEqual({ secondsRemaining: 10, label: '0:10' });
  state.tick += DANGER_GRACE_SECONDS * TICKS_PER_SECOND;
  expect(advanceSurvivalCycle(state)).toBeNull();
  let result = null;
  while (!result) {
    state.tick += 1;
    result = advanceSurvivalCycle(state);
  }
  return result;
}

describe('alternating survival timer', () => {
  it('counts 9:59 through 0:00, then 0:59 through 0:00, and repeats', () => {
    expect(survivalTimerAtTick(0)).toEqual({ phase: 'safe', threat: 'fog', secondsRemaining: 599, label: '9:59' });
    expect(survivalTimerAtTick(TICKS_PER_SECOND)).toMatchObject({ phase: 'safe', label: '9:58' });
    expect(survivalTimerAtTick(DANGER_START_TICK - 1)).toEqual({ phase: 'safe', threat: 'fog', secondsRemaining: 0, label: '0:00' });
    expect(survivalTimerAtTick(DANGER_START_TICK)).toEqual({ phase: 'danger', threat: 'fog', secondsRemaining: 59, label: '0:59' });
    expect(survivalTimerAtTick((SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * TICKS_PER_SECOND - 1))
      .toEqual({ phase: 'danger', threat: 'fog', secondsRemaining: 0, label: '0:00' });
    expect(survivalTimerAtTick((SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * TICKS_PER_SECOND))
      .toEqual({ phase: 'safe', threat: 'raid', secondsRemaining: 599, label: '9:59' });
  });
});

describe('alternating threats', () => {
  const CYCLE_TICKS = (SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * TICKS_PER_SECOND;

  it('teaches fog and raid twice each before the storm arrives', () => {
    expect([0, 1, 2, 3].map(dangerThreatFor)).toEqual(['fog', 'raid', 'fog', 'raid']);
  });

  it('rotates storm, fog, raid forever once onboarding is done', () => {
    expect([4, 5, 6, 7, 8, 9, 10].map(dangerThreatFor))
      .toEqual(['storm', 'fog', 'raid', 'storm', 'fog', 'raid', 'storm']);
  });

  it('never runs fog exposure on a storm night', () => {
    const state = createInitialState(6);
    // Cycle 4 is the first storm; stand outside with nothing built anywhere.
    state.tick = CYCLE_TICKS * 4 + DANGER_START_TICK;
    state.buildings = [];
    const hpBefore = state.player.hp;

    for (let step = 0; step < (DANGER_GRACE_SECONDS + 5) * TICKS_PER_SECOND; step += 1) {
      state.tick += 1;
      advanceSurvivalCycle(state);
    }

    expect(state.player.hp).toBe(hpBefore);
    expect(state.dangerExposureStartedAtTick).toBeNull();
  });

  it('names the coming threat throughout the safe phase that precedes it', () => {
    // The whole point of the label is preparation, so the raid cycle reads
    // "raid" from its first safe tick, not only once the raiders arrive.
    expect(survivalTimerAtTick(CYCLE_TICKS).threat).toBe('raid');
    expect(survivalTimerAtTick(CYCLE_TICKS + DANGER_START_TICK).threat).toBe('raid');
  });

  it('counts raids rather than cycles, so wave scaling keeps its slope', () => {
    expect([0, 1, 2, 3, 4, 5].map(raidNumberFor)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('does not let a storm cycle advance the raid number', () => {
    // Raid nights are cycles 1, 3, 6, 9 — so those are raids 0, 1, 2, 3, and
    // the storm and fog cycles between them buy no extra raiders.
    expect([1, 3, 6, 9].map(raidNumberFor)).toEqual([0, 1, 2, 3]);
    expect(raidNumberFor(4)).toBe(2);
    expect(raidNumberFor(5)).toBe(2);
  });

  it('never drains exposure during a raid night', () => {
    const state = createInitialState(5);
    // Cycle 1's danger phase, standing outside with no shelter anywhere.
    state.tick = CYCLE_TICKS + DANGER_START_TICK;
    state.buildings = [];
    const hpBefore = state.player.hp;

    for (let step = 0; step < (DANGER_GRACE_SECONDS + 5) * TICKS_PER_SECOND; step += 1) {
      state.tick += 1;
      advanceSurvivalCycle(state);
    }

    expect(state.player.hp).toBe(hpBefore);
    expect(state.dangerExposureStartedAtTick).toBeNull();
  });
});

describe('per-threat danger phase lengths', () => {
  /** A fog night of 30s and a raid night of 90s, so no two cycles match. */
  function unevenBalance() {
    const raid = createInitialState(21).gameBalance.raid;
    raid.dangerPhaseSecondsByThreat = { fog: 30, raid: 90, storm: 60 };
    return raid;
  }

  it('counts each danger phase down from its own length', () => {
    const raid = unevenBalance();
    expect(survivalTimerAtTick(DANGER_START_TICK, raid))
      .toEqual({ phase: 'danger', threat: 'fog', secondsRemaining: 29, label: '0:29' });

    const raidNightStart = (SAFE_PHASE_SECONDS * 2 + 30) * TICKS_PER_SECOND;
    expect(survivalTimerAtTick(raidNightStart, raid))
      .toEqual({ phase: 'danger', threat: 'raid', secondsRemaining: 89, label: '1:29' });
  });

  it('lengthens only the cycles that carry the retuned threat', () => {
    const raid = unevenBalance();
    const fogCycle = (SAFE_PHASE_SECONDS + 30) * TICKS_PER_SECOND;
    const raidCycle = (SAFE_PHASE_SECONDS + 90) * TICKS_PER_SECOND;

    expect(survivalCycleIndex(fogCycle - 1, raid)).toBe(0);
    expect(survivalCycleIndex(fogCycle, raid)).toBe(1);
    expect(survivalCycleIndex(fogCycle + raidCycle - 1, raid)).toBe(1);
    // The rotation repeats from here, so cycle 2 is fog again at a fog length.
    expect(survivalCycleIndex(fogCycle + raidCycle, raid)).toBe(2);
    expect(dangerThreatFor(2)).toBe('fog');
    expect(survivalCycleIndex(fogCycle * 2 + raidCycle, raid)).toBe(3);
  });

  it('starts the danger phase of an uneven cycle on demand', () => {
    const state = createInitialState(22);
    state.gameBalance.raid.dangerPhaseSecondsByThreat = { fog: 30, raid: 90, storm: 60 };
    const fogCycle = (SAFE_PHASE_SECONDS + 30) * TICKS_PER_SECOND;
    state.tick = fogCycle + 5 * TICKS_PER_SECOND;

    expect(startDangerPhaseNow(state).ok).toBe(true);

    expect(state.tick).toBe(fogCycle + DANGER_START_TICK);
    expect(survivalTimerAtTick(state.tick, state.gameBalance.raid))
      .toMatchObject({ phase: 'danger', threat: 'raid', secondsRemaining: 89 });
  });
});

describe('starting the danger phase on demand', () => {
  it('jumps to the first danger tick without changing the cycle it belongs to', () => {
    const state = createInitialState(11);
    state.tick = 90 * TICKS_PER_SECOND;
    const before = survivalCycleIndex(state.tick, state.gameBalance.raid);

    const result = startDangerPhaseNow(state);

    expect(result).toMatchObject({ ok: true, skippedTicks: DANGER_START_TICK - 90 * TICKS_PER_SECOND });
    expect(state.tick).toBe(DANGER_START_TICK);
    expect(survivalTimerAtTick(state.tick, state.gameBalance.raid).phase).toBe('danger');
    expect(survivalCycleIndex(state.tick, state.gameBalance.raid)).toBe(before);
    expect(state.dangerExposureStartedAtTick).toBeNull();
  });

  it('lands on the danger phase of a later cycle without rewinding the clock', () => {
    const state = createInitialState(12);
    const cycleTicks = (SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * TICKS_PER_SECOND;
    state.tick = cycleTicks * 3 + 5 * TICKS_PER_SECOND;

    expect(startDangerPhaseNow(state).ok).toBe(true);
    expect(state.tick).toBe(cycleTicks * 3 + DANGER_START_TICK);
    expect(survivalCycleIndex(state.tick, state.gameBalance.raid)).toBe(3);
  });

  it('refuses to restart a danger phase that is already running', () => {
    const state = createInitialState(13);
    state.tick = DANGER_START_TICK + 120;

    const result = startDangerPhaseNow(state);

    expect(result).toMatchObject({ ok: false, skippedTicks: 0 });
    expect(state.tick).toBe(DANGER_START_TICK + 120);
  });
});

describe('danger exposure and Bed respawn', () => {
  it('protects a 1-tile radius around an unenclosed Air Purifier', () => {
    const state = createInitialState(20);
    state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Away', theme: 'forest', seed: 9 };
    state.buildings = [{ id: 'purifier-outside', definitionId: 'air-purifier', tileX: 20, tileY: 20 }];

    expect([...airPurifierProtectedCells(state.buildings)].sort()).toEqual([
      '19,19', '19,20', '19,21',
      '20,19', '20,20', '20,21',
      '21,19', '21,20', '21,21',
    ].sort());

    state.player.x = 19.5 * TILE_SIZE;
    state.player.y = 19.5 * TILE_SIZE;
    expect(isPlayerSheltered(state)).toBe(true);
    state.player.x = 18.5 * TILE_SIZE;
    expect(isPlayerSheltered(state)).toBe(false);
  });

  it('switches from local coverage to the whole room once the purifier is enclosed', () => {
    const state = createInitialState(22);
    state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Away', theme: 'forest', seed: 9 };
    state.buildings = enclosedEnvironment(10, 10, 3, 2, 'indoor');
    state.buildings.push({ id: 'purifier-enclosed', definitionId: 'air-purifier', tileX: 11, tileY: 10 });

    const protectedCells = airPurifierProtectedCells(state.buildings);
    expect(protectedCells).toEqual(new Set(['10,10', '11,10', '12,10', '10,11', '11,11', '12,11']));
    expect(protectedCells.has('11,9')).toBe(false);
  });

  it('clears the grace countdown in shelter and restarts it on later exposure', () => {
    const state = createInitialState(10);
    state.buildings = baseWithBed();
    state.player.x = 9.5 * TILE_SIZE;
    state.player.y = 10.5 * TILE_SIZE;
    state.tick = DANGER_START_TICK;

    expect(advanceSurvivalCycle(state)).toBeNull();
    expect(state.dangerExposureStartedAtTick).toBe(DANGER_START_TICK);
    state.tick += 9 * TICKS_PER_SECOND;
    expect(dangerGraceTimer(state)).toEqual({ secondsRemaining: 1, label: '0:01' });

    // Reaching shelter spends nothing: the whole grace period is available
    // again the next time the player steps outside.
    state.player.x = 12.5 * TILE_SIZE;
    expect(advanceSurvivalCycle(state)).toBeNull();
    expect(state.dangerExposureStartedAtTick).toBeNull();
    expect(dangerGraceTimer(state)).toBeNull();

    state.tick += 3 * TICKS_PER_SECOND;
    state.player.x = 9.5 * TILE_SIZE;
    expect(advanceSurvivalCycle(state)).toBeNull();
    expect(state.dangerExposureStartedAtTick).toBe(state.tick);
    expect(dangerGraceTimer(state)).toEqual({ secondsRemaining: 10, label: '0:10' });
  });

  it('treats a Bed-only room as unsafe until an Air Purifier is added', () => {
    const state = createInitialState(21);
    state.buildings = baseWithBed().filter((building) => building.definitionId !== 'air-purifier');
    state.player.x = 12.5 * TILE_SIZE;
    state.player.y = 10.5 * TILE_SIZE;
    state.tick = DANGER_START_TICK;

    expect(isPlayerSheltered(state)).toBe(false);
    expect(drainExposureToDefeat(state)).toMatchObject({ pendingRespawn: true, cause: 'exposure' });
    const bed = respawnDestinations(state).find((destination) => destination.kind === 'bed')!;
    expect(bed).toMatchObject({ safe: false, sheltered: true });
    expect(state.player.hp).toBe(0);
    expect(chooseRespawn(state, bed.id).ok).toBe(true);

    state.buildings.push({ id: 'purifier-late', definitionId: 'air-purifier', tileX: 12, tileY: 11 });
    expect(isPlayerSheltered(state)).toBe(true);
  });

  it('keeps a player safe only inside the enclosed indoor room containing an Air Purifier', () => {
    const state = createInitialState(1);
    state.buildings = baseWithBed();
    state.player.x = (12 + 0.5) * TILE_SIZE;
    state.player.y = (10 + 0.5) * TILE_SIZE;
    state.tick = DANGER_START_TICK;

    expect(isPlayerSheltered(state)).toBe(true);
    expect(advanceSurvivalCycle(state)).toBeNull();
    expect(state.player.hp).toBe(state.player.maxHp);

    state.player.x = 9.5 * TILE_SIZE;
    expect(isPlayerSheltered(state)).toBe(false);
  });

  it('ramps the exposure drain second by second and stops immediately in shelter', () => {
    const state = createInitialState(12);
    const raid = state.gameBalance.raid;
    state.buildings = baseWithBed();
    state.player.maxHp = 200;
    state.player.hp = 200;
    state.player.x = 9.5 * TILE_SIZE;
    state.player.y = 10.5 * TILE_SIZE;
    state.tick = DANGER_START_TICK;

    expect(advanceSurvivalCycle(state)).toBeNull();
    state.tick += DANGER_GRACE_SECONDS * TICKS_PER_SECOND;
    expect(advanceSurvivalCycle(state)).toBeNull();
    const runSecond = () => {
      for (let tick = 0; tick < TICKS_PER_SECOND; tick += 1) {
        state.tick += 1;
        expect(advanceSurvivalCycle(state)).toBeNull();
      }
    };
    runSecond();
    expect(state.player.hp).toBe(200 - DANGER_EXPOSURE_DAMAGE_PER_SECOND);
    expect(dangerGraceTimer(state)).toEqual({ secondsRemaining: 0, label: '0:00' });

    // The second exposed second costs more than the first — that ramp is what
    // turns a lost wall into a scramble instead of an instant death.
    runSecond();
    expect(state.player.hp).toBe(200 - exposureDamagePerSecond(raid, 1) - exposureDamagePerSecond(raid, 2));
    expect(exposureDamagePerSecond(raid, 2)).toBeGreaterThan(exposureDamagePerSecond(raid, 1));

    const shelteredHp = state.player.hp;
    state.player.x = 10.5 * TILE_SIZE;
    state.tick += 1;
    expect(advanceSurvivalCycle(state)).toBeNull();
    expect(state.player.hp).toBe(shelteredHp);
    expect(state.dangerExposureStartedAtTick).toBeNull();
  });

  it('spends Cloth Masks one at a time, holding the fog off for five seconds each', () => {
    const state = createInitialState(12);
    state.buildings = baseWithBed();
    state.player.maxHp = 200;
    state.player.hp = 200;
    state.player.x = 9.5 * TILE_SIZE;
    state.player.y = 10.5 * TILE_SIZE;
    state.tick = DANGER_START_TICK;
    state.inventory['cloth-mask'] = 2;

    expect(advanceSurvivalCycle(state)).toBeNull();
    state.tick += DANGER_GRACE_SECONDS * TICKS_PER_SECOND;
    expect(advanceSurvivalCycle(state)).toBeNull();

    const runSecond = () => {
      for (let tick = 0; tick < TICKS_PER_SECOND; tick += 1) {
        state.tick += 1;
        expect(advanceSurvivalCycle(state)).toBeNull();
      }
    };

    // The first damaging tick draws a mask instead of health.
    state.tick += 1;
    expect(advanceSurvivalCycle(state)).toBeNull();
    expect(state.inventory['cloth-mask']).toBe(1);
    expect(clothMaskSecondsRemaining(state)).toBe(CLOTH_MASK_PROTECTION_SECONDS);

    for (let second = 0; second < CLOTH_MASK_PROTECTION_SECONDS; second += 1) runSecond();
    expect(state.player.hp).toBe(200);
    // Its filter spent, the second mask is drawn rather than health taken.
    expect(state.inventory['cloth-mask']).toBe(0);
    expect(clothMaskSecondsRemaining(state)).toBe(CLOTH_MASK_PROTECTION_SECONDS);

    for (let second = 0; second < CLOTH_MASK_PROTECTION_SECONDS; second += 1) runSecond();
    expect(state.player.hp).toBe(200);

    // Out of masks, the drain resumes at the first rung of the ramp rather than
    // wherever it would have climbed to had the masks never been worn.
    runSecond();
    expect(state.inventory['cloth-mask']).toBe(0);
    expect(state.player.hp).toBe(200 - DANGER_EXPOSURE_DAMAGE_PER_SECOND);
  });

  it('clears the grace countdown once the danger phase ends', () => {
    const state = createInitialState(13);
    state.buildings = baseWithBed();
    state.player.x = 9.5 * TILE_SIZE;
    state.player.y = 10.5 * TILE_SIZE;
    state.tick = DANGER_START_TICK;

    expect(advanceSurvivalCycle(state)).toBeNull();
    state.tick += 3 * TICKS_PER_SECOND;
    expect(dangerGraceTimer(state)).toEqual({ secondsRemaining: 7, label: '0:07' });

    state.tick = (SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * TICKS_PER_SECOND;
    expect(advanceSurvivalCycle(state)).toBeNull();
    expect(state.dangerExposureStartedAtTick).toBeNull();
    expect(dangerGraceTimer(state)).toBeNull();
  });

  it('persists defeat, clears carried inventory once, and awakens safely at the selected Bed', () => {
    const state = createInitialState(2);
    state.buildings = baseWithBed();
    state.buildings.push({
      id: 'cache-safe', definitionId: 'field-cache', tileX: 20, tileY: 20,
      storage: { wood: 22, stone: 3, fiber: 1, 'iron-ore': 4, 'iron-ingot': 2 },
      storageStacks: { wood: [22], stone: [3], fiber: [1], 'iron-ore': [4], 'iron-ingot': [2] },
      storedTools: [carriedTool()],
    });
    Object.assign(state.inventory, {
      wood: 7, stone: 4, fiber: 3, 'iron-ore': 2, 'iron-ingot': 1,
      berry: 2, 'taming-snare': 1, arrow: 8, 'cloth-mask': 0,
    });
    state.tools = [{ ...carriedTool(), instanceId: 'tool-in-bag' }];
    state.equippedToolId = 'tool-in-bag';
    state.player.x = 2.5 * TILE_SIZE;
    state.player.y = 2.5 * TILE_SIZE;
    state.tick = DANGER_START_TICK;

    const result = drainExposureToDefeat(state);

    expect(result).toMatchObject({ pendingRespawn: true, cause: 'exposure', lostItemCount: 29 });
    expect(state.inventory).toEqual({
      wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0,
      'taming-snare': 0, 'reinforced-snare': 0, berry: 0, arrow: 0, 'cloth-mask': 0,
      'safeguard-charm': 0, 'draft-parchment': 0,
      'tuftle-down': 0, 'craghopper-shell': 0, 'stag-antler': 0, 'snarlfox-pelt': 0,
      'masonmole-claw': 0, 'boar-tusk': 0, 'quillfinch-quill': 0, 'mistmoth-scale': 0,
      'slingtail-stone': 0,
      'scrap-iron': 0, 'clockwork': 0, 'lens': 0, 'arcane-dust': 0, 'construct-core': 0, 'ancient-alloy': 0, 'sealed-satchel': 0, 'vault-key': 0, 'recall-flare': 0,
    });
    expect(state.inventoryStacks).toEqual({
      wood: [], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [],
      'taming-snare': [], 'reinforced-snare': [], berry: [], arrow: [], 'cloth-mask': [],
      'safeguard-charm': [], 'draft-parchment': [],
      'tuftle-down': [], 'craghopper-shell': [], 'stag-antler': [], 'snarlfox-pelt': [],
      'masonmole-claw': [], 'boar-tusk': [], 'quillfinch-quill': [], 'mistmoth-scale': [],
      'slingtail-stone': [],
      'scrap-iron': [], 'clockwork': [], 'lens': [], 'arcane-dust': [], 'construct-core': [], 'ancient-alloy': [], 'sealed-satchel': [], 'vault-key': [], 'recall-flare': [],
    });
    expect(state.tools).toEqual([]);
    expect(state.equippedToolId).toBeNull();
    expect(state.buildings.find((building) => building.id === 'cache-safe')?.storage?.wood).toBe(22);
    expect(state.player.hp).toBe(0);
    expect(state.pendingRespawn).toMatchObject({ defeatedAreaKey: '0,0', lostItemCount: 29 });
    const bed = respawnDestinations(state).find((destination) => destination.kind === 'bed')!;
    expect(bed).toMatchObject({ safe: true, sheltered: true });
    expect(chooseRespawn(state, bed.id)).toMatchObject({ ok: true });
    expect(state.pendingRespawn).toBeNull();
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(isPlayerSheltered(state)).toBe(true);
    expect(isRespawnProtected(state)).toBe(true);
  });

  it('offers and returns to an enclosed Bed in a previously visited base area', () => {
    const state = createInitialState(3);
    state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Away', theme: 'forest', seed: 4 };
    state.buildings = [];
    state.visitedAreas['0,0'] = {
      key: '0,0', x: 0, y: 0, name: 'Elaris', theme: 'elaris', seed: 3,
      resourceNodes: [], wildCreatures: [], groundDrops: [], containers: [], buildings: baseWithBed(), raiders: [],
    };
    state.player.x = 3 * TILE_SIZE;
    state.player.y = 3 * TILE_SIZE;
    state.tick = DANGER_START_TICK;

    expect(drainExposureToDefeat(state)).toMatchObject({ pendingRespawn: true });
    expect(state.currentArea.key).toBe('1,0');
    const bed = respawnDestinations(state).find((destination) => destination.kind === 'bed')!;
    expect(bed).toMatchObject({ areaKey: '0,0', safe: true });
    expect(chooseRespawn(state, bed.id).ok).toBe(true);
    expect(state.currentArea.key).toBe('0,0');
    expect(isPlayerSheltered(state)).toBe(true);
  });

  it('always offers the Elaris sanctuary when no Bed exists', () => {
    const state = createInitialState(4);
    state.player.x = 55 * TILE_SIZE;
    state.player.y = 82 * TILE_SIZE;
    state.tick = DANGER_START_TICK;
    expect(drainExposureToDefeat(state)).toMatchObject({ pendingRespawn: true });
    expect(state.player).toMatchObject({ hp: 0, x: 55 * TILE_SIZE, y: 82 * TILE_SIZE });
    expect(respawnDestinations(state)).toHaveLength(1);
    expect(respawnDestinations(state)[0]).toMatchObject({
      id: 'elaris-sanctuary', kind: 'elaris', safe: true,
    });
    expect(chooseRespawn(state, 'elaris-sanctuary').ok).toBe(true);
    expect(state.currentArea.key).toBe('0,0');
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(isPlayerSheltered(state)).toBe(true);
  });

  it('removes a destroyed Bed from the available destination list', () => {
    const state = createInitialState(5);
    state.buildings.push({ id: 'bed-doomed', definitionId: 'bed', tileX: 30, tileY: 30 });
    expect(respawnDestinations(state).map((destination) => destination.id)).toContain('bed:bed-doomed');
    state.buildings = state.buildings.filter((building) => building.id !== 'bed-doomed');
    expect(respawnDestinations(state).map((destination) => destination.id)).toEqual(['elaris-sanctuary']);
  });
});
