import { TILE_SIZE } from '../config/platform';
import {
  interiorDefinitionById,
  isInsideTownShell,
  shellDoorstep,
  townBuildingShell,
  townShellBlocks,
  type TownBuildingShell,
} from '../content/interiors';
import {
  isRuinedTownBuilding,
  townBuildingsInArea,
  type TownBuildingDefinition,
} from '../content/townBuildings';
import { isWithinTownSafeZoneWorldPosition, townFenceBlocksWorldMove } from '../content/townDefences';
import { hasElarisFallen, isElarisSanctuary } from './elarisFall';
import type { Facing, GameState } from './state';

/*
 * Town service buildings are walk-in: each one's room is built inside its own
 * footprint, so the authoritative player position simply walks through the
 * doorway and stands indoors. There is no separate interior scene and no
 * parked "visit" pose — being inside a building is being at a position.
 */

const SHELLS = new Map<TownBuildingDefinition, TownBuildingShell>();

/** Cached shell geometry for a placement. */
export function townShellFor(building: TownBuildingDefinition): TownBuildingShell {
  let shell = SHELLS.get(building);
  if (!shell) {
    shell = townBuildingShell(building);
    SHELLS.set(building, shell);
  }
  return shell;
}

function localPoint(building: TownBuildingDefinition, x: number, y: number): { x: number; y: number } {
  return { x: x / TILE_SIZE - building.footprint.tileX, y: y / TILE_SIZE - building.footprint.tileY };
}

function footprintContains(building: TownBuildingDefinition, x: number, y: number): boolean {
  const { footprint } = building;
  const left = footprint.tileX * TILE_SIZE;
  const top = footprint.tileY * TILE_SIZE;
  return x >= left && x < left + footprint.tilesWide * TILE_SIZE
    && y >= top && y < top + footprint.tilesHigh * TILE_SIZE;
}

/**
 * The town building whose walls the given world point stands between, in
 * service or ruined. A point in the doorway passage outside the wall line is
 * not yet inside.
 */
export function townBuildingContaining(areaKey: string, x: number, y: number): TownBuildingDefinition | null {
  for (const building of townBuildingsInArea(areaKey)) {
    if (!footprintContains(building, x, y)) continue;
    const local = localPoint(building, x, y);
    if (isInsideTownShell(townShellFor(building), local.x, local.y)) return building;
  }
  return null;
}

/**
 * The serving building the player is standing inside, if any. A ruin's walls
 * still stand, but a ruin is not a building anyone keeps: it names nobody.
 */
export function townBuildingAroundPlayer(state: GameState): TownBuildingDefinition | null {
  const building = townBuildingContaining(state.currentArea.key, state.player.x, state.player.y);
  if (!building) return null;
  return isRuinedTownBuilding(building, hasElarisFallen(state)) ? null : building;
}

/**
 * True while the authoritative player stands inside a serving NPC building.
 * The Arcane Storm and the raid both read this: under a keeper's roof is
 * under a roof. A collapsed ruin offers no cover.
 */
export function isPlayerInsideTownBuilding(state: GameState): boolean {
  return townBuildingAroundPlayer(state) !== null;
}

/**
 * Whether a world point is solid for a walking body because of a town
 * building: its walls everywhere but the doorway, and — while it is kept —
 * its keeper and furniture. A ruin keeps its walls and loses its contents.
 */
export function isTownPositionBlocked(state: GameState, x: number, y: number): boolean {
  const buildings = townBuildingsInArea(state.currentArea.key);
  if (buildings.length === 0) return false;
  let fallen: boolean | null = null;
  for (const building of buildings) {
    if (!footprintContains(building, x, y)) continue;
    fallen ??= hasElarisFallen(state);
    const interior = isRuinedTownBuilding(building, fallen) ? null : interiorDefinitionById(building.interiorId);
    const local = localPoint(building, x, y);
    if (townShellBlocks(townShellFor(building), interior, local.x, local.y)) return true;
  }
  return false;
}

/**
 * Elaris protection supplied by the municipal fence and purifiers. It lasts
 * exactly as long as the town does: once Elaris falls the fence is breached and
 * the purifiers are cold, so the ground inside the old perimeter is as exposed
 * as any other field.
 */
export function isElarisTownSafeZone(state: GameState): boolean {
  return isElarisSanctuary(state) && isWithinTownSafeZoneWorldPosition(state.player.x, state.player.y);
}

/**
 * Axis-separated collision keeps movement smooth along exterior walls. A
 * position already inside something solid (an old save, or a ruin's contents
 * vanishing around the player) may always move, so nobody is ever trapped.
 */
export function resolveTownMovement(
  state: GameState,
  currentX: number,
  currentY: number,
  nextX: number,
  nextY: number,
): { x: number; y: number } {
  const stuck = isTownPositionBlocked(state, currentX, currentY);
  let x = currentX;
  let y = currentY;
  // The breached fence of a fallen Elaris stops nobody.
  if ((stuck || !isTownPositionBlocked(state, nextX, currentY))
    && (!isElarisSanctuary(state) || !townFenceBlocksWorldMove(currentX, currentY, nextX, currentY))) x = nextX;
  if ((stuck || !isTownPositionBlocked(state, x, nextY))
    && (!isElarisSanctuary(state) || !townFenceBlocksWorldMove(x, currentY, x, nextY))) y = nextY;
  return { x, y };
}

/** Put the player on the step just outside a building's doorway, facing away from it. */
export function positionPlayerOutsideDoor(state: GameState, building: TownBuildingDefinition): void {
  const shell = townShellFor(building);
  const step = shellDoorstep(shell);
  state.player.x = Math.round((building.footprint.tileX + step.x) * TILE_SIZE);
  state.player.y = Math.round((building.footprint.tileY + step.y) * TILE_SIZE);
  state.player.facing = outwardFacing(shell);
}

/**
 * A save from before buildings were walk-in can hold the player inside a
 * wall or a counter (the old visit parked them on the door tile, which is now
 * the wall line). Recover such a position to the doorstep; anywhere the
 * player could have walked to is left exactly where it is.
 */
export function recoverPlayerFromTownWalls(state: GameState): TownBuildingDefinition | null {
  if (!isTownPositionBlocked(state, state.player.x, state.player.y)) return null;
  const building = townBuildingsInArea(state.currentArea.key)
    .find((candidate) => footprintContains(candidate, state.player.x, state.player.y)) ?? null;
  if (building) positionPlayerOutsideDoor(state, building);
  return building;
}

function outwardFacing(shell: TownBuildingShell): Facing {
  switch (shell.door.side) {
    case 'north': return 'up';
    case 'south': return 'down';
    case 'west': return 'left';
    case 'east': return 'right';
  }
}
