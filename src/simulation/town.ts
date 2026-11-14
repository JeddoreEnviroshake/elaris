import { TILE_SIZE } from '../config/platform';
import {
  outsideDoorTile,
  townBuildingAtDoorTile,
  townBuildingsInArea,
  type TownBuildingDefinition,
} from '../content/townBuildings';
import { isWithinTownSafeZoneWorldPosition, townFenceBlocksWorldMove } from '../content/townDefences';
import { hasElarisFallen, isElarisSanctuary, servingTownBuildings } from './elarisFall';
import type { Facing, GameState } from './state';

// The authoritative player position is its feet/ground point. Using that point
// matches Phaser depth and allows registry door tiles to be true openings.
const PLAYER_COLLISION_HALF = 0;

export function townBuildingAtPlayerDoor(state: GameState): TownBuildingDefinition | null {
  const building = townBuildingAtDoorTile(
    Math.floor(state.player.x / TILE_SIZE),
    Math.floor(state.player.y / TILE_SIZE),
    state.currentArea.key,
  );
  // A ruin keeps its doorway walkable so nobody is sealed inside a collapsed
  // building, but the door leads nowhere.
  return building && building.requiresElarisStanding && hasElarisFallen(state) ? null : building;
}

/**
 * True while the authoritative player stands in a serving NPC building's
 * doorway — which is where entering a building parks them for as long as the
 * visit lasts. A ruin's doorway is not a building: `townBuildingAtPlayerDoor`
 * already refuses to name a fallen Elaris site, so the collapsed shell offers
 * no cover.
 */
export function isPlayerInsideTownBuilding(state: GameState): boolean {
  return townBuildingAtPlayerDoor(state) !== null;
}

/** Nearest authored door close enough for an explicit Enter interaction. */
export function nearestTownBuildingDoor(
  state: GameState,
  rangePx = TILE_SIZE * 1.45,
): TownBuildingDefinition | null {
  let nearest: TownBuildingDefinition | null = null;
  let nearestDistance = rangePx;
  for (const building of servingTownBuildings(state)) {
    const x = (building.door.tileX + 0.5) * TILE_SIZE;
    const y = (building.door.tileY + 0.5) * TILE_SIZE;
    const distance = Math.hypot(x - state.player.x, y - state.player.y);
    if (distance <= nearestDistance) {
      nearest = building;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Solid registry footprint, with every declared door cell cut out as an opening. */
export function isSolidTownTile(tileX: number, tileY: number, areaKey = '0,0'): boolean {
  for (const building of townBuildingsInArea(areaKey)) {
    const { footprint } = building;
    if (townBuildingAtDoorTile(tileX, tileY, areaKey)?.id === building.id) return false;
    if (tileX >= footprint.tileX && tileX < footprint.tileX + footprint.tilesWide
      && tileY >= footprint.tileY && tileY < footprint.tileY + footprint.tilesHigh) return true;
  }
  return false;
}

export function isTownPositionBlocked(state: GameState, x: number, y: number): boolean {
  if (townBuildingsInArea(state.currentArea.key).length === 0) return false;
  const minTileX = Math.floor((x - PLAYER_COLLISION_HALF) / TILE_SIZE);
  const maxTileX = Math.floor((x + PLAYER_COLLISION_HALF) / TILE_SIZE);
  const minTileY = Math.floor((y - PLAYER_COLLISION_HALF) / TILE_SIZE);
  const maxTileY = Math.floor((y + PLAYER_COLLISION_HALF) / TILE_SIZE);
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (isSolidTownTile(tileX, tileY, state.currentArea.key)) return true;
    }
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

/** Axis-separated collision keeps movement smooth along exterior walls. */
export function resolveTownMovement(
  state: GameState,
  currentX: number,
  currentY: number,
  nextX: number,
  nextY: number,
): { x: number; y: number } {
  let x = currentX;
  let y = currentY;
  // The breached fence of a fallen Elaris stops nobody.
  if (!isTownPositionBlocked(state, nextX, currentY)
    && (!isElarisSanctuary(state) || !townFenceBlocksWorldMove(currentX, currentY, nextX, currentY))) x = nextX;
  if (!isTownPositionBlocked(state, x, nextY)
    && (!isElarisSanctuary(state) || !townFenceBlocksWorldMove(x, currentY, x, nextY))) y = nextY;
  return { x, y };
}

/** Move to the center of the safe exterior tile so the door cannot re-trigger. */
export function positionPlayerOutsideDoor(state: GameState, building: TownBuildingDefinition): void {
  const outside = outsideDoorTile(building);
  state.player.x = (outside.tileX + 0.5) * TILE_SIZE;
  state.player.y = (outside.tileY + 0.5) * TILE_SIZE;
  state.player.facing = outsideFacing(building, outside);
}

/**
 * Park the authoritative player in the doorway for the length of a visit.
 *
 * The interior itself is presentation, but "indoors" has to be a fact the
 * simulation can read: the Arcane Storm has to know not to aim at somebody
 * standing under a roof, and it only ever sees the exterior position. The
 * doorway is the one tile of the building the world model already treats as
 * walkable, so it is where a visitor stands. Leaving puts them back outside.
 */
export function positionPlayerInDoorway(state: GameState, building: TownBuildingDefinition): void {
  state.player.x = (building.door.tileX + 0.5) * TILE_SIZE;
  state.player.y = (building.door.tileY + 0.5) * TILE_SIZE;
  state.player.facing = insideFacing(building);
}

/**
 * Interior sessions are presentation-only. If a save or scene restart catches
 * the authoritative player on a service doorway, recover to the same safe tile
 * used by an ordinary exit so automatic door detection cannot trap or reopen it.
 */
export function recoverPlayerOutsideTownDoor(state: GameState): TownBuildingDefinition | null {
  const building = townBuildingAtPlayerDoor(state);
  if (!building) return null;
  positionPlayerOutsideDoor(state, building);
  return building;
}

/** Face away from the safe exterior tile, i.e. into the room being entered. */
function insideFacing(building: TownBuildingDefinition): Facing {
  const outward = outsideFacing(building, outsideDoorTile(building));
  if (outward === 'up') return 'down';
  if (outward === 'down') return 'up';
  return outward === 'left' ? 'right' : 'left';
}

function outsideFacing(building: TownBuildingDefinition, outside: { tileX: number; tileY: number }): Facing {
  if (outside.tileY < building.door.tileY) return 'up';
  if (outside.tileY > building.door.tileY) return 'down';
  if (outside.tileX < building.door.tileX) return 'left';
  return 'right';
}
