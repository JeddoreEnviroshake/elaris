import { BAG_ITEM_LABELS, INTERACTION_RANGE_PX, OUTLANDS_BALANCE } from '../config/balance';
import { TILE_SIZE, WORLD_PX, WORLD_TILES } from '../config/platform';
import { BLUEPRINT_QUALITY_WEIGHTS } from '../content/blueprintQuality';
import { isRegionalLandmarkTileClear } from '../content/regions';
import { isRoadPosition } from '../content/roads';
import {
  ORDINARY_UNCOMMON_BPS, RARE_STRONGBOX_MIN_RING, RARE_STRONGBOX_SALVAGE, SITE_KIND_IDS, siteKind,
  type SiteKindId, type SiteLootEntry,
} from '../content/sites';
import { isWithinTownPrecinct } from '../content/townBuildings';
import { isWithinTownSafeZoneWorldPosition } from '../content/townDefences';
import { describeArea } from './areas';
import { coordinateHash } from './biomes';
import { foldedRoll, resolveBlueprintFind } from './blueprintFinds';
import { effectiveBuildingDimensions } from './buildingGeometry';
import { tryCarryBlueprint } from './carriedBlueprints';
import { creditCoins } from './coins';
import { spawnLevel } from './enemyLevels';
import { addGroundDrop, tryAddResource, type CommandResult } from './gameplayCommands';
import { isTerrainSpawnable } from './landscape';
import { createRng } from './rng';
import { survivalCycleIndex, survivalSchedule } from './survivalCycle';
import type {
  AreaDescriptor, BuildingState, EditableOutlandsBalance, GameState, ResourceId, SiteProgress,
} from './state';

/**
 * Field sites, derived and searched.
 *
 * A site is a pure function of the world seed and its area: nothing about where
 * it stands, what kind it is or what its containers hold is ever saved. The
 * only stored state is a sparse `siteProgress` record per site (what has been
 * searched and how many guards have fallen this refill) and the one search
 * under way. Because of that, areas visited before sites existed gain them the
 * next time they are drawn, and no world-generation version bump is needed.
 */

/** A site occupies a 7×7 tile patch centred on its anchor tile. */
export const SITE_HALF_TILES = 3;
/** Coming this close records the site, which is also what marks it discovered. */
export const SITE_DISCOVERY_RADIUS_PX = 20 * TILE_SIZE;
/** Moving further than this from where a search began cancels it. */
export const SEARCH_MOVE_TOLERANCE_PX = 4;
/**
 * Candidates generated per area regardless of the configured count, so raising
 * or lowering `sitesPerArea` adds or hides the highest-numbered sites and never
 * moves an existing one.
 */
const MAX_SITES_PER_AREA = 6;
/** Sites keep this many tiles between their anchors so two never merge. */
const SITE_SPACING_TILES = 24;
/** Clear of the area centre, which is where an arriving player may stand. */
const SITE_CENTER_CLEARANCE_PX = 12 * TILE_SIZE;

/** Ordinary containers sit on the corners of the patch; the strongbox in the middle. */
const CONTAINER_OFFSETS: ReadonlyArray<readonly [number, number]> = [[-2, -2], [2, -2], [-2, 2], [2, 2]];
/** Guards post just outside the ruin walls. */
const GUARD_POST_OFFSETS: ReadonlyArray<readonly [number, number]> = [[-4, 0], [4, 0], [0, -4], [0, 4]];

export interface SiteContainer {
  readonly index: number;
  /** Whole world pixels, at the centre of the container's tile. */
  readonly x: number;
  readonly y: number;
  readonly strongbox: boolean;
}

