import { DEFAULT_WORLD_BALANCE, RESOURCE_BALANCE } from '../config/balance';
import { TILE_SIZE, WORLD_PX } from '../config/platform';
import { createRng } from './rng';
import { scaleByLevel, spawnLevel } from './enemyLevels';
import type {
  EditableResourceBalance,
  EditableWorldBalance,
  ResourceNodeKind,
  ResourceNodeState,
  WildCreatureState,
  WorldContainerKind,
  WorldContainerState,
} from './state';
import { creatureDefinition } from '../content/creatures';
import { STARTER_TUFTLE_POSITION, starterTuftleId } from '../content/onboarding';
import { starterBiomeAt, type StarterBiome } from './biomes';
import { isTownFootprintWorldPosition, isWithinTownPrecinct } from '../content/townBuildings';
import { isWithinTownSafeZoneWorldPosition } from '../content/townDefences';
import { isTerrainSpawnable, type LandscapeContext } from './landscape';
import { isRegionalLandmarkTileClear, regionalIdentityForArea } from '../content/regions';
import { isResourceClearOfRoad } from '../content/roads';

/**
 * Where the starter fixtures sit relative to their anchor. The two nearest
 * trees and both plants are in reach of a player standing on the anchor; the
 * stones are one step out, exactly as they were when the cluster stood on the
 * spawn point.
 */
const STARTER_GROVE_FIXTURES = [
  { kind: 'tree', index: 0, dx: 30, dy: 0 },
  { kind: 'tree', index: 1, dx: -36, dy: 18 },
  { kind: 'tree', index: 2, dx: 12, dy: -42 },
  { kind: 'plant', index: 0, dx: -42, dy: 0 },
  { kind: 'plant', index: 1, dx: 42, dy: 0 },
  { kind: 'stone', index: 0, dx: 86, dy: 12 },
  { kind: 'stone', index: 1, dx: -78, dy: -24 },
] as const;

/** New-game-only roadside encounter on authored, protected town ground. */
export function generateOpeningTuftle(seed: number): WildCreatureState {
  const profile = creatureDefinition('tuftle').encounter;
  return {
    id: starterTuftleId(seed), speciesId: 'tuftle', ...STARTER_TUFTLE_POSITION,
    hp: profile.maxHp, maxHp: profile.maxHp, level: 1,
    homeX: STARTER_TUFTLE_POSITION.x, homeY: STARTER_TUFTLE_POSITION.y,
    aggroUntilTick: 0, nextAttackTick: 0, fleeUntilTick: 0,
    captureBonusBps: 0, encounterCooldownUntilTick: 0,
  };
}

/**
 * The clearing the tutorial cluster stands in: west of Elaris's gate causeway,
 * the first open ground a new character reaches after crossing the moat. The
 * cluster used to sit on the spawn point, but nothing generates inside the
 * walls any more.
 */
const STARTER_GROVE_PREFERRED = { x: 52 * TILE_SIZE, y: 84 * TILE_SIZE } as const;
/** How far the grove may be nudged, in tiles, to find ground that holds it. */
const STARTER_GROVE_SEARCH_TILES = 12;

/**
 * The grove anchor for one world seed.
 *
 * Elaris's surroundings are seed-varied, so the preferred clearing is a river
 * bed in some worlds. The anchor therefore walks outward until it finds ground
 * that holds every fixture — the opening of the game is a promise the terrain
 * does not get to break, and a cluster half-eaten by the spawn filters is the
 * same as no cluster at all.
 */
export function starterGroveAnchor(seed: number): { readonly x: number; readonly y: number } {
  const area = { x: 0, y: 0, theme: 'elaris' as const };
  const holdsEveryFixture = (x: number, y: number): boolean =>
    STARTER_GROVE_FIXTURES.every(({ kind, dx, dy }) => isPlaceableElarisGround(seed, area, x + dx, y + dy)
      && isResourceClearOfRoad('0,0', { kind, x: x + dx, y: y + dy }));
  for (let radius = 0; radius <= STARTER_GROVE_SEARCH_TILES; radius += 1) {
    for (let tileY = -radius; tileY <= radius; tileY += 1) {
      for (let tileX = -radius; tileX <= radius; tileX += 1) {
        if (Math.max(Math.abs(tileX), Math.abs(tileY)) !== radius) continue;
        const x = STARTER_GROVE_PREFERRED.x + tileX * TILE_SIZE;
        const y = STARTER_GROVE_PREFERRED.y + tileY * TILE_SIZE;
        if (holdsEveryFixture(x, y)) return { x, y };
      }
    }
  }
  return STARTER_GROVE_PREFERRED;
}

