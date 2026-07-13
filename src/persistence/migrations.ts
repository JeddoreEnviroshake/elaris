import { createInitialState, createWoodlotPlanterState, type Facing } from '../simulation/state';
import { AREA_TIERS } from '../config/areaGates';
import { QUEST_IDS } from '../content/quests';
import { MAX_ACTIVE_FOLLOWERS, MAX_CREATURE_ROSTER, creatureDefinition, isSpeciesId } from '../content/creatures';
import type { PortableSave } from './types';
import { SAVE_VERSION } from './types';
import { RESOURCE_BALANCE } from '../config/balance';
import { generateWildCreatures } from '../simulation/worldGeneration';

/**
 * Save migrations. Each entry upgrades a save from version N to N+1. The chain
 * runs until the save reaches SAVE_VERSION. A save newer than SAVE_VERSION, or
 * one missing a migration step, is rejected rather than silently loaded.
 *
 * v0 → v1: `state.rngState` was introduced in v1; seed it from the world seed.
 * v1 → v2: deterministic resource nodes, inventory, tools, and action state.
 */
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Readonly<Record<number, Migration>> = {
  0: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 1 },
      state: { ...state, rngState: typeof state['seed'] === 'number' ? state['seed'] : 0 },
    };
  },
  1: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const seed = state['seed'];
    if (typeof seed !== 'number') {
      return { ...raw, meta: { ...meta, saveVersion: 2 } };
    }
    const initial = createInitialState(seed);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 2, worldGenVersion: 2, contentVersion: 2 },
      state: { ...initial, ...state },
    };
  },
  2: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 3, contentVersion: 3 },
      state: { ...state, groundDrops: Array.isArray(state['groundDrops']) ? state['groundDrops'] : [] },
    };
  },
  3: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 4, contentVersion: 4 },
      state: {
        ...state,
        highestAreaTierEver: typeof state['highestAreaTierEver'] === 'number' ? state['highestAreaTierEver'] : 0,
      },
    };
  },
  4: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 5 },
      state: { ...state, buildings: Array.isArray(state['buildings']) ? state['buildings'] : [] },
    };
  },
  5: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const seed = state['seed'];
    const initial = typeof seed === 'number' ? createInitialState(seed) : null;
    const existingNodes = Array.isArray(state['resourceNodes']) ? state['resourceNodes'] : [];
    const existingIds = new Set(existingNodes.map((node) => isRecord(node) ? node['id'] : undefined));
    const plants = initial?.resourceNodes.filter((node) => node.kind === 'plant' && !existingIds.has(node.id)) ?? [];
    const inventory = asRecord(state['inventory']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 6, worldGenVersion: 3, contentVersion: 5 },
      state: {
        ...state,
        inventory: { ...inventory, fiber: typeof inventory['fiber'] === 'number' ? inventory['fiber'] : 0 },
        resourceNodes: [...existingNodes, ...plants],
      },
    };
  },
  6: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const inventory = asRecord(state['inventory']);
    const collected = asRecord(state['resourcesCollected']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 7, contentVersion: 6 },
      state: {
        ...state,
        resourcesCollected: {
          wood: nonNegativeIntegerOr(collected['wood'], inventory['wood']),
          stone: nonNegativeIntegerOr(collected['stone'], inventory['stone']),
          fiber: nonNegativeIntegerOr(collected['fiber'], inventory['fiber']),
        },
        repairsMade: nonNegativeIntegerOr(state['repairsMade'], 0),
      },
    };
  },
  7: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const seed = state['seed'];
    const initial = typeof seed === 'number' ? createInitialState(seed) : null;
    return {
      ...raw,
      meta: { ...meta, saveVersion: 8, worldGenVersion: 4, contentVersion: 7 },
      state: {
        ...state,
        wildCreatures: Array.isArray(state['wildCreatures']) ? state['wildCreatures'] : (initial?.wildCreatures ?? []),
        ownedCreatures: Array.isArray(state['ownedCreatures']) ? state['ownedCreatures'] : [],
      },
    };
  },
  8: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const creatures = Array.isArray(state['ownedCreatures']) ? state['ownedCreatures'] : [];
    const buildings = Array.isArray(state['buildings']) ? state['buildings'] : [];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 9, contentVersion: 8 },
      state: {
        ...state,
        ownedCreatures: creatures.map((creature) => ({
          ...asRecord(creature), assignment: null, nextWorkTick: 0,
        })),
        buildings: buildings.map((building) => {
          const item = asRecord(building);
          return item['definitionId'] === 'field-cache'
            ? { ...item, storage: { wood: 0, stone: 0, fiber: 0 } }
            : item;
        }),
      },
    };
  },
  9: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const creatures = Array.isArray(state['ownedCreatures']) ? state['ownedCreatures'] : [];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 10, contentVersion: 9 },
      state: {
        ...state,
        ownedCreatures: creatures.map((rawCreature) => {
          const creature = asRecord(rawCreature);
          return { ...creature, role: 'rest', assignment: null, worksiteId: null };
        }),
      },
    };
  },
  10: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 11, contentVersion: 10 },
      state: {
        ...state,
        completedQuestIds: stringArrayOrEmpty(state['completedQuestIds']),
        claimedQuestRewardIds: stringArrayOrEmpty(state['claimedQuestRewardIds']),
        workerResourcesProduced: nonNegativeIntegerOr(state['workerResourcesProduced'], 0),
      },
    };
  },
  11: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const nodes = Array.isArray(state['resourceNodes']) ? state['resourceNodes'] : [];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 12, worldGenVersion: 5, contentVersion: 11 },
      state: {
        ...state,
        resourceNodes: nodes.map((rawNode) => {
          const node = asRecord(rawNode);
          const kind = node['kind'];
          const tick = nonNegativeIntegerOr(state['tick'], 0);
          const respawnTicks = kind === 'tree' || kind === 'stone' || kind === 'plant'
            ? RESOURCE_BALANCE[kind].respawnTicks
            : 0;
          return {
            ...node,
            respawnAtTick: node['hp'] === 0 ? tick + respawnTicks : null,
          };
        }),
      },
    };
  },
  12: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']); const player = asRecord(state['player']);
    const wild = Array.isArray(state['wildCreatures']) ? state['wildCreatures'] : [];
    return { ...raw, meta: { ...meta, saveVersion: 13, contentVersion: 12 }, state: {
      ...state,
      player: { ...player, hp: nonNegativeIntegerOr(player['hp'], 100), maxHp: nonNegativeIntegerOr(player['maxHp'], 100) },
      consumables: { berries: 2, tamingSnares: 0 },
      activeEncounter: null,
      wildCreatures: wild.map((item) => ({ ...asRecord(item), encounterCooldownUntilTick: 0 })),
    } };
  },
  13: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']); const player = asRecord(state['player']);
    return { ...raw, meta: { ...meta, saveVersion: 14, contentVersion: 13 }, state: {
      ...state,
      player: {
        ...player,
        stamina: 100,
        maxStamina: 100,
        level: 1,
        xp: 0,
        attributePoints: 0,
        attributes: { vitality: 0, strength: 0, endurance: 0, agility: 0, dexterity: 0, defense: 0, capacity: 0, handling: 0 },
      },
    } };
  },
  // v14 → v15: battle-screen encounters — mana pool, craftable arrows, and the
  // capture meter. Any in-flight encounter is safely reset to null.
  14: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']); const player = asRecord(state['player']);
    const consumables = asRecord(state['consumables']);
    return { ...raw, meta: { ...meta, saveVersion: 15, contentVersion: 14 }, state: {
      ...state,
      player: { ...player, mana: 30, maxMana: 30 },
      consumables: { ...consumables, arrows: nonNegativeIntegerOr(consumables['arrows'], 5) },
      activeEncounter: null,
    } };
  },
  // v15 → v16: register the remaining original species in existing worlds.
  // A species already present in the wild or roster is never duplicated.
  15: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const wild = Array.isArray(state['wildCreatures']) ? state['wildCreatures'] : [];
    const owned = Array.isArray(state['ownedCreatures']) ? state['ownedCreatures'] : [];
    const representedSpecies = new Set<string>();
    for (const creature of [...wild, ...owned]) {
      const speciesId = asRecord(creature)['speciesId'];
      if (typeof speciesId === 'string') representedSpecies.add(speciesId);
    }
    const seed = typeof state['seed'] === 'number' ? state['seed'] : 0;
    const missing = generateWildCreatures(seed).filter((creature) => !representedSpecies.has(creature.speciesId));
    return { ...raw, meta: { ...meta, saveVersion: 16, worldGenVersion: 6, contentVersion: 15 }, state: {
      ...state,
      wildCreatures: [...wild, ...missing],
    } };
  },
  // v16 → v17: persist deterministic Woodlot Planter growth/output state.
  16: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const buildings = Array.isArray(state['buildings']) ? state['buildings'] : [];
    const tick = nonNegativeIntegerOr(state['tick'], 0);
    return { ...raw, meta: { ...meta, saveVersion: 17, contentVersion: 16 }, state: {
      ...state,
      buildings: buildings.map((rawBuilding) => {
        const building = asRecord(rawBuilding);
        return building['definitionId'] === 'woodlot-planter' && building['woodlot'] === undefined
          ? { ...building, woodlot: createWoodlotPlanterState(tick) }
          : building;
      }),
    } };
  },
};