export interface SiteDefinition {
  /** `${area.key}:site-${n}`, n from 1. */
  readonly id: string;
  readonly areaKey: string;
  /** Zero-based position in the area's candidate list; drives the rare-salvage rhythm. */
  readonly ordinal: number;
  readonly kind: SiteKindId;
  readonly anchorTileX: number;
  readonly anchorTileY: number;
  /** Whole world pixels at the centre of the anchor tile. */
  readonly x: number;
  readonly y: number;
  readonly containers: readonly SiteContainer[];
  readonly guardPosts: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

type SiteArea = Pick<AreaDescriptor, 'key' | 'x' | 'y' | 'theme' | 'seed'>;

/** Module-level memo of candidate lists per seed and area. Not game state. */
const candidateCache = new Map<string, readonly SiteDefinition[]>();

/**
 * The sites of one area, in id order. Pure: the same seed and area always give
 * the same list. Elaris has none, and neither does any theme no kind lists.
 */
export function areaSites(worldSeed: number, area: SiteArea, count = OUTLANDS_BALANCE.sitesPerArea): readonly SiteDefinition[] {
  const cacheKey = `${worldSeed >>> 0}|${area.key}`;
  let candidates = candidateCache.get(cacheKey);
  if (!candidates) {
    candidates = generateSiteCandidates(worldSeed, area);
    candidateCache.set(cacheKey, candidates);
  }
  return candidates.slice(0, Math.max(0, Math.min(MAX_SITES_PER_AREA, Math.floor(count))));
}

function generateSiteCandidates(worldSeed: number, area: SiteArea): readonly SiteDefinition[] {
  if (area.key === '0,0') return [];
  const kinds = SITE_KIND_IDS.filter((id) => siteKind(id).themes.includes(area.theme));
  if (kinds.length === 0) return [];
  // A different salt from the containers' 0x434f_4e54, so sites and caches are
  // scattered independently over the same filter chain.
  const rng = createRng((area.seed ^ 0x5349_5445) >>> 0);
  // Generated terrain only: player-made land clearings are save state, and a
  // site must depend on nothing but the seed.
  const landscape = { x: area.x, y: area.y, theme: area.theme };
  const center = WORLD_PX / 2;
  const sites: SiteDefinition[] = [];
  const margin = SITE_HALF_TILES + 6;
  let attempts = 0;
  while (sites.length < MAX_SITES_PER_AREA && attempts < 600) {
    attempts += 1;
    const tileX = rng.nextInt(margin, WORLD_TILES - margin);
    const tileY = rng.nextInt(margin, WORLD_TILES - margin);
    const kindRoll = rng.nextInt(0, 1_000);
    const x = tileX * TILE_SIZE + TILE_SIZE / 2;
    const y = tileY * TILE_SIZE + TILE_SIZE / 2;
    if (Math.hypot(x - center, y - center) < SITE_CENTER_CLEARANCE_PX) continue;
    if (sites.some((site) => Math.max(Math.abs(site.anchorTileX - tileX), Math.abs(site.anchorTileY - tileY)) < SITE_SPACING_TILES)) continue;
    if (!patchIsClear(worldSeed, area, landscape, tileX, tileY)) continue;
    const ordinal = sites.length;
    const kind = kinds[kindRoll % kinds.length]!;
    const definition = siteKind(kind);
    const offsets = CONTAINER_OFFSETS.slice(0, Math.max(2, Math.min(4, definition.containerCount - 1)));
    const containers: SiteContainer[] = [...offsets, [0, 0] as const].map(([dx, dy], index, all) => ({
      index,
      x: (tileX + dx) * TILE_SIZE + TILE_SIZE / 2,
      y: (tileY + dy) * TILE_SIZE + TILE_SIZE / 2,
      strongbox: index === all.length - 1,
    }));
    sites.push({
      id: `${area.key}:site-${ordinal + 1}`,
      areaKey: area.key,
      ordinal,
      kind,
      anchorTileX: tileX,
      anchorTileY: tileY,
      x,
      y,
      containers,
      guardPosts: GUARD_POST_OFFSETS.map(([dx, dy]) => ({
        x: (tileX + dx) * TILE_SIZE + TILE_SIZE / 2,
        y: (tileY + dy) * TILE_SIZE + TILE_SIZE / 2,
      })),
    });
  }
  return sites;
}

/**
 * The same filter chain `generateAreaContainers` uses (not in water, not in a
 * town precinct, not on a landmark, not inside the Elaris walls), plus roads,
 * tested at the anchor and the four corners of the 7×7 patch.
 */
function patchIsClear(
  worldSeed: number,
  area: SiteArea,
  landscape: { x: number; y: number; theme: SiteArea['theme'] },
  tileX: number,
  tileY: number,
): boolean {
  const h = SITE_HALF_TILES;
  for (const [dx, dy] of [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]] as const) {
    const tx = tileX + dx;
    const ty = tileY + dy;
    const px = tx * TILE_SIZE + TILE_SIZE / 2;
    const py = ty * TILE_SIZE + TILE_SIZE / 2;
    if (isWithinTownPrecinct(px, py, area.key)) return false;
    if (area.key === '0,0' && isWithinTownSafeZoneWorldPosition(px, py)) return false;
    if (isRegionalLandmarkTileClear(area.key, tx, ty, 6)) return false;
    if (isRoadPosition(area.key, tx + 0.5, ty + 0.5, 1)) return false;
    if (!isTerrainSpawnable(worldSeed, landscape, px, py)) return false;
  }
  return true;
}