/** Ground outside Elaris's walls and precinct that a node may stand on. */
function isPlaceableElarisGround(
  seed: number,
  area: LandscapeContext,
  x: number,
  y: number,
): boolean {
  return isTerrainSpawnable(seed, area, x, y)
    && !isWithinTownSafeZoneWorldPosition(x, y)
    && !isWithinTownPrecinct(x, y)
    && !isTownFootprintWorldPosition(x, y);
}

/**
 * Generate stable resource nodes from the world seed. The starter fixtures
 * guarantee immediately reachable tree, plant, and stone progression goals in
 * the starter grove outside the west gate. Nothing generates inside the Elaris
 * perimeter: that ground is the town's, walked and defended, and a tree growing
 * between the wall and the shops reads as somewhere nobody keeps.
 */
export function starterResourceNodes(seed: number, objects: Readonly<Record<ResourceNodeKind, EditableResourceBalance>> = RESOURCE_BALANCE): ResourceNodeState[] {
  const grove = starterGroveAnchor(seed); const nodes: ResourceNodeState[] = [];
  for (const { kind, index, dx, dy } of STARTER_GROVE_FIXTURES) addNode(nodes, objects, kind, index, grove.x + dx, grove.y + dy);
  return nodes;
}

export function generateResourceNodes(
  seed: number,
  objects: Readonly<Record<ResourceNodeKind, EditableResourceBalance>> = RESOURCE_BALANCE,
): ResourceNodeState[] {
  const starter = starterResourceNodes(seed, objects);

  const center = WORLD_PX / 2;
  const rng = createRng(seed ^ 0x9e37_79b9);
  // Forests are wood-rich and dense with undergrowth; the open grassland keeps
  // more stone and plants visible so each biome has a readable gathering role.
  const scattered: ResourceNodeState[] = [];
  scatter(scattered, objects, rng, seed, 'tree', 58, 3, center, 'forest');
  scatter(scattered, objects, rng, seed, 'tree', 19, 61, center, 'grassland');
  scatter(scattered, objects, rng, seed, 'stone', 15, 2, center, 'forest');
  scatter(scattered, objects, rng, seed, 'stone', 28, 17, center, 'grassland');
  scatter(scattered, objects, rng, seed, 'plant', 30, 2, center, 'forest');
  scatter(scattered, objects, rng, seed, 'plant', 28, 32, center, 'grassland');

  // The perimeter is the line, not the building bounding box: the precinct
  // stops nodes crowding the service buildings, and the walls clear the rest of
  // the town — the squares, the gate approaches, and the ground behind the
  // shops — so Elaris is somewhere that was cleared and stayed cleared.
  return [...starter, ...scattered]
    .filter((node) => isResourceClearOfRoad('0,0', node))
    .filter((node) => !isTownFootprintWorldPosition(node.x, node.y))
    .filter((node) => !isWithinTownPrecinct(node.x, node.y))
    .filter((node) => !isWithinTownSafeZoneWorldPosition(node.x, node.y))
    .filter((node) => isTerrainSpawnable(seed, { x: 0, y: 0, theme: 'elaris' }, node.x, node.y));
}

