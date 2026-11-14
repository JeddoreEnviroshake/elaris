import { TILE_SIZE, WORLD_PX } from '../config/platform';
import { coordinateHash } from './biomes';
import { generateAreaContainers, generateAreaResourceNodes, generateWildCreatures, starterResourceNodes } from './worldGeneration';
import { isResourceClearOfRoad } from '../content/roads';
import { effectiveBuildingDimensions } from './buildingGeometry';
import type { AreaDescriptor, AreaSnapshot, AreaThemeId, Facing, GameState, ResourceNodeKind, ResourceNodeState } from './state';
import { recordAreaVisit } from './questTracking';
import { authoredWorldAreaAt, canTravelToWorldArea, isWithinWorldBounds } from '../content/world';
import { townBuildingsInArea } from '../content/townBuildings';
import { regionalIdentityForArea } from '../content/regions';
import { isElarisWaterSceneryReservedTile } from '../content/elarisWaters';
import { releaseOpeningProtection } from './openingFog';

export interface AreaPalette {
  base: number;
  alternate: number;
  detail: number;
  background: string;
  minimap: string;
}

interface ThemeDefinition {
  nouns: readonly string[];
  adjectives: readonly string[];
  weights: Readonly<Record<ResourceNodeKind, number>>;
  palette: AreaPalette;
}

const THEMES: Readonly<Record<AreaThemeId, ThemeDefinition>> = {
  elaris: {
    adjectives: [''], nouns: ['Elaris'],
    weights: { tree: 77, stone: 43, metal: 0, plant: 58, 'berry-bush': 0 },
    palette: { base: 0x2e5b3a, alternate: 0x315f3d, detail: 0x244b32, background: '#1a2c22', minimap: '#315b3e' },
  },
  forest: {
    adjectives: ['Dark', 'Whispering', 'Ancient', 'Mossy', 'Dusky'], nouns: ['Forest', 'Woods', 'Timberland', 'Wildwood'],
    weights: { tree: 112, stone: 18, metal: 0, plant: 42, 'berry-bush': 18 },
    palette: { base: 0x285039, alternate: 0x2b553b, detail: 0x1e422d, background: '#17281f', minimap: '#2a513a' },
  },
  mountain: {
    adjectives: ['Metal', 'Iron', 'Flint', 'Silver', 'Storm'], nouns: ['Mountain', 'Highlands', 'Crags', 'Ridge'],
    weights: { tree: 18, stone: 92, metal: 24, plant: 25, 'berry-bush': 6 },
    palette: { base: 0x424c43, alternate: 0x4d584d, detail: 0x747a6d, background: '#232927', minimap: '#4c5850' },
  },
  meadow: {
    adjectives: ['Golden', 'Sunlit', 'Windy', 'Quiet', 'Amber'], nouns: ['Meadow', 'Fields', 'Prairie', 'Downs'],
    weights: { tree: 24, stone: 25, metal: 0, plant: 104, 'berry-bush': 28 },
    palette: { base: 0x49653c, alternate: 0x506d40, detail: 0x75804a, background: '#273522', minimap: '#526c42' },
  },
  thicket: {
    adjectives: ['Berry', 'Bramble', 'Sweet', 'Redleaf', 'Thorn'], nouns: ['Thicket', 'Grove', 'Hollow', 'Briar'],
    weights: { tree: 44, stone: 14, metal: 0, plant: 40, 'berry-bush': 90 },
    palette: { base: 0x355b3d, alternate: 0x3a6141, detail: 0x694653, background: '#202d24', minimap: '#3d6043' },
  },
  marsh: {
    adjectives: ['Mist', 'Reed', 'Still', 'Murk', 'Willow'], nouns: ['Marsh', 'Fen', 'Wetlands', 'Mire'],
    weights: { tree: 35, stone: 15, metal: 0, plant: 92, 'berry-bush': 20 },
    palette: { base: 0x34594f, alternate: 0x395f55, detail: 0x496b62, background: '#1d2e2b', minimap: '#3a5e54' },
  },
};

const GENERATED_THEMES: readonly AreaThemeId[] = ['forest', 'mountain', 'meadow', 'thicket', 'marsh'];