/** Whether a site's 7×7 patch overlaps a tile rectangle. */
export function siteOverlapsRect(site: SiteDefinition, tileX: number, tileY: number, tilesWide: number, tilesHigh: number): boolean {
  const h = SITE_HALF_TILES;
  return tileX <= site.anchorTileX + h && tileX + tilesWide - 1 >= site.anchorTileX - h
    && tileY <= site.anchorTileY + h && tileY + tilesHigh - 1 >= site.anchorTileY - h;
}

function siteUnderBuilding(site: SiteDefinition, buildings: readonly BuildingState[]): boolean {
  return buildings.some((building) => {
    const size = effectiveBuildingDimensions(building);
    return siteOverlapsRect(site, building.tileX, building.tileY, size.tilesWide, size.tilesHigh);
  });
}

/**
 * Sites of an area that are actually there: a site whose patch a building
 * already overlaps is suppressed rather than drawn through someone's wall.
 */
export function liveAreaSites(state: GameState, areaKey = state.currentArea.key): readonly SiteDefinition[] {
  const area = areaKey === state.currentArea.key ? state.currentArea : areaDescriptorForKey(state.seed, areaKey);
  if (!area) return [];
  const buildings = areaKey === state.currentArea.key ? state.buildings : state.visitedAreas[areaKey]?.buildings ?? [];
  return areaSites(state.seed, area, state.gameBalance.outlands.sitesPerArea)
    .filter((site) => !siteUnderBuilding(site, buildings));
}

/** The live site in the current area whose patch covers a tile, if any. Used by build placement. */
export function liveSiteBlockingRect(state: GameState, tileX: number, tileY: number, tilesWide: number, tilesHigh: number): SiteDefinition | null {
  return liveAreaSites(state).find((site) => siteOverlapsRect(site, tileX, tileY, tilesWide, tilesHigh)) ?? null;
}

function areaDescriptorForKey(worldSeed: number, areaKey: string): AreaDescriptor | null {
  const [x, y] = areaKey.split(',').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return describeArea(worldSeed, x!, y!);
}

/** Look up any site by id, whether or not its area is loaded. */
export function siteById(worldSeed: number, siteId: string): SiteDefinition | null {
  const match = /^(-?\d+,-?\d+):site-(\d+)$/.exec(siteId);
  if (!match) return null;
  const area = areaDescriptorForKey(worldSeed, match[1]!);
  if (!area) return null;
  return areaSites(worldSeed, area, MAX_SITES_PER_AREA).find((site) => site.id === siteId) ?? null;
}

/** Chebyshev distance of an area from Elaris. */
export function areaRing(areaKey: string): number {
  const [x, y] = areaKey.split(',').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  return Math.max(Math.abs(x!), Math.abs(y!));
}

/* -------------------------------------------------------------------------- */
/* Refills and records                                                         */
/* -------------------------------------------------------------------------- */

/** Which refill the world is on: one rhythm shared by every site. */
export function siteRestockIndex(state: GameState): number {
  const cycles = Math.max(1, state.gameBalance.outlands.restockCycles);
  return Math.floor(survivalCycleIndex(state.tick, state.gameBalance.raid) / cycles);
}

/** Survival cycles until the next refill, at least 1. */
export function cyclesUntilRestock(state: GameState): number {
  const cycles = Math.max(1, state.gameBalance.outlands.restockCycles);
  const cycle = survivalCycleIndex(state.tick, state.gameBalance.raid);
  return (Math.floor(cycle / cycles) + 1) * cycles - cycle;
}

/**
 * This refill's view of a site. A stored record from an earlier refill reads as
 * empty without being written; only `ensureSiteProgress` overwrites it.
 */
export function currentSiteProgress(state: GameState, siteId: string): SiteProgress {
  const restockIndex = siteRestockIndex(state);
  const record = state.siteProgress[siteId];
  if (record && record.restockIndex === restockIndex) return record;
  return { restockIndex, searched: [], guardsDefeated: 0 };
}

/** The stored record for this refill, created or rolled over as needed. */
export function ensureSiteProgress(state: GameState, siteId: string): SiteProgress {
  const restockIndex = siteRestockIndex(state);
  const record = state.siteProgress[siteId];
  if (record && record.restockIndex === restockIndex) return record;
  const fresh: SiteProgress = { restockIndex, searched: [], guardsDefeated: 0 };
  state.siteProgress[siteId] = fresh;
  return fresh;
}