/** Generate a themed region from explicit material weights. */
export function generateAreaResourceNodes(
  seed: number,
  weights: Readonly<Record<ResourceNodeKind, number>>,
  excludeTown = false,
  objects: Readonly<Record<ResourceNodeKind, EditableResourceBalance>> = RESOURCE_BALANCE,
  landscape?: LandscapeContext,
  landscapeSeed = seed,
  townAreaKey = '0,0',
): ResourceNodeState[] {
  const rng = createRng(seed ^ 0x9e37_79b9);
  const nodes: ResourceNodeState[] = [];
  let offset = 0;
  for (const kind of ['tree', 'stone', 'metal', 'plant', 'berry-bush'] as const) {
    const count = weights[kind];
    scatterAnywhere(nodes, objects, rng, kind, count, offset);
    offset += count;
  }
  const precinctFiltered = excludeTown
    ? nodes.filter((node) => !isWithinTownPrecinct(node.x, node.y, townAreaKey))
    : nodes;
  // Elaris can be regenerated through this path (a save that never snapshotted
  // its home area), so its walls clear resources here exactly as they do in
  // generateResourceNodes.
  const townFiltered = townAreaKey === '0,0'
    ? precinctFiltered.filter((node) => !isWithinTownSafeZoneWorldPosition(node.x, node.y))
    : precinctFiltered;
  const landmarkFiltered = townFiltered.filter((node) => isResourceClearOfRoad(townAreaKey, node) && !isRegionalLandmarkTileClear(
    townAreaKey,
    Math.floor(node.x / TILE_SIZE),
    Math.floor(node.y / TILE_SIZE),
  ));
  return landscape
    ? landmarkFiltered.filter((node) => isTerrainSpawnable(landscapeSeed, landscape, node.x, node.y))
    : landmarkFiltered;
}

/**
 * Sparse, seed-stable findable containers. The count is deliberately low: a
 * cache the player trips over every screen is a resource node with extra
 * steps. Placement reuses the exact filter chain resource nodes use, so a
 * container never lands in water, on a settlement, or on a landmark tile.
 */
export const CONTAINERS_PER_AREA = 3;
/** Minimum distance from an area's center, which is also the player's spawn. */
const CONTAINER_CENTER_CLEARANCE_PX = 160;

export function generateAreaContainers(
  seed: number,
  idPrefix = '',
  excludeTown = false,
  landscape?: LandscapeContext,
  landscapeSeed = seed,
  townAreaKey = '0,0',
  count = CONTAINERS_PER_AREA,
  /**
   * Force every container to one kind. Used by the arcane storm, whose caches
   * are placed by the same filter chain as the permanent ones — a cache in a
   * lake would be no more reachable for having been scattered by weather.
   */
  fixedKind?: WorldContainerKind,
): WorldContainerState[] {
  const center = WORLD_PX / 2;
  const rng = createRng(seed ^ 0x434f_4e54);
  const containers: WorldContainerState[] = [];
  let attempts = 0;
  while (containers.length < count && attempts < 400) {
    attempts += 1;
    const x = rng.nextInt(TILE_SIZE * 3, WORLD_PX - TILE_SIZE * 3);
    const y = rng.nextInt(TILE_SIZE * 3, WORLD_PX - TILE_SIZE * 3);
    if (Math.hypot(x - center, y - center) < CONTAINER_CENTER_CLEARANCE_PX) continue;
    if (excludeTown && isWithinTownPrecinct(x, y, townAreaKey)) continue;
    // Elaris keeps its walls clear of findables too: a cache behind the smithy
    // is loot the town would have collected long before the player arrived.
    if (townAreaKey === '0,0' && isWithinTownSafeZoneWorldPosition(x, y)) continue;
    if (isRegionalLandmarkTileClear(townAreaKey, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE), 3)) continue;
    if (landscape && !isTerrainSpawnable(landscapeSeed, landscape, x, y)) continue;
    const suffix = `container-${String(containers.length + 1).padStart(3, '0')}`;
    containers.push({
      id: idPrefix ? `${idPrefix}-${suffix}` : suffix,
      kind: fixedKind ?? containerKind(rng.nextInt(0, 99)),
      x,
      y,
      opened: false,
    });
  }
  return containers;
}

/** Rarity ladder. Cellars are the only source of blueprints, so they stay rare. */
function containerKind(roll: number): WorldContainerKind {
  if (roll < 55) return 'hollow-log';
  if (roll < 88) return 'supply-cache';
  return 'collapsed-cellar';
}

/**
 * The wild population of one area.
 *
 * An area with a regional identity is scattered entirely from its own species
 * list. Everywhere else opens with the four authored spawns, kept exactly where
 * they always were: they are the creatures a new character meets on their first
 * walk out of town, and moving them would change the opening of the game.
 *
 * Both paths are then filled out to `creaturesPerArea`, because a map with six
 * animals on it reads as a diorama rather than as somewhere that lives. The
 * quota is a target rather than a guarantee — the town and terrain filters
 * below still get the last word on where anything may stand.
 */