export function areaPalette(theme: AreaThemeId): AreaPalette {
  return THEMES[theme].palette;
}

export function isElaris(state: GameState): boolean {
  return state.currentArea.x === 0 && state.currentArea.y === 0;
}

/**
 * Remove pre-upgrade generated scenery that now overlaps Elaris's authored
 * moat, temple lake, or shrine island. Player buildings and drops are retained.
 */
export function reconcileElarisWaters(state: GameState): void {
  const keep = (entity: { x: number; y: number }): boolean => !isElarisWaterSceneryReservedTile(
    Math.floor(entity.x / TILE_SIZE),
    Math.floor(entity.y / TILE_SIZE),
  );
  if (state.currentArea.key === '0,0') {
    state.resourceNodes = state.resourceNodes.filter(keep);
    state.wildCreatures = state.wildCreatures.filter(keep);
    state.containers = state.containers.filter(keep);
  }
  const snapshot = state.visitedAreas['0,0'];
  if (!snapshot) return;
  snapshot.resourceNodes = snapshot.resourceNodes.filter(keep);
  snapshot.wildCreatures = snapshot.wildCreatures.filter(keep);
  snapshot.containers = snapshot.containers.filter(keep);
}

/** Clean generated roadside scenery in active and saved regions, retaining all player property. */
export function reconcileRoadResources(state: GameState): void {
  let starter: Map<string, ResourceNodeState> | null = null;
  const clean = (key: string, nodes: ResourceNodeState[], buildings: GameState['buildings']) => nodes.flatMap((node) => {
    if (isResourceClearOfRoad(key, node)) return [node];
    if (key === '0,0' && /^(tree-00[0-2]|plant-00[01]|stone-00[01])$/.test(node.id)) {
      starter ??= new Map(starterResourceNodes(state.seed, state.gameBalance.objects).map((candidate) => [candidate.id, candidate]));
      const replacement = starter.get(node.id);
      if (replacement && !buildings.some((building) => {
        const size = effectiveBuildingDimensions(building); const x = replacement.x / TILE_SIZE; const y = replacement.y / TILE_SIZE;
        return x >= building.tileX && x < building.tileX + size.tilesWide && y >= building.tileY && y < building.tileY + size.tilesHigh;
      })) return [{ ...node, x: replacement.x, y: replacement.y }];
    }
    return [];
  });
  state.resourceNodes = clean(state.currentArea.key, state.resourceNodes, state.buildings);
  for (const [key, area] of Object.entries(state.visitedAreas)) area.resourceNodes = key === state.currentArea.key ? state.resourceNodes : clean(key, area.resourceNodes, area.buildings);
}

export function areaKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function describeArea(worldSeed: number, x: number, y: number): AreaDescriptor {
  const authored = authoredWorldAreaAt(x, y);
  if (authored) {
    const seed = (worldSeed ^ Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x119de1f3)) >>> 0;
    return { key: authored.key, x, y, name: authored.name, theme: authored.theme, seed };
  }
  const normalizedHash = (value: number) => ((value % 1) + 1) % 1;
  const value = normalizedHash(coordinateHash(worldSeed ^ 0x4152_4541, x, y));
  const theme = GENERATED_THEMES[Math.floor(value * GENERATED_THEMES.length) % GENERATED_THEMES.length]!;
  const definition = THEMES[theme];
  const nameSeed = normalizedHash(coordinateHash(worldSeed ^ 0x4e41_4d45, y, x));
  const adjective = definition.adjectives[Math.floor(nameSeed * definition.adjectives.length) % definition.adjectives.length]!;
  const nounIndex = Math.floor(normalizedHash(coordinateHash(worldSeed ^ 0x4e4f_554e, x, y)) * definition.nouns.length) % definition.nouns.length;
  const seed = (worldSeed ^ Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x119de1f3)) >>> 0;
  return { key: areaKey(x, y), x, y, name: `${adjective} ${definition.nouns[nounIndex]!}`, theme, seed };
}

export function saveCurrentArea(state: GameState): void {
  state.visitedAreas[state.currentArea.key] = {
    ...state.currentArea,
    resourceNodes: state.resourceNodes,
    wildCreatures: state.wildCreatures,
    groundDrops: state.groundDrops,
    containers: state.containers,
    buildings: state.buildings,
    // Raiders never travel with a snapshot: a live raid the player walks away
    // from is already recorded as settled for this cycle, so its survivors
    // simply give up rather than freezing in place until the player returns.
    raiders: [],
  };
}

