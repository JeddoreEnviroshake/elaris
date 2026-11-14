import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TILE_SIZE } from '../../src/config/platform';
import {
  createDefaultGameBalance,
  PLAYER_SHOT_DAMAGE,
  TURRET_FIRE_COOLDOWN_TICKS,
} from '../../src/config/balance';
import { type BuildingState, type GameState } from '../../src/simulation/state';
import { createOrdinaryState as createInitialState } from './helpers/ordinaryWorld';
import { advanceRaid, firePlayerShot, loadTurretAmmo, unloadTurretAmmo } from '../../src/simulation/raids';
import { DANGER_PHASE_SECONDS, SAFE_PHASE_SECONDS } from '../../src/simulation/survivalCycle';
import { ArrowShotTracker, arrowArcHeight, arrowFlightSeconds, createArrowMesh } from '../../src/three/raidArrows';
import { createRaiderRig, RAIDER_CHEST_HEIGHT } from '../../src/three/raiderRigs';
import { enclosedEnvironment } from './helpers/buildings';
import type { RaiderKindId } from '../../src/simulation/state';

/** Equip a crafted Bow. The bow is an ordinary tool now, not a durable flag. */
function equipBow(state: { tools: any[]; equippedToolId: string | null }): void {
  state.tools.push({
    instanceId: 'tool-bow-test', definitionId: 'bow', durability: 120,
    maxDurability: 120, powerRank: 0, speedRank: 0, durabilityRank: 0,
  });
  state.equippedToolId = 'tool-bow-test';
}


const TICKS_PER_SECOND = 60;
const BALANCE = createDefaultGameBalance();
/**
 * The wave lands only after the warning window at the top of the phase, and
 * only on a raid night — cycle 0 brings poison fog, so this sits in cycle 1.
 */
const RAID_ARRIVAL_TICK = (SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS) * TICKS_PER_SECOND
  + (SAFE_PHASE_SECONDS + BALANCE.raid.spawnDelaySeconds) * TICKS_PER_SECOND;

/** A purified base mid-raid with one raider parked next to the turret. */
function raidingState(): { state: GameState; turret: BuildingState } {
  const state = createInitialState(7);
  state.buildings = enclosedEnvironment(10, 10, 3, 2, 'indoor');
  state.buildings.push({ id: 'building-901', definitionId: 'air-purifier', tileX: 11, tileY: 10 });
  const turret: BuildingState = {
    id: 'building-960', definitionId: 'turret', tileX: 11, tileY: 11,
    turret: { ammo: 4, nextFireTick: 0 },
  };
  state.buildings.push(turret);
  state.tick = RAID_ARRIVAL_TICK;
  advanceRaid(state);
  const victim = state.raiders[0]!;
  victim.x = 11 * TILE_SIZE + 8;
  victim.y = 12 * TILE_SIZE + 8;
  victim.hp = victim.maxHp = 500;
  state.player.x = victim.x + TILE_SIZE;
  state.player.y = victim.y;
  return { state, turret };
}

