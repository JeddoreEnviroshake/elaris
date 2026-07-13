import { WORLD_PX } from '../config/platform';
import { GARDEN_BED_GROWTH_STEP_TICKS, WOODLOT_GROWTH_STEP_TICKS } from '../config/balance';
import type { AreaTier } from '../config/areaGates';
import { generateResourceNodes } from './worldGeneration';
import { generateWildCreatures } from './worldGeneration';

export type Facing = 'up' | 'down' | 'left' | 'right';
export type AttributeId = 'vitality' | 'strength' | 'endurance' | 'agility' | 'dexterity' | 'defense' | 'capacity' | 'handling';
export type PlayerAttributes = Record<AttributeId, number>;

export interface PlayerState {
  /** World position in source pixels. */
  x: number;
  y: number;
  facing: Facing;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  mana: number;
  maxMana: number;
  level: number;
  xp: number;
  attributePoints: number;
  attributes: PlayerAttributes;
}

export type ResourceId = 'wood' | 'stone' | 'fiber';
export type ResourceNodeKind = 'tree' | 'stone' | 'plant';

export interface InventoryState {
  wood: number;
  stone: number;
  fiber: number;
}

/** Lifetime gathered resources; progression remains complete after spending. */
export interface ResourceCollectionState {
  wood: number;
  stone: number;
  fiber: number;
}

/** A resource yield that could not fit in the player's inventory. */
export interface GroundDropState {
  /** Stable, persisted entity ID allocated from nextEntityId. */
  id: string;
  resource: ResourceId;
  amount: number;
  x: number;
  y: number;
}

export interface ResourceNodeState {
  /** Stable, seed-derived identifier. */
  id: string;
  kind: ResourceNodeKind;
  x: number;
  y: number;
  /** Integer hit points. Zero means depleted and persists across reloads. */
  hp: number;
  maxHp: number;
  /** Absolute fixed-step tick when a depleted node renews; null while live. */
  respawnAtTick: number | null;
}

/** Phase 1's original species. Wild entities are seed-derived until tamed. */
export type SpeciesId = 'tuftle' | 'craghopper' | 'glade-stag' | 'snarlfox';
export type CreatureRole = 'rest' | 'follow' | 'work';

export interface WildCreatureState {
  id: string;
  speciesId: SpeciesId;
  x: number;
  y: number;
  encounterCooldownUntilTick: number;
}

export interface ConsumableInventoryState { berries: number; tamingSnares: number; arrows: number }
export interface EncounterState {
  wildCreatureId: string;
  creatureHp: number;
  creatureMaxHp: number;
  round: number;
  message: string;
  /** Capture meter progress in basis points; the creature is caught at 10000. */
  captureBps: number;
}

/** Owned creatures deliberately have allocated IDs, separate from their spawn. */
export interface OwnedCreatureState {
  id: string;
  speciesId: SpeciesId;
  name: string;
  role: CreatureRole;
  /** Null means resting; an assigned Tuftle harvests that resource into a Field Cache. */
  assignment: ResourceId | null;
  /** Stable building ID while working; null for rest/follow and legacy saves. */
  worksiteId: string | null;
  /** Absolute fixed-step tick when this creature may next perform work. */
  nextWorkTick: number;
}

export type ToolDefinitionId =
  | 'wooden-axe' | 'wooden-pick' | 'wooden-sickle'
  | 'stone-axe' | 'stone-pick' | 'stone-sickle';

export interface ToolInstance {
  instanceId: string;
  definitionId: ToolDefinitionId;
  durability: number;
  maxDurability: number;
}

export type BuildingDefinitionId = 'palisade-wall' | 'field-cache' | 'workbench' | 'woodlot-planter' | 'garden-bed';

/**
 * Deterministic Garden Bed growth bookkeeping. Integer ticks only; environment
 * validity is always re-derived from wall geometry, never persisted here.
 */