/** Save the active region and restore an already-visited region by key. */
export function enterVisitedArea(state: GameState, key: string): boolean {
  if (key === state.currentArea.key) return true;
  const area = state.visitedAreas[key];
  if (!area) return false;
  saveCurrentArea(state);
  activateArea(state, area);
  return true;
}

/** Teleport to a bounded surface area, creating it deterministically if needed. */
export function enterWorldArea(state: GameState, x: number, y: number): boolean {
  if (x === state.currentArea.x && y === state.currentArea.y) return true;
  if (!isWithinWorldBounds(x, y)) return false;
  const descriptor = describeArea(state.seed, x, y);
  const area = state.visitedAreas[descriptor.key] ?? createAreaSnapshot(state, descriptor);
  saveCurrentArea(state);
  activateArea(state, area);
  return true;
}

function activateArea(state: GameState, area: AreaSnapshot): void {
  releaseOpeningProtection(state, area.key);
  const authored = describeArea(state.seed, area.x, area.y);
  state.currentArea = activeAreaDescriptor({ ...area, ...authored });
  state.resourceNodes = area.resourceNodes;
  state.wildCreatures = area.wildCreatures;
  state.groundDrops = area.groundDrops;
  // Legacy snapshots predate containers; generate them on first activation so
  // an existing save still finds caches in regions it had already visited.
  if (!Array.isArray(area.containers)) {
    area.containers = generateAreaContainers(
      area.seed, area.key, townBuildingsInArea(area.key).length > 0, area, state.seed, area.key,
    );
  }
  state.containers = area.containers;
  state.buildings = area.buildings;
  state.raiders = [];
  state.activeEncounter = null;
  reconcileRoadResources(state);
  recordAreaVisit(state);
}

function createAreaSnapshot(state: GameState, descriptor: AreaDescriptor): AreaSnapshot {
  const weights = regionalIdentityForArea(descriptor.key)?.resourceWeights ?? THEMES[descriptor.theme].weights;
  const containsSettlement = townBuildingsInArea(descriptor.key).length > 0;
  return {
    ...descriptor,
    resourceNodes: generateAreaResourceNodes(
      descriptor.seed,
      weights,
      containsSettlement,
      state.gameBalance.objects,
      descriptor,
      state.seed,
      descriptor.key,
    ),
    wildCreatures: generateWildCreatures(
      descriptor.seed,
      descriptor.key,
      containsSettlement,
      descriptor,
      state.seed,
      descriptor.key,
      state.gameBalance.world,
    ),
    groundDrops: [],
    containers: generateAreaContainers(
      descriptor.seed,
      descriptor.key,
      containsSettlement,
      descriptor,
      state.seed,
      descriptor.key,
    ),
    buildings: [],
    raiders: [],
  };
}

/** Persist the old region and restore or deterministically create its neighbor. */
export function enterAdjacentArea(state: GameState, direction: Facing): boolean {
  const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
  const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  const destinationX = state.currentArea.x + dx;
  const destinationY = state.currentArea.y + dy;
  if (!canTravelToWorldArea(state.currentArea.x, state.currentArea.y, destinationX, destinationY)) return false;
  saveCurrentArea(state);
  const descriptor = describeArea(state.seed, destinationX, destinationY);
  const area = state.visitedAreas[descriptor.key] ?? createAreaSnapshot(state, descriptor);
  activateArea(state, area);

  const inset = TILE_SIZE / 2 + 1;
  if (direction === 'left') state.player.x = WORLD_PX - inset;
  if (direction === 'right') state.player.x = inset;
  if (direction === 'up') state.player.y = WORLD_PX - inset;
  if (direction === 'down') state.player.y = inset;
  return true;
}

function activeAreaDescriptor(area: AreaDescriptor): AreaDescriptor {
  return {
    key: area.key, x: area.x, y: area.y, name: area.name, theme: area.theme, seed: area.seed,
    ...(area.landClearingTiles ? { landClearingTiles: [...area.landClearingTiles] } : {}),
  };
}