export function generateWildCreatures(
  seed: number,
  idPrefix = '',
  excludeTown = false,
  landscape?: LandscapeContext,
  landscapeSeed = seed,
  townAreaKey = '0,0',
  world: EditableWorldBalance = DEFAULT_WORLD_BALANCE,
): WildCreatureState[] {
  const center = WORLD_PX / 2;
  const rng = createRng(seed ^ 0x51f1_7e);
  const spawn = (
    id: string,
    speciesId: WildCreatureState['speciesId'],
    x: number,
    y: number,
  ): WildCreatureState => newWildCreature(
    id,
    speciesId,
    x + rng.nextInt(-10, 10),
    y + rng.nextInt(-10, 10),
    world,
    townAreaKey,
  );
  const id = (suffix: string) => idPrefix ? `${idPrefix}-${suffix}` : suffix;
  const regional = regionalIdentityForArea(townAreaKey);
  const regionalSpecies = regional?.characteristicCreature.speciesId === 'tuftle'
    ? ['tuftle', 'tuftle', 'tuftle', 'glade-stag', 'glade-stag', 'craghopper'] as const
    : regional?.characteristicCreature.speciesId === 'glade-stag'
      ? ['glade-stag', 'glade-stag', 'glade-stag', 'snarlfox', 'snarlfox', 'tuftle'] as const
      : null;
  const quota = Math.max(0, Math.floor(world.creaturesPerArea));
  const authored = regionalSpecies && landscape
    ? []
    : [
      spawn(id('wild-tuftle-001'), 'tuftle', center + 160, center - 80),
      spawn(id('wild-craghopper-001'), 'craghopper', center - 190, center + 138),
      spawn(id('wild-glade-stag-001'), 'glade-stag', center + 235, center + 205),
      spawn(id('wild-snarlfox-001'), 'snarlfox', center - 260, center - 220),
    ];
  const creatures = [
    ...authored,
    ...scatterCreatures(
      regionalSpecies ?? DEFAULT_AREA_SPECIES,
      Math.max(0, quota - authored.length),
      authored.length,
      rng,
      idPrefix,
      landscape,
      landscapeSeed,
      townAreaKey,
      world,
    ),
  ];
  const townFiltered = excludeTown
    ? creatures.filter((creature) => !isTownFootprintWorldPosition(creature.x, creature.y, townAreaKey))
    : creatures;
  const context = landscape ?? (excludeTown ? { x: 0, y: 0, theme: 'elaris' as const } : undefined);
  return context
    ? townFiltered.filter((creature) => isTerrainSpawnable(landscapeSeed, context, creature.x, creature.y))
    : townFiltered;
}

/**
 * A wild creature at full health, anchored to where it spawned.
 *
 * Takes the content maxHp rather than the save-backed value, because world
 * generation runs without a GameState — the same way a raider spawn takes the
 * definition it is handed. An Admin edit applies to creatures spawned after it.
 *
 * The level is stamped here, from where the creature landed, and health is
 * scaled to match. A creature that carried a level but not the health to go
 * with it would advertise a fight it could not give.
 */
export function newWildCreature(
  id: string,
  speciesId: WildCreatureState['speciesId'],
  x: number,
  y: number,
  world: EditableWorldBalance = DEFAULT_WORLD_BALANCE,
  areaKey = '0,0',
): WildCreatureState {
  const { encounter } = creatureDefinition(speciesId);
  const level = spawnLevel(areaKey, x, y, world);
  const maxHp = scaleByLevel(encounter.maxHp, level, encounter.levelMultiplierBps);
  return {
    id,
    speciesId,
    x,
    y,
    hp: maxHp,
    maxHp,
    level,
    homeX: x,
    homeY: y,
    aggroUntilTick: 0,
    nextAttackTick: 0,
    fleeUntilTick: 0,
    captureBonusBps: 0,
    encounterCooldownUntilTick: 0,
  };
}

/**
 * Species used to fill an area that has no regional identity of its own. The
 * same four the authored spawns use, so a generic area still reads as this
 * world's wildlife rather than as one repeated animal.
 */
const DEFAULT_AREA_SPECIES: readonly WildCreatureState['speciesId'][] = [
  'tuftle', 'craghopper', 'glade-stag', 'snarlfox',
  // The homestead-defence roster fills out the back of the cycle, so a generic
  // area still reads mostly as the founding four — the species a player needs
  // in order to defend a base should be something the map eventually offers,
  // not the first thing every field is full of.
  'masonmole', 'bulwark-boar', 'quillfinch', 'mistmoth', 'slingtail',
];

