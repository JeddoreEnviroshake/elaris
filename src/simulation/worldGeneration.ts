import { RESOURCE_BALANCE } from '../config/balance';
import { TILE_SIZE, WORLD_PX } from '../config/platform';
import { createRng } from './rng';
import type { ResourceNodeKind, ResourceNodeState, WildCreatureState } from './state';
import { starterBiomeAt, type StarterBiome } from './biomes';

/**
 * Generate stable resource nodes from the world seed. The starter fixtures
 * guarantee immediately reachable tree, plant, and stone progression goals.
 */
export function generateResourceNodes(seed: number): ResourceNodeState[] {
  const center = WORLD_PX / 2;
  const nodes: ResourceNodeState[] = [];

  addNode(nodes, 'tree', 0, center + 30, center);
  addNode(nodes, 'tree', 1, center - 36, center + 18);
  addNode(nodes, 'tree', 2, center + 12, center - 42);
  addNode(nodes, 'plant', 0, center - 42, center);
  addNode(nodes, 'plant', 1, center + 42, center);
  addNode(nodes, 'stone', 0, center + 86, center + 12);
  addNode(nodes, 'stone', 1, center - 78, center - 24);

  const rng = createRng(seed ^ 0x9e37_79b9);
  // Forests are wood-rich and dense with undergrowth; the open grassland keeps
  // more stone and plants visible so each biome has a readable gathering role.
  scatter(nodes, rng, seed, 'tree', 58, 3, center, 'forest');
  scatter(nodes, rng, seed, 'tree', 19, 61, center, 'grassland');
  scatter(nodes, rng, seed, 'stone', 15, 2, center, 'forest');
  scatter(nodes, rng, seed, 'stone', 28, 17, center, 'grassland');
  scatter(nodes, rng, seed, 'plant', 30, 2, center, 'forest');
  scatter(nodes, rng, seed, 'plant', 28, 32, center, 'grassland');
  return nodes;
}

/** One seed-stable habitat preview for each original species. */
export function generateWildCreatures(seed: number): WildCreatureState[] {
  const center = WORLD_PX / 2;
  const rng = createRng(seed ^ 0x51f1_7e);
  const spawn = (
    id: string,
    speciesId: WildCreatureState['speciesId'],
    x: number,
    y: number,
  ): WildCreatureState => ({
    id,
    speciesId,
    x: x + rng.nextInt(-10, 10),
    y: y + rng.nextInt(-10, 10),
    encounterCooldownUntilTick: 0,
  });
  return [
    spawn('wild-tuftle-001', 'tuftle', center + 104, center - 80),
    spawn('wild-craghopper-001', 'craghopper', center - 190, center + 138),
    spawn('wild-glade-stag-001', 'glade-stag', center + 235, center + 205),
    spawn('wild-snarlfox-001', 'snarlfox', center - 260, center - 220),
  ];
}

function scatter(
  nodes: ResourceNodeState[],
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
    addNode(nodes, kind, i + idOffset, x, y);
  }
}

function addNode(
  nodes: ResourceNodeState[],
  kind: ResourceNodeKind,
  index: number,
  x: number,
  y: number,
): void {
  const maxHp = RESOURCE_BALANCE[kind].maxHp;
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
