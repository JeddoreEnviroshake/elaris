import * as THREE from 'three';
import { TILE_SIZE } from '../config/platform';
import { buildingCenter, playerShotDamage, playerShotRangePx, turrets } from '../simulation/raids';
import type { GameState } from '../simulation/state';
import { turretStats } from '../simulation/facilityLevels';

/**
 * Arrows in flight, inferred from state rather than simulated.
 *
 * The simulation resolves every shot instantly: a turret spends an arrow and
 * the raider takes the damage on the same tick. That is deliberate — a real
 * projectile would be another moving thing in the deterministic state hash,
 * and raid outcomes must stay identical whether a base is played live or
 * settled abstractly off-screen. So the flight is presentation only: this
 * tracker samples the state each frame, notices the evidence a shot leaves
 * behind, and hands the renderer an arc to draw. Nothing here writes state.
 *
 * The evidence:
 *   - Turret shot: the turret's ammo dropped while raiders were on the field.
 *     Unloading also drops ammo, but it puts those arrows back in the player's
 *     pack, so a rising arrow count vetoes the whole sample.
 *   - Player shot: an arrow left the pack *and* the action cooldown was pushed
 *     out. Loading a turret spends arrows too but never touches the cooldown.
 *
 * Victim selection mirrors advanceTurrets — nearest raider in range — using the
 * previous sample's positions, which is what the sim saw when it fired.
 */

export type ArrowSource = 'turret' | 'player';

/** One shot to draw, in world pixels. */
export interface ArrowShot {
  readonly source: ArrowSource;
  /** Turret or player id the shot came from; only used for debugging. */
  readonly shooterId: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly targetId: string;
  /** The target died from this shot, so the impact reads as a kill. */
  readonly killed: boolean;
}

interface RaiderSample {
  readonly x: number;
  readonly y: number;
  readonly hp: number;
}

export class ArrowShotTracker {
  private tick = Number.NEGATIVE_INFINITY;
  private arrows = 0;
  private cooldownUntil = 0;
  private readonly turretAmmo = new Map<string, number>();
  private readonly raiders = new Map<string, RaiderSample>();
  private seeded = false;

  /** Forget the previous sample; the next one only re-seeds. */
  reset(): void {
    this.seeded = false;
    this.turretAmmo.clear();
    this.raiders.clear();
  }

  /**
   * Compare the state against the previous sample and return the shots that
   * happened in between. Safe to call every frame; a frame with no tick change
   * yields nothing.
   */
  sample(state: GameState): ArrowShot[] {
    // A load, an area change, or a rewind all invalidate the comparison.
    const rewound = state.tick < this.tick;
    const shots = this.seeded && !rewound ? this.detect(state) : [];
    this.capture(state);
    return shots;
  }

  private detect(state: GameState): ArrowShot[] {
    const shots: ArrowShot[] = [];
    const previousRaiders = new Map(this.raiders);
    if (previousRaiders.size === 0) return shots;
    const defense = state.gameBalance.defense;
    // Recovering arrows from a turret looks exactly like firing them, so a
    // sample where the pack grew is never read as fire.
    const recovered = state.inventory.arrow > this.arrows;

    if (!recovered) {
      for (const turret of turrets(state.buildings)) {
        const before = this.turretAmmo.get(turret.id);
        const after = turret.turret?.ammo ?? 0;
        if (before === undefined || after >= before) continue;
        const center = buildingCenter(turret);
        for (let shot = 0; shot < before - after; shot += 1) {
          const target = nearestSample(previousRaiders, center.x, center.y, turretStats(turret, defense).rangeTiles * TILE_SIZE);
          if (!target) break;
          shots.push(this.shotTo(state, 'turret', turret.id, center.x, center.y, target));
        }
      }
    }

    const spentArrow = state.inventory.arrow < this.arrows;
    const pushedCooldown = state.actionCooldownUntilTick > this.cooldownUntil;
    if (spentArrow && pushedCooldown) {
      const player = state.player;
      const range = playerShotRangePx(state);
      // The player can click any raider, not just the closest, so prefer the
      // one that visibly took a player-sized hit and fall back to nearest.
      const hit = hitSample(previousRaiders, state, playerShotDamage(state), player.x, player.y, range)
        ?? nearestSample(previousRaiders, player.x, player.y, range);
      if (hit) shots.push(this.shotTo(state, 'player', 'player', player.x, player.y, hit));
    }
    return shots;
  }