export interface GardenBedState {
  /** Fixed-step ticks of valid growth accumulated toward the next batch. */
  progressTicks: number;
  /** Grown fiber waiting in the bed until the player harvests it. */
  readyFiber: number;
  /** Absolute tick when growth may next advance; prevents double-granting. */
  nextGrowthTick: number;
}

export function createGardenBedState(tick: number): GardenBedState {
  return { progressTicks: 0, readyFiber: 0, nextGrowthTick: tick + GARDEN_BED_GROWTH_STEP_TICKS };
}

export interface WoodlotPlanterState {
  progressTicks: number;
  readyWood: number;
  nextGrowthTick: number;
}

export function createWoodlotPlanterState(tick: number): WoodlotPlanterState {
  return { progressTicks: 0, readyWood: 0, nextGrowthTick: tick + WOODLOT_GROWTH_STEP_TICKS };
}

export interface BuildingState {
  /** Stable, persisted entity ID allocated from nextEntityId. */
  id: string;
  definitionId: BuildingDefinitionId;
  /** Top-left footprint position in whole world tiles. */
  tileX: number;
  tileY: number;
  /** Present only on Field Caches. Kept on the building so cache contents persist. */
  storage?: InventoryState;
  /** Present only on Garden Beds. Growth state persists on the building. */
  garden?: GardenBedState;
  /** Present only on Woodlot Planters. Sapling growth persists on the building. */
  woodlot?: WoodlotPlanterState;
}

/**
 * The single serializable authoritative game state. Resource HP, inventory,
 * tools, and cooldowns live here so gathering is deterministic and reload-safe.
 */
export interface GameState {
  seed: number;
  rngState: number;
  tick: number;
  player: PlayerState;
  inventory: InventoryState;
  consumables: ConsumableInventoryState;
  resourcesCollected: ResourceCollectionState;
  /** Number of successful repair commands, used by the tutorial milestone. */
  repairsMade: number;
  /** Durable quest history; predicates are still re-evaluated on every load. */
  completedQuestIds: string[];
  claimedQuestRewardIds: string[];
  /** Lifetime resources delivered by creature work, even after cache withdrawal. */
  workerResourcesProduced: number;
  groundDrops: GroundDropState[];
  buildings: BuildingState[];
  /** Highest valid enclosed area tier ever reached; never decreases. */
  highestAreaTierEver: AreaTier | 0;
  resourceNodes: ResourceNodeState[];
  wildCreatures: WildCreatureState[];
  activeEncounter: EncounterState | null;
  ownedCreatures: OwnedCreatureState[];
  tools: ToolInstance[];
  equippedToolId: string | null;
  nextEntityId: number;
  actionCooldownUntilTick: number;
}

export function createInitialState(seed: number): GameState {
  return {
    seed,
    rngState: seed >>> 0,
    tick: 0,
    player: {
      x: WORLD_PX / 2,
      y: WORLD_PX / 2,
      facing: 'down',
      hp: 100,
      maxHp: 100,
      stamina: 100,
      maxStamina: 100,
      mana: 30,
      maxMana: 30,
      level: 1,
      xp: 0,
      attributePoints: 0,
      attributes: {
        vitality: 0,
        strength: 0,
        endurance: 0,
        agility: 0,
        dexterity: 0,
        defense: 0,
        capacity: 0,
        handling: 0,
      },
    },
    inventory: { wood: 0, stone: 0, fiber: 0 },
    consumables: { berries: 2, tamingSnares: 0, arrows: 5 },
    resourcesCollected: { wood: 0, stone: 0, fiber: 0 },
    repairsMade: 0,
    completedQuestIds: [],
    claimedQuestRewardIds: [],
    workerResourcesProduced: 0,
    groundDrops: [],
    buildings: [],
    highestAreaTierEver: 0,
    resourceNodes: generateResourceNodes(seed),
    wildCreatures: generateWildCreatures(seed),
    activeEncounter: null,
    ownedCreatures: [],
    tools: [],
    equippedToolId: null,
    nextEntityId: 1,
    actionCooldownUntilTick: 0,
  };
}