/** A site is discovered once any record of it exists, from any refill. */
export function isSiteDiscovered(state: GameState, siteId: string): boolean {
  return state.siteProgress[siteId] !== undefined;
}

/**
 * Record every live site the player has come within range of. Cheap enough to
 * run every tick: an area holds at most a handful of sites.
 */
export function discoverNearbySites(state: GameState): boolean {
  if (state.pendingRespawn) return false;
  let changed = false;
  const radiusSq = SITE_DISCOVERY_RADIUS_PX * SITE_DISCOVERY_RADIUS_PX;
  for (const site of liveAreaSites(state)) {
    if (state.siteProgress[site.id]) continue;
    const dx = site.x - state.player.x;
    const dy = site.y - state.player.y;
    if (dx * dx + dy * dy > radiusSq) continue;
    ensureSiteProgress(state, site.id);
    changed = true;
  }
  return changed;
}

/* -------------------------------------------------------------------------- */
/* Loot                                                                        */
/* -------------------------------------------------------------------------- */

export interface SiteContainerLoot {
  /** Merged by resource, in the order first drawn. */
  readonly resources: ReadonlyArray<readonly [ResourceId, number]>;
  readonly coins: number;
  /** Whether this strongbox carries a blueprint this refill. */
  readonly carriesBlueprint: boolean;
  /** The [0,1) roll the blueprint is picked with, so the pick is as stable as the rest. */
  readonly blueprintRoll: number;
}

function stableKeyHash(key: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 0x0100_0193);
  return hash >>> 0;
}

/**
 * Exactly what one container holds on one refill. Pure: seeded from the
 * inputs only, never from `state.rngState`, so a reload, a replay or a second
 * client always finds the same thing in the same crate.
 */
export function siteContainerLoot(
  worldSeed: number,
  siteId: string,
  containerIndex: number,
  restockIndex: number,
  level: number,
  inDanger: boolean,
  outlands: EditableOutlandsBalance = OUTLANDS_BALANCE,
): SiteContainerLoot {
  const site = siteById(worldSeed, siteId);
  const container = site?.containers[containerIndex];
  if (!site || !container) return { resources: [], coins: 0, carriesBlueprint: false, blueprintRoll: 0 };
  const kind = siteKind(site.kind);
  const keyHash = stableKeyHash(siteId);
  const roll = (salt: number, draw: number): number => foldedRoll(coordinateHash(
    ((worldSeed ^ salt) >>> 0), (keyHash ^ Math.imul(containerIndex + 1, 0x9e37_79b1)) + draw, restockIndex,
  ));
  const between = (value: number, min: number, max: number): number => min + Math.min(max - min, Math.floor(value * (max - min + 1)));
  const totals = new Map<ResourceId, number>();
  const add = (resource: ResourceId, amount: number): void => {
    if (amount > 0) totals.set(resource, (totals.get(resource) ?? 0) + amount);
  };
  const pick = (table: readonly SiteLootEntry[], value: number): SiteLootEntry => {
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    let target = value * total;
    for (const entry of table) {
      target -= entry.weight;
      if (target < 0) return entry;
    }
    return table[table.length - 1]!;
  };

  // Two common picks, each one unit richer per three area levels.
  const levelBonus = Math.floor(Math.max(1, Math.floor(level)) / 3);
  for (let draw = 0; draw < 2; draw += 1) {
    const entry = pick(kind.common, roll(0x434f_4d4d, draw));
    add(entry.resource, between(roll(0x514e_5459, draw), entry.min, entry.max) + levelBonus);
  }
  // Uncommon: guaranteed in a strongbox, sometimes in an ordinary crate, and
  // more of them for searching while a danger phase is running.
  const uncommonPicks = (container.strongbox || roll(0x554e_434f, 0) * 10_000 < ORDINARY_UNCOMMON_BPS ? 1 : 0)
    + (inDanger ? Math.max(0, Math.floor(outlands.dangerBonusRolls)) : 0);
  for (let draw = 0; draw < uncommonPicks; draw += 1) {
    const entry = pick(kind.uncommon, roll(0x554e_4331, draw));
    add(entry.resource, between(roll(0x554e_5154, draw), entry.min, entry.max));
  }

  let coins = 0;
  let carriesBlueprint = false;
  if (container.strongbox) {
    kind.strongbox.forEach((entry, draw) => add(entry.resource, between(roll(0x5354_524e, draw), entry.min, entry.max)));
    coins = between(roll(0x434f_494e, 0), kind.strongboxCoins.min, kind.strongboxCoins.max);
    carriesBlueprint = roll(0x424c_5052, 0) * 10_000 < outlands.strongboxBlueprintBps;
    // Far sites hand over one rare piece on every third refill, staggered by
    // site so a region always has one paying out somewhere. A rhythm, not a roll.
    if (areaRing(site.areaKey) >= RARE_STRONGBOX_MIN_RING && restockIndex % 3 === site.ordinal % 3) {
      const which = (site.ordinal + Math.floor(restockIndex / 3)) % RARE_STRONGBOX_SALVAGE.length;
      add(RARE_STRONGBOX_SALVAGE[which]!, 1);
    }
  }
  return { resources: [...totals.entries()], coins, carriesBlueprint, blueprintRoll: roll(0x5449_4552, 0) };
}