  /** Aim at where the raider is now if it survived, else where it fell. */
  private shotTo(
    state: GameState,
    source: ArrowSource,
    shooterId: string,
    fromX: number,
    fromY: number,
    target: { id: string; sample: RaiderSample },
  ): ArrowShot {
    const alive = state.raiders.find((raider) => raider.id === target.id);
    return {
      source,
      shooterId,
      fromX,
      fromY,
      toX: alive?.x ?? target.sample.x,
      toY: alive?.y ?? target.sample.y,
      targetId: target.id,
      killed: !alive,
    };
  }

  private capture(state: GameState): void {
    this.tick = state.tick;
    this.arrows = state.inventory.arrow;
    this.cooldownUntil = state.actionCooldownUntilTick;
    this.turretAmmo.clear();
    for (const turret of turrets(state.buildings)) this.turretAmmo.set(turret.id, turret.turret?.ammo ?? 0);
    this.raiders.clear();
    for (const raider of state.raiders) this.raiders.set(raider.id, { x: raider.x, y: raider.y, hp: raider.hp });
    this.seeded = true;
  }
}

function nearestSample(
  raiders: Map<string, RaiderSample>,
  x: number,
  y: number,
  range: number,
): { id: string; sample: RaiderSample } | null {
  let best: { id: string; sample: RaiderSample } | null = null;
  let bestDistance = range * range;
  for (const [id, sample] of raiders) {
    const distance = (sample.x - x) ** 2 + (sample.y - y) ** 2;
    if (distance <= bestDistance) {
      best = { id, sample };
      bestDistance = distance;
    }
  }
  return best;
}

/** A raider in range that lost exactly one player shot's worth of health. */
function hitSample(
  previous: Map<string, RaiderSample>,
  state: GameState,
  damage: number,
  x: number,
  y: number,
  range: number,
): { id: string; sample: RaiderSample } | null {
  for (const [id, sample] of previous) {
    if ((sample.x - x) ** 2 + (sample.y - y) ** 2 > range * range) continue;
    const alive = state.raiders.find((raider) => raider.id === id);
    if (alive ? sample.hp - alive.hp === damage : sample.hp <= damage) return { id, sample };
  }
  return null;
}

/**
 * A single arrow: shaft, head, and fletching, built along +z so the mesh can be
 * pointed down its own velocity with lookAt.
 */
export function createArrowMesh(): THREE.Group {
  const arrow = new THREE.Group();
  arrow.name = 'raid-arrow';
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.6, 5),
    new THREE.MeshStandardMaterial({ color: 0x9a7248, roughness: 0.8, flatShading: true }),
  );
  shaft.rotation.x = Math.PI / 2;
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.045, 0.16, 5),
    new THREE.MeshStandardMaterial({ color: 0xcbd0c6, roughness: 0.45, metalness: 0.35, flatShading: true }),
  );
  head.rotation.x = Math.PI / 2;
  head.position.z = 0.36;
  const fletching = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.16, 4),
    new THREE.MeshStandardMaterial({ color: 0xe6d5a8, roughness: 0.9, flatShading: true }),
  );
  fletching.rotation.x = -Math.PI / 2;
  fletching.position.z = -0.3;
  arrow.add(shaft, head, fletching);
  return arrow;
}

/**
 * Flight time for an arc, in seconds. Long shots take longer, but everything
 * lands inside the beat the HUD already reacts in, so the impact never trails
 * the "Hit Scavenger" feedback by enough to read as a second event.
 */
export function arrowFlightSeconds(distanceUnits: number): number {
  return Math.min(0.62, 0.16 + distanceUnits * 0.035);
}

/** Peak height of the arc, in world units. Flat for a point-blank shot. */
export function arrowArcHeight(distanceUnits: number): number {
  return Math.min(1.6, distanceUnits * 0.16);
}
