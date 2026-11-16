import { TILE_SIZE } from '../config/platform';
import { siteKind } from '../content/sites';
import {
  currentSiteProgress, cyclesUntilRestock, isSiteDiscovered, liveAreaSites, type SiteDefinition,
} from '../simulation/sites';
import type { GameState } from '../simulation/state';
import type { CompassTarget } from './compass';

/** One container as the renderer and HUD see it. */
export interface SiteContainerView {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly strongbox: boolean;
  readonly searched: boolean;
}

/** A live site with everything presentation needs, read fresh from state. */
export interface SiteView {
  readonly id: string;
  readonly label: string;
  /** CSS colour of the kind's banner. */
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly anchorTileX: number;
  readonly anchorTileY: number;
  readonly discovered: boolean;
  readonly searchedCount: number;
  readonly containerCount: number;
  /** "Ready", "Searched 2/4" or "Refills next cycle". */
  readonly status: string;
  readonly containers: readonly SiteContainerView[];
}

function viewFor(state: GameState, site: SiteDefinition): SiteView {
  const kind = siteKind(site.kind);
  const searched = currentSiteProgress(state, site.id).searched;
  return {
    id: site.id,
    label: kind.label,
    color: kind.color,
    x: site.x,
    y: site.y,
    anchorTileX: site.anchorTileX,
    anchorTileY: site.anchorTileY,
    discovered: isSiteDiscovered(state, site.id),
    searchedCount: searched.length,
    containerCount: site.containers.length,
    status: siteStatusLabel(state, searched.length, site.containers.length),
    containers: site.containers.map((container) => ({ ...container, searched: searched.includes(container.index) })),
  };
}

/** The map label for a site's refill state. */
export function siteStatusLabel(state: GameState, searched: number, total: number): string {
  if (searched <= 0) return 'Ready';
  if (searched < total) return `Searched ${searched}/${total}`;
  const cycles = cyclesUntilRestock(state);
  return cycles <= 1 ? 'Refills next cycle' : `Refills in ${cycles} cycles`;
}

/** Every live site in an area, discovered or not. */
export function siteViewsForArea(state: GameState, areaKey = state.currentArea.key): SiteView[] {
  return liveAreaSites(state, areaKey).map((site) => viewFor(state, site));
}

/** Discovered sites in every area the player has records for, grouped by area key. */
export function discoveredSitesByArea(state: GameState): Map<string, SiteView[]> {
  const areas = new Set(Object.keys(state.siteProgress).map((id) => id.slice(0, id.indexOf(':site-'))));
  const grouped = new Map<string, SiteView[]>();
  for (const areaKey of areas) {
    const views = siteViewsForArea(state, areaKey).filter((view) => view.discovered);
    if (views.length > 0) grouped.set(areaKey, views);
  }
  return grouped;
}

/**
 * What the compass points at: discovered sites in this area, the death cache
 * while it lies here, and the nearest bed the player owns here.
 */
export function compassTargets(state: GameState): CompassTarget[] {
  const targets: CompassTarget[] = siteViewsForArea(state)
    .filter((view) => view.discovered)
    .map((view) => ({ id: view.id, kind: 'site' as const, label: `${view.label} · ${view.status}`, x: view.x, y: view.y }));
  const cache = state.deathCache;
  if (cache && cache.areaKey === state.currentArea.key) {
    targets.push({ id: cache.id, kind: 'cache', label: 'Your cache', x: cache.x, y: cache.y });
  }
  let bed: CompassTarget | null = null;
  let bedDistance = Number.POSITIVE_INFINITY;
  for (const building of state.buildings) {
    if (building.definitionId !== 'bed') continue;
    const x = (building.tileX + 0.5) * TILE_SIZE;
    const y = (building.tileY + 0.5) * TILE_SIZE;
    const distance = Math.hypot(x - state.player.x, y - state.player.y);
    if (distance < bedDistance) {
      bed = { id: building.id, kind: 'bed', label: 'Bed', x, y };
      bedDistance = distance;
    }
  }
  if (bed) targets.push(bed);
  return targets;
}