/**
 * Scatter `count` creatures over the spawnable ground of an area, cycling the
 * species list so a region's characteristic animals stay in proportion however
 * many the quota asks for.
 *
 * The attempt budget scales with the quota rather than being a flat number: a
 * marsh where most tiles reject a spawn used to be able to exhaust 400 tries on
 * six creatures, and asking it for fourteen would have quietly left the map
 * half empty.
 */
function scatterCreatures(
  species: readonly WildCreatureState['speciesId'][],
  count: number,
  idOffset: number,
  rng: ReturnType<typeof createRng>,
  idPrefix: string,
  landscape: LandscapeContext | undefined,
  landscapeSeed: number,
  areaKey: string,
  world: EditableWorldBalance,
): WildCreatureState[] {
  const creatures: WildCreatureState[] = [];
  if (count <= 0 || species.length === 0) return creatures;
  let attempts = 0;
  const budget = Math.max(400, count * 80);
  while (creatures.length < count && attempts < budget) {
    attempts += 1;
    const x = rng.nextInt(TILE_SIZE * 6, WORLD_PX - TILE_SIZE * 6);
    const y = rng.nextInt(TILE_SIZE * 6, WORLD_PX - TILE_SIZE * 6);
    if (isWithinTownPrecinct(x, y, areaKey)
      || isRegionalLandmarkTileClear(areaKey, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE), 5)
      || (landscape && !isTerrainSpawnable(landscapeSeed, landscape, x, y))) continue;
    const index = idOffset + creatures.length;
    const speciesId = species[creatures.length % species.length]!;
    const suffix = `wild-${speciesId}-${String(index + 1).padStart(3, '0')}`;
    creatures.push(newWildCreature(
      idPrefix ? `${idPrefix}-${suffix}` : suffix,
      speciesId,
      x,
      y,
      world,
      areaKey,
    ));
  }
  return creatures;
}

function scatterAnywhere(
  nodes: ResourceNodeState[],
  objects: Readonly<Record<ResourceNodeKind, EditableResourceBalance>>,
  rng: ReturnType<typeof createRng>,
  kind: ResourceNodeKind,
  count: number,
  idOffset: number,
): void {
  const center = WORLD_PX / 2;
  for (let i = 0; i < count; i += 1) {
    let x = 0; let y = 0;
    do {
      x = rng.nextInt(TILE_SIZE * 2, WORLD_PX - TILE_SIZE * 2);
      y = rng.nextInt(TILE_SIZE * 2, WORLD_PX - TILE_SIZE * 2);
    } while (Math.hypot(x - center, y - center) < 72);
    addNode(nodes, objects, kind, i + idOffset, x, y);
  }
}

function scatter(
  nodes: ResourceNodeState[],
  objects: Readonly<Record<ResourceNodeKind, EditableResourceBalance>>,
  rng: ReturnType<typeof createRng>,
  seed: number,
  kind: ResourceNodeKind,
  count: number,
  idOffset: number,
  center: number,
  biome: StarterBiome,
): void {
  for (let i = 0; i < count; i += 1) {
    let x = 0;
    let y = 0;
    do {
      x = rng.nextInt(TILE_SIZE * 2, WORLD_PX - TILE_SIZE * 2);
      y = rng.nextInt(TILE_SIZE * 2, WORLD_PX - TILE_SIZE * 2);
    } while (Math.hypot(x - center, y - center) < 72 || starterBiomeAt(seed, x, y) !== biome);
    addNode(nodes, objects, kind, i + idOffset, x, y);
  }
}

function addNode(
  nodes: ResourceNodeState[],
  objects: Readonly<Record<ResourceNodeKind, EditableResourceBalance>>,
  kind: ResourceNodeKind,
  index: number,
  x: number,
  y: number,
): void {
  const maxHp = objects[kind].maxHp;
  nodes.push({
    id: `${kind}-${String(index).padStart(3, '0')}`,
    kind,
    x: Math.round(x),
    y: Math.round(y),
    hp: maxHp,
    maxHp,
    respawnAtTick: null,
  });
}
