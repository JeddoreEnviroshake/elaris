import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { isWithinTownSafeZoneWorldPosition } from '../content/townDefences';
import { isElarisSanctuary } from '../simulation/elarisFall';
import { creaturePurifiedCells } from '../simulation/creatureRoles';
import { environments } from '../simulation/environmentProgress';
import type { GameState } from '../simulation/state';
import {
  airPurifierProtectedCells,
  isPlayerEnclosed,
  isPlayerSheltered,
  type DangerThreat,
} from '../simulation/survivalCycle';

/**
 * How a danger phase reads on screen. The sky always wears the event, sheltered
 * or not; the screen tint is the player's own exposure cue and only appears
 * while they are standing somewhere the threat can reach them.
 */
export interface DangerPresentationStyle {
  /** Full-screen hue laid over the world while the player is exposed. */
  readonly tintColor: number;
  /** Tint strength at the centre of the view, kept light so the ground reads. */
  readonly tintCenterAlpha: number;
  /** Tint strength at the screen edges, where the vignette closes in. */
  readonly tintEdgeAlpha: number;
  /** Top of the event sky dome. */
  readonly skyZenith: number;
  /** Cloud, star or vortex colour painted into the event sky. */
  readonly skyAccent: number;
}

export interface DangerSafeRect {
  readonly tileX: number;
  readonly tileY: number;
  readonly tilesWide: number;
  readonly tilesHigh: number;
}

/**
 * Poison reads green, a raid reads as a black night, and the storm reads
 * violet, so a glance at the sky names the threat before the timer does.
 */
export const DANGER_PRESENTATION: Readonly<Record<DangerThreat, DangerPresentationStyle>> = {
  fog: {
    tintColor: 0x3f7a1e,
    tintCenterAlpha: 0.1,
    tintEdgeAlpha: 0.42,
    skyZenith: 0x142a14,
    skyAccent: 0x9cc44a,
  },
  raid: {
    tintColor: 0x02040a,
    tintCenterAlpha: 0.2,
    tintEdgeAlpha: 0.62,
    skyZenith: 0x03050c,
    skyAccent: 0xe8eeff,
  },
  // Lighter than a raid night on purpose: the storm is the one danger the
  // player has to read the ground during, so the tint must never compete with
  // a strike marker for legibility.
  storm: {
    tintColor: 0x5a2aa8,
    tintCenterAlpha: 0.08,
    tintEdgeAlpha: 0.38,
    skyZenith: 0x150a33,
    skyAccent: 0xc78cff,
  },
};

/**
 * Whether the threat outside can reach the player where they stand: fog asks
 * for purified air, a raid and a storm for walls. This is the same rule the
 * survival timer uses for its SHELTERED / SEALED IN / UNDER COVER badge, so the
 * screen tint and the badge never disagree.
 */
export function playerExposedTo(state: GameState, threat: DangerThreat): boolean {
  return threat === 'fog' ? !isPlayerSheltered(state) : !isPlayerEnclosed(state);
}

const TOWN_SAFE_CELLS = townSafeCells();

/**
 * Safe cells for the current hazard, shared by both renderers.
 *
 * Fog needs purification; raiders cannot enter any enclosed indoor room; the
 * storm respects neither, so it punches out nothing the player built. Only
 * Elaris is added below, and only because it is Elaris.
 */
export function dangerSafeCells(state: GameState, threat: DangerThreat): string[] {
  const cells = threat === 'storm'
    ? new Set<string>()
    : threat === 'fog'
      ? unionCells(airPurifierProtectedCells(state.buildings), creaturePurifiedCells(state))
      : new Set(environments(state.buildings)
        .filter((room) => room.valid && room.kind === 'indoor')
        .flatMap((room) => [...room.cells]));
  if (isElarisSanctuary(state)) for (const cell of TOWN_SAFE_CELLS) cells.add(cell);
  return [...cells].sort(compareCells);
}

/** Player-built purifier coverage only, used by the persistent blue floor cue. */
export function purifierProtectedCells(state: GameState): string[] {
  // A working Mistmoth's square is drawn in the same blue as a purifier's: the
  // cue answers "where can I breathe", and the player should not have to know
  // which of the two is holding a given tile.
  return [...unionCells(airPurifierProtectedCells(state.buildings), creaturePurifiedCells(state))].sort(compareCells);
}

function unionCells(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const merged = new Set(left);
  for (const cell of right) merged.add(cell);
  return merged;
}

/** Compact strips for rendering the persistent protected-floor highlight. */
export function purifierProtectedRects(state: GameState): DangerSafeRect[] {
  return cellsToRects(purifierProtectedCells(state));
}

function cellsToRects(cells: readonly string[]): DangerSafeRect[] {
  const strips: DangerSafeRect[] = [];
  for (const cell of cells) {
    const [tileX, tileY] = cell.split(',').map(Number) as [number, number];
    const previous = strips.at(-1);
    if (previous && previous.tileY === tileY && previous.tileX + previous.tilesWide === tileX) {
      strips[strips.length - 1] = { ...previous, tilesWide: previous.tilesWide + 1 };
    } else {
      strips.push({ tileX, tileY, tilesWide: 1, tilesHigh: 1 });
    }
  }
  return strips;
}

function townSafeCells(): readonly string[] {
  const cells: string[] = [];
  for (let tileY = 0; tileY < WORLD_TILES; tileY += 1) {
    for (let tileX = 0; tileX < WORLD_TILES; tileX += 1) {
      if (isWithinTownSafeZoneWorldPosition(
        (tileX + 0.5) * TILE_SIZE,
        (tileY + 0.5) * TILE_SIZE,
      )) cells.push(`${tileX},${tileY}`);
    }
  }
  return cells;
}

function compareCells(a: string, b: string): number {
  const [ax, ay] = a.split(',').map(Number) as [number, number];
  const [bx, by] = b.split(',').map(Number) as [number, number];
  return ay - by || ax - bx;
}