export interface MigrationResult {
  save: PortableSave;
  migrated: boolean;
}

export function migrateToCurrent(raw: unknown): MigrationResult {
  if (!isRecord(raw)) throw new SaveValidationError('save is not an object');
  const meta = asRecord(raw['meta']);
  let version = typeof meta['saveVersion'] === 'number' ? meta['saveVersion'] : 0;

  if (version > SAVE_VERSION) {
    throw new SaveValidationError(`save version ${version} is newer than supported ${SAVE_VERSION}`);
  }

  let current: Record<string, unknown> = raw;
  let migrated = false;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new SaveValidationError(`no migration from save version ${version}`);
    current = step(current);
    version += 1;
    migrated = true;
  }

  return { save: assertValidPortableSave(current), migrated };
}

const FACINGS: ReadonlySet<string> = new Set<Facing>(['up', 'down', 'left', 'right']);
const AREA_TIER_VALUES = new Set<number>([0, ...AREA_TIERS.map((tier) => tier.area)]);
const TOOL_DEFINITION_IDS = new Set([
  'wooden-axe', 'wooden-pick', 'wooden-sickle',
  'stone-axe', 'stone-pick', 'stone-sickle',
]);

/** Structural validation — the gate that keeps corrupt/foreign data out. */
export function assertValidPortableSave(raw: unknown): PortableSave {
  if (!isRecord(raw)) throw new SaveValidationError('save is not an object');
  const meta = raw['meta'];
  const state = raw['state'];
  if (!isRecord(meta)) throw new SaveValidationError('missing meta');
  if (!isRecord(state)) throw new SaveValidationError('missing state');

  requireNumber(meta, 'saveVersion');
  requireNumber(meta, 'savedAt');
  requireNumber(state, 'seed');
  requireNumber(state, 'rngState');
  requireNumber(state, 'tick');

  const player = state['player'];
  if (!isRecord(player)) throw new SaveValidationError('missing player');
  requireNumber(player, 'x');
  requireNumber(player, 'y');
  if (typeof player['facing'] !== 'string' || !FACINGS.has(player['facing'])) {
    throw new SaveValidationError('invalid player.facing');
  }
  requirePositiveInteger(player, 'maxHp'); requireNonNegativeInteger(player, 'hp');
  if ((player['hp'] as number) > (player['maxHp'] as number)) throw new SaveValidationError('player hp exceeds maxHp');
  requirePositiveInteger(player, 'maxStamina'); requireNonNegativeInteger(player, 'stamina');
  if ((player['stamina'] as number) > (player['maxStamina'] as number)) throw new SaveValidationError('player stamina exceeds maxStamina');
  requirePositiveInteger(player, 'maxMana'); requireNonNegativeInteger(player, 'mana');
  if ((player['mana'] as number) > (player['maxMana'] as number)) throw new SaveValidationError('player mana exceeds maxMana');
  requirePositiveInteger(player, 'level'); requireNonNegativeInteger(player, 'xp'); requireNonNegativeInteger(player, 'attributePoints');
  const attributes = player['attributes'];
  if (!isRecord(attributes)) throw new SaveValidationError('missing player attributes');
  for (const attribute of ['vitality', 'strength', 'endurance', 'agility', 'dexterity', 'defense', 'capacity', 'handling']) {
    requireNonNegativeInteger(attributes, attribute);
  }

  const inventory = state['inventory'];
  if (!isRecord(inventory)) throw new SaveValidationError('missing inventory');
  requireNonNegativeInteger(inventory, 'wood');
  requireNonNegativeInteger(inventory, 'stone');
  requireNonNegativeInteger(inventory, 'fiber');
  const consumables = state['consumables'];
  if (!isRecord(consumables)) throw new SaveValidationError('missing consumables');
  requireNonNegativeInteger(consumables, 'berries'); requireNonNegativeInteger(consumables, 'tamingSnares'); requireNonNegativeInteger(consumables, 'arrows');

  const resourcesCollected = state['resourcesCollected'];
  if (!isRecord(resourcesCollected)) throw new SaveValidationError('missing resourcesCollected');
  requireNonNegativeInteger(resourcesCollected, 'wood');
  requireNonNegativeInteger(resourcesCollected, 'stone');
  requireNonNegativeInteger(resourcesCollected, 'fiber');
  requireNonNegativeInteger(state, 'repairsMade');
  validateQuestIds(state, 'completedQuestIds');
  validateQuestIds(state, 'claimedQuestRewardIds');
  requireNonNegativeInteger(state, 'workerResourcesProduced');

  const groundDrops = state['groundDrops'];
  if (!Array.isArray(groundDrops)) throw new SaveValidationError('missing groundDrops');
  const entityIds = new Set<string>();
  for (const drop of groundDrops) {
    if (!isRecord(drop) || typeof drop['id'] !== 'string' || !entityIds.add(drop['id'])) {
      throw new SaveValidationError('invalid ground drop id');
    }
    if (drop['resource'] !== 'wood' && drop['resource'] !== 'stone' && drop['resource'] !== 'fiber') {
      throw new SaveValidationError('invalid ground drop resource');
    }
    requirePositiveInteger(drop, 'amount');
    requireNumber(drop, 'x');
    requireNumber(drop, 'y');
  }

  const buildings = state['buildings'];
  if (!Array.isArray(buildings)) throw new SaveValidationError('missing buildings');
  const buildingDefinitionIds = new Set(['palisade-wall', 'field-cache', 'workbench', 'woodlot-planter', 'garden-bed']);
  for (const building of buildings) {
    if (!isRecord(building) || typeof building['id'] !== 'string' || !entityIds.add(building['id'])) {
      throw new SaveValidationError('invalid building id');
    }
    if (typeof building['definitionId'] !== 'string' || !buildingDefinitionIds.has(building['definitionId'])) {
      throw new SaveValidationError('invalid building definition');
    }
    requireNonNegativeInteger(building, 'tileX');
    requireNonNegativeInteger(building, 'tileY');
    if (building['storage'] !== undefined) {
      const storage = building['storage'];
      if (!isRecord(storage)) throw new SaveValidationError('invalid building storage');
      requireNonNegativeInteger(storage, 'wood');
      requireNonNegativeInteger(storage, 'stone');
      requireNonNegativeInteger(storage, 'fiber');
    }
    if (building['garden'] !== undefined) {
      const garden = building['garden'];
      if (!isRecord(garden) || building['definitionId'] !== 'garden-bed') {
        throw new SaveValidationError('invalid building garden state');
      }
      requireNonNegativeInteger(garden, 'progressTicks');
      requireNonNegativeInteger(garden, 'readyFiber');
      requireNonNegativeInteger(garden, 'nextGrowthTick');
    }
    if (building['woodlot'] !== undefined) {
      const woodlot = building['woodlot'];
      if (!isRecord(woodlot) || building['definitionId'] !== 'woodlot-planter') {
        throw new SaveValidationError('invalid building woodlot state');
      }
      requireNonNegativeInteger(woodlot, 'progressTicks');
      requireNonNegativeInteger(woodlot, 'readyWood');
      requireNonNegativeInteger(woodlot, 'nextGrowthTick');
    }
  }

  requireNonNegativeInteger(state, 'highestAreaTierEver');
  if (!AREA_TIER_VALUES.has(state['highestAreaTierEver'] as number)) {
    throw new SaveValidationError('invalid highestAreaTierEver');
  }

  const nodes = state['resourceNodes'];
  if (!Array.isArray(nodes)) throw new SaveValidationError('missing resourceNodes');
  for (const node of nodes) {
    if (!isRecord(node)) throw new SaveValidationError('invalid resource node');
    if (typeof node['id'] !== 'string') throw new SaveValidationError('invalid resource node id');
    if (node['kind'] !== 'tree' && node['kind'] !== 'stone' && node['kind'] !== 'plant') {
      throw new SaveValidationError('invalid resource node kind');
    }
    requireNumber(node, 'x');
    requireNumber(node, 'y');
    requireNonNegativeInteger(node, 'hp');
    requireNonNegativeInteger(node, 'maxHp');
    if (node['respawnAtTick'] !== null) requireNonNegativeInteger(node, 'respawnAtTick');
    if ((node['hp'] as number) > (node['maxHp'] as number)) {
      throw new SaveValidationError('resource hp exceeds maxHp');
    }
  }

  const wildCreatures = state['wildCreatures'];
  if (!Array.isArray(wildCreatures)) throw new SaveValidationError('missing wildCreatures');
  for (const creature of wildCreatures) {
    if (!isRecord(creature) || typeof creature['id'] !== 'string' || !entityIds.add(creature['id']) || !isSpeciesId(creature['speciesId'])) {
      throw new SaveValidationError('invalid wild creature');
    }
    requireNumber(creature, 'x'); requireNumber(creature, 'y');
    requireNonNegativeInteger(creature, 'encounterCooldownUntilTick');
  }
  const encounter = state['activeEncounter'];
  if (encounter !== null) {
    if (!isRecord(encounter) || typeof encounter['wildCreatureId'] !== 'string' || typeof encounter['message'] !== 'string') throw new SaveValidationError('invalid active encounter');
    requireNonNegativeInteger(encounter, 'creatureHp'); requirePositiveInteger(encounter, 'creatureMaxHp'); requirePositiveInteger(encounter, 'round');
    if ((encounter['creatureHp'] as number) > (encounter['creatureMaxHp'] as number)) throw new SaveValidationError('encounter hp exceeds maxHp');
    requireNonNegativeInteger(encounter, 'captureBps');
    if ((encounter['captureBps'] as number) > 10000) throw new SaveValidationError('encounter captureBps exceeds 10000');
    if (!wildCreatures.some((item) => isRecord(item) && item['id'] === encounter['wildCreatureId'])) throw new SaveValidationError('encounter creature does not exist');
  }
  const ownedCreatures = state['ownedCreatures'];
  if (!Array.isArray(ownedCreatures)) throw new SaveValidationError('missing ownedCreatures');
  if (ownedCreatures.length > MAX_CREATURE_ROSTER) throw new SaveValidationError('creature roster exceeds capacity');
  let activeFollowers = 0;
  for (const creature of ownedCreatures) {
    if (!isRecord(creature) || typeof creature['id'] !== 'string' || !entityIds.add(creature['id']) || !isSpeciesId(creature['speciesId']) || typeof creature['name'] !== 'string') {
      throw new SaveValidationError('invalid owned creature');
    }
    if (creature['assignment'] !== null && creature['assignment'] !== 'wood' && creature['assignment'] !== 'stone' && creature['assignment'] !== 'fiber') {
      throw new SaveValidationError('invalid owned creature assignment');
    }
    requireNonNegativeInteger(creature, 'nextWorkTick');
    if (creature['role'] !== 'rest' && creature['role'] !== 'follow' && creature['role'] !== 'work') {
      throw new SaveValidationError('invalid owned creature role');
    }
    if (creature['role'] === 'follow') activeFollowers += 1;
    if (creature['worksiteId'] !== null && typeof creature['worksiteId'] !== 'string') {
      throw new SaveValidationError('invalid creature worksite');
    }
    // Legacy v9 work assignments migrate safely to rest until the player picks
    // a real persisted worksite; never guess an ID or delete the creature.
    if (creature['role'] === 'work' && typeof creature['worksiteId'] !== 'string') {
      throw new SaveValidationError('working creature missing worksite');
    }
    if (creature['role'] === 'work' && isSpeciesId(creature['speciesId']) && !creatureDefinition(creature['speciesId']).work) {
      throw new SaveValidationError('creature species has no unlocked work role');
    }
  }
  if (activeFollowers > MAX_ACTIVE_FOLLOWERS) throw new SaveValidationError('too many active creature followers');

  const tools = state['tools'];
  if (!Array.isArray(tools)) throw new SaveValidationError('missing tools');
  for (const tool of tools) {
    if (!isRecord(tool)) throw new SaveValidationError('invalid tool');
    if (
      typeof tool['instanceId'] !== 'string' ||
      !entityIds.add(tool['instanceId']) ||
      typeof tool['definitionId'] !== 'string' || !TOOL_DEFINITION_IDS.has(tool['definitionId'])
    ) {
      throw new SaveValidationError('invalid tool identity');
    }
    requireNonNegativeInteger(tool, 'durability');
    requireNonNegativeInteger(tool, 'maxDurability');
    if ((tool['durability'] as number) > (tool['maxDurability'] as number)) {
      throw new SaveValidationError('tool durability exceeds maxDurability');
    }
  }

  if (state['equippedToolId'] !== null && typeof state['equippedToolId'] !== 'string') {
    throw new SaveValidationError('invalid equippedToolId');
  }
  if (typeof state['equippedToolId'] === 'string' && !tools.some((tool) => isRecord(tool) && tool['instanceId'] === state['equippedToolId'])) {
    throw new SaveValidationError('equipped tool does not exist');
  }
  requireNonNegativeInteger(state, 'nextEntityId');
  requireNonNegativeInteger(state, 'actionCooldownUntilTick');

  return raw as unknown as PortableSave;
}

export class SaveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function requireNumber(obj: Record<string, unknown>, key: string): void {
  const v = obj[key];
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new SaveValidationError(`expected numeric ${key}`);
  }
}

function requireNonNegativeInteger(obj: Record<string, unknown>, key: string): void {
  requireNumber(obj, key);
  const value = obj[key] as number;
  if (!Number.isInteger(value) || value < 0) {
    throw new SaveValidationError(`expected non-negative integer ${key}`);
  }
}

function requirePositiveInteger(obj: Record<string, unknown>, key: string): void {
  requireNonNegativeInteger(obj, key);
  if ((obj[key] as number) === 0) {
    throw new SaveValidationError(`expected positive integer ${key}`);
  }
}

function nonNegativeIntegerOr(value: unknown, fallback: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof fallback === 'number' && Number.isInteger(fallback) && fallback >= 0) return fallback;
  return 0;
}

function stringArrayOrEmpty(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && QUEST_IDS.has(item)) : [];
}

function validateQuestIds(state: Record<string, unknown>, key: string): void {
  const value = state[key];
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !QUEST_IDS.has(id)) || new Set(value).size !== value.length) {
    throw new SaveValidationError(`invalid ${key}`);
  }
}