/* -------------------------------------------------------------------------- */
/* Searching                                                                   */
/* -------------------------------------------------------------------------- */

export function containerLabelFor(container: SiteContainer): string {
  return container.strongbox ? 'Strongbox' : 'Crate';
}

/** A live site in the current area, by id. */
export function currentAreaSite(state: GameState, siteId: string): SiteDefinition | null {
  return liveAreaSites(state).find((site) => site.id === siteId) ?? null;
}

export interface SiteContainerTarget {
  readonly site: SiteDefinition;
  readonly container: SiteContainer;
  readonly distancePx: number;
}

/** The nearest unsearched container in reach, for the overhead context action. */
export function nearestSearchableContainer(state: GameState, range = INTERACTION_RANGE_PX): SiteContainerTarget | null {
  let best: SiteContainerTarget | null = null;
  for (const site of liveAreaSites(state)) {
    const searched = currentSiteProgress(state, site.id).searched;
    for (const container of site.containers) {
      if (searched.includes(container.index)) continue;
      const distancePx = Math.hypot(container.x - state.player.x, container.y - state.player.y);
      if (distancePx > range || (best && distancePx >= best.distancePx)) continue;
      best = { site, container, distancePx };
    }
  }
  return best;
}

/** Ticks a container takes to search. */
export function searchTicksFor(state: GameState, container: SiteContainer): number {
  const outlands = state.gameBalance.outlands;
  return Math.max(1, Math.floor(container.strongbox ? outlands.strongboxSearchTicks : outlands.searchTicks));
}

/**
 * Start searching one container. The search then runs on its own, one tick at
 * a time, until it completes or the player moves or is hurt.
 */
export function beginSiteSearch(state: GameState, siteId: string, containerIndex: number): CommandResult {
  if (state.pendingRespawn) return { ok: false, message: 'Not now' };
  if (state.activeSearch) {
    return state.activeSearch.siteId === siteId && state.activeSearch.containerIndex === containerIndex
      ? { ok: false, message: 'Already searching' }
      : { ok: false, message: 'Finish this search first' };
  }
  const site = currentAreaSite(state, siteId);
  const container = site?.containers[containerIndex];
  if (!site || !container) return { ok: false, message: 'Nothing to search here' };
  const label = containerLabelFor(container);
  if (Math.hypot(container.x - state.player.x, container.y - state.player.y) > INTERACTION_RANGE_PX) {
    return { ok: false, message: `Move closer to the ${label.toLowerCase()}` };
  }
  if (currentSiteProgress(state, siteId).searched.includes(containerIndex)) {
    const cycles = cyclesUntilRestock(state);
    return { ok: false, message: `Already searched · refills in ${cycles} cycle${cycles === 1 ? '' : 's'}` };
  }
  ensureSiteProgress(state, siteId);
  state.activeSearch = {
    siteId,
    containerIndex,
    startX: Math.round(state.player.x),
    startY: Math.round(state.player.y),
    hpAtStart: state.player.hp,
    completesAtTick: state.tick + searchTicksFor(state, container),
  };
  return { ok: true, message: `Searching the ${label.toLowerCase()}…` };
}

export function cancelSiteSearch(state: GameState): boolean {
  if (!state.activeSearch) return false;
  state.activeSearch = null;
  return true;
}

