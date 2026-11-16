/**
 * The first-person compass strip, as pure maths.
 *
 * Bearings are whole-circle degrees clockwise from north, the same convention
 * `FirstPersonView.heading()` uses, in world space where +y is south. A pip's
 * offset is where it sits along the strip: -1 at the left edge, 0 dead ahead,
 * +1 at the right edge. Nothing here eases or animates; a pip moves only when
 * the heading or the player's position changes, which is the comfort rule.
 */

export type CompassTargetKind = 'site' | 'cache' | 'bed';

export interface CompassTarget {
  readonly id: string;
  readonly kind: CompassTargetKind;
  readonly label: string;
  /** World pixels. */
  readonly x: number;
  readonly y: number;
}

export interface CompassPip {
  readonly id: string;
  readonly kind: CompassTargetKind;
  readonly label: string;
  /** -1 (left edge) .. 0 (ahead) .. +1 (right edge). */
  readonly offset: number;
  /** Whole tiles to the target, for the pip's caption. */
  readonly distanceTiles: number;
}

export interface CompassMark {
  readonly label: string;
  readonly offset: number;
}

/** Half the strip's field, in degrees: the strip shows 90° either side of ahead. */
export const COMPASS_HALF_SPAN_DEGREES = 90;

/** Bearing from a vector, clockwise from north, in [0, 360). East is 90. */
export function bearingDegrees(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const degrees = Math.atan2(dx, -dy) * 180 / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/** Signed angle from `heading` to `bearing`, in (-180, 180]. Positive is to the right. */
export function relativeBearing(bearing: number, heading: number): number {
  const wrapped = (((bearing - heading) % 360) + 540) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Where a bearing sits on the strip, or null when it is behind the player. */
export function stripOffset(bearing: number, heading: number, halfSpan = COMPASS_HALF_SPAN_DEGREES): number | null {
  const relative = relativeBearing(bearing, heading);
  if (Math.abs(relative) > halfSpan) return null;
  return relative / halfSpan;
}

/**
 * Pips for every target ahead of the player, nearest first so the strip can
 * draw the nearest on top. A target the player stands on has no bearing and
 * is left off.
 */
export function compassPips(
  origin: { readonly x: number; readonly y: number },
  heading: number,
  targets: Iterable<CompassTarget>,
  tileSize: number,
  halfSpan = COMPASS_HALF_SPAN_DEGREES,
): CompassPip[] {
  const pips: CompassPip[] = [];
  for (const target of targets) {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    const offset = stripOffset(bearingDegrees(dx, dy), heading, halfSpan);
    if (offset === null) continue;
    pips.push({
      id: target.id,
      kind: target.kind,
      label: target.label,
      offset,
      distanceTiles: Math.round(Math.hypot(dx, dy) / tileSize),
    });
  }
  return pips.sort((a, b) => b.distanceTiles - a.distanceTiles);
}

const CARDINALS: ReadonlyArray<readonly [string, number]> = [
  ['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315],
];

/** Cardinal and intercardinal letters visible on the strip at this heading. */
export function compassMarks(heading: number, halfSpan = COMPASS_HALF_SPAN_DEGREES): CompassMark[] {
  const marks: CompassMark[] = [];
  for (const [label, bearing] of CARDINALS) {
    const offset = stripOffset(bearing, heading, halfSpan);
    if (offset !== null) marks.push({ label, offset });
  }
  return marks;
}
