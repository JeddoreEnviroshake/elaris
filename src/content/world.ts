/**
 * The authored surface-world envelope. One coordinate is one existing
 * 160×160-tile area; local terrain remains deterministic inside each area.
 *
 * Keeping bounds in content data makes the large map and movement simulation
 * agree about the size of the world.
 */
export const WORLD_BOUNDS = {
  minX: -3,
  maxX: 3,
  minY: -3,
  maxY: 3,
} as const;

export const WORLD_AREA_COLUMNS = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX + 1;
export const WORLD_AREA_ROWS = WORLD_BOUNDS.maxY - WORLD_BOUNDS.minY + 1;
export const WORLD_AREA_COUNT = WORLD_AREA_COLUMNS * WORLD_AREA_ROWS;

export interface AuthoredWorldArea {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly theme: 'elaris' | 'forest' | 'mountain' | 'meadow' | 'thicket' | 'marsh';
  readonly settlementName: string;
  readonly mapLabel: string;
  readonly mapColor: string;
  readonly summary: string;
  readonly signatureResource: string;
}

/**
 * Named destinations anchor the procedural regions around them. Their
 * coordinates, identity, atlas markers, and generation themes must come from
 * one registry so a quest can never point at a differently named location.
 */
export const AUTHORED_WORLD_AREAS: readonly AuthoredWorldArea[] = [
  {
    key: '0,0',
    x: 0,
    y: 0,
    name: 'Elaris',
    theme: 'elaris',
    settlementName: 'Elaris',
    mapLabel: 'ELARIS',
    mapColor: '#ffe08a',
    summary: 'A protected crossroads and the safest road home.',
    signatureResource: 'mixed starter resources',
  },
  {
    key: '1,0',
    x: 1,
    y: 0,
    name: 'Verdant Reach',
    theme: 'meadow',
    settlementName: 'Verdant Reach',
    mapLabel: 'VERDANT',
    mapColor: '#bdda72',
    summary: 'Open farmland, trained creatures, and wind-bent harvest roads.',
    signatureResource: 'fiber and berries',
  },
  {
    key: '2,0',
    x: 2,
    y: 0,
    name: 'Sylvaren',
    theme: 'forest',
    settlementName: 'Sylvaren',
    mapLabel: 'SYLVAREN',
    mapColor: '#c9a6ff',
    summary: 'An elven woodland city shaped around old trees and arcane study.',
    signatureResource: 'ancient timber and magical flora',
  },
  // The field copies of the Elaris services. They are authored areas so the
  // atlas can name them and so their precinct is guaranteed dry, walkable
  // ground — a service door must never end up in a procedural lake.
  {
    key: '-3,0',
    x: -3,
    y: 0,
    name: 'Cinderpost',
    theme: 'mountain',
    settlementName: 'Cinderpost',
    mapLabel: 'CINDERPOST',
    mapColor: '#e28a52',
    summary: 'A smoke-stained forge outpost working the western ore seams.',
    signatureResource: 'stone and ore',
  },
  {
    key: '0,-3',
    x: 0,
    y: -3,
    name: 'Ironwatch',
    theme: 'mountain',
    settlementName: 'Ironwatch',
    mapLabel: 'IRONWATCH',
    mapColor: '#a9bcc4',
    summary: 'A northern garrison armoury that never stood down.',
    signatureResource: 'iron and hard stone',
  },
  {
    key: '-2,-2',
    x: -2,
    y: -2,
    name: 'Hollowmarch',
    theme: 'marsh',
    settlementName: 'Hollowmarch',
    mapLabel: 'HOLLOWMARCH',
    mapColor: '#7fbfae',
    summary: 'A fighting pit dug into the northwest fen, older than Elaris.',
    signatureResource: 'reed fiber',
  },
  {
    key: '2,-2',
    x: 2,
    y: -2,
    name: 'Kestrel Crossing',
    theme: 'thicket',
    settlementName: 'Kestrel Crossing',
    mapLabel: 'KESTREL',
    mapColor: '#e8b0c0',
    summary: 'A trading post where the northeast bramble roads meet.',
    signatureResource: 'berries and bramble wood',
  },
  {
    key: '1,2',
    x: 1,
    y: 2,
    name: 'Fallowmere',
    theme: 'meadow',
    settlementName: 'Fallowmere',
    mapLabel: 'FALLOWMERE',
    mapColor: '#d9c46a',
    summary: 'A roadhouse in the southern grass, lit late for anyone still walking.',
    signatureResource: 'grain and fiber',
  },
  {
    key: '-1,3',
    x: -1,
    y: 3,
    name: 'Stillwater',
    theme: 'marsh',
    settlementName: 'Stillwater',
    mapLabel: 'STILLWATER',
    mapColor: '#9fc7e8',
    summary: 'A chapel kept above the southern flood line by its caretakers.',
    signatureResource: 'marsh herbs',
  },
] as const;

export function authoredWorldAreaAt(x: number, y: number): AuthoredWorldArea | null {
  return AUTHORED_WORLD_AREAS.find((area) => area.x === x && area.y === y) ?? null;
}

export function authoredWorldAreaByKey(key: string): AuthoredWorldArea | null {
  return AUTHORED_WORLD_AREAS.find((area) => area.key === key) ?? null;
}

export function isWithinWorldBounds(x: number, y: number): boolean {
  return x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX
    && y >= WORLD_BOUNDS.minY && y <= WORLD_BOUNDS.maxY;
}

/**
 * New travel is constrained to the finite world. A legacy save whose player
 * was already generated outside the new bounds may move only toward the world,
 * so adopting finite geography never traps that character permanently.
 */
export function canTravelToWorldArea(
  currentX: number,
  currentY: number,
  destinationX: number,
  destinationY: number,
): boolean {
  if (isWithinWorldBounds(destinationX, destinationY)) return true;
  if (isWithinWorldBounds(currentX, currentY)) return false;
  return distanceOutsideWorld(destinationX, destinationY) < distanceOutsideWorld(currentX, currentY);
}

export function distanceOutsideWorld(x: number, y: number): number {
  const dx = x < WORLD_BOUNDS.minX
    ? WORLD_BOUNDS.minX - x
    : x > WORLD_BOUNDS.maxX ? x - WORLD_BOUNDS.maxX : 0;
  const dy = y < WORLD_BOUNDS.minY
    ? WORLD_BOUNDS.minY - y
    : y > WORLD_BOUNDS.maxY ? y - WORLD_BOUNDS.maxY : 0;
  return dx + dy;
}
