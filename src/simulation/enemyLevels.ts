import { TILE_SIZE, WORLD_PX } from '../config/platform';
import type { EditableWorldBalance } from './state';

/**
 * How dangerous a given patch of the world is, and what a level is worth.
 *
 * Every creature and raider carries a level from 1 up. The rank is a pure
 * function of where the spawn point sits: rings of areas away from home, plus
 * bands of distance from the middle of the area it generated in. Nothing here
 * looks at the player.
 *
 * That is the whole design decision. A level that tracked the character would
 * keep the world permanently at par and make travelling pointless — the field
 * outside town would be exactly as dangerous at level 30 as at level 1. Pinning
 * difficulty to geography instead means the ring road stays a place a new
 * character survives, and the far edge of the map stays somewhere to work up to.
 *
 * Determinism rules this module obeys, matching the rest of the simulation:
 *   - Integers only. Levels and scaled stats land in GameState, and
 *     canonicalizeGameState rejects a fractional number anywhere in it.
 *   - No RNG and no transcendentals. Bands are found by comparing squared
 *     distances, so two clients agree without consuming the shared stream.
 */

/** Basis-point denominator; 10000 bps is 1x. */
const BPS = 10_000;

/**
 * A stat at a given level: `ceil(base * (1 + multiplier * (level - 1)))`.
 *
 * Linear rather than compounding, so the curve stays legible at the top end —
 * a 0.25 multiplier means "a quarter of the base per level", and level 9 is
 * three times base rather than six. Rounded up so a small base never levels
 * without changing: 1 attack power at 0.25 becomes 2 at level 2, not 1.
 */
export function scaleByLevel(base: number, level: number, multiplierBps: number): number {
  if (level <= 1 || multiplierBps <= 0 || base <= 0) return base;
  // Kept as one integer numerator over BPS so the ceiling is taken on an exact
  // rational. Multiplying by a floating 1.25 first would round 60 to 75.00000001
  // on some inputs and quietly hand out a free point.
  return Math.ceil((base * (BPS + multiplierBps * (level - 1))) / BPS);
}

/**
 * The level a spawn at this point gets, stamped once at spawn time.
 *
 * Deliberately not re-derived later: an Admin edit to the bands changes what
 * the next area generates, never what is already standing in the world. A
 * creature that visibly re-ranked itself between the player reading its plate
 * and swinging at it would read as a bug.
 */
export function spawnLevel(areaKey: string, x: number, y: number, world: EditableWorldBalance): number {
  const rings = areaRings(areaKey) * Math.max(0, world.levelsPerAreaRing);
  return clampLevel(1 + rings + distanceBand(x, y, world.levelBandTiles), world.maxEnemyLevel);
}

/** Levels are whole numbers from 1 up, and never past the configured ceiling. */
export function clampLevel(level: number, maxEnemyLevel: number): number {
  const ceiling = Math.max(1, Math.floor(maxEnemyLevel));
  return Math.max(1, Math.min(ceiling, Math.floor(level)));
}

/**
 * Chebyshev distance of an area from home, so the ring around town is one step
 * out in every direction rather than diagonals counting double.
 */
function areaRings(areaKey: string): number {
  const [x, y] = areaKey.split(',').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  return Math.max(Math.abs(x!), Math.abs(y!));
}

/**
 * How many whole bands of `levelBandTiles` the point sits from the middle of
 * its area — which, in the home area, is the town.
 *
 * Counted by comparing squared distances rather than taking a square root:
 * the result feeds a persisted level, and integer comparisons are the same on
 * every client without depending on the last bit of a `Math.hypot`.
 */
function distanceBand(x: number, y: number, levelBandTiles: number): number {
  const bandPx = Math.max(1, Math.floor(levelBandTiles)) * TILE_SIZE;
  const center = WORLD_PX / 2;
  const dx = x - center;
  const dy = y - center;
  const distanceSq = dx * dx + dy * dy;
  let band = 0;
  // The world is finite, so the loop is bounded by the map's own half-diagonal
  // no matter how small a band the Admin panel asks for.
  for (let edge = bandPx; edge * edge <= distanceSq; edge += bandPx) band += 1;
  return band;
}