export type SiteSearchResult =
  | { readonly kind: 'interrupted'; readonly message: string }
  | {
    readonly kind: 'completed';
    readonly siteId: string;
    readonly containerIndex: number;
    readonly message: string;
    /** What went into the bag. */
    readonly gains: ReadonlyArray<readonly [ResourceId, number]>;
    /** What did not fit and was left on the ground at the container. */
    readonly spilled: ReadonlyArray<readonly [ResourceId, number]>;
    readonly coins: number;
    readonly blueprintId: string | null;
    readonly blueprintSpilled: boolean;
  };

/** 0..1 progress of the search under way, for the HUD ring. */
export function siteSearchProgress(state: GameState): number | null {
  const search = state.activeSearch;
  if (!search) return null;
  const site = siteById(state.seed, search.siteId);
  const container = site?.containers[search.containerIndex];
  if (!container) return null;
  const total = searchTicksFor(state, container);
  const remaining = Math.max(0, search.completesAtTick - state.tick);
  return Math.max(0, Math.min(1, (total - remaining) / total));
}

/**
 * One tick of the search under way. Runs after hostiles and movement so a hit
 * or a step this tick is judged before anything is granted.
 */
export function advanceSiteSearch(state: GameState): SiteSearchResult | null {
  const search = state.activeSearch;
  if (!search) return null;
  const site = currentAreaSite(state, search.siteId);
  const container = site?.containers[search.containerIndex];
  if (!site || !container || state.pendingRespawn) {
    state.activeSearch = null;
    return { kind: 'interrupted', message: 'Search interrupted' };
  }
  if (Math.hypot(state.player.x - search.startX, state.player.y - search.startY) > SEARCH_MOVE_TOLERANCE_PX) {
    state.activeSearch = null;
    return { kind: 'interrupted', message: 'Search interrupted · you moved' };
  }
  if (state.player.hp < search.hpAtStart) {
    state.activeSearch = null;
    return { kind: 'interrupted', message: 'Search interrupted · you were hit' };
  }
  // Regeneration raises the bar with it, so a hit after a heal still counts.
  if (state.player.hp > search.hpAtStart) search.hpAtStart = state.player.hp;
  if (state.tick < search.completesAtTick) return null;
  state.activeSearch = null;
  return completeSearch(state, site, container);
}

function completeSearch(state: GameState, site: ReturnType<typeof currentAreaSite> & object, container: SiteContainer): SiteSearchResult {
  const progress = ensureSiteProgress(state, site.id);
  if (progress.searched.includes(container.index)) return { kind: 'interrupted', message: 'Already searched' };
  const level = spawnLevel(site.areaKey, site.x, site.y, state.gameBalance.world);
  const timer = survivalSchedule(state);
  const loot = siteContainerLoot(
    state.seed, site.id, container.index, progress.restockIndex, level, timer.phase === 'danger', state.gameBalance.outlands,
  );
  const gains: Array<readonly [ResourceId, number]> = [];
  const spilled: Array<readonly [ResourceId, number]> = [];
  for (const [resource, amount] of loot.resources) {
    if (tryAddResource(state, resource, amount)) gains.push([resource, amount]);
    else {
      addGroundDrop(state, resource, amount, container.x, container.y);
      spilled.push([resource, amount]);
    }
  }
  let blueprintId: string | null = null;
  let blueprintSpilled = false;
  if (loot.carriesBlueprint) {
    blueprintId = resolveBlueprintFind(state.unlockedItemIds, 'site', BLUEPRINT_QUALITY_WEIGHTS, loot.blueprintRoll);
    if (blueprintId) blueprintSpilled = tryCarryBlueprint(state, blueprintId) === null;
  }
  progress.searched = [...progress.searched, container.index].sort((a, b) => a - b);
  if (loot.coins > 0) creditCoins(state, loot.coins, '');
  const kindLabel = siteKind(site.kind).label;
  const parts = gains.map(([resource, amount]) => `${amount} ${BAG_ITEM_LABELS[resource]}`);
  if (loot.coins > 0) parts.push(`${loot.coins} coins`);
  if (blueprintId && !blueprintSpilled) parts.push('a blueprint');
  const found = parts.length > 0 ? parts.join(', ') : 'nothing you could carry';
  const spillNote = spilled.length > 0 || blueprintSpilled ? ' · bag full, some left on the ground' : '';
  return {
    kind: 'completed',
    siteId: site.id,
    containerIndex: container.index,
    message: `${kindLabel} ${containerLabelFor(container).toLowerCase()}: ${found}${spillNote}`,
    gains,
    spilled,
    coins: loot.coins,
    blueprintId,
    blueprintSpilled,
  };
}
