import {
  servingTownBuildingsInArea,
  townBuildingsInArea,
  type TownBuildingDefinition,
} from '../content/townBuildings';
import { isElaris } from './areas';
import type { GameState } from './state';

/**
 * The last level that still gets a safe town. Elaris exists to carry a new
 * character through their first hours; past this level it stops being a place
 * to hide and becomes a ruin, and every service it held must be found again in
 * the field.
 */
export const ELARIS_LAST_SAFE_LEVEL = 7;

/**
 * Whether Elaris has fallen is derived from the character, never stored. A level
 * only ever climbs, so the derivation is monotonic, and a shared world can hand
 * every client the same static town data while each player sees the town at the
 * stage of the story they have reached.
 */
export function hasElarisFallen(state: GameState): boolean {
  return state.player.level > ELARIS_LAST_SAFE_LEVEL;
}

/**
 * The protection Elaris grants — its fence, its purifiers, its raid immunity —
 * exists only while the town stands. Every safety check asks this rather than
 * `isElaris` so the ruins can never keep quietly sheltering a high-level player.
 */
export function isElarisSanctuary(state: GameState): boolean {
  return isElaris(state) && !hasElarisFallen(state);
}

/**
 * What the player should be told this place is called. The stored area name
 * stays 'Elaris' — it is written into every area snapshot and shared by every
 * player — so the ruin is a presentation-time rename.
 */
export function areaDisplayName(state: GameState): string {
  return isElaris(state) && hasElarisFallen(state) ? 'Ruins of Elaris' : state.currentArea.name;
}

/** Placements in the current area whose doors open and whose NPC is present. */
export function servingTownBuildings(state: GameState): readonly TownBuildingDefinition[] {
  return servingTownBuildingsInArea(state.currentArea.key, hasElarisFallen(state));
}

/** Placements in the current area left standing as rubble. */
export function ruinedTownBuildings(state: GameState): readonly TownBuildingDefinition[] {
  if (!hasElarisFallen(state)) return [];
  return townBuildingsInArea(state.currentArea.key).filter((building) => building.requiresElarisStanding);
}
