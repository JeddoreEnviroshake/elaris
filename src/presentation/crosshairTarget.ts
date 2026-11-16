/**
 * First-person targeting: what is under the crosshair.
 *
 * Deliberately not a mesh raycast. Each candidate is a point on the ground
 * plane (the entity's world position) and the pick is the nearest one inside
 * its reach and inside a forward cone of the look direction. Cheap, stable
 * from frame to frame, and forgiving of the player not aiming precisely,
 * which matters when the view must not be nudged to help them aim.
 */

export type CrosshairTargetKind =
  | 'raider'
  | 'creature'
  | 'resource'
  | 'drop'
  | 'facility'
  | 'garden'
  | 'woodlot'
  /** A keeper or an examinable thing inside a town building; id is `${buildingId}:${hotspotId}`. */
  | 'town-hotspot'
  | 'building'
  /** An unsearched container at a field site; id is `${siteId}#${index}`. */
  | 'site-container';

export interface CrosshairCandidate {
  readonly kind: CrosshairTargetKind;
  readonly id: string;
  /** World pixels. */
  readonly x: number;
  readonly y: number;
  readonly label: string;
  /** How far away, in world pixels, this candidate can be picked from. */
  readonly reachPx: number;
}

/** Half-angle of the forward cone, in degrees. */
export const CROSSHAIR_CONE_DEGREES = 35;

/**
 * The nearest candidate inside its reach and within `coneDegrees` of
 * `forward` (a unit vector in world x/y). A candidate the player is standing
 * on top of has no meaningful direction and always counts as in the cone.
 */
export function pickCrosshairTarget<T extends CrosshairCandidate>(
  origin: { x: number; y: number },
  forward: { x: number; y: number },
  candidates: Iterable<T>,
  coneDegrees = CROSSHAIR_CONE_DEGREES,
): T | null {
  const cosine = Math.cos(coneDegrees * Math.PI / 180);
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const dx = candidate.x - origin.x;
    const dy = candidate.y - origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance > candidate.reachPx || distance >= bestDistance) continue;
    if (distance > 4 && (dx * forward.x + dy * forward.y) / distance < cosine) continue;
    best = candidate;
    bestDistance = distance;
  }
  return best;
}