describe('arrow shot tracker', () => {
  it('reports nothing until it has a previous sample to compare against', () => {
    const { state } = raidingState();
    const tracker = new ArrowShotTracker();
    expect(tracker.sample(state)).toEqual([]);
    expect(tracker.sample(state)).toEqual([]);
  });

  it('draws an arrow from a firing turret to the raider the simulation hit', () => {
    const { state, turret } = raidingState();
    const tracker = new ArrowShotTracker();
    tracker.sample(state);

    state.tick += TURRET_FIRE_COOLDOWN_TICKS;
    advanceRaid(state);
    expect(turret.turret!.ammo).toBe(3);

    const [shot, ...rest] = tracker.sample(state);
    expect(rest).toEqual([]);
    expect(shot).toMatchObject({
      source: 'turret',
      shooterId: turret.id,
      targetId: state.raiders[0]!.id,
      killed: false,
    });
    // The arc starts at the turret and ends on the raider it damaged.
    expect(Math.hypot(shot!.fromX - (11 * TILE_SIZE + 8), shot!.fromY - (11 * TILE_SIZE + 8))).toBeLessThan(TILE_SIZE);
    expect(shot!.toX).toBe(state.raiders[0]!.x);
  });

  it('marks the shot that killed its target', () => {
    const { state } = raidingState();
    const tracker = new ArrowShotTracker();
    tracker.sample(state);
    const victim = state.raiders[0]!;
    victim.hp = 1;

    state.tick += TURRET_FIRE_COOLDOWN_TICKS;
    advanceRaid(state);
    expect(state.raiders.some((raider) => raider.id === victim.id)).toBe(false);

    const [shot] = tracker.sample(state);
    // The arrow still flies to where the raider fell rather than vanishing.
    expect(shot).toMatchObject({ killed: true, targetId: victim.id, toX: victim.x, toY: victim.y });
  });

  it('draws the player’s own shot from the player', () => {
    const { state } = raidingState();
    state.inventory.arrow = 3;
    equipBow(state);
    const tracker = new ArrowShotTracker();
    tracker.sample(state);

    const victim = state.raiders[0]!;
    expect(firePlayerShot(state, victim.id).ok).toBe(true);

    const shots = tracker.sample(state);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({
      source: 'player',
      targetId: victim.id,
      fromX: state.player.x,
      fromY: state.player.y,
    });
    expect(victim.hp).toBe(500 - PLAYER_SHOT_DAMAGE);
  });

  it('never mistakes loading or unloading a turret for a volley', () => {
    const { state, turret } = raidingState();
    state.inventory.arrow = 20;
    const tracker = new ArrowShotTracker();
    tracker.sample(state);

    // Loading spends arrows from the pack; unloading drains the magazine.
    expect(loadTurretAmmo(state, turret.id, 5).ok).toBe(true);
    expect(tracker.sample(state)).toEqual([]);
    expect(unloadTurretAmmo(state, turret.id, 5).ok).toBe(true);
    expect(tracker.sample(state)).toEqual([]);
  });

  it('re-seeds instead of firing a volley after a reset or a rewind', () => {
    const { state, turret } = raidingState();
    const tracker = new ArrowShotTracker();
    tracker.sample(state);
    tracker.reset();

    state.tick += TURRET_FIRE_COOLDOWN_TICKS;
    advanceRaid(state);
    expect(turret.turret!.ammo).toBe(3);
    expect(tracker.sample(state)).toEqual([]);

    // A loaded save rewinds the tick; the stale magazine reading is discarded.
    tracker.sample(state);
    state.tick = 0;
    turret.turret!.ammo = 0;
    expect(tracker.sample(state)).toEqual([]);
  });

  it('leaves the simulation untouched while sampling it', () => {
    const { state } = raidingState();
    const before = JSON.stringify(state);
    new ArrowShotTracker().sample(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('arrow flight shaping', () => {
  it('lands every shot inside the beat the HUD reacts in', () => {
    expect(arrowFlightSeconds(0)).toBeGreaterThan(0);
    expect(arrowFlightSeconds(2)).toBeLessThan(arrowFlightSeconds(9));
    expect(arrowFlightSeconds(200)).toBeLessThanOrEqual(0.62);
  });

  it('lobs long shots and keeps point-blank ones flat', () => {
    expect(arrowArcHeight(0.5)).toBeLessThan(0.2);
    expect(arrowArcHeight(200)).toBeLessThanOrEqual(1.6);
  });

  it('builds an arrow pointing down its own +z axis', () => {
    const arrow = createArrowMesh();
    const head = arrow.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry instanceof THREE.ConeGeometry
        && child.position.z > 0,
    );
    expect(head).toBeDefined();
  });
});

describe('3D raider rigs', () => {
  const kinds: RaiderKindId[] = ['scavenger', 'breaker', 'stalker'];

  it('builds a distinct rig for every raider kind', () => {
    for (const kind of kinds) {
      const rig = createRaiderRig(kind);
      expect(rig.kindId).toBe(kind);
      expect(rig.root.name).toBe(`${kind}-rig`);
      expect(RAIDER_CHEST_HEIGHT[kind]).toBeGreaterThan(0);
    }
    // Silhouettes stay distinguishable: the Breaker is the broad one.
    expect(RAIDER_CHEST_HEIGHT.breaker).toBeGreaterThan(RAIDER_CHEST_HEIGHT.scavenger);
  });

  it('swings opposing limbs while walking', () => {
    for (const kind of kinds) {
      const rig = createRaiderRig(kind);
      rig.animate(140, 'walk', false);
      expect(rig.joints.leftLeg!.rotation.x).toBeCloseTo(-rig.joints.rightLeg!.rotation.x);
      expect(rig.joints.leftLeg!.rotation.x).not.toBe(0);
    }
  });

  it('winds the Breaker’s maul overhead and drives it down again', () => {
    const rig = createRaiderRig('breaker');
    expect(rig.joints.maul).toBeDefined();
    const swing: number[] = [];
    for (let time = 0; time <= 800; time += 20) {
      rig.animate(time, 'attack', false);
      swing.push(rig.joints.rightArm!.rotation.x);
    }
    // A full overhead arc: wound back past vertical, then driven forward.
    expect(Math.min(...swing)).toBeLessThan(-3);
    expect(Math.max(...swing)).toBeGreaterThan(-1);
  });

  it('holds a readable pose under reduced motion instead of collapsing', () => {
    for (const kind of kinds) {
      const rig = createRaiderRig(kind);
      rig.animate(140, 'walk', true);
      expect(rig.joints.leftLeg!.rotation.x).toBeCloseTo(0);
    }
    // Reduced motion stills the swing but holds the pose: the Breaker's maul
    // stays raised rather than snapping back to a neutral, meaningless arm.
    const breaker = createRaiderRig('breaker');
    breaker.animate(140, 'attack', true);
    expect(breaker.joints.rightArm!.rotation.x).toBeCloseTo(-2.2);
  });
});
