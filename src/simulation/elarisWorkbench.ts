import { TILE_SIZE } from '../config/platform';
import { hasElarisFallen } from './elarisFall';
import type { BuildingState, GameState } from './state';

/**
 * The public workbench in Elaris.
 *
 * A blueprint is only worth carrying home if there is a home to carry it to,
 * and the player's own Workbench is a level-4 grant. Elaris covers the gap: the
 * town keeps a bench anyone may use, and it serves until the town falls after
 * level 7 — several levels of overlap after the player can build their own.
 *
 * "Anyone may use" is literal. It is a whole bench, not a filing cabinet: walk
 * up and it opens the same facility panel a player's own Workbench does, with
 * the same recipes, drafting, and blueprint work. Nothing about it is earned,
 * so nothing about it is gated — no level, no floor under it, no ownership.
 *
 * It is town content, derived from the area, not a row in `state.buildings`.
 * That matters: a real building in the player's list would be counted by the
 * Homestead Rating and would quietly complete the quest that asks them to build
 * a Workbench of their own. Nothing here is ever saved.
 *
 * After the fall the bench stays on the map as a ruin rather than vanishing.
 * The loss should read as something that happened to the town, and walking up
 * to a bench that no longer takes anything in is how a player learns that
 * registering is now their own problem.
 */

export const ELARIS_AREA_KEY = '0,0';

/**
 * Authored position: the bench outside the Weaponsmith, west of Mara's door,
 * where the forge front already reads as a place to make things. It used to
 * stand alone in the middle of the street. Covered by a test that asserts it
 * overlaps no town footprint or doorway.
 */
export const ELARIS_PUBLIC_WORKBENCH_TILE = { tileX: 73, tileY: 80 } as const;

/** Two tiles wide and one deep, matching the Workbench footprint. */
export const ELARIS_PUBLIC_WORKBENCH_SIZE = { tilesWide: 2, tilesHigh: 1 } as const;

export function elarisPublicWorkbenchCenterPx(): { x: number; y: number } {
  return {
    x: (ELARIS_PUBLIC_WORKBENCH_TILE.tileX + ELARIS_PUBLIC_WORKBENCH_SIZE.tilesWide / 2) * TILE_SIZE,
    y: (ELARIS_PUBLIC_WORKBENCH_TILE.tileY + ELARIS_PUBLIC_WORKBENCH_SIZE.tilesHigh / 2) * TILE_SIZE,
  };
}

/** Whether the town's bench exists in this area at all, standing or ruined. */
export function areaHasElarisPublicWorkbench(areaKey: string): boolean {
  return areaKey === ELARIS_AREA_KEY;
}

/** Whether the bench is still in service, rather than standing as rubble. */
export function isElarisPublicWorkbenchServing(state: GameState): boolean {
  return areaHasElarisPublicWorkbench(state.currentArea.key) && !hasElarisFallen(state);
}

/**
 * Reserved id for the town bench when it is handed around as a facility.
 *
 * It can never collide with a player building: those ids come from
 * `nextEntityId` and are numeric suffixes. Nothing under this id is ever
 * written to `state.buildings` or saved.
 */
export const ELARIS_PUBLIC_WORKBENCH_ID = 'elaris-public-workbench';

export function isElarisPublicWorkbenchId(id: string): boolean {
  return id === ELARIS_PUBLIC_WORKBENCH_ID;
}

/**
 * The town bench as a facility anyone may walk up to and use.
 *
 * Synthesized fresh on every call rather than stored, so it behaves like the
 * town content it is: no owner, no upkeep, nothing to persist. Handing it out
 * shaped as a `BuildingState` is what lets the ordinary facility paths — the
 * walk-up panel, the workbench recipes, blueprint work — treat it as a bench
 * without any of them learning that Elaris exists.
 *
 * Returns null once the town falls; a ruin is not a facility.
 */
export function elarisPublicWorkbenchFacility(state: GameState): BuildingState | null {
  if (!isElarisPublicWorkbenchServing(state)) return null;
  return {
    id: ELARIS_PUBLIC_WORKBENCH_ID,
    definitionId: 'workbench',
    tileX: ELARIS_PUBLIC_WORKBENCH_TILE.tileX,
    tileY: ELARIS_PUBLIC_WORKBENCH_TILE.tileY,
  };
}

/** Whether a world point lands on the town bench's footprint. */
export function elarisPublicWorkbenchContains(worldX: number, worldY: number): boolean {
  const left = ELARIS_PUBLIC_WORKBENCH_TILE.tileX * TILE_SIZE;
  const top = ELARIS_PUBLIC_WORKBENCH_TILE.tileY * TILE_SIZE;
  return worldX >= left && worldX <= left + ELARIS_PUBLIC_WORKBENCH_SIZE.tilesWide * TILE_SIZE
    && worldY >= top && worldY <= top + ELARIS_PUBLIC_WORKBENCH_SIZE.tilesHigh * TILE_SIZE;
}

/** Whether the player is close enough to the town bench to use it. */
export function withinElarisPublicWorkbench(state: GameState, range: number): boolean {
  if (!isElarisPublicWorkbenchServing(state)) return false;
  const center = elarisPublicWorkbenchCenterPx();
  return Math.hypot(center.x - state.player.x, center.y - state.player.y) <= range;
}
