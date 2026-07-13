import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { PLACEABLES } from '../config/areaGates';
import type { BuildingDefinitionId, GameState, ResourceId } from '../simulation/state';
import {
  BUILD_RANGE_PX,
  BUILDABLES,
  buildableById,
  checkPlacement,
  placeBuilding,
  placeableLockedReason,
  removeBuilding,
  validatePlacement,
  type BuildableDefinition,
  type PlacementCheck,
  type PlaceResult,
} from '../simulation/gameplayCommands';

/**
 * PRESENTATION ADAPTER for build mode. Placement logic is now the authoritative
 * simulation's: this module re-exports the sim's catalog/commands (which persist
 * to `state.buildings` and enforce enclosure/area gates) and adds only the
 * presentation-side concerns the sim does not carry — ghost geometry, palette
 * copy, and small display helpers. `BuildModeController` and `BuildMenu` import
 * everything build-related from here so the seam stays in one place.
 */

export type BuildableId = BuildingDefinitionId;

export {
  BUILD_RANGE_PX,
  BUILDABLES,
  buildableById,
  checkPlacement,
  placeBuilding,
  removeBuilding,
  validatePlacement,
};
export type { BuildableDefinition, PlacementCheck, PlaceResult };

/** Palette copy per structure. Gates here match the sim's enforced requirements. */
const BUILD_DESCRIPTIONS: Readonly<Record<BuildableId, string>> = {
  'palisade-wall': 'Encloses an area — enclosures unlock facilities.',
  'field-cache': 'Small storage. Needs an enclosure of 4+ cells.',
  workbench: 'Crafting station. Needs an indoor enclosure of 8+ cells.',
  'garden-bed': 'Grows fiber renewably. Needs a grassland work yard of 8+ cells.',
  'woodlot-planter': 'Grows renewable wood. Needs forest soil and a work yard of 16+ cells.',
};

export function describeBuildable(id: BuildableId): string {
  return BUILD_DESCRIPTIONS[id];
}

/**
 * Palette lock line for a not-yet-discovered placeable (sticky area-tier
 * discovery), or null when the entry is available. Presentation mirror of the
 * sim's `placeableLockedReason` placement gate.
 */
export function buildableLockedReason(state: GameState, id: BuildableId): string | null {
  const placeable = PLACEABLES.find((candidate) => candidate.id === id);
  return placeable ? placeableLockedReason(state, placeable) : null;
}

export function costText(cost: BuildableDefinition['cost']): string {
  return Object.entries(cost)
    .map(([resource, amount]) => `${amount} ${resource}`)
    .join(' + ');
}

/** First resource the inventory cannot cover, or null when affordable. */
export function missingCost(
  state: GameState,
  cost: BuildableDefinition['cost'],
): { resource: ResourceId; amount: number } | null {
  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceId, number]>) {
    const short = amount - state.inventory[resource];
    if (short > 0) return { resource, amount: short };
  }
  return null;
}

export function tileFromWorld(worldPx: number): number {
  return Math.floor(worldPx / TILE_SIZE);
}

/** Ghost spawns on the tile(s) directly in front of the player. */
export function defaultGhostTile(
  state: GameState,
  def: BuildableDefinition,
): { tileX: number; tileY: number } {
  const px = tileFromWorld(state.player.x);
  const py = tileFromWorld(state.player.y);
  let tileX = px - Math.floor((def.tilesWide - 1) / 2);
  let tileY = py - Math.floor((def.tilesHigh - 1) / 2);
  switch (state.player.facing) {
    case 'down':
      tileY = py + 1;
      break;
    case 'up':
      tileY = py - def.tilesHigh;
      break;
    case 'left':
      tileX = px - def.tilesWide;
      break;
    case 'right':
      tileX = px + 1;
      break;
  }
  return clampTileToBounds(tileX, tileY, def);
}

export function clampTileToBounds(
  tileX: number,
  tileY: number,
  def: BuildableDefinition,
): { tileX: number; tileY: number } {
  return {
    tileX: Math.max(0, Math.min(WORLD_TILES - def.tilesWide, tileX)),
    tileY: Math.max(0, Math.min(WORLD_TILES - def.tilesHigh, tileY)),
  };
}
