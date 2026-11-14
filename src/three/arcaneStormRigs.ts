import * as THREE from 'three';
import { ARCANE_IMPACT_AFTERMATH_TICKS } from '../simulation/arcaneStorm';
import type { ArcaneStrikeState } from '../simulation/state';

/**
 * The 3D form of one arcane strike marker, and the pure frame maths behind it.
 *
 * Split out of the renderer for the same reason raider rigs and raid arrows
 * are: the geometry needs a WebGL context to build, but what the marker should
 * look like on a given tick does not — and that is exactly the part that has to
 * stay in step with the 2D overlay.
 */

/** Violet ring, violet countdown, gold core when the strike pays. */
export const ARCANE_RING_COLOR = 0x9a6bff;
export const ARCANE_REWARD_COLOR = 0xffcb5c;
export const ARCANE_IMPACT_COLOR = 0xf1e6ff;
/** Just clear of the ground plane, so the ring never z-fights the terrain. */
const MARKER_HEIGHT = 0.02;

export interface ArcaneStrikeVisual {
  readonly root: THREE.Group;
  readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly countdown: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly column: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
}

/** What one marker looks like this tick, in renderer-agnostic numbers. */
export interface ArcaneStrikeFrame {
  /** True once the strike has landed and only its aftermath is left. */
  readonly landing: boolean;
  readonly ringOpacity: number;
  /** Countdown ring scale, 1 at first sight and shrinking toward the centre. */
  readonly countdownScale: number;
  readonly countdownOpacity: number;
  readonly columnOpacity: number;
  readonly columnScaleY: number;
}

/**
 * The countdown proportion, matching the 2D overlay tick for tick.
 *
 * Reduced motion holds the inner ring still and brightens it instead of
 * sweeping it inward: the deadline still reads, without an edge racing across
 * the ground toward the player.
 */
export function arcaneStrikeFrame(
  strike: ArcaneStrikeState,
  tick: number,
  reducedMotion: boolean,
): ArcaneStrikeFrame {
  if (strike.resolvedAtTick !== null) {
    const fade = 1 - clamp01((tick - strike.resolvedAtTick) / ARCANE_IMPACT_AFTERMATH_TICKS);
    return {
      landing: true,
      ringOpacity: 0.5 * fade,
      countdownScale: 1,
      countdownOpacity: 0,
      columnOpacity: 0.75 * fade,
      columnScaleY: reducedMotion ? 1 : 0.4 + 1.6 * (1 - fade),
    };
  }

  const window = Math.max(1, strike.impactAtTick - strike.telegraphAtTick);
  const progress = clamp01((tick - strike.telegraphAtTick) / window);
  return {
    landing: false,
    ringOpacity: 0.55 + 0.35 * progress,
    countdownScale: reducedMotion ? 0.55 : Math.max(0.02, 1 - progress),
    countdownOpacity: reducedMotion ? 0.3 + 0.6 * progress : 0.9,
    columnOpacity: 0,
    columnScaleY: 1,
  };
}

/** Build one marker at the origin; the caller positions its root. */
export function createArcaneStrikeVisual(radius: number, rewarded: boolean): ArcaneStrikeVisual {
  const flat = (mesh: THREE.Mesh, height: number): void => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = height;
  };

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.92, radius, 48),
    new THREE.MeshBasicMaterial({
      color: rewarded ? ARCANE_REWARD_COLOR : ARCANE_RING_COLOR,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  flat(ring, MARKER_HEIGHT);

  const countdown = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.86, radius, 48),
    new THREE.MeshBasicMaterial({
      color: ARCANE_RING_COLOR,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  flat(countdown, MARKER_HEIGHT * 2);

  // Vertical, unlike anything else on the ground: an impact should be visible
  // from across the map, not only by the player standing in it.
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.3, radius * 0.5, 6, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: ARCANE_IMPACT_COLOR,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  column.position.y = 3;
  column.visible = false;

  const root = new THREE.Group();
  root.add(ring, countdown, column);
  return { root, ring, countdown, column };
}

/** Apply one frame to a built marker. */
export function applyArcaneStrikeFrame(visual: ArcaneStrikeVisual, frame: ArcaneStrikeFrame): void {
  visual.ring.material.opacity = frame.ringOpacity;
  visual.countdown.visible = !frame.landing;
  visual.countdown.material.opacity = frame.countdownOpacity;
  visual.countdown.scale.set(frame.countdownScale, frame.countdownScale, frame.countdownScale);
  visual.column.visible = frame.landing;
  visual.column.material.opacity = frame.columnOpacity;
  visual.column.scale.set(1, frame.columnScaleY, 1);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
