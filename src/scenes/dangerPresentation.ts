import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { isWithinTownSafeZoneWorldPosition } from '../content/townDefences';
import { isElarisSanctuary } from '../simulation/elarisFall';
import { creaturePurifiedCells } from '../simulation/creatureRoles';
import { environments } from '../simulation/environmentProgress';
import type { GameState } from '../simulation/state';
import {
  airPurifierProtectedCells,
  type DangerThreat,
} from '../simulation/survivalCycle';

export interface DangerPresentationStyle {
  readonly baseColor: number;
  readonly baseAlpha: number;
  readonly wispColors: readonly number[];
}

export interface DangerSafeRect {
  readonly tileX: number;
  readonly tileY: number;
  readonly tilesWide: number;
  readonly tilesHigh: number;
}

/**
 * Poison reads green; a raid reads as moonless night, with no green cast; the
 * storm reads violet over navy, so a glance at the sky names the threat before
 * the timer does.
 */
export const DANGER_PRESENTATION: Readonly<Record<DangerThreat, DangerPresentationStyle>> = {
  fog: {
    baseColor: 0x13301a,
    baseAlpha: 0.58,
    wispColors: [0x74a03a, 0x8fbc4a, 0x4d7f2c],
  },
  raid: {
    baseColor: 0x050913,
    baseAlpha: 0.72,
    wispColors: [0x111a2b, 0x172238, 0x0c1424],
  },
  // Lighter than a raid night on purpose: the storm is the one danger the
  // player has to read the ground during, so the wash must never compete with
  // a strike marker for legibility.
  storm: {
    baseColor: 0x140b2e,
    baseAlpha: 0.5,
    wispColors: [0x6a4bd0, 0x8f6ef0, 0x3d2a86],
  },
};

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

/** Merge adjacent safe cells into row strips for inexpensive projected masks. */
export function dangerSafeRects(state: GameState, threat: DangerThreat): DangerSafeRect[] {
  return cellsToRects(dangerSafeCells(state, threat));
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
