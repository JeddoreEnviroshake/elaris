import { createArcaneStormState, createCartDockState, createInitialState, createLogisticsHubState, createNpcMemoryState, createQuestProgressState, createRegionalProgressState, createWorkerHousingState, createWorkerProducerState, createWoodlotPlanterState, type Facing } from '../simulation/state';
import { AREA_TIERS } from '../config/areaGates';
import { BUILDING_DEFINITION_IDS, buildableById } from '../content/buildingParts';
import { QUEST_IDS } from '../content/quests';
import { authoredWorldAreaAt } from '../content/world';
import { REGIONAL_IDENTITIES } from '../content/regions';
import { CREATURE_DEFINITIONS, MAX_ACTIVE_FOLLOWERS, MAX_CREATURE_ROSTER, creatureDefinition, isSpeciesId } from '../content/creatures';
import { RAIDER_KIND_IDS, isRaiderKindId, raiderDefinition } from '../content/raiders';
import { companionAbility, isCompanionAbilityId, signatureCompanionAbility } from '../content/companionAbilities';
import type { PortableSave } from './types';
import { SAVE_VERSION } from './types';
import {
  createDefaultGameBalance, DANGER_PHASE_SECONDS, RESOURCE_BALANCE, RESOURCE_NODE_KINDS, RESOURCE_STACK_SIZE,
  STORAGE_BOX_SLOTS, WAREHOUSE_SLOTS, STRIKE_TARGETS, STRUCTURE_FACILITY_IDS, WALL_MATERIAL_IDS,
} from '../config/balance';
import { DANGER_THREAT_IDS } from '../content/dangerThreats';
import {
  PLAYER_SPEED_PX_PER_S, SPRINT_SPEED_TENTHS, SPRINT_STAMINA_PER_SECOND, TILE_SIZE, WORLD_TILES,
} from '../config/platform';
import { ELARIS_CAMERA_DEFAULT_TENTHS } from '../three/cameraControls';
import { generateAreaContainers, generateAreaResourceNodes, generateWildCreatures } from '../simulation/worldGeneration';
import { townBuildingsInArea } from '../content/townBuildings';
import { isWithinTownSafeZoneWorldPosition } from '../content/townDefences';
import { isExpeditionRouteId } from '../content/expeditions';
import { createOpeningChapter, createOpeningThreat, createOpeningProduction, createOpeningSupplyRun, createOpeningGarden, OPENING_NEXT_GOALS, OPENING_CHAPTER_VERSION, OPENING_MILESTONES, starterTuftleId } from '../content/onboarding';
import { TAMING_MOODS } from '../simulation/taming';
import { ATTRIBUTE_GAIN_FIELDS, ATTRIBUTE_IDS } from '../simulation/characterProgression';
import { CONSUMABLE_BLUEPRINT_IDS, isBlueprintItemId } from '../simulation/blueprintKnowledge';
import { blueprintsGrantedUpToLevel } from '../content/blueprintGates';
import { predicateSatisfied } from '../simulation/unlocks';
import type { AreaThemeId, GameState } from '../simulation/state';
import { isNpcId } from '../content/npcs';

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
  // v17 → v18: persistent coin economy, tame discoveries, and tool ranks.
  17: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const tools = Array.isArray(state['tools']) ? state['tools'] : [];
    const owned = Array.isArray(state['ownedCreatures']) ? state['ownedCreatures'] : [];
    const firstTamedSpeciesIds = [...new Set(owned
      .map((item) => asRecord(item)['speciesId'])
      .filter((id): id is string => typeof id === 'string' && isSpeciesId(id)))];
    return { ...raw, meta: { ...meta, saveVersion: 18, contentVersion: 17 }, state: {
      ...state,
      coins: nonNegativeIntegerOr(state['coins'], 0),
      resourcesSold: nonNegativeIntegerOr(state['resourcesSold'], 0),
      firstTamedSpeciesIds,
      tools: tools.map((rawTool) => ({
        ...asRecord(rawTool), powerRank: 0, speedRank: 0, durabilityRank: 0,
      })),
    } };
  },
  // v18 → v19: name the starter region Elaris and add persistent neighboring areas.
  18: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const seed = typeof state['seed'] === 'number' ? state['seed'] : 0;
    return { ...raw, meta: { ...meta, saveVersion: 19, worldGenVersion: 7, contentVersion: 18 }, state: {
      ...state,
      currentArea: { key: '0,0', x: 0, y: 0, name: 'Elaris', theme: 'elaris', seed },
      visitedAreas: {},
    } };
  },
  // v19 → v20: marker-anchored environments, material building parts, and
  // Homestead Rating. Legacy palisade walls become wood walls in place; any
  // capture-meter encounter is safely reset before the snare-chance model.
  19: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const buildings = Array.isArray(state['buildings']) ? state['buildings'] : [];
    return { ...raw, meta: { ...meta, saveVersion: 20, contentVersion: 19 }, state: {
      ...state,
      buildings: buildings.map((rawBuilding) => {
        const building = asRecord(rawBuilding);
        return building['definitionId'] === 'palisade-wall'
          ? { ...building, definitionId: 'wood-wall' }
          : building;
      }),
      highestRatingEverTenths: nonNegativeIntegerOr(state['highestRatingEverTenths'], 0),
      activeEncounter: null,
    } };
  },
  // v20 -> v21: boundaries moved from occupied cells to canonical shared
  // edges, and Environment Markers persist their declared region kind.
  20: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const buildings = Array.isArray(state['buildings']) ? state['buildings'].map(asRecord) : [];
    const surfaceAt = new Set(buildings
      .filter((building) => building['definitionId'] === 'thatch-floor' || building['definitionId'] === 'wood-floor')
      .map((building) => `${building['tileX']},${building['tileY']}`));
    return { ...raw, meta: { ...meta, saveVersion: 21, contentVersion: 20 }, state: {
      ...state,
      buildings: buildings.map((building) => {
        const id = building['definitionId'];
        if (typeof id !== 'string' || !BUILDING_DEFINITION_IDS.has(id)) return building;
        const definition = buildableById(id as Parameters<typeof buildableById>[0]);
        if (definition.layer === 'boundary') return { ...building, boundaryEdge: building['boundaryEdge'] ?? 'north' };
        if (definition.footprintKind === 'marker') {
          const key = `${building['tileX']},${building['tileY']}`;
          return { ...building, environmentKind: building['environmentKind'] ?? (surfaceAt.has(key) ? 'indoor' : 'workYard') };
        }
        return building;
      }),
    } };
  },
  // v21 -> v22: replace discovery/enclosure recipe gates with permanent,
  // level-funded unlock ownership and persist two-orientation buildings.
  21: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const buildings = Array.isArray(state['buildings']) ? state['buildings'].map(asRecord) : [];
    const visitedAreas = asRecord(state['visitedAreas']);
    const allBuildings = [
      ...buildings,
      ...Object.values(visitedAreas).flatMap((rawArea) => {
        const area = asRecord(rawArea);
        return Array.isArray(area['buildings']) ? area['buildings'].map(asRecord) : [];
      }),
    ];
    const inventory = asRecord(state['inventory']);
    const collected = asRecord(state['resourcesCollected']);
    const discovered = (resource: 'wood' | 'stone' | 'fiber') =>
      nonNegativeIntegerOr(collected[resource], inventory[resource]) > 0 || nonNegativeIntegerOr(inventory[resource], 0) > 0;
    const unlocked = new Set<string>();
    const unlockMaterial = (material: 'thatch' | 'wood') => {
      for (const definitionId of BUILDING_DEFINITION_IDS) {
        const definition = buildableById(definitionId as Parameters<typeof buildableById>[0]);
        if (definition.material === material && isBlueprintItemId(definitionId)) unlocked.add(definitionId);
      }
    };
    if (discovered('fiber')) unlockMaterial('thatch');
    if (discovered('wood')) {
      unlockMaterial('wood');
      unlocked.add('wooden-axe'); unlocked.add('wooden-pick'); unlocked.add('wooden-sickle');
    }
    const highestAreaTierEver = nonNegativeIntegerOr(state['highestAreaTierEver'], 0);
    if (highestAreaTierEver >= 4) unlocked.add('field-cache');
    if (highestAreaTierEver >= 8) {
      unlocked.add('workbench'); unlocked.add('garden-bed');
    }
    if (highestAreaTierEver >= 16) unlocked.add('woodlot-planter');
    const typedState = state as unknown as GameState;
    if (discovered('stone') && predicateSatisfied(typedState, { kind: 'workstationAvailable', workstationId: 'workbench' })) {
      unlocked.add('stone-axe'); unlocked.add('stone-pick'); unlocked.add('stone-sickle');
    }
    for (const building of allBuildings) {
      const id = building['definitionId'];
      if (typeof id === 'string' && isBlueprintItemId(id)) unlocked.add(id);
    }
    const tools = Array.isArray(state['tools']) ? state['tools'].map(asRecord) : [];
    for (const tool of tools) {
      const id = tool['definitionId'];
      if (typeof id === 'string' && isBlueprintItemId(id)) unlocked.add(id);
    }
    const migrateBuildings = (items: Record<string, unknown>[]) => items.map((building) => ({
      ...building,
      rotated: building['rotated'] === true,
    }));
    const migratedAreas = Object.fromEntries(Object.entries(visitedAreas).map(([key, rawArea]) => {
      const area = asRecord(rawArea);
      const areaBuildings = Array.isArray(area['buildings']) ? area['buildings'].map(asRecord) : [];
      return [key, { ...area, buildings: migrateBuildings(areaBuildings) }];
    }));
    return { ...raw, meta: { ...meta, saveVersion: 22 }, state: {
      ...state,
      unlockPoints: 0,
      unlockedItemIds: [...unlocked].sort(),
      buildings: migrateBuildings(buildings),
      visitedAreas: migratedAreas,
    } };
  },
  // v22 -> v23: iron resources, deterministic-yield carry, mountain veins,
  // Furnace queue state, and the tier-2 Iron tool definition IDs.
  22: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const inventory = asRecord(state['inventory']);
    const collected = asRecord(state['resourcesCollected']);
    const remainder = asRecord(state['yieldRemainderByResource']);
    const withMountainMetal = (area: Record<string, unknown>, nodes: unknown[]) => {
      if (area['theme'] !== 'mountain' || typeof area['seed'] !== 'number') return nodes;
      const existingIds = new Set(nodes.map((node) => asRecord(node)['id']));
      const generated = generateAreaResourceNodes(area['seed'], {
        tree: 18, stone: 92, metal: 24, plant: 25, 'berry-bush': 6,
      }).filter((node) => node.kind === 'metal' && !existingIds.has(node.id));
      return [...nodes, ...generated];
    };
    const currentArea = asRecord(state['currentArea']);
    const currentNodes = Array.isArray(state['resourceNodes']) ? state['resourceNodes'] : [];
    const withFurnaceState = (rawBuilding: unknown) => {
      const building = asRecord(rawBuilding);
      return building['definitionId'] === 'furnace' && !isRecord(building['furnace'])
        ? { ...building, furnace: { queue: [] } }
        : building;
    };
    const buildings = Array.isArray(state['buildings']) ? state['buildings'].map(withFurnaceState) : [];
    const visited = asRecord(state['visitedAreas']);
    const migratedAreas = Object.fromEntries(Object.entries(visited).map(([key, rawArea]) => {
      const area = asRecord(rawArea);
      const nodes = Array.isArray(area['resourceNodes']) ? area['resourceNodes'] : [];
      const areaBuildings = Array.isArray(area['buildings']) ? area['buildings'].map(withFurnaceState) : [];
      return [key, { ...area, resourceNodes: withMountainMetal(area, nodes), buildings: areaBuildings }];
    }));
    return { ...raw, meta: { ...meta, saveVersion: 23, worldGenVersion: 8, contentVersion: 21 }, state: {
      ...state,
      inventory: { ...inventory, 'iron-ore': nonNegativeIntegerOr(inventory['iron-ore'], 0), 'iron-ingot': nonNegativeIntegerOr(inventory['iron-ingot'], 0) },
      resourcesCollected: { ...collected, 'iron-ore': nonNegativeIntegerOr(collected['iron-ore'], 0), 'iron-ingot': nonNegativeIntegerOr(collected['iron-ingot'], 0) },
      yieldRemainderByResource: {
        wood: nonNegativeIntegerOr(remainder['wood'], 0), stone: nonNegativeIntegerOr(remainder['stone'], 0),
        fiber: nonNegativeIntegerOr(remainder['fiber'], 0), 'iron-ore': nonNegativeIntegerOr(remainder['iron-ore'], 0),
        'iron-ingot': nonNegativeIntegerOr(remainder['iron-ingot'], 0),
      },
      resourceNodes: withMountainMetal(currentArea, currentNodes),
      buildings,
      visitedAreas: migratedAreas,
    } };
  },
  // v23 → v24: move Admin-editable equipment/target tuning into the save.
  23: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 24, contentVersion: 22 },
      state: { ...state, gameBalance: createDefaultGameBalance() },
    };
  },
  // v24 → v25: persist the Admin-editable base walking speed on the player.
  24: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']); const player = asRecord(state['player']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 25, contentVersion: 23 },
      state: { ...state, player: { ...player, walkSpeed: PLAYER_SPEED_PX_PER_S } },
    };
  },
  // v25 → v26: split global character defaults from this save's local player.
  25: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']); const player = asRecord(state['player']);
    const existingBalance = asRecord(state['gameBalance']);
    const defaults = createDefaultGameBalance();
    const walkSpeed = typeof player['walkSpeed'] === 'number' && Number.isInteger(player['walkSpeed']) && player['walkSpeed'] > 0
      ? player['walkSpeed'] : PLAYER_SPEED_PX_PER_S;
    const migratedPlayer = { ...player };
    delete migratedPlayer['walkSpeed'];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 26, contentVersion: 24 },
      state: {
        ...state,
        player: migratedPlayer,
        gameBalance: {
          ...defaults,
          ...existingBalance,
          characterDefaults: { ...defaults.characterDefaults, walkSpeed },
        },
      },
    };
  },
  // v26 → v27: move every resource-object value into global game balance.
  26: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const existingBalance = asRecord(state['gameBalance']);
    const oldMinimumTiers = asRecord(existingBalance['minimumToolTierByTarget']);
    const defaults = createDefaultGameBalance();
    const objects = structuredClone(defaults.objects) as unknown as Record<string, Record<string, unknown>>;
    for (const kind of RESOURCE_NODE_KINDS) {
      const oldTier = oldMinimumTiers[kind];
      if (typeof oldTier === 'number' && Number.isInteger(oldTier) && oldTier >= 0 && oldTier <= 3) {
        objects[kind]!['minimumToolTier'] = oldTier;
      }
    }
    const migratedBalance: Record<string, unknown> = { ...defaults, ...existingBalance, objects };
    delete migratedBalance['minimumToolTierByTarget'];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 27, contentVersion: 25 },
      state: { ...state, gameBalance: migratedBalance },
    };
  },
  // v27 → v28: positional battles and dedicated HP/SP/MP recovery attributes.
  27: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const player = asRecord(state['player']); const attributes = asRecord(player['attributes']);
    const encounter = state['activeEncounter'] === null ? null : asRecord(state['activeEncounter']);
    const existingBalance = asRecord(state['gameBalance']);
    const characterDefaults = asRecord(existingBalance['characterDefaults']);
    // The v28 shape's own defaults, spelled out: recovery was a whole number
    // per pulse back here, and v75 is where it becomes hundredths per second.
    const defaults = { hpRegenBase: 0, staminaRegenBase: 5, manaRegenBase: 2 };
    return {
      ...raw,
      meta: { ...meta, saveVersion: 28, contentVersion: 26 },
      state: {
        ...state,
        player: { ...player, attributes: { ...attributes, health: 0, stamina: 0, magic: 0 } },
        activeEncounter: encounter === null ? null : {
          ...encounter,
          playerPos: nonNegativeIntegerOr(encounter['playerPos'], 30),
          creaturePos: nonNegativeIntegerOr(encounter['creaturePos'], 70),
        },
        gameBalance: {
          ...existingBalance,
          characterDefaults: {
            ...characterDefaults,
            hpRegenBase: nonNegativeIntegerOr(characterDefaults['hpRegenBase'], defaults.hpRegenBase),
            staminaRegenBase: nonNegativeIntegerOr(characterDefaults['staminaRegenBase'], defaults.staminaRegenBase),
            manaRegenBase: nonNegativeIntegerOr(characterDefaults['manaRegenBase'], defaults.manaRegenBase),
          },
        },
      },
    };
  },
  // v28 → v29: consolidate the character sheet into eight battle/exploration
  // attributes. Removed Defense and Capacity investments are refunded.
  28: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const player = asRecord(state['player']); const old = asRecord(player['attributes']);
    const oldHealth = nonNegativeIntegerOr(old['health'], 0);
    const oldStamina = nonNegativeIntegerOr(old['stamina'], 0);
    const oldMagic = nonNegativeIntegerOr(old['magic'], 0);
    const hpIncrease = oldHealth * 10;
    const staminaIncrease = oldStamina * 10;
    const manaIncrease = oldMagic * 10;
    const maxHp = nonNegativeIntegerOr(player['maxHp'], 100) + hpIncrease;
    const maxStamina = nonNegativeIntegerOr(player['maxStamina'], 100) + staminaIncrease;
    const maxMana = nonNegativeIntegerOr(player['maxMana'], 30) + manaIncrease;
    return {
      ...raw,
      meta: { ...meta, saveVersion: 29, contentVersion: 27 },
      state: {
        ...state,
        player: {
          ...player,
          hp: Math.min(maxHp, nonNegativeIntegerOr(player['hp'], maxHp) + hpIncrease),
          maxHp,
          stamina: Math.min(maxStamina, nonNegativeIntegerOr(player['stamina'], maxStamina) + staminaIncrease),
          maxStamina,
          mana: Math.min(maxMana, nonNegativeIntegerOr(player['mana'], maxMana) + manaIncrease),
          maxMana,
          attributePoints: nonNegativeIntegerOr(player['attributePoints'], 0)
            + nonNegativeIntegerOr(old['defense'], 0)
            + nonNegativeIntegerOr(old['capacity'], 0),
          attributes: {
            strength: nonNegativeIntegerOr(old['strength'], 0),
            dexterity: nonNegativeIntegerOr(old['dexterity'], 0),
            magic: 0,
            luck: nonNegativeIntegerOr(old['handling'], 0),
            speed: nonNegativeIntegerOr(old['agility'], 0),
            vitality: nonNegativeIntegerOr(old['vitality'], 0) + oldHealth,
            endurance: nonNegativeIntegerOr(old['endurance'], 0) + oldStamina,
            intelligence: oldMagic,
          },
        },
      },
    };
  },
  // v29 → v30: exact bag capacity and per-item weights in global balance.
  29: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const existingBalance = asRecord(state['gameBalance']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 30, contentVersion: 28 },
      state: {
        ...state,
        gameBalance: {
          ...existingBalance,
          bagWeight: structuredClone(createDefaultGameBalance().bagWeight),
        },
      },
    };
  },
  // v30 -> v31: persisted resource stack boundaries and timed player drops.
  30: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const inventory = asRecord(state['inventory']);
    const makeStacks = (value: unknown): number[] => {
      let remaining = nonNegativeIntegerOr(value, 0);
      const stacks: number[] = [];
      while (remaining > 0) {
        const amount = Math.min(remaining, RESOURCE_STACK_SIZE);
        stacks.push(amount); remaining -= amount;
      }
      return stacks;
    };
    const migrateDrops = (value: unknown): unknown[] => Array.isArray(value)
      ? value.map((drop) => isRecord(drop) ? { ...drop, expiresAtTick: null } : drop)
      : [];
    const visited = asRecord(state['visitedAreas']);
    const visitedAreas = Object.fromEntries(Object.entries(visited).map(([key, value]) => {
      const area = asRecord(value);
      return [key, { ...area, groundDrops: migrateDrops(area['groundDrops']) }];
    }));
    return {
      ...raw,
      meta: { ...meta, saveVersion: 31, contentVersion: 29 },
      state: {
        ...state,
        inventoryStacks: {
          wood: makeStacks(inventory['wood']), stone: makeStacks(inventory['stone']),
          fiber: makeStacks(inventory['fiber']), 'iron-ore': makeStacks(inventory['iron-ore']),
          'iron-ingot': makeStacks(inventory['iron-ingot']),
        },
        groundDrops: migrateDrops(state['groundDrops']),
        visitedAreas,
      },
    };
  },
  // v31 -> v32: Storage Box (small) becomes a six-space stack/tool inventory.
  31: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const makeStacks = (value: unknown): number[] => {
      let remaining = nonNegativeIntegerOr(value, 0); const stacks: number[] = [];
      while (remaining > 0) { const amount = Math.min(remaining, RESOURCE_STACK_SIZE); stacks.push(amount); remaining -= amount; }
      return stacks;
    };
    const migrateBuildings = (value: unknown): unknown[] => Array.isArray(value) ? value.map((rawBuilding) => {
      if (!isRecord(rawBuilding) || rawBuilding['definitionId'] !== 'field-cache') return rawBuilding;
      const storage = asRecord(rawBuilding['storage']);
      const inventory = {
        wood: nonNegativeIntegerOr(storage['wood'], 0), stone: nonNegativeIntegerOr(storage['stone'], 0),
        fiber: nonNegativeIntegerOr(storage['fiber'], 0), 'iron-ore': nonNegativeIntegerOr(storage['iron-ore'], 0),
        'iron-ingot': nonNegativeIntegerOr(storage['iron-ingot'], 0),
      };
      return {
        ...rawBuilding,
        storage: inventory,
        storageStacks: {
          wood: makeStacks(inventory.wood), stone: makeStacks(inventory.stone), fiber: makeStacks(inventory.fiber),
          'iron-ore': makeStacks(inventory['iron-ore']), 'iron-ingot': makeStacks(inventory['iron-ingot']),
        },
        storedTools: [],
      };
    }) : [];
    const visited = asRecord(state['visitedAreas']);
    const visitedAreas = Object.fromEntries(Object.entries(visited).map(([key, value]) => {
      const area = asRecord(value);
      return [key, { ...area, buildings: migrateBuildings(area['buildings']) }];
    }));
    return {
      ...raw,
      meta: { ...meta, saveVersion: 32, contentVersion: 30 },
      state: { ...state, buildings: migrateBuildings(state['buildings']), visitedAreas },
    };
  },
  // v32 -> v33: battle companions, Bond abilities, cooldowns, and enemy intent.
  32: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const ownedCreatures = Array.isArray(state['ownedCreatures']) ? state['ownedCreatures'].map((value) => {
      if (!isRecord(value) || !isSpeciesId(value['speciesId'])) return value;
      return {
        ...value,
        bondXp: nonNegativeIntegerOr(value['bondXp'], 0),
        selectedBattleAbilityId: isCompanionAbilityId(value['selectedBattleAbilityId'])
          && companionAbility(value['speciesId'], value['selectedBattleAbilityId'])
          ? value['selectedBattleAbilityId']
          : signatureCompanionAbility(value['speciesId']),
      };
    }) : [];
    const encounter = state['activeEncounter'] === null ? null : asRecord(state['activeEncounter']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 33, contentVersion: 32 },
      state: {
        ...state,
        ownedCreatures,
        battleCompanionId: null,
        activeEncounter: encounter === null ? null : {
          ...encounter,
          companionCreatureId: null,
          selectedCompanionAbilityId: null,
          companionAbilityReadyRounds: {},
          enemyIntent: 'watch',
        },
      },
    };
  },
  // v33 -> v34: persist the start of an active danger-exposure grace period.
  33: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 34 },
      state: { ...state, dangerExposureStartedAtTick: null },
    };
  },
  // v34 -> v35: durable lifetime counters for the expanded parallel quest log.
  34: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const progress = createQuestProgressState();
    const currentArea = asRecord(state['currentArea']);
    const visited = asRecord(state['visitedAreas']);
    const buildingRecords = [
      ...(Array.isArray(state['buildings']) ? state['buildings'] : []),
      ...Object.values(visited).flatMap((value) => {
        const area = asRecord(value);
        return Array.isArray(area['buildings']) ? area['buildings'] : [];
      }),
    ].map(asRecord);
    for (const building of buildingRecords) {
      if (typeof building['definitionId'] === 'string') {
        progress.buildingsPlaced[building['definitionId']] = (progress.buildingsPlaced[building['definitionId']] ?? 0) + 1;
      }
      const storedTools = Array.isArray(building['storedTools']) ? building['storedTools'].map(asRecord) : [];
      for (const tool of storedTools) if (typeof tool['definitionId'] === 'string') progress.crafted[tool['definitionId']] = 1;
    }
    const tools = Array.isArray(state['tools']) ? state['tools'].map(asRecord) : [];
    for (const tool of tools) if (typeof tool['definitionId'] === 'string') progress.crafted[tool['definitionId']] = 1;
    const collected = asRecord(state['resourcesCollected']);
    progress.crafted['iron-ingot'] = nonNegativeIntegerOr(collected['iron-ingot'], 0);
    const areaRecords = [currentArea, ...Object.values(visited).map(asRecord)];
    progress.areaKeysVisited = [...new Set(areaRecords.map((area) => area['key']).filter((key): key is string => typeof key === 'string'))];
    progress.areaThemesVisited = [...new Set(areaRecords.map((area) => area['theme']).filter((theme): theme is typeof progress.areaThemesVisited[number] =>
      theme === 'elaris' || theme === 'forest' || theme === 'mountain' || theme === 'meadow' || theme === 'thicket' || theme === 'marsh'))];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 35, contentVersion: 33 },
      state: { ...state, questProgress: progress },
    };
  },
  // v35 -> v36: persist shelter pauses for the danger-phase grace countdown.
  35: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 36 },
      state: { ...state, dangerExposurePausedAtTick: null },
    };
  },
  // v36 -> v37: authoritative landscape traversal and unique rowboat ownership.
  36: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']); const player = asRecord(state['player']);
    const clearingTiles = (rawBuildings: unknown, includePlayer: boolean): string[] => {
      const tiles = new Set<string>();
      const add = (x: number, y: number) => {
        if (x >= 0 && y >= 0 && x < WORLD_TILES && y < WORLD_TILES) tiles.add(`${x},${y}`);
      };
      for (const rawBuilding of Array.isArray(rawBuildings) ? rawBuildings : []) {
        const building = asRecord(rawBuilding);
        const id = building['definitionId'];
        const tileX = building['tileX']; const tileY = building['tileY'];
        if (typeof id !== 'string' || !BUILDING_DEFINITION_IDS.has(id) || typeof tileX !== 'number' || typeof tileY !== 'number') continue;
        const definition = buildableById(id as Parameters<typeof buildableById>[0]);
        const rotated = building['rotated'] === true;
        const width = rotated ? definition.tilesHigh : definition.tilesWide;
        const height = rotated ? definition.tilesWide : definition.tilesHigh;
        for (let y = tileY - 1; y <= tileY + height; y += 1) {
          for (let x = tileX - 1; x <= tileX + width; x += 1) add(x, y);
        }
      }
      if (includePlayer && typeof player['x'] === 'number' && typeof player['y'] === 'number') {
        add(Math.floor(player['x'] / TILE_SIZE), Math.floor(player['y'] / TILE_SIZE));
      }
      return [...tiles].sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
    };
    const currentArea = asRecord(state['currentArea']);
    const currentClearings = clearingTiles(state['buildings'], true);
    const visitedAreas = Object.fromEntries(Object.entries(asRecord(state['visitedAreas'])).map(([key, value]) => {
      const area = asRecord(value);
      const clearings = clearingTiles(area['buildings'], false);
      return [key, { ...area, ...(clearings.length > 0 ? { landClearingTiles: clearings } : {}) }];
    }));
    return {
      ...raw,
      meta: { ...meta, saveVersion: 37, worldGenVersion: 9, contentVersion: 34 },
      state: {
        ...state,
        rowboatOwned: false,
        player: { ...player, traversalMode: 'foot' },
        currentArea: { ...currentArea, ...(currentClearings.length > 0 ? { landClearingTiles: currentClearings } : {}) },
        visitedAreas,
      },
    };
  },
  // The danger minute became a raid. Every new field is additive, so a v37 save
  // only needs its empty raider lists seeded; existing buildings keep their
  // absent-means-undamaged `hp` representation untouched.
  37: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const visitedAreas = Object.fromEntries(Object.entries(asRecord(state['visitedAreas'])).map(([key, value]) => (
      [key, { ...asRecord(value), raiders: [] }]
    )));
    return {
      ...raw,
      meta: { ...meta, saveVersion: 38, contentVersion: 35 },
      state: {
        ...state,
        raiders: [],
        raidCycleIndex: null,
        raidSettledAreaKeys: [],
        visitedAreas,
      },
    };
  },
  // v38 -> v39: raid, raider, defence, structure, and creature tuning move into
  // global balance, and shelter clears exposure outright instead of pausing it.
  38: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const existingBalance = asRecord(state['gameBalance']);
    const defaults = createDefaultGameBalance();
    const migratedState = { ...state };
    delete migratedState['dangerExposurePausedAtTick'];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 39, contentVersion: 36 },
      state: {
        ...migratedState,
        gameBalance: {
          ...existingBalance,
          raiders: structuredClone(defaults.raiders),
          raid: structuredClone(defaults.raid),
          defense: structuredClone(defaults.defense),
          structures: structuredClone(defaults.structures),
          creatures: structuredClone(defaults.creatures),
        },
      },
    };
  },
  // v39 -> v40: poison fog and raiders stop overlapping and take alternate
  // cycles, raiders gain a separate player-damage number, and kills pay coins.
  //
  // Raider and defence tuning is reset to the shipped defaults rather than
  // patched field by field: the structure-damage numbers were rebalanced
  // downward against the new bounties, so carrying a v39 save's old values
  // forward would leave a base facing raiders tuned for a game where hiding was
  // the only option. The rest of the player's balance edits are untouched.
  39: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const existingBalance = asRecord(state['gameBalance']);
    const existingRaid = asRecord(existingBalance['raid']);
    const defaults = createDefaultGameBalance();
    return {
      ...raw,
      meta: { ...meta, saveVersion: 40, contentVersion: 37 },
      state: {
        ...state,
        // Live raiders are dropped: a save reloaded mid-raid may land on what is
        // now a fog cycle, and advanceRaid would clear them on the first tick
        // anyway. Doing it here keeps the loaded state self-consistent.
        raiders: [],
        visitedAreas: Object.fromEntries(Object.entries(asRecord(state['visitedAreas'])).map(([key, value]) => (
          [key, { ...asRecord(value), raiders: [] }]
        ))),
        gameBalance: {
          ...existingBalance,
          raiders: structuredClone(defaults.raiders),
          defense: structuredClone(defaults.defense),
          raid: {
            ...existingRaid,
            // Wave growth is counted per raid now rather than per cycle, so the
            // old per-cycle number would describe half the intended curve.
            waveGrowthTenths: defaults.raid.waveGrowthTenths,
          },
        },
      },
    };
  },
  // v40 -> v41: the Bow gates every shot, and Cloth Masks are a stackable fog
  // filter. Both are additive: an existing save starts with neither, and the
  // new bag-weight entry is merged in rather than resetting the player's edits.
  40: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const consumables = asRecord(state['consumables']);
    const balance = asRecord(state['gameBalance']);
    const bagWeight = asRecord(balance['bagWeight']);
    const defaults = createDefaultGameBalance();
    return {
      ...raw,
      meta: { ...meta, saveVersion: 41, contentVersion: 38 },
      state: {
        ...state,
        bowOwned: false,
        clothMaskActiveUntilTick: null,
        consumables: { ...consumables, clothMasks: nonNegativeIntegerOr(consumables['clothMasks'], 0) },
        gameBalance: {
          ...balance,
          bagWeight: {
            ...bagWeight,
            itemHundredths: {
              ...defaults.bagWeight.itemHundredths,
              ...asRecord(bagWeight['itemHundredths']),
              'cloth-mask': defaults.bagWeight.itemHundredths['cloth-mask'],
            },
          },
        },
      },
    };
  },
  // v41 -> v42: persist configurable automatic and spendable level-up rewards.
  41: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 42 },
      state: {
        ...state,
        gameBalance: {
          ...balance,
          levelUp: structuredClone(createDefaultGameBalance().levelUp),
        },
      },
    };
  },
  // v42 → v43: snares, berries, arrows, and masks become ordinary Bag items.
  42: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const consumables = asRecord(state['consumables']);
    const inventory = asRecord(state['inventory']);
    const stacks = asRecord(state['inventoryStacks']);
    const moved: Array<[string, string]> = [
      ['taming-snare', 'tamingSnares'], ['berry', 'berries'], ['arrow', 'arrows'], ['cloth-mask', 'clothMasks'],
    ];
    const nextInventory: Record<string, unknown> = { ...inventory };
    const nextStacks: Record<string, unknown> = { ...stacks };
    for (const [item, legacyKey] of moved) {
      const amount = nonNegativeIntegerOr(consumables[legacyKey], 0);
      nextInventory[item] = amount;
      const boundaries: number[] = [];
      for (let left = amount; left > 0; left -= RESOURCE_STACK_SIZE) boundaries.push(Math.min(left, RESOURCE_STACK_SIZE));
      nextStacks[item] = boundaries;
    }
    const { consumables: _dropped, ...rest } = state;
    return {
      ...raw,
      meta: { ...meta, saveVersion: 43, contentVersion: 39 },
      state: { ...rest, inventory: nextInventory, inventoryStacks: nextStacks },
    };
  },
  // v43 → v44: unlock points and gold granted per level become configurable.
  43: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const levelUp = asRecord(balance['levelUp']);
    const defaults = createDefaultGameBalance().levelUp;
    return {
      ...raw,
      meta: { ...meta, saveVersion: 44 },
      state: {
        ...state,
        gameBalance: {
          ...balance,
          levelUp: { ...defaults, ...levelUp, coins: defaults.coins },
        },
      },
    };
  },
  // v44 → v45: the damage table widens past resource nodes. Raiders and
  // structures become ordinary strike targets so one row describes a tool's
  // whole relationship with the world, which means every persisted
  // damage/wear record gains two keys.
  44: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const defaults = createDefaultGameBalance();

    // Shipped values win for the new keys: nothing in an old save ever
    // expressed them, so there is no player intent here to preserve.
    const widen = (
      existing: Record<string, unknown>,
      fallback: Readonly<Record<string, number>>,
    ): Record<string, number> => {
      const next: Record<string, number> = {};
      for (const target of STRIKE_TARGETS) {
        const carried = existing[target];
        next[target] = typeof carried === 'number' && Number.isSafeInteger(carried) && carried >= 0
          ? carried
          : fallback[target] ?? 0;
      }
      return next;
    };

    const hands = asRecord(balance['hands']);
    const tools = asRecord(balance['tools']);
    const nextTools: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(tools)) {
      const tool = asRecord(value);
      const shipped = defaults.tools[id as keyof typeof defaults.tools];
      if (!shipped) continue;
      nextTools[id] = {
        ...tool,
        damageByTarget: widen(asRecord(tool['damageByTarget']), shipped.damageByTarget),
        wearMultiplierByTarget: widen(asRecord(tool['wearMultiplierByTarget']), shipped.wearMultiplierByTarget),
      };
    }

    return {
      ...raw,
      meta: { ...meta, saveVersion: 45, contentVersion: 40 },
      state: {
        ...state,
        gameBalance: {
          ...balance,
          hands: {
            ...hands,
            damageByTarget: widen(asRecord(hands['damageByTarget']), defaults.hands.damageByTarget),
          },
          tools: nextTools,
        },
      },
    };
  },
  // v45 → v46: swords. A new tool definition means a new persisted balance row,
  // so every save needs the shipped defaults filled in or the Admin panel and
  // save validation would both trip over a missing key.
  45: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const tools = asRecord(balance['tools']);
    const defaults = createDefaultGameBalance().tools;
    const nextTools: Record<string, unknown> = { ...tools };
    for (const [id, shipped] of Object.entries(defaults)) {
      if (nextTools[id] === undefined) nextTools[id] = structuredClone(shipped);
    }
    return {
      ...raw,
      meta: { ...meta, saveVersion: 46, contentVersion: 41 },
      state: { ...state, gameBalance: { ...balance, tools: nextTools } },
    };
  },
  // v46 → v47: the Bow stops being a durable ownership flag and becomes an
  // ordinary tool, so it takes a bag slot, wears out, and has to be equipped.
  // Anyone who owned one keeps it, at full durability, as a carried instance.
  46: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const tools = Array.isArray(state['tools']) ? [...state['tools']] : [];
    let nextEntityId = nonNegativeIntegerOr(state['nextEntityId'], 1);

    if (state['bowOwned'] === true && !tools.some((tool) => isRecord(tool) && tool['definitionId'] === 'bow')) {
      const shipped = createDefaultGameBalance().tools.bow;
      const editable = asRecord(asRecord(balance['tools'])['bow']);
      // Admin-tuned durability wins where a save carries it, matching how every
      // other tool reads its ceiling back out of save-backed balance.
      const maxDurability = nonNegativeIntegerOr(editable['maxDurability'], shipped.maxDurability);
      tools.push({
        instanceId: `tool-${nextEntityId}`,
        definitionId: 'bow',
        durability: maxDurability,
        maxDurability,
        powerRank: 0,
        speedRank: 0,
        durabilityRank: 0,
      });
      nextEntityId += 1;
    }

    const { bowOwned: _dropped, ...rest } = state;
    return {
      ...raw,
      meta: { ...meta, saveVersion: 47, contentVersion: 42 },
      state: { ...rest, tools, nextEntityId },
    };
  },
  // v47 → v48: roaming hostiles. Two new raider kinds need balance rows, and
  // the defense block gains the roamer dials the Admin panel edits.
  47: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const defaults = createDefaultGameBalance();
    const raiders = asRecord(balance['raiders']);
    const nextRaiders: Record<string, unknown> = { ...raiders };
    for (const [kindId, shipped] of Object.entries(defaults.raiders)) {
      if (nextRaiders[kindId] === undefined) nextRaiders[kindId] = structuredClone(shipped);
    }
    return {
      ...raw,
      meta: { ...meta, saveVersion: 48, contentVersion: 43 },
      state: {
        ...state,
        gameBalance: {
          ...balance,
          raiders: nextRaiders,
          defense: { ...defaults.defense, ...asRecord(balance['defense']) },
        },
      },
    };
  },
  // v48 → v49: persisted defeat selection and brief post-respawn protection.
  // Existing saves begin alive (or retain an admin-set 0 HP) without inventing
  // a defeat event or charging their inventory a second time.
  48: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 49, contentVersion: 44 },
      state: { ...state, pendingRespawn: null, respawnProtectionUntilTick: null },
    };
  },
  // v49 → v50: named expedition destinations replace the procedural identity
  // previously assigned to their coordinates. Preserve every persisted entity
  // while canonicalizing area names and themes in active and inactive snapshots.
  49: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const visitedAreas = asRecord(state['visitedAreas']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 50, contentVersion: 45 },
      state: {
        ...state,
        currentArea: canonicalizeAuthoredArea(state['currentArea']),
        visitedAreas: Object.fromEntries(
          Object.entries(visitedAreas).map(([key, area]) => [key, canonicalizeAuthoredArea(area)]),
        ),
      },
    };
  },
  // v50 → v51: landmark discovery and repeatable regional contracts. Existing
  // characters begin with the landmarks unclaimed so every reward is earned.
  50: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 51, worldGenVersion: 10, contentVersion: 46 },
      state: { ...state, regionalProgress: createRegionalProgressState() },
    };
  },
  // v51 → v52: lifetime regional contract completions power mastery. Existing
  // cycle progress is preserved, and a completed live contract proves at least
  // one historical completion so the character does not lose earned credit.
  51: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const regionalProgress = asRecord(state['regionalProgress']);
    const contracts = asRecord(regionalProgress['contracts']);
    const completionCounts = Object.fromEntries(
      Object.entries(contracts)
        .filter(([, contract]) => isRecord(contract) && contract['completed'] === true)
        .map(([contractId]) => [contractId, 1]),
    );
    return {
      ...raw,
      meta: { ...meta, saveVersion: 52, contentVersion: 47 },
      state: {
        ...state,
        regionalProgress: { ...regionalProgress, contractCompletionCounts: completionCounts },
      },
    };
  },
  // v52 → v53: the shop-exclusive Magic Staff adds one save-backed tool
  // balance row. Existing tool tuning stays untouched.
  52: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const tools = asRecord(balance['tools']);
    const nextTools: Record<string, unknown> = { ...tools };
    if (nextTools['magic-staff'] === undefined) {
      nextTools['magic-staff'] = structuredClone(createDefaultGameBalance().tools['magic-staff']);
    }
    return {
      ...raw,
      meta: { ...meta, saveVersion: 53, contentVersion: 48 },
      state: { ...state, gameBalance: { ...balance, tools: nextTools } },
    };
  },
  // v53 → v54: worker housing reserves stable Pen/Barn slots and persists the
  // finite collection bin plus cycle remainder. Legacy workers rest safely;
  // no creature or previously gathered resource is guessed or discarded.
  53: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const buildings = Array.isArray(state['buildings']) ? state['buildings'].map((value) => {
      if (!isRecord(value) || (value['definitionId'] !== 'small-pen' && value['definitionId'] !== 'barn')) return value;
      return { ...value, housing: isRecord(value['housing']) ? value['housing'] : createWorkerHousingState() };
    }) : [];
    const ownedCreatures = Array.isArray(state['ownedCreatures']) ? state['ownedCreatures'].map((value) => {
      if (!isRecord(value)) return value;
      return {
        ...value,
        housingId: typeof value['housingId'] === 'string' ? value['housingId'] : null,
        workRemainderMs: nonNegativeIntegerOr(value['workRemainderMs'], 0),
        ...(value['role'] === 'work' ? { role: 'rest', assignment: null, worksiteId: null } : {}),
      };
    }) : [];
    const balance = asRecord(state['gameBalance']);
    const structures = asRecord(balance['structures']);
    const facilityHp = asRecord(structures['facilityHp']);
    const defaults = createDefaultGameBalance().structures.facilityHp;
    return {
      ...raw,
      meta: { ...meta, saveVersion: 54, contentVersion: 49 },
      state: {
        ...state,
        buildings,
        ownedCreatures,
        gameBalance: {
          ...balance,
          structures: {
            ...structures,
            facilityHp: {
              ...facilityHp,
              'farm-counter': nonNegativeIntegerOr(facilityHp['farm-counter'], defaults['farm-counter']),
              'small-pen': nonNegativeIntegerOr(facilityHp['small-pen'], defaults['small-pen']),
              barn: nonNegativeIntegerOr(facilityHp['barn'], defaults.barn),
            },
          },
        },
      },
    };
  },
  // v54 â†’ v55: species worksites add Stone Yard output and Cart Dock links.
  // New facilities get explicit finite/edge-trigger state; all prior entities
  // are retained verbatim because these definitions did not exist in v54.
  54: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const buildings = Array.isArray(state['buildings']) ? state['buildings'].map((value) => {
      if (!isRecord(value)) return value;
      if (value['definitionId'] === 'stone-yard') {
        return { ...value, producer: isRecord(value['producer']) ? value['producer'] : createWorkerProducerState() };
      }
      if (value['definitionId'] === 'cart-dock') {
        return { ...value, cartDock: isRecord(value['cartDock']) ? value['cartDock'] : createCartDockState() };
      }
      return value;
    }) : [];
    const balance = asRecord(state['gameBalance']);
    const structures = asRecord(balance['structures']);
    const facilityHp = asRecord(structures['facilityHp']);
    const defaults = createDefaultGameBalance().structures.facilityHp;
    return {
      ...raw,
      meta: { ...meta, saveVersion: 55, contentVersion: 50 },
      state: {
        ...state,
        buildings,
        gameBalance: {
          ...balance,
          structures: {
            ...structures,
            facilityHp: {
              ...facilityHp,
              'stone-yard': nonNegativeIntegerOr(facilityHp['stone-yard'], defaults['stone-yard']),
              'cart-dock': nonNegativeIntegerOr(facilityHp['cart-dock'], defaults['cart-dock']),
            },
          },
        },
      },
    };
  },
  // v55 → v56: four construction materials, bulk storage, and stable Logistics
  // Hub routes. Existing storage is normalized without changing any totals.
  55: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const buildings = Array.isArray(state['buildings']) ? state['buildings'].map((value) => {
      if (!isRecord(value)) return value;
      let next = value;
      if (isRecord(value['storage'])) {
        next = {
          ...next,
          storage: {
            ...value['storage'] as Record<string, unknown>,
            'taming-snare': 0, berry: 0, arrow: 0, 'cloth-mask': 0,
          },
          storageStacks: {
            ...asRecord(value['storageStacks']),
            'taming-snare': [], berry: [], arrow: [], 'cloth-mask': [],
          },
        };
      }
      if (value['definitionId'] === 'logistics-hub') {
        next = { ...next, logistics: isRecord(value['logistics']) ? value['logistics'] : createLogisticsHubState() };
      }
      return next;
    }) : [];
    const balance = asRecord(state['gameBalance']);
    const structures = asRecord(balance['structures']);
    const defaults = createDefaultGameBalance().structures;
    return {
      ...raw,
      meta: { ...meta, saveVersion: 56, contentVersion: 51 },
      state: {
        ...state,
        buildings,
        gameBalance: {
          ...balance,
          structures: {
            ...structures,
            wallHp: { ...defaults.wallHp, ...asRecord(structures['wallHp']) },
            facilityHp: {
              ...asRecord(structures['facilityHp']),
              warehouse: defaults.facilityHp.warehouse,
              'logistics-hub': defaults.facilityHp['logistics-hub'],
            },
          },
        },
      },
    };
  },
  // v56 → v57: minimal NPC conversation memory. Service outcomes remain
  // derivable or transient and are deliberately not copied into this record.
  56: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 57, contentVersion: 52 },
      state: { ...state, npcMemory: createNpcMemoryState() },
    };
  },
  // Creature trophies, the Reinforced Snare, and findable world containers.
  // Containers are generated rather than defaulted to empty so a save that has
  // already explored half the map still finds caches in those regions.
  57: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const worldSeed = typeof state['seed'] === 'number' ? state['seed'] : 0;
    const inventory = asRecord(state['inventory']);
    const inventoryStacks = asRecord(state['inventoryStacks']);
    for (const item of NEW_V58_BAG_ITEMS) {
      if (typeof inventory[item] !== 'number') inventory[item] = 0;
      if (!Array.isArray(inventoryStacks[item])) inventoryStacks[item] = [];
    }
    const visitedAreas = asRecord(state['visitedAreas']);
    const migratedAreas = Object.fromEntries(Object.entries(visitedAreas).map(([key, rawArea]) => {
      const area = asRecord(rawArea);
      return [key, Array.isArray(area['containers'])
        ? area
        : { ...area, containers: containersForRawArea(area, worldSeed) }];
    }));
    return {
      ...raw,
      meta: { ...meta, saveVersion: 58, contentVersion: 53 },
      state: {
        ...state,
        inventory,
        inventoryStacks,
        visitedAreas: migratedAreas,
        containers: Array.isArray(state['containers'])
          ? state['containers']
          : containersForRawArea(asRecord(state['currentArea']), worldSeed),
      },
    };
  },
  // Per-NPC stock: Elowen's Safeguard Charm plus the two durable purchase
  // counters behind Garrick's Reinforced Pack and Selene's Arcane Study.
  58: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const inventory = asRecord(state['inventory']);
    const inventoryStacks = asRecord(state['inventoryStacks']);
    if (typeof inventory['safeguard-charm'] !== 'number') inventory['safeguard-charm'] = 0;
    if (!Array.isArray(inventoryStacks['safeguard-charm'])) inventoryStacks['safeguard-charm'] = [];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 59, contentVersion: 54 },
      state: {
        ...state,
        inventory,
        inventoryStacks,
        packRanks: typeof state['packRanks'] === 'number' ? state['packRanks'] : 0,
        arcaneStudyPurchases: typeof state['arcaneStudyPurchases'] === 'number' ? state['arcaneStudyPurchases'] : 0,
      },
    };
  },
  // Creature expeditions. Nothing to reconstruct: a save from before this
  // simply has no party out, so both fields start empty.
  59: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 60, contentVersion: 55 },
      state: {
        ...state,
        expeditions: Array.isArray(state['expeditions']) ? state['expeditions'] : [],
        expeditionsDispatched: typeof state['expeditionsDispatched'] === 'number' ? state['expeditionsDispatched'] : 0,
      },
    };
  },
  // Wild creatures become live world entities: health, a leash anchor, and
  // hostility all move out of the encounter and into the creature itself.
  //
  // Every creature is restored at full health where it stands, and that spot
  // becomes its home. Reconstructing the original spawn point is not possible
  // from an old save and not worth it — a creature that leashes back to where
  // the player last saw it is indistinguishable from one that leashes to where
  // it was generated. Any encounter in progress is ended, because the battle
  // screen it belonged to is being retired.
  60: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const creatureBalance = asRecord(balance['creatures']);
    for (const definition of CREATURE_DEFINITIONS) {
      const editable = asRecord(creatureBalance[definition.speciesId]);
      for (const field of NEW_V61_CREATURE_BALANCE_FIELDS) {
        if (typeof editable[field] !== 'number') editable[field] = definition.encounter[field];
      }
      creatureBalance[definition.speciesId] = editable;
    }
    return {
      ...raw,
      meta: { ...meta, saveVersion: 61, contentVersion: 56 },
      state: {
        ...state,
        activeEncounter: null,
        gameBalance: { ...balance, creatures: creatureBalance },
        wildCreatures: migrateWildCreatures(state['wildCreatures']),
        visitedAreas: Array.isArray(state['visitedAreas'])
          ? state['visitedAreas'].map((area) => {
            const record = asRecord(area);
            return { ...record, wildCreatures: migrateWildCreatures(record['wildCreatures']) };
          })
          : state['visitedAreas'],
      },
    };
  },
  // The camera angle becomes a published global value instead of a per-device
  // preference, so it joins the balance document at the shipped default tilt.
  61: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 62, contentVersion: 57 },
      state: {
        ...state,
        gameBalance: { ...balance, camera: { ...ELARIS_CAMERA_DEFAULT_TENTHS } },
      },
    };
  },
  // The danger phase splits into one length per danger element. Every element
  // inherits the single length the save was tuned to, so a retuned save keeps
  // the cycle it had and only diverges once an admin edits one of them.
  62: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const raid = asRecord(balance['raid']);
    const shared = typeof raid['dangerPhaseSeconds'] === 'number' && Number.isInteger(raid['dangerPhaseSeconds'])
      && (raid['dangerPhaseSeconds'] as number) > 0
      ? raid['dangerPhaseSeconds'] as number
      : DANGER_PHASE_SECONDS;
    const { dangerPhaseSeconds: _removed, ...rest } = raid;
    return {
      ...raw,
      meta: { ...meta, saveVersion: 63, contentVersion: 57 },
      state: {
        ...state,
        gameBalance: {
          ...balance,
          raid: {
            ...rest,
            // The two elements that existed at v62, spelled out rather than
            // read from DANGER_THREAT_IDS: a migration describes the shape of
            // its own version, and later elements are added by later steps.
            dangerPhaseSecondsByThreat: { fog: shared, raid: shared },
          },
        },
      },
    };
  },
  // Sprinting arrives as a global value: an existing save inherits the shipped
  // 1.5x speed and 2 SP per second until an admin retunes them.
  63: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const characterDefaults = asRecord(balance['characterDefaults']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 64, contentVersion: 57 },
      state: {
        ...state,
        gameBalance: {
          ...balance,
          characterDefaults: {
            ...characterDefaults,
            sprintSpeedTenths: SPRINT_SPEED_TENTHS,
            sprintStaminaPerSecond: SPRINT_STAMINA_PER_SECOND,
          },
        },
      },
    };
  },
  // v64 → v65: what one attribute point is worth becomes a Global Value. An
  // existing save inherits exactly the curve it was already running, so nothing
  // about a character in flight changes until an admin retunes it.
  64: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 65 },
      state: {
        ...state,
        gameBalance: {
          ...balance,
          attributeGains: structuredClone(createDefaultGameBalance().attributeGains),
        },
      },
    };
  },
  // v65 → v66: the Arcane Storm joins the danger rotation. An existing save
  // gains an empty schedule and the shipped storm tuning, and keeps every fog
  // and raid value it had — the storm has no state to inherit, because a save
  // written before this version was never in one.
  65: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const raid = asRecord(balance['raid']);
    const phases = asRecord(raid['dangerPhaseSecondsByThreat']);
    const defaults = createDefaultGameBalance();
    return {
      ...raw,
      meta: { ...meta, saveVersion: 66 },
      state: {
        ...state,
        arcaneStorm: createArcaneStormState(),
        gameBalance: {
          ...balance,
          raid: {
            ...raid,
            dangerPhaseSecondsByThreat: {
              ...phases,
              // The storm inherits the fog night's length, which is the length
              // this save was actually tuned to rather than the shipped default.
              storm: typeof phases['fog'] === 'number' && Number.isInteger(phases['fog']) && (phases['fog'] as number) > 0
                ? phases['fog'] as number
                : defaults.raid.dangerPhaseSecondsByThreat.storm,
            },
          },
          storm: { ...defaults.storm },
        },
      },
    };
  },
  // Creatures and raiders gain a level, and the world gains the bands that hand
  // levels out. Everything already standing becomes level 1 rather than being
  // re-ranked from where it happens to be: an animal the player walked past
  // yesterday must not be twice as strong when they load the save, and level 1
  // is exactly the enemy this save has been balanced against all along.
  //
  // The per-kind aggro zone and Level Multiplier come from the shipped
  // definitions, so a save keeps behaving as it did until an admin edits them.
  66: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const defaults = createDefaultGameBalance();
    const raiderBalance = asRecord(balance['raiders']);
    for (const kindId of RAIDER_KIND_IDS) {
      const editable = asRecord(raiderBalance[kindId]);
      const shipped = raiderDefinition(kindId);
      if (typeof editable['aggroRangePx'] !== 'number') editable['aggroRangePx'] = shipped.aggroRangePx;
      if (typeof editable['levelMultiplierBps'] !== 'number') {
        editable['levelMultiplierBps'] = shipped.levelMultiplierBps;
      }
      raiderBalance[kindId] = editable;
    }
    const creatureBalance = asRecord(balance['creatures']);
    for (const definition of CREATURE_DEFINITIONS) {
      const editable = asRecord(creatureBalance[definition.speciesId]);
      if (typeof editable['levelMultiplierBps'] !== 'number') {
        editable['levelMultiplierBps'] = definition.encounter.levelMultiplierBps;
      }
      creatureBalance[definition.speciesId] = editable;
    }
    // The single global roamer aggro range is replaced by the per-kind zones
    // above, so it is dropped rather than carried forward as a dead field.
    const defense = asRecord(balance['defense']);
    delete defense['roamerAggroRangeTiles'];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 67, worldGenVersion: 11, contentVersion: 58 },
      state: {
        ...state,
        gameBalance: {
          ...balance,
          defense,
          raiders: raiderBalance,
          creatures: creatureBalance,
          world: { ...defaults.world },
        },
        wildCreatures: withDefaultLevel(state['wildCreatures']),
        raiders: withDefaultLevel(state['raiders']),
        ownedCreatures: withDefaultLevel(state['ownedCreatures']),
        visitedAreas: mapAreaSnapshots(state['visitedAreas'], (area) => ({
          ...area,
          wildCreatures: withDefaultLevel(area['wildCreatures']),
          raiders: withDefaultLevel(area['raiders']),
        })),
      },
    };
  },
  /**
   * v67 → v68: `'creature'` joins StrikeTarget, so every persisted per-target
   * damage and wear record gains a row. Wild creatures were previously only
   * reachable through the Encounter screen; making them an ordinary strike
   * target is what lets one tool describe its whole relationship with the
   * world.
   *
   * Shipped values win for the new key, exactly as the v44 widening did: no old
   * save ever expressed a creature row, so there is no player intent to
   * preserve. Anything iterating these records must use STRIKE_TARGETS — a loop
   * over RESOURCE_NODE_KINDS here is what silently zeroed the combat rows last
   * time.
   */
  67: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const defaults = createDefaultGameBalance();

    const widen = (
      existing: Record<string, unknown>,
      fallback: Readonly<Record<string, number>>,
    ): Record<string, number> => {
      const next: Record<string, number> = {};
      for (const target of STRIKE_TARGETS) {
        const carried = existing[target];
        next[target] = typeof carried === 'number' && Number.isSafeInteger(carried) && carried >= 0
          ? carried
          : fallback[target] ?? 0;
      }
      return next;
    };

    const hands = asRecord(balance['hands']);
    const tools = asRecord(balance['tools']);
    const nextTools: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(tools)) {
      const tool = asRecord(value);
      const shipped = defaults.tools[id as keyof typeof defaults.tools];
      if (!shipped) continue;
      nextTools[id] = {
        ...tool,
        damageByTarget: widen(asRecord(tool['damageByTarget']), shipped.damageByTarget),
        wearMultiplierByTarget: widen(
          asRecord(tool['wearMultiplierByTarget']),
          shipped.wearMultiplierByTarget,
        ),
      };
    }

    return {
      ...raw,
      meta: { ...meta, saveVersion: 68, worldGenVersion: 11, contentVersion: 58 },
      state: {
        ...state,
        gameBalance: {
          ...balance,
          hands: {
            ...hands,
            damageByTarget: widen(
              asRecord(hands['damageByTarget']),
              defaults.hands.damageByTarget,
            ),
          },
          tools: nextTools,
        },
      },
    };
  },
  /**
   * v68 → v69: reach becomes a Global Value. Every tool and the bare hands gain
   * a `rangePx`, and `defense.playerShotRangeTiles` — the one range dial that
   * existed — moves onto the Bow as its Range.
   *
   * The bow deliberately inherits the save's own tiles value rather than the
   * shipped default: an admin who widened the shot range meant it, and dropping
   * that on load would silently re-nerf a world that has been played at the
   * wider range. Everything else takes the shipped reach, which is the distance
   * these saves have always struck and gathered at, so no save changes behaviour
   * for having been migrated.
   */
  68: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const defaults = createDefaultGameBalance();
    const defense = asRecord(balance['defense']);
    const carriedTiles = defense['playerShotRangeTiles'];
    const bowRangePx = typeof carriedTiles === 'number' && Number.isSafeInteger(carriedTiles) && carriedTiles > 0
      ? carriedTiles * TILE_SIZE
      : defaults.tools.bow.rangePx;
    delete defense['playerShotRangeTiles'];

    const tools = asRecord(balance['tools']);
    const nextTools: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(tools)) {
      const shipped = defaults.tools[id as keyof typeof defaults.tools];
      if (!shipped) continue;
      nextTools[id] = {
        ...asRecord(value),
        rangePx: id === 'bow' ? bowRangePx : shipped.rangePx,
      };
    }

    return {
      ...raw,
      meta: { ...meta, saveVersion: 69 },
      state: {
        ...state,
        gameBalance: {
          ...balance,
          defense,
          hands: { ...asRecord(balance['hands']), rangePx: defaults.hands.rangePx },
          tools: nextTools,
        },
      },
    };
  },
  /**
   * The homestead-defence roster: five species, their trophies, and the Work
   * passives they run.
   *
   * Everything here is additive and keyed off CREATURE_DEFINITIONS rather than
   * a hard-coded list, so the next species to ship needs no second copy of this
   * step. A save arriving with none of these keys is not corrupt — it simply
   * predates the roster — and every counter it gains starts at zero, which is
   * the truth: it has never met one.
   */
  69: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']);
    const inventory = asRecord(state['inventory']);
    const inventoryStacks = asRecord(state['inventoryStacks']);
    for (const trophy of CREATURE_TROPHY_IDS) {
      if (typeof inventory[trophy] !== 'number') inventory[trophy] = 0;
      if (!Array.isArray(inventoryStacks[trophy])) inventoryStacks[trophy] = [];
    }

    const progress = asRecord(state['questProgress']);
    const counters = ['creatureEncounters', 'creatureDefeats', 'companionWins', 'farmOrders'] as const;
    for (const counter of counters) {
      const record = asRecord(progress[counter]);
      for (const definition of CREATURE_DEFINITIONS) {
        if (typeof record[definition.speciesId] !== 'number') record[definition.speciesId] = 0;
      }
      progress[counter] = record;
    }
    const gathered = asRecord(progress['gatheredWithFollower']);
    const areaKeys = asRecord(progress['areaKeysVisitedWithFollower']);
    for (const definition of CREATURE_DEFINITIONS) {
      if (!isRecord(gathered[definition.speciesId])) {
        gathered[definition.speciesId] = { wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 };
      }
      if (!Array.isArray(areaKeys[definition.speciesId])) areaKeys[definition.speciesId] = [];
    }
    progress['gatheredWithFollower'] = gathered;
    progress['areaKeysVisitedWithFollower'] = areaKeys;

    // Admin edits to the founding four are preserved; the new species take the
    // shipped rows, because there is no earlier tuning of them to respect.
    const balance = asRecord(state['gameBalance']);
    const defaults = createDefaultGameBalance();
    const creatureBalance = asRecord(balance['creatures']);
    for (const definition of CREATURE_DEFINITIONS) {
      if (!isRecord(creatureBalance[definition.speciesId])) {
        creatureBalance[definition.speciesId] = structuredClone(defaults.creatures[definition.speciesId]);
      }
    }

    return {
      ...raw,
      meta: { ...meta, saveVersion: 70, contentVersion: 59 },
      state: {
        ...state,
        inventory,
        inventoryStacks,
        questProgress: progress,
        gameBalance: { ...balance, creatures: creatureBalance },
      },
    };
  },
  // v70 → v71: blueprints stop being bought. The unlock-point currency is gone
  // from both the player and the level-up balance row; `unlockedItemIds` is
  // untouched because it has always held exactly the set of blueprints the
  // player knows, so every purchase already made survives as knowledge.
  70: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    const levelUp = asRecord(balance['levelUp']);
    const { unlockPoints: _droppedPoints, ...remainingState } = state;
    const { unlockPoints: _droppedGrant, ...remainingLevelUp } = levelUp;
    // Every gate at or below the character's level is granted outright rather
    // than queued: these are levels they earned long before the gates existed,
    // and a returning player should not face a banner backlog for them.
    const player = asRecord(state['player']);
    const level = typeof player['level'] === 'number' ? player['level'] : 1;
    const known = Array.isArray(state['unlockedItemIds'])
      ? state['unlockedItemIds'].filter((id): id is string => typeof id === 'string')
      : [];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 71 },
      state: {
        ...remainingState,
        unlockedItemIds: [...new Set([...known, ...blueprintsGrantedUpToLevel(level)])].sort(),
        pendingBlueprintGrantIds: [],
        gameBalance: { ...balance, levelUp: remainingLevelUp },
      },
    };
  },
  // v71 → v72: the handcraft consumables and the Rowboat become real
  // blueprints. They were always known for want of an id, so every existing
  // character keeps them outright — a returning player must never find that a
  // recipe they have been using for hours now needs discovering.
  71: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const known = Array.isArray(state['unlockedItemIds'])
      ? state['unlockedItemIds'].filter((id): id is string => typeof id === 'string')
      : [];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 72 },
      state: {
        ...state,
        unlockedItemIds: [...new Set([...known, ...PREVIOUSLY_ALWAYS_KNOWN])].sort(),
      },
    };
  },
  // v72 -> v73: blueprints become things you carry. Existing saves start with
  // an empty satchel. The Elaris public workbench needs no migration: it is
  // town content derived from the area, never a row in the player's buildings.
  72: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 73 },
      state: { ...state, carriedBlueprints: [], blueprintDrops: [] },
    };
  },
  // v73 -> v74: scrapping a blueprint yields Draft Parchment, a new bag item.
  // Backfilled at zero the way every other new supply has been.
  73: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const inventory = asRecord(state['inventory']);
    const inventoryStacks = asRecord(state['inventoryStacks']);
    if (typeof inventory['draft-parchment'] !== 'number') inventory['draft-parchment'] = 0;
    if (!Array.isArray(inventoryStacks['draft-parchment'])) inventoryStacks['draft-parchment'] = [];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 74 },
      state: { ...state, inventory, inventoryStacks },
    };
  },
  // v74 -> v75: Vitality, Endurance, and Intelligence split into one attribute
  // per promise, and regeneration becomes a per-second rate stored in
  // hundredths so it can be tuned in decimals.
  //
  // Points are copied, not divided: a character who bought Endurance was
  // promised stamina, its recovery, and carry weight, and taking two thirds of
  // that back would be a nerf wearing a migration's clothes. The maximums those
  // points bought are already banked in maxHp/maxStamina/maxMana, so copying
  // the points grants nothing twice.
  74: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const player = asRecord(state['player']);
    const old = asRecord(player['attributes']);
    const vitality = nonNegativeIntegerOr(old['vitality'], 0);
    const endurance = nonNegativeIntegerOr(old['endurance'], 0);
    const intelligence = nonNegativeIntegerOr(old['intelligence'], 0);
    const defaults = createDefaultGameBalance();
    const balance = asRecord(state['gameBalance']);
    const characterDefaults = asRecord(balance['characterDefaults']);
    const gains = asRecord(balance['attributeGains']);
    // A rate that used to be "per recovery pulse" is the same number per
    // second, so multiplying by the scale preserves the old base recovery
    // exactly. The per-point rates are the ones being retuned.
    const perSecond = (value: unknown, fallback: number): number => (
      nonNegativeIntegerOr(value, fallback) * 100
    );
    const nextDefaults: Record<string, unknown> = {
      ...characterDefaults,
      hpRegenBaseHundredths: perSecond(characterDefaults['hpRegenBase'], 0),
      staminaRegenBaseHundredths: perSecond(characterDefaults['staminaRegenBase'], 5),
      manaRegenBaseHundredths: perSecond(characterDefaults['manaRegenBase'], 2),
    };
    for (const retired of ['hpRegenBase', 'staminaRegenBase', 'manaRegenBase']) delete nextDefaults[retired];
    const nextGains: Record<string, unknown> = {
      ...defaults.attributeGains,
      ...gains,
      healthMaxHp: nonNegativeIntegerOr(gains['vitalityMaxHp'], defaults.attributeGains.healthMaxHp),
      staminaMaxStamina: nonNegativeIntegerOr(gains['enduranceMaxStamina'], defaults.attributeGains.staminaMaxStamina),
      manaMaxMana: nonNegativeIntegerOr(gains['intelligenceMaxMana'], defaults.attributeGains.manaMaxMana),
      carryWeightHundredths: nonNegativeIntegerOr(
        gains['enduranceCarryWeightHundredths'],
        defaults.attributeGains.carryWeightHundredths,
      ),
      // Deliberately the shipped rate rather than the old one: a point of
      // regeneration a pulse is what made the stat the only buy worth making,
      // and this migration is where that ends.
      healthRegenHundredths: defaults.attributeGains.healthRegenHundredths,
      staminaRegenHundredths: defaults.attributeGains.staminaRegenHundredths,
      manaRegenHundredths: defaults.attributeGains.manaRegenHundredths,
    };
    for (const retired of [
      'vitalityMaxHp', 'vitalityHpRegen', 'enduranceMaxStamina', 'enduranceStaminaRegen',
      'enduranceCarryWeightHundredths', 'intelligenceMaxMana', 'intelligenceManaRegen',
    ]) delete nextGains[retired];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 75 },
      state: {
        ...state,
        player: {
          ...player,
          attributes: {
            strength: nonNegativeIntegerOr(old['strength'], 0),
            dexterity: nonNegativeIntegerOr(old['dexterity'], 0),
            magic: nonNegativeIntegerOr(old['magic'], 0),
            luck: nonNegativeIntegerOr(old['luck'], 0),
            speed: nonNegativeIntegerOr(old['speed'], 0),
            health: vitality,
            healthRegen: vitality,
            stamina: endurance,
            staminaRegen: endurance,
            carryWeight: endurance,
            mana: intelligence,
            manaRegen: intelligence,
          },
        },
        gameBalance: { ...balance, characterDefaults: nextDefaults, attributeGains: nextGains },
      },
    };
  },
  // v75 -> v76: nothing generates inside the Elaris walls any more. Worlds made
  // under the old rule still hold whatever grew there, so the perimeter is swept
  // once — resource nodes and findable containers alike — in the live area and
  // in the stored Elaris snapshot.
  //
  // Only Elaris is swept, and only inside its walls: a node the player is
  // part-way through gathering outside the town is theirs, and the sweep has no
  // business anywhere else on the map.
  75: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const sweep = (area: Record<string, unknown>): Record<string, unknown> => {
      const next = { ...area };
      for (const key of ['resourceNodes', 'containers'] as const) {
        const list = next[key];
        if (!Array.isArray(list)) continue;
        next[key] = list.filter((entry) => {
          if (!isRecord(entry)) return true;
          const { x, y } = entry;
          if (typeof x !== 'number' || typeof y !== 'number') return true;
          return !isWithinTownSafeZoneWorldPosition(x, y);
        });
      }
      return next;
    };
    const swept = asRecord(state['currentArea'])['key'] === '0,0' ? sweep(state) : { ...state };
    const visited = asRecord(state['visitedAreas']);
    const elaris = visited['0,0'];
    if (isRecord(elaris)) swept['visitedAreas'] = { ...visited, '0,0': sweep(elaris) };
    return {
      ...raw,
      meta: { ...meta, saveVersion: 76, worldGenVersion: 12 },
      state: swept,
    };
  },
  // v76 -> v77: the Thatch Door joins the level-1 gate, so a starting character
  // can close the room they just built. Granted to everyone rather than only to
  // characters below the old level-3 thatch sweep: every existing save is at
  // least level 1, and adding an id already known is a no-op.
  76: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const known = Array.isArray(state['unlockedItemIds'])
      ? state['unlockedItemIds'].filter((id): id is string => typeof id === 'string')
      : [];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 77 },
      state: {
        ...state,
        unlockedItemIds: [...new Set([...known, 'thatch-door'])].sort(),
      },
    };
  },
  // v77 -> v78: blueprint finds move from a per-node percentage roll to counters
  // per source, and the counters are Admin-tunable.
  //
  // Everyone starts at zero. There is no honest way to convert the old system's
  // history into progress — a percentage keeps no record of the two hundred
  // trees that did not pay — and starting at zero is the generous reading
  // anyway: the first counter is the shortest wait these saves have ever had.
  //
  // Storm caches are transient, so nothing is added to the world here. The
  // first storm after loading scatters its own.
  77: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const balance = asRecord(state['gameBalance']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 78 },
      state: {
        ...state,
        blueprintProgress: {},
        gameBalance: {
          ...balance,
          blueprints: structuredClone(createDefaultGameBalance().blueprints),
        },
      },
    };
  },
  // v78 -> v79: the Rowboat must be found. It was grandfathered into every save
  // at v72 along with the handcraft consumables, on the reasoning that a recipe
  // in use for hours should not suddenly need discovering. The Rowboat is the
  // one of the five that opens the map rather than filling the bag, so it is
  // taken back and returned to the marsh and storm-cache pools it already sits
  // in — the crossing is a discovery, not a starting condition.
  //
  // A boat already built stays built: `rowboatOwned` is the object, not the
  // knowledge, and the recipe is refused for an owner anyway.
  78: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const known = Array.isArray(state['unlockedItemIds'])
      ? state['unlockedItemIds'].filter((id): id is string => typeof id === 'string')
      : [];
    return {
      ...raw,
      meta: { ...meta, saveVersion: 79 },
      state: {
        ...state,
        unlockedItemIds: known.filter((id) => id !== 'rowboat'),
      },
    };
  },
  // v79 -> v80: defeat no longer destroys the bag. What the Safeguard Charms do
  // not cover is stacked where the player fell, beaconed on the map, and given
  // ten minutes to be recovered.
  //
  // Loading saves start with no cache. There is nothing to reconstruct — a
  // past death deleted its items outright and left no record of what they were
  // — and inventing one would light a beacon over a patch of ground that has
  // been empty for hours.
  79: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 80 },
      state: { ...state, deathCache: null },
    };
  },
  // v80 -> v81: tools can be put down from the Bag, so the world gains a list
  // of tools lying in it. Nothing existed to convert; every save starts empty.
  80: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 81 },
      state: { ...state, toolDrops: [] },
    };
  },
  // Existing worlds never opt into new-game onboarding, even if they are still at tick zero.
  81: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const seed = typeof state['seed'] === 'number' ? state['seed'] : 0;
    const removeFixture = (value: unknown) => Array.isArray(value)
      ? value.filter((wild) => asRecord(wild)['id'] !== starterTuftleId(seed)) : value;
    return {
      ...raw, meta: { ...meta, saveVersion: 82, contentVersion: 60 },
      state: {
        ...state, onboarding: createOpeningChapter(seed, true),
        wildCreatures: removeFixture(state['wildCreatures']),
        visitedAreas: mapAreaSnapshots(state['visitedAreas'], (area) => ({ ...area, wildCreatures: removeFixture(area['wildCreatures']) })),
      },
    };
  },
  // Continue the first release's partnership into cooperative gathering; older worlds stay opted out.
  82: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const chapter = asRecord(state['onboarding']);
    return {
      ...raw, meta: { ...meta, saveVersion: 83, contentVersion: 61 },
      state: {
        ...state,
        onboarding: chapter['version'] === 1 ? {
          ...chapter, version: OPENING_CHAPTER_VERSION,
          status: chapter['status'] === 'complete' ? 'active' : chapter['status'],
        } : chapter,
      },
    };
  },
  83: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    const chapter = asRecord(state['onboarding']);
    return {
      ...raw, meta: { ...meta, saveVersion: 84, contentVersion: 62 },
      state: { ...state, onboarding: {
        ...chapter,
        version: chapter['version'] === 2 || chapter['version'] === 3 ? OPENING_CHAPTER_VERSION : chapter['version'],
        status: chapter['status'] === 'complete' && !(Array.isArray(chapter['completedMilestoneIds']) && chapter['completedMilestoneIds'].includes('build-shelter')) ? 'active' : chapter['status'],
        shelterPlan: chapter['shelterPlan'] ?? null, shelterHome: chapter['shelterHome'] ?? null,
      } },
    };
  },
  // Existing worlds retain their exact threat clock, including chapters between phases.
  84: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']); const chapter = asRecord(state['onboarding']);
    return { ...raw, meta: { ...meta, saveVersion: 85, contentVersion: 63 }, state: { ...state, onboarding: {
      ...chapter, version: OPENING_CHAPTER_VERSION,
      status: chapter['status'] === 'complete' ? 'active' : chapter['status'],
      firstThreat: chapter['status'] === 'legacy' ? null : createOpeningThreat('ordinary'),
    } } };
  },
  85: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']); const chapter = asRecord(state['onboarding']);
    return { ...raw, meta: { ...meta, saveVersion: 86, contentVersion: 64 }, state: { ...state, onboarding: {
      ...chapter, version: OPENING_CHAPTER_VERSION, status: chapter['status'] === 'complete' ? 'active' : chapter['status'],
      production: chapter['status'] === 'legacy' ? null : createOpeningProduction(),
    } } };
  },
  86: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']); const chapter = asRecord(state['onboarding']);
    return { ...raw, meta: { ...meta, saveVersion: 87, contentVersion: 65 }, state: { ...state, onboarding: {
      ...chapter, version: OPENING_CHAPTER_VERSION, status: chapter['status'] === 'complete' ? 'active' : chapter['status'],
      supplyRun: chapter['status'] === 'legacy' ? null : createOpeningSupplyRun(),
    } } };
  },
  87: (raw) => {
    const meta = asRecord(raw['meta']); const state = asRecord(raw['state']); const chapter = asRecord(state['onboarding']);
    return { ...raw, meta: { ...meta, saveVersion: 88, contentVersion: 66 }, state: { ...state, onboarding: {
      ...chapter, version: OPENING_CHAPTER_VERSION, status: chapter['status'] === 'complete' ? 'active' : chapter['status'],
      garden: chapter['status'] === 'legacy' ? null : createOpeningGarden(),
    } } };
  },
  // Road masks now own crossings and scenery clearance. Saved entities and
  // property are retained; the normal load/area reconciliation clears scenery.
  88: (raw) => ({ ...raw, meta: { ...asRecord(raw['meta']), saveVersion: 89, contentVersion: 67, worldGenVersion: 13 } }),
};

/**
 * The recipes that had no blueprint id before v72. Grandfathered wholesale
 * rather than replayed through the gates: a level-3 character had Arrows and
 * the Snare under the old rules, and taking them back would be a regression
 * dressed up as a migration. The Rowboat was grandfathered here too and is
 * taken back again at v79 — this list is history and stays as it was.
 */
const PREVIOUSLY_ALWAYS_KNOWN: readonly string[] = CONSUMABLE_BLUEPRINT_IDS;

/**
 * Apply a change to every stored area snapshot.
 *
 * Handles both shapes deliberately: `visitedAreas` is a record keyed by area
 * today, but old saves carried an array, and a migration that only understood
 * one of them would silently skip half the world.
 */
function mapAreaSnapshots(
  value: unknown,
  change: (area: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  if (Array.isArray(value)) return value.map((area) => change(asRecord(area)));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, area]) => [key, change(asRecord(area))]),
  );
}

/** Stamp level 1 on every stored entity that predates levelling. */
function withDefaultLevel(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    const record = asRecord(entry);
    return typeof record['level'] === 'number' ? record : { ...record, level: 1 };
  });
}

const NEW_V61_CREATURE_BALANCE_FIELDS = [
  'speedPxPerTick', 'attackRangePx', 'attackIntervalTicks', 'aggroRangePx', 'leashPx', 'preferredRangePx',
] as const;

/** Give every stored creature world health and a leash anchor where it stands. */
function migrateWildCreatures(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    const creature = asRecord(entry);
    const speciesId = creature['speciesId'];
    const maxHp = isSpeciesId(speciesId) ? creatureDefinition(speciesId).encounter.maxHp : 1;
    const x = typeof creature['x'] === 'number' ? Math.round(creature['x']) : 0;
    const y = typeof creature['y'] === 'number' ? Math.round(creature['y']) : 0;
    return {
      ...creature,
      x,
      y,
      hp: maxHp,
      maxHp,
      homeX: x,
      homeY: y,
      aggroUntilTick: 0,
      nextAttackTick: 0,
      fleeUntilTick: 0,
      captureBonusBps: 0,
    };
  });
}

const NEW_V58_BAG_ITEMS = [
  'reinforced-snare', 'tuftle-down', 'craghopper-shell', 'stag-antler', 'snarlfox-pelt',
] as const;

/** Rebuild one area's containers from the descriptor fields a save already holds. */
function containersForRawArea(area: Record<string, unknown>, worldSeed: number): unknown[] {
  const key = typeof area['key'] === 'string' ? area['key'] : '0,0';
  const seed = typeof area['seed'] === 'number' ? area['seed'] : worldSeed;
  const x = typeof area['x'] === 'number' ? area['x'] : 0;
  const y = typeof area['y'] === 'number' ? area['y'] : 0;
  const theme = typeof area['theme'] === 'string' ? area['theme'] as AreaThemeId : 'elaris';
  return generateAreaContainers(
    seed, key, townBuildingsInArea(key).length > 0, { x, y, theme }, worldSeed, key,
  );
}

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
/** Ids validated field-by-field; kept beside the validator they gate. */
const GATHERABLE_RESOURCE_IDS = ['wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot'] as const;
const CRAFTED_SUPPLY_IDS = [
  'taming-snare', 'reinforced-snare', 'berry', 'arrow', 'cloth-mask', 'safeguard-charm',
] as const;
const CREATURE_TROPHY_IDS = [
  'tuftle-down', 'craghopper-shell', 'stag-antler', 'snarlfox-pelt',
  'masonmole-claw', 'boar-tusk', 'quillfinch-quill', 'mistmoth-scale', 'slingtail-stone',
] as const;
const BAG_ITEM_ID_SET: ReadonlySet<string> = new Set<string>([
  ...GATHERABLE_RESOURCE_IDS, ...CRAFTED_SUPPLY_IDS, ...CREATURE_TROPHY_IDS,
]);
const WORLD_CONTAINER_KINDS: ReadonlySet<string> = new Set([
  'hollow-log', 'supply-cache', 'collapsed-cellar',
  // Transient: only ever present in a save written mid-storm.
  'storm-cache',
]);
const TOOL_DEFINITION_IDS = new Set([
  'wooden-axe', 'wooden-pick', 'wooden-sickle',
  'stone-axe', 'stone-pick', 'stone-sickle',
  'iron-axe', 'iron-pick', 'iron-sickle',
  'wooden-sword', 'stone-sword', 'iron-sword',
  'bow', 'magic-staff',
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
  validateOpeningChapter(state);
  if (state['dangerExposureStartedAtTick'] !== null) {
    requireNonNegativeInteger(state, 'dangerExposureStartedAtTick');
    if ((state['dangerExposureStartedAtTick'] as number) > (state['tick'] as number)) {
      throw new SaveValidationError('danger exposure starts after current tick');
    }
  }
  const pendingRespawn = state['pendingRespawn'];
  if (pendingRespawn !== null) {
    if (!isRecord(pendingRespawn)) throw new SaveValidationError('invalid pendingRespawn');
    if (!['exposure', 'raider', 'creature', 'arcane-storm'].includes(String(pendingRespawn['cause']))) {
      throw new SaveValidationError('invalid pending respawn cause');
    }
    requireNonNegativeInteger(pendingRespawn, 'lostItemCount');
    requireString(pendingRespawn, 'defeatedAreaKey');
    requireString(pendingRespawn, 'defeatedAreaName');
    requireNumber(pendingRespawn, 'defeatedAreaX');
    requireNumber(pendingRespawn, 'defeatedAreaY');
    requireNumber(pendingRespawn, 'defeatedX');
    requireNumber(pendingRespawn, 'defeatedY');
    requireNonNegativeInteger(pendingRespawn, 'defeatedAtTick');
  }
  if (state['respawnProtectionUntilTick'] !== null) {
    requireNonNegativeInteger(state, 'respawnProtectionUntilTick');
  }
  validateDeathCache(state['deathCache']);

  const currentArea = state['currentArea'];
  if (!isRecord(currentArea)) throw new SaveValidationError('missing currentArea');
  validateAreaDescriptor(currentArea, 'currentArea');
  const visitedAreas = state['visitedAreas'];
  if (!isRecord(visitedAreas)) throw new SaveValidationError('missing visitedAreas');
  for (const [key, rawArea] of Object.entries(visitedAreas)) {
    if (!isRecord(rawArea) || rawArea['key'] !== key) throw new SaveValidationError('invalid visited area');
    validateAreaDescriptor(rawArea, 'visited area');
    if (!Array.isArray(rawArea['resourceNodes']) || !Array.isArray(rawArea['wildCreatures'])
      || !Array.isArray(rawArea['groundDrops']) || !Array.isArray(rawArea['buildings'])
      || !Array.isArray(rawArea['raiders']) || !Array.isArray(rawArea['containers'])) {
      throw new SaveValidationError('invalid visited area entities');
    }
    for (const container of rawArea['containers']) validateWorldContainer(container);
  }

  const player = state['player'];
  if (!isRecord(player)) throw new SaveValidationError('missing player');
  requireNumber(player, 'x');
  requireNumber(player, 'y');
  if (typeof player['facing'] !== 'string' || !FACINGS.has(player['facing'])) {
    throw new SaveValidationError('invalid player.facing');
  }
  if (player['traversalMode'] !== 'foot' && player['traversalMode'] !== 'boat') {
    throw new SaveValidationError('invalid player.traversalMode');
  }
  if (typeof state['rowboatOwned'] !== 'boolean') throw new SaveValidationError('invalid rowboatOwned');
  if (state['clothMaskActiveUntilTick'] !== null) requirePositiveInteger(state, 'clothMaskActiveUntilTick');
  if (player['traversalMode'] === 'boat' && state['rowboatOwned'] !== true) {
    throw new SaveValidationError('boat traversal requires rowboat ownership');
  }
  requirePositiveInteger(player, 'maxHp'); requireNonNegativeInteger(player, 'hp');
  if ((player['hp'] as number) > (player['maxHp'] as number)) throw new SaveValidationError('player hp exceeds maxHp');
  if (pendingRespawn !== null && player['hp'] !== 0) {
    throw new SaveValidationError('pending respawn requires 0 HP');
  }
  requirePositiveInteger(player, 'maxStamina'); requireNonNegativeInteger(player, 'stamina');
  if ((player['stamina'] as number) > (player['maxStamina'] as number)) throw new SaveValidationError('player stamina exceeds maxStamina');
  requirePositiveInteger(player, 'maxMana'); requireNonNegativeInteger(player, 'mana');
  if ((player['mana'] as number) > (player['maxMana'] as number)) throw new SaveValidationError('player mana exceeds maxMana');
  requirePositiveInteger(player, 'level'); requireNonNegativeInteger(player, 'xp'); requireNonNegativeInteger(player, 'attributePoints');
  const attributes = player['attributes'];
  if (!isRecord(attributes)) throw new SaveValidationError('missing player attributes');
  for (const attribute of ATTRIBUTE_IDS) {
    requireNonNegativeInteger(attributes, attribute);
  }

  validateGameBalance(state['gameBalance']);

  const inventory = state['inventory'];
  if (!isRecord(inventory)) throw new SaveValidationError('missing inventory');
  requireNonNegativeInteger(inventory, 'wood');
  requireNonNegativeInteger(inventory, 'stone');
  requireNonNegativeInteger(inventory, 'fiber');
  requireNonNegativeInteger(inventory, 'iron-ore');
  requireNonNegativeInteger(inventory, 'iron-ingot');
  for (const item of CRAFTED_SUPPLY_IDS) requireNonNegativeInteger(inventory, item);
  const inventoryStacks = state['inventoryStacks'];
  if (!isRecord(inventoryStacks)) throw new SaveValidationError('missing inventoryStacks');
  for (const resource of [...GATHERABLE_RESOURCE_IDS, ...CRAFTED_SUPPLY_IDS]) {
    const stacks = inventoryStacks[resource];
    if (!Array.isArray(stacks) || stacks.some((amount) => !Number.isInteger(amount) || amount <= 0 || amount > RESOURCE_STACK_SIZE)) {
      throw new SaveValidationError('invalid inventory stack');
    }
  }
  requireNonNegativeInteger(state, 'coins');
  requireNonNegativeInteger(state, 'packRanks');
  requireNonNegativeInteger(state, 'arcaneStudyPurchases');
  requireNonNegativeInteger(state, 'expeditionsDispatched');
  const expeditions = state['expeditions'];
  if (!Array.isArray(expeditions)) throw new SaveValidationError('missing expeditions');
  for (const expedition of expeditions) {
    if (!isRecord(expedition) || typeof expedition['id'] !== 'string') {
      throw new SaveValidationError('invalid expedition id');
    }
    if (!isExpeditionRouteId(expedition['routeId'])) throw new SaveValidationError('invalid expedition route');
    requireString(expedition, 'creatureId');
    requireNonNegativeInteger(expedition, 'remainingMs');
    requireNonNegativeInteger(expedition, 'rollIndex');
  }
  const unlockedItemIds = state['unlockedItemIds'];
  if (!Array.isArray(unlockedItemIds) || unlockedItemIds.some((id) => typeof id !== 'string' || !isBlueprintItemId(id)) || new Set(unlockedItemIds).size !== unlockedItemIds.length) {
    throw new SaveValidationError('invalid unlockedItemIds');
  }
  const carried = state['carriedBlueprints'];
  if (!Array.isArray(carried) || carried.some((entry) => {
    if (!isRecord(entry)) return true;
    return typeof entry['instanceId'] !== 'string' || typeof entry['blueprintId'] !== 'string'
      || !isBlueprintItemId(entry['blueprintId']);
  })) {
    throw new SaveValidationError('invalid carriedBlueprints');
  }
  const carriedIds = carried.map((entry) => (entry as Record<string, unknown>)['instanceId']);
  if (new Set(carriedIds).size !== carriedIds.length) {
    throw new SaveValidationError('duplicate carriedBlueprints instance id');
  }
  const blueprintDrops = state['blueprintDrops'];
  if (!Array.isArray(blueprintDrops) || blueprintDrops.some((entry) => {
    if (!isRecord(entry)) return true;
    return typeof entry['id'] !== 'string'
      || typeof entry['blueprintId'] !== 'string' || !isBlueprintItemId(entry['blueprintId'])
      || !Number.isInteger(entry['x']) || !Number.isInteger(entry['y'])
      || !Number.isInteger(entry['expiresAtTick']);
  })) {
    throw new SaveValidationError('invalid blueprintDrops');
  }
  // Counters are sparse by design, so an absent key is a source never worked
  // rather than a corrupt save. What must hold is that every entry present is
  // two whole non-negative numbers: a fractional `struck` would fail the
  // determinism canonicaliser long after the save that introduced it.
  const blueprintProgress = state['blueprintProgress'];
  if (!isRecord(blueprintProgress) || Object.values(blueprintProgress).some((entry) => {
    if (!isRecord(entry)) return true;
    return !Number.isSafeInteger(entry['struck']) || (entry['struck'] as number) < 0
      || !Number.isSafeInteger(entry['cycle']) || (entry['cycle'] as number) < 0;
  })) {
    throw new SaveValidationError('invalid blueprintProgress');
  }
  const pendingGrants = state['pendingBlueprintGrantIds'];
  if (!Array.isArray(pendingGrants)
    || pendingGrants.some((id) => typeof id !== 'string' || !isBlueprintItemId(id))
    || new Set(pendingGrants).size !== pendingGrants.length
    // A blueprint cannot be both waiting to be collected and already known.
    || pendingGrants.some((id) => unlockedItemIds.includes(id))) {
    throw new SaveValidationError('invalid pendingBlueprintGrantIds');
  }
  requireNonNegativeInteger(state, 'resourcesSold');
  const firstTamedSpeciesIds = state['firstTamedSpeciesIds'];
  if (!Array.isArray(firstTamedSpeciesIds) || firstTamedSpeciesIds.some((id) => !isSpeciesId(id)) || new Set(firstTamedSpeciesIds).size !== firstTamedSpeciesIds.length) {
    throw new SaveValidationError('invalid firstTamedSpeciesIds');
  }
  const resourcesCollected = state['resourcesCollected'];
  if (!isRecord(resourcesCollected)) throw new SaveValidationError('missing resourcesCollected');
  requireNonNegativeInteger(resourcesCollected, 'wood');
  requireNonNegativeInteger(resourcesCollected, 'stone');
  requireNonNegativeInteger(resourcesCollected, 'fiber');
  requireNonNegativeInteger(resourcesCollected, 'iron-ore');
  requireNonNegativeInteger(resourcesCollected, 'iron-ingot');
  const yieldRemainder = state['yieldRemainderByResource'];
  if (!isRecord(yieldRemainder)) throw new SaveValidationError('missing yieldRemainderByResource');
  for (const resource of ['wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot']) {
    requireNonNegativeInteger(yieldRemainder, resource);
    if ((yieldRemainder[resource] as number) >= 10_000) throw new SaveValidationError('invalid yield remainder');
  }
  requireNonNegativeInteger(state, 'repairsMade');
  validateQuestIds(state, 'completedQuestIds');
  validateQuestIds(state, 'claimedQuestRewardIds');
  validateNpcMemory(state['npcMemory']);
  validateQuestProgress(state['questProgress']);
  validateRegionalProgress(state['regionalProgress']);
  requireNonNegativeInteger(state, 'workerResourcesProduced');

  const groundDrops = state['groundDrops'];
  if (!Array.isArray(groundDrops)) throw new SaveValidationError('missing groundDrops');
  const entityIds = new Set<string>();
  for (const drop of groundDrops) {
    if (!isRecord(drop) || typeof drop['id'] !== 'string' || !entityIds.add(drop['id'])) {
      throw new SaveValidationError('invalid ground drop id');
    }
    if (!BAG_ITEM_ID_SET.has(String(drop['resource']))) {
      throw new SaveValidationError('invalid ground drop resource');
    }
    requirePositiveInteger(drop, 'amount');
    requireNumber(drop, 'x');
    requireNumber(drop, 'y');
    if (drop['expiresAtTick'] !== null) requireNonNegativeInteger(drop, 'expiresAtTick');
  }

  const containers = state['containers'];
  if (!Array.isArray(containers)) throw new SaveValidationError('missing containers');
  for (const container of containers) {
    validateWorldContainer(container);
    if (!entityIds.add((container as Record<string, unknown>)['id'] as string)) {
      throw new SaveValidationError('invalid container id');
    }
  }

  const buildings = state['buildings'];
  if (!Array.isArray(buildings)) throw new SaveValidationError('missing buildings');
  const buildingDefinitionIds = BUILDING_DEFINITION_IDS;
  for (const building of buildings) {
    if (!isRecord(building) || typeof building['id'] !== 'string' || !entityIds.add(building['id'])) {
      throw new SaveValidationError('invalid building id');
    }
    if (typeof building['definitionId'] !== 'string' || !buildingDefinitionIds.has(building['definitionId'])) {
      throw new SaveValidationError('invalid building definition');
    }
    requireNonNegativeInteger(building, 'tileX');
    requireNonNegativeInteger(building, 'tileY');
    if (building['rotated'] !== undefined && typeof building['rotated'] !== 'boolean') {
      throw new SaveValidationError('invalid building rotation');
    }
    const definition = buildableById(building['definitionId'] as Parameters<typeof buildableById>[0]);
    if (definition.layer === 'boundary' && !['north', 'east', 'south', 'west'].includes(building['boundaryEdge'] as string)) {
      throw new SaveValidationError('invalid building boundary edge');
    }
    if (definition.footprintKind === 'marker' && !['indoor', 'paddock', 'workYard'].includes(building['environmentKind'] as string)) {
      throw new SaveValidationError('invalid marker environment kind');
    }
    if (building['storage'] !== undefined) {
      const storage = building['storage'];
      if (!isRecord(storage)) throw new SaveValidationError('invalid building storage');
      requireNonNegativeInteger(storage, 'wood');
      requireNonNegativeInteger(storage, 'stone');
      requireNonNegativeInteger(storage, 'fiber');
      requireNonNegativeInteger(storage, 'iron-ore');
      requireNonNegativeInteger(storage, 'iron-ingot');
      const storageStacks = building['storageStacks'];
      const storedTools = building['storedTools'];
      if (!isRecord(storageStacks) || !Array.isArray(storedTools)) throw new SaveValidationError('invalid storage box slots');
      let usedStorageSlots = storedTools.length;
      for (const resource of ['wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot', 'taming-snare', 'berry', 'arrow', 'cloth-mask']) {
        requireNonNegativeInteger(storage, resource);
        const stacks = storageStacks[resource];
        if (!Array.isArray(stacks) || stacks.some((amount) => !Number.isInteger(amount) || amount <= 0 || amount > RESOURCE_STACK_SIZE)) {
          throw new SaveValidationError('invalid storage box stack');
        }
        if (stacks.reduce((sum, amount) => sum + (amount as number), 0) !== storage[resource]) {
          throw new SaveValidationError('storage box stack total mismatch');
        }
        usedStorageSlots += stacks.length;
      }
      const capacity = building['definitionId'] === 'warehouse' ? WAREHOUSE_SLOTS : STORAGE_BOX_SLOTS;
      if (usedStorageSlots > capacity) throw new SaveValidationError('storage container exceeds capacity');
      for (const tool of storedTools) {
        if (!isRecord(tool) || typeof tool['instanceId'] !== 'string' || !entityIds.add(tool['instanceId'])
          || typeof tool['definitionId'] !== 'string' || !TOOL_DEFINITION_IDS.has(tool['definitionId'])) {
          throw new SaveValidationError('invalid stored tool identity');
        }
        requireNonNegativeInteger(tool, 'durability'); requireNonNegativeInteger(tool, 'maxDurability');
        requireNonNegativeInteger(tool, 'powerRank'); requireNonNegativeInteger(tool, 'speedRank'); requireNonNegativeInteger(tool, 'durabilityRank');
        if ((tool['durability'] as number) > (tool['maxDurability'] as number)) throw new SaveValidationError('stored tool durability exceeds maxDurability');
      }
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
    if (building['furnace'] !== undefined) {
      const furnace = building['furnace'];
      if (!isRecord(furnace) || building['definitionId'] !== 'furnace' || !Array.isArray(furnace['queue'])) {
        throw new SaveValidationError('invalid building furnace state');
      }
      if (furnace['queue'].length > 4) throw new SaveValidationError('furnace queue exceeds capacity');
      for (const rawItem of furnace['queue']) {
        const item = asRecord(rawItem); const inputs = asRecord(item['reservedInputs']);
        if (item['recipe'] !== 'iron-ingot' || typeof item['blocked'] !== 'boolean') throw new SaveValidationError('invalid furnace queue item');
        requireNonNegativeInteger(item, 'remainingWorkMs'); requireNonNegativeInteger(item, 'completedOutput');
        if ((item['completedOutput'] as number) > 1) throw new SaveValidationError('invalid furnace completed output');
        requireNonNegativeInteger(inputs, 'iron-ore'); requireNonNegativeInteger(inputs, 'wood');
      }
    }
    if (building['housing'] !== undefined) {
      const housing = building['housing'];
      if (!isRecord(housing) || (building['definitionId'] !== 'small-pen' && building['definitionId'] !== 'barn')) {
        throw new SaveValidationError('invalid worker housing state');
      }
      const bin = asRecord(housing['bin']);
      requireNonNegativeInteger(bin, 'fiber');
      requireNonNegativeInteger(bin, 'berry');
      const capacity = building['definitionId'] === 'small-pen' ? 12 : 36;
      if ((bin['fiber'] as number) + (bin['berry'] as number) > capacity) {
        throw new SaveValidationError('worker housing bin exceeds capacity');
      }
    }
    if (building['producer'] !== undefined) {
      const producer = building['producer'];
      if (!isRecord(producer) || building['definitionId'] !== 'stone-yard') {
        throw new SaveValidationError('invalid worker producer state');
      }
      const bin = asRecord(producer['bin']);
      requireNonNegativeInteger(bin, 'stone');
      if ((bin['stone'] as number) > 18) throw new SaveValidationError('worker producer bin exceeds capacity');
    }
    if (building['cartDock'] !== undefined) {
      const cartDock = building['cartDock'];
      if (!isRecord(cartDock) || building['definitionId'] !== 'cart-dock') {
        throw new SaveValidationError('invalid cart dock state');
      }
      if (cartDock['linkedStorageId'] !== null && typeof cartDock['linkedStorageId'] !== 'string') {
        throw new SaveValidationError('invalid cart dock storage link');
      }
      if (typeof cartDock['playerInside'] !== 'boolean') throw new SaveValidationError('invalid cart dock entry state');
      if (cartDock['lastTransferMessage'] !== null && typeof cartDock['lastTransferMessage'] !== 'string') {
        throw new SaveValidationError('invalid cart dock transfer message');
      }
    }
    if (building['logistics'] !== undefined) {
      const logistics = building['logistics'];
      if (!isRecord(logistics) || building['definitionId'] !== 'logistics-hub' || !Array.isArray(logistics['routes'])) {
        throw new SaveValidationError('invalid logistics hub state');
      }
      if (logistics['lastRoutingMessage'] !== null && typeof logistics['lastRoutingMessage'] !== 'string') {
        throw new SaveValidationError('invalid logistics message');
      }
      const sourceIds = new Set<string>();
      for (const value of logistics['routes']) {
        if (!isRecord(value) || typeof value['sourceWorkerId'] !== 'string' || sourceIds.has(value['sourceWorkerId'])
          || !Array.isArray(value['destinationContainerIds'])
          || value['destinationContainerIds'].length === 0
          || value['destinationContainerIds'].some((id) => typeof id !== 'string')
          || new Set(value['destinationContainerIds']).size !== value['destinationContainerIds'].length) {
          throw new SaveValidationError('invalid logistics route');
        }
        sourceIds.add(value['sourceWorkerId']);
      }
    }
  }

  requireNonNegativeInteger(state, 'highestAreaTierEver');
  if (!AREA_TIER_VALUES.has(state['highestAreaTierEver'] as number)) {
    throw new SaveValidationError('invalid highestAreaTierEver');
  }
  requireNonNegativeInteger(state, 'highestRatingEverTenths');

  const nodes = state['resourceNodes'];
  if (!Array.isArray(nodes)) throw new SaveValidationError('missing resourceNodes');
  for (const node of nodes) {
    if (!isRecord(node)) throw new SaveValidationError('invalid resource node');
    if (typeof node['id'] !== 'string') throw new SaveValidationError('invalid resource node id');
    if (node['kind'] !== 'tree' && node['kind'] !== 'stone' && node['kind'] !== 'metal' && node['kind'] !== 'plant' && node['kind'] !== 'berry-bush') {
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
    requirePositiveInteger(creature, 'level');
    for (const field of [
      'hp', 'maxHp', 'homeX', 'homeY',
      'aggroUntilTick', 'nextAttackTick', 'fleeUntilTick', 'captureBonusBps',
    ]) requireNonNegativeInteger(creature, field);
    if ((creature['hp'] as number) > (creature['maxHp'] as number)) {
      throw new SaveValidationError('creature hp exceeds maxHp');
    }
  }
  const raiders = state['raiders'];
  if (!Array.isArray(raiders)) throw new SaveValidationError('missing raiders');
  for (const raider of raiders) {
    if (!isRecord(raider) || typeof raider['id'] !== 'string' || !entityIds.add(raider['id']) || !isRaiderKindId(raider['kindId'])) {
      throw new SaveValidationError('invalid raider');
    }
    // Integer positions are a hard requirement, not a nicety: a fractional
    // coordinate would make canonicalizeGameState throw on the next save.
    requireNonNegativeInteger(raider, 'x'); requireNonNegativeInteger(raider, 'y');
    requirePositiveInteger(raider, 'hp'); requirePositiveInteger(raider, 'maxHp');
    requirePositiveInteger(raider, 'level');
    requireNonNegativeInteger(raider, 'nextAttackTick');
    if ((raider['hp'] as number) > (raider['maxHp'] as number)) throw new SaveValidationError('raider hp exceeds maxHp');
    if (raider['targetBuildingId'] !== null && typeof raider['targetBuildingId'] !== 'string') {
      throw new SaveValidationError('invalid raider target');
    }
  }
  validateArcaneStorm(state, entityIds);
  if (state['raidCycleIndex'] !== null) requireNonNegativeInteger(state, 'raidCycleIndex');
  if (!Array.isArray(state['raidSettledAreaKeys']) || state['raidSettledAreaKeys'].some((key) => typeof key !== 'string')) {
    throw new SaveValidationError('invalid raidSettledAreaKeys');
  }

  const encounter = state['activeEncounter'];
  if (encounter !== null) {
    if (!isRecord(encounter) || typeof encounter['wildCreatureId'] !== 'string' || typeof encounter['message'] !== 'string') throw new SaveValidationError('invalid active encounter');
    requireNonNegativeInteger(encounter, 'creatureHp'); requirePositiveInteger(encounter, 'creatureMaxHp'); requirePositiveInteger(encounter, 'round');
    requireNonNegativeInteger(encounter, 'playerPos'); requireNonNegativeInteger(encounter, 'creaturePos');
    if ((encounter['playerPos'] as number) > 100 || (encounter['creaturePos'] as number) > 100 || (encounter['playerPos'] as number) > (encounter['creaturePos'] as number)) {
      throw new SaveValidationError('invalid encounter positions');
    }
    if ((encounter['creatureHp'] as number) > (encounter['creatureMaxHp'] as number)) throw new SaveValidationError('encounter hp exceeds maxHp');
    if (!wildCreatures.some((item) => isRecord(item) && item['id'] === encounter['wildCreatureId'])) throw new SaveValidationError('encounter creature does not exist');
    if (encounter['companionCreatureId'] !== null && typeof encounter['companionCreatureId'] !== 'string') throw new SaveValidationError('invalid encounter companion');
    if (encounter['selectedCompanionAbilityId'] !== null && !isCompanionAbilityId(encounter['selectedCompanionAbilityId'])) throw new SaveValidationError('invalid selected encounter ability');
    if (encounter['enemyIntent'] !== 'advance' && encounter['enemyIntent'] !== 'strike' && encounter['enemyIntent'] !== 'advance-strike'
      && encounter['enemyIntent'] !== 'retreat-strike' && encounter['enemyIntent'] !== 'watch') throw new SaveValidationError('invalid enemy intent');
    const cooldowns = encounter['companionAbilityReadyRounds'];
    if (!isRecord(cooldowns)) throw new SaveValidationError('invalid companion cooldowns');
    for (const [abilityId, readyRound] of Object.entries(cooldowns)) {
      if (!isCompanionAbilityId(abilityId) || !Number.isSafeInteger(readyRound) || (readyRound as number) < 0) throw new SaveValidationError('invalid companion cooldown');
    }
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
    if (creature['workRemainderMs'] !== undefined) requireNonNegativeInteger(creature, 'workRemainderMs');
    if (creature['housingId'] !== undefined && creature['housingId'] !== null && typeof creature['housingId'] !== 'string') {
      throw new SaveValidationError('invalid creature housing');
    }
    requireNonNegativeInteger(creature, 'bondXp');
    if (!isCompanionAbilityId(creature['selectedBattleAbilityId'])
      || !companionAbility(creature['speciesId'], creature['selectedBattleAbilityId'])) {
      throw new SaveValidationError('invalid owned creature battle ability');
    }
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
  if (state['battleCompanionId'] !== null && typeof state['battleCompanionId'] !== 'string') throw new SaveValidationError('invalid battle companion');
  if (typeof state['battleCompanionId'] === 'string' && !ownedCreatures.some((item) => isRecord(item)
    && item['id'] === state['battleCompanionId'] && item['role'] === 'follow')) throw new SaveValidationError('battle companion must be a follower');
  if (encounter !== null) {
    const current = asRecord(encounter);
    const companionId = current['companionCreatureId'];
    const selectedAbilityId = current['selectedCompanionAbilityId'];
    const companion = typeof companionId === 'string'
      ? ownedCreatures.find((item) => isRecord(item) && item['id'] === companionId)
      : undefined;
    if (typeof companionId === 'string' && !companion) throw new SaveValidationError('encounter companion does not exist');
    if (selectedAbilityId !== null) {
      if (!companion || !isRecord(companion) || !isSpeciesId(companion['speciesId']) || !isCompanionAbilityId(selectedAbilityId)
        || !companionAbility(companion['speciesId'], selectedAbilityId)) throw new SaveValidationError('encounter ability does not belong to companion');
    }
  }

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
    requireNonNegativeInteger(tool, 'powerRank');
    requireNonNegativeInteger(tool, 'speedRank');
    requireNonNegativeInteger(tool, 'durabilityRank');
    if ((tool['powerRank'] as number) > 2 || (tool['speedRank'] as number) > 2 || (tool['durabilityRank'] as number) > 2) {
      throw new SaveValidationError('tool upgrade rank exceeds world Weaponsmith limit');
    }
    if ((tool['durability'] as number) > (tool['maxDurability'] as number)) {
      throw new SaveValidationError('tool durability exceeds maxDurability');
    }
  }

  // Tools put down in the world are whole instances, so they answer to the same
  // identity and wear rules as the ones in the bag — and share the entity-id
  // space, because picking one back up returns that exact instance.
  const toolDrops = state['toolDrops'];
  if (!Array.isArray(toolDrops)) throw new SaveValidationError('missing toolDrops');
  for (const drop of toolDrops) {
    if (!isRecord(drop) || typeof drop['id'] !== 'string' || !entityIds.add(drop['id'])) {
      throw new SaveValidationError('invalid toolDrop id');
    }
    if (!Number.isInteger(drop['x']) || !Number.isInteger(drop['y'])
      || !Number.isInteger(drop['expiresAtTick'])) {
      throw new SaveValidationError('invalid toolDrop placement');
    }
    const tool = drop['tool'];
    if (!isRecord(tool) || typeof tool['instanceId'] !== 'string' || !entityIds.add(tool['instanceId'])
      || typeof tool['definitionId'] !== 'string' || !TOOL_DEFINITION_IDS.has(tool['definitionId'])) {
      throw new SaveValidationError('invalid toolDrop tool identity');
    }
    requireNonNegativeInteger(tool, 'durability');
    requireNonNegativeInteger(tool, 'maxDurability');
    requireNonNegativeInteger(tool, 'powerRank');
    requireNonNegativeInteger(tool, 'speedRank');
    requireNonNegativeInteger(tool, 'durabilityRank');
    if ((tool['durability'] as number) > (tool['maxDurability'] as number)) {
      throw new SaveValidationError('toolDrop durability exceeds maxDurability');
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

function canonicalizeAuthoredArea(value: unknown): Record<string, unknown> {
  const area = asRecord(value);
  const x = area['x'];
  const y = area['y'];
  if (typeof x !== 'number' || typeof y !== 'number') return area;
  const authored = authoredWorldAreaAt(x, y);
  return authored
    ? { ...area, key: authored.key, x: authored.x, y: authored.y, name: authored.name, theme: authored.theme }
    : area;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

const AREA_THEMES = new Set(['elaris', 'forest', 'mountain', 'meadow', 'thicket', 'marsh']);

function validateAreaDescriptor(area: Record<string, unknown>, label: string): void {
  if (typeof area['key'] !== 'string' || typeof area['name'] !== 'string' || !AREA_THEMES.has(String(area['theme']))) {
    throw new SaveValidationError(`invalid ${label} identity`);
  }
  requireNumber(area, 'x'); requireNumber(area, 'y'); requireNumber(area, 'seed');
  if (!Number.isInteger(area['x']) || !Number.isInteger(area['y'])) throw new SaveValidationError(`invalid ${label} coordinates`);
  const clearings = area['landClearingTiles'];
  if (clearings !== undefined && (!Array.isArray(clearings) || clearings.some((tile) => typeof tile !== 'string' || !/^\d{1,3},\d{1,3}$/.test(tile)))) {
    throw new SaveValidationError(`invalid ${label} landscape clearings`);
  }
}

function validateGameBalance(raw: unknown): void {
  const balance = asRecord(raw);
  const characterDefaults = asRecord(balance['characterDefaults']);
  const levelUp = asRecord(balance['levelUp']);
  const hands = asRecord(balance['hands']);
  const handDamage = asRecord(hands['damageByTarget']);
  const objects = asRecord(balance['objects']);
  const tools = asRecord(balance['tools']);
  const bagWeight = asRecord(balance['bagWeight']);
  const itemWeights = asRecord(bagWeight['itemHundredths']);
  requirePositiveInteger(characterDefaults, 'startingHp');
  requirePositiveInteger(characterDefaults, 'startingStamina');
  requirePositiveInteger(characterDefaults, 'startingMana');
  requireNonNegativeInteger(characterDefaults, 'startingAttributePoints');
  requireNonNegativeInteger(characterDefaults, 'hpRegenBaseHundredths');
  requireNonNegativeInteger(characterDefaults, 'staminaRegenBaseHundredths');
  requireNonNegativeInteger(characterDefaults, 'manaRegenBaseHundredths');
  requirePositiveInteger(characterDefaults, 'walkSpeed');
  requirePositiveInteger(characterDefaults, 'sprintSpeedTenths');
  requireNonNegativeInteger(characterDefaults, 'sprintStaminaPerSecond');
  const attributeGains = asRecord(balance['attributeGains']);
  for (const field of ATTRIBUTE_GAIN_FIELDS) requireNonNegativeInteger(attributeGains, field.key);
  requireNonNegativeInteger(levelUp, 'attributePointsPerStat');
  requireNonNegativeInteger(levelUp, 'spendableAttributePoints');
  requireNonNegativeInteger(levelUp, 'coins');
  requirePositiveInteger(bagWeight, 'capacityHundredths');
  for (const item of ['taming-snare', 'berry', 'arrow', 'cloth-mask', 'wood', 'stone', 'fiber', 'iron-ingot', 'iron-ore']) {
    requireNonNegativeInteger(itemWeights, item);
  }
  requirePositiveInteger(hands, 'actionTicks');
  requirePositiveInteger(hands, 'rangePx');
  // Hand damage spans every strike target; only resource nodes carry an
  // `objects` entry, so the two are validated over different key sets.
  for (const target of STRIKE_TARGETS) requireNonNegativeInteger(handDamage, target);
  for (const kind of RESOURCE_NODE_KINDS) {
    const object = asRecord(objects[kind]);
    requirePositiveInteger(object, 'maxHp');
    requireNonNegativeInteger(object, 'yieldMin');
    requireNonNegativeInteger(object, 'yieldMax');
    if ((object['yieldMin'] as number) > (object['yieldMax'] as number)) throw new SaveValidationError(`invalid yield range for ${kind}`);
    requireNonNegativeInteger(object, 'yieldAmount');
    if (!['wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot'].includes(String(object['resource']))) {
      throw new SaveValidationError(`invalid resource drop for ${kind}`);
    }
    requireNonNegativeInteger(object, 'respawnTicks');
    requirePositiveInteger(object, 'hardness');
    requireNonNegativeInteger(object, 'minimumToolTier');
    if ((object['minimumToolTier'] as number) > 3) throw new SaveValidationError(`invalid minimum tool tier for ${kind}`);
    requireNonNegativeInteger(object, 'berryYield');
  }
  const raid = asRecord(balance['raid']);
  const raiders = asRecord(balance['raiders']);
  const defense = asRecord(balance['defense']);
  const structures = asRecord(balance['structures']);
  const wallHp = asRecord(structures['wallHp']);
  const facilityHp = asRecord(structures['facilityHp']);
  const creatures = asRecord(balance['creatures']);
  for (const key of ['safePhaseSeconds', 'waveBaseSize', 'waveMaxSize']) {
    requirePositiveInteger(raid, key);
  }
  const dangerPhaseSeconds = asRecord(raid['dangerPhaseSecondsByThreat']);
  for (const threat of DANGER_THREAT_IDS) requirePositiveInteger(dangerPhaseSeconds, threat);
  for (const key of [
    'spawnDelaySeconds', 'graceSeconds', 'exposureDamagePerSecond', 'exposureRampPerSecond',
    'exposureMaxDamagePerSecond', 'waveGrowthTenths', 'waveRatingTenths',
  ]) requireNonNegativeInteger(raid, key);
  if (!['purifier-first', 'purifier-last', 'nearest', 'player-first'].includes(String(raid['targetPriority']))) {
    throw new SaveValidationError('invalid raid target priority');
  }
  for (const kindId of RAIDER_KIND_IDS) {
    const raider = asRecord(raiders[kindId]);
    for (const key of ['maxHp', 'speedPxPerTick', 'attackCooldownTicks']) requirePositiveInteger(raider, key);
    for (const key of ['damage', 'playerDamage', 'wallDamagePercent', 'unlockCycle', 'aggroRangePx', 'levelMultiplierBps']) {
      requireNonNegativeInteger(raider, key);
    }
  }
  for (const key of [
    'turretCooldownTicks', 'turretRangeTiles', 'turretAmmoCapacity',
    'playerShotCooldownTicks', 'raiderAggroRangeTiles',
    'roamerLeashTiles', 'roamerRespawnTicks',
  ]) requirePositiveInteger(defense, key);
  for (const key of ['turretDamage', 'turretAbsentRoundShots', 'playerShotDamage', 'roamersPerArea']) {
    requireNonNegativeInteger(defense, key);
  }
  for (const material of WALL_MATERIAL_IDS) requirePositiveInteger(wallHp, material);
  for (const id of STRUCTURE_FACILITY_IDS) requirePositiveInteger(facilityHp, id);
  for (const definition of CREATURE_DEFINITIONS) {
    const creature = asRecord(creatures[definition.speciesId]);
    for (const key of ['maxHp', 'moveSpeed', 'attackRange']) requirePositiveInteger(creature, key);
    for (const key of ['attackPower', 'defense', 'tameEaseBps', 'dodgeBps', 'levelMultiplierBps']) {
      requireNonNegativeInteger(creature, key);
    }
  }

  const world = asRecord(balance['world']);
  for (const key of ['levelBandTiles', 'maxEnemyLevel']) requirePositiveInteger(world, key);
  for (const key of ['levelsPerAreaRing', 'creaturesPerArea']) requireNonNegativeInteger(world, key);

  for (const id of TOOL_DEFINITION_IDS) {
    const tool = asRecord(tools[id]);
    const craftCost = asRecord(tool['craftCost']);
    const damage = asRecord(tool['damageByTarget']);
    const wearMultiplier = asRecord(tool['wearMultiplierByTarget']);
    requirePositiveInteger(tool, 'maxDurability');
    requirePositiveInteger(tool, 'actionTicks');
    requirePositiveInteger(tool, 'rangePx');
    requireNonNegativeInteger(tool, 'wearPerHit');
    for (const resource of ['wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot']) requireNonNegativeInteger(craftCost, resource);
    for (const target of STRIKE_TARGETS) {
      requireNonNegativeInteger(damage, target);
      requireNonNegativeInteger(wearMultiplier, target);
      if ((damage[target] as number) > 0 && (wearMultiplier[target] as number) <= 0) {
        throw new SaveValidationError(`eligible ${id} target ${target} needs a wear multiplier`);
      }
    }
  }
}

function requireNumber(obj: Record<string, unknown>, key: string): void {
  const v = obj[key];
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new SaveValidationError(`expected numeric ${key}`);
  }
}

function requireString(obj: Record<string, unknown>, key: string): void {
  if (typeof obj[key] !== 'string') throw new SaveValidationError(`expected string ${key}`);
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

/**
 * The scheduled arcane strikes, if a save was written mid-storm.
 *
 * Every field is checked because a strike is the rare piece of state that both
 * damages the player and pays them: a corrupt one could bill 35 HP for a ring
 * that was never drawn, or mint ore at a coordinate no renderer can reach.
 */
function validateArcaneStorm(state: Record<string, unknown>, entityIds: Set<string>): void {
  const storm = state['arcaneStorm'];
  if (!isRecord(storm)) throw new SaveValidationError('missing arcaneStorm');
  if (storm['cycleIndex'] !== null) requireNonNegativeInteger(storm, 'cycleIndex');
  requireNonNegativeInteger(storm, 'nextStrikeIndex');
  const strikes = storm['strikes'];
  if (!Array.isArray(strikes)) throw new SaveValidationError('invalid arcane strikes');

  const areaKeys = new Set<string>(Object.keys(asRecord(state['visitedAreas'])));
  const currentArea = asRecord(state['currentArea']);
  if (typeof currentArea['key'] === 'string') areaKeys.add(currentArea['key']);

  for (const entry of strikes) {
    if (!isRecord(entry) || typeof entry['id'] !== 'string' || !entityIds.add(entry['id'])) {
      throw new SaveValidationError('invalid arcane strike id');
    }
    if (storm['cycleIndex'] === null) throw new SaveValidationError('arcane strike outside a storm');
    if (entry['cycleIndex'] !== storm['cycleIndex']) {
      throw new SaveValidationError('arcane strike belongs to another cycle');
    }
    requireNonNegativeInteger(entry, 'strikeIndex');
    if ((entry['strikeIndex'] as number) >= (storm['nextStrikeIndex'] as number)) {
      throw new SaveValidationError('arcane strike was never scheduled');
    }
    if (typeof entry['areaKey'] !== 'string' || !areaKeys.has(entry['areaKey'])) {
      throw new SaveValidationError('invalid arcane strike area');
    }
    // Whole pixels, for the same reason raiders are: a fractional coordinate
    // makes canonicalizeGameState throw on the very next save.
    requireNonNegativeInteger(entry, 'x'); requireNonNegativeInteger(entry, 'y');
    requireNonNegativeInteger(entry, 'telegraphAtTick');
    requireNonNegativeInteger(entry, 'impactAtTick');
    requireNonNegativeInteger(entry, 'rewardIronOre');
    if ((entry['telegraphAtTick'] as number) > (entry['impactAtTick'] as number)) {
      throw new SaveValidationError('arcane strike lands before it is telegraphed');
    }
    if (entry['resolvedAtTick'] !== null) {
      requireNonNegativeInteger(entry, 'resolvedAtTick');
      if ((entry['resolvedAtTick'] as number) < (entry['impactAtTick'] as number)) {
        throw new SaveValidationError('arcane strike resolved before it landed');
      }
    }
  }
}

/**
 * The bag left where the player fell. Null is the normal case — most saves are
 * written by someone who has not died recently.
 *
 * An empty cache is rejected rather than tolerated: it would light a beacon
 * over nothing and hand the player a countdown to an empty patch of ground.
 */
function validateDeathCache(cache: unknown): void {
  if (cache === null || cache === undefined) return;
  if (!isRecord(cache) || typeof cache['id'] !== 'string') {
    throw new SaveValidationError('invalid deathCache id');
  }
  requireString(cache, 'areaKey');
  requireString(cache, 'areaName');
  requireNumber(cache, 'areaX');
  requireNumber(cache, 'areaY');
  requireNumber(cache, 'x');
  requireNumber(cache, 'y');
  requireNonNegativeInteger(cache, 'createdAtTick');
  requireNonNegativeInteger(cache, 'expiresAtTick');
  if ((cache['expiresAtTick'] as number) <= (cache['createdAtTick'] as number)) {
    throw new SaveValidationError('invalid deathCache lifetime');
  }

  const resources = cache['resources'];
  if (!isRecord(resources)) throw new SaveValidationError('invalid deathCache resources');
  for (const [resource, amount] of Object.entries(resources)) {
    if (!BAG_ITEM_ID_SET.has(resource)) throw new SaveValidationError('invalid deathCache resource');
    if (!Number.isInteger(amount) || (amount as number) <= 0) {
      throw new SaveValidationError('invalid deathCache amount');
    }
  }

  const tools = cache['tools'];
  if (!Array.isArray(tools)) throw new SaveValidationError('invalid deathCache tools');
  const toolIds = new Set<string>();
  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool['instanceId'] !== 'string' || !toolIds.add(tool['instanceId'])
      || typeof tool['definitionId'] !== 'string' || !TOOL_DEFINITION_IDS.has(tool['definitionId'])) {
      throw new SaveValidationError('invalid deathCache tool identity');
    }
    requireNonNegativeInteger(tool, 'durability');
    requireNonNegativeInteger(tool, 'maxDurability');
    requireNonNegativeInteger(tool, 'powerRank');
    requireNonNegativeInteger(tool, 'speedRank');
    requireNonNegativeInteger(tool, 'durabilityRank');
    if ((tool['durability'] as number) > (tool['maxDurability'] as number)) {
      throw new SaveValidationError('deathCache tool durability exceeds maxDurability');
    }
  }

  if (tools.length === 0 && Object.keys(resources).length === 0) {
    throw new SaveValidationError('empty deathCache');
  }
}

/** Containers persist only identity, position, and whether they were opened. */
function validateWorldContainer(container: unknown): void {
  if (!isRecord(container) || typeof container['id'] !== 'string') {
    throw new SaveValidationError('invalid container id');
  }
  if (typeof container['kind'] !== 'string' || !WORLD_CONTAINER_KINDS.has(container['kind'])) {
    throw new SaveValidationError('invalid container kind');
  }
  requireNumber(container, 'x');
  requireNumber(container, 'y');
  if (typeof container['opened'] !== 'boolean') throw new SaveValidationError('invalid container opened');
}

function validateOpeningChapter(state: Record<string, unknown>): void {
  const chapter = state['onboarding'];
  if (!isRecord(chapter) || chapter['version'] !== OPENING_CHAPTER_VERSION
    || !['active', 'complete', 'legacy'].includes(String(chapter['status']))) throw new SaveValidationError('invalid opening chapter');
  const milestones = chapter['completedMilestoneIds'];
  const rewards = chapter['issuedRewardIds'];
  if (!Array.isArray(milestones) || new Set(milestones).size !== milestones.length
    || milestones.some((id) => !OPENING_MILESTONES.some((milestone) => milestone.id === id))) throw new SaveValidationError('invalid opening milestones');
  if (!Array.isArray(rewards) || new Set(rewards).size !== rewards.length
    || rewards.some((id) => !['starter-partner', 'shelter-recipes', 'shelter-supplies', 'shelter-grove', 'paddock-recipes', 'paddock-supplies'].includes(id))) throw new SaveValidationError('invalid opening rewards');
  const garden = chapter['garden'];
  if (chapter['status'] === 'legacy') {
    if (garden !== null) throw new SaveValidationError('legacy garden lesson must be inactive');
  } else {
    if (!isRecord(garden)) throw new SaveValidationError('invalid opening garden');
    requireNonNegativeInteger(garden, 'harvestedFiber');
    if ((garden['harvestedFiber'] as number) > 5 || typeof garden['recapAcknowledged'] !== 'boolean'
      || garden['bedId'] !== null && (typeof garden['bedId'] !== 'string' || !garden['bedId'])
      || garden['nextGoal'] !== null && !OPENING_NEXT_GOALS.some((goal) => goal === garden['nextGoal'])) throw new SaveValidationError('invalid garden progress');
    const plan = garden['plan'];
    if (plan !== null && (!isRecord(plan) || plan['areaKey'] !== '0,0' || !Number.isSafeInteger(plan['tileX']) || !Number.isSafeInteger(plan['tileY'])
      || (plan['tileX'] as number) < 0 || (plan['tileX'] as number) + 2 > WORLD_TILES || (plan['tileY'] as number) < 0 || (plan['tileY'] as number) >= WORLD_TILES)) throw new SaveValidationError('invalid garden footprint');
    if ((plan !== null || garden['bedId'] !== null || (garden['harvestedFiber'] as number) > 0) && !milestones.includes('register-discovery')
      || milestones.includes('register-discovery') && (!milestones.includes('collect-discovery') || !Array.isArray(state['unlockedItemIds']) || !state['unlockedItemIds'].includes('garden-bed'))
      || milestones.includes('build-garden') && (!milestones.includes('register-discovery') || garden['bedId'] === null)
      || (garden['harvestedFiber'] as number) > 0 && (!milestones.includes('build-garden') || garden['bedId'] === null)
      || milestones.includes('harvest-garden') && (!milestones.includes('build-garden') || (garden['harvestedFiber'] as number) < 5)
      || (garden['recapAcknowledged'] || garden['nextGoal'] !== null) && (chapter['status'] !== 'complete' || !milestones.includes('harvest-garden'))
      || garden['nextGoal'] !== null && !garden['recapAcknowledged']) throw new SaveValidationError('inconsistent garden lesson');
  }
  const run = chapter['supplyRun'];
  if (chapter['status'] === 'legacy') {
    if (run !== null) throw new SaveValidationError('legacy supply run must be inactive');
  } else {
    if (!isRecord(run)) throw new SaveValidationError('invalid opening supply run');
    for (const key of ['discovered', 'suppliesRecovered', 'sideCacheOpened', 'guardianStarted', 'guardianDefeated', 'blueprintClaimed']) if (typeof run[key] !== 'boolean') throw new SaveValidationError('invalid supply run flag');
    requireNonNegativeInteger(run, 'guardedDamage');
    if ((run['guardedDamage'] as number) > 9999) throw new SaveValidationError('invalid guard lesson damage');
    for (const key of ['blueprintInstanceId', 'blueprintDropId']) if (run[key] !== null && (typeof run[key] !== 'string' || !run[key])) throw new SaveValidationError('invalid discovery identity');
    const site = run['site'];
    if (site !== null && (!isRecord(site) || site['areaKey'] !== '0,0' || !Number.isSafeInteger(site['tileX']) || !Number.isSafeInteger(site['tileY'])
      || (site['tileX'] as number) < 5 || (site['tileX'] as number) >= WORLD_TILES || (site['tileY'] as number) < 0 || (site['tileY'] as number) >= WORLD_TILES)) throw new SaveValidationError('invalid supply cart site');
    if ((site !== null || run['discovered'] || run['suppliesRecovered'] || run['sideCacheOpened'] || run['guardianStarted']) && !milestones.includes('return-to-follow')
      || (run['suppliesRecovered'] || run['guardianStarted'] || run['sideCacheOpened']) && site === null
      || run['blueprintClaimed'] && !run['suppliesRecovered']
      || (run['blueprintInstanceId'] !== null || run['blueprintDropId'] !== null) && !run['blueprintClaimed']
      || run['guardianDefeated'] && !run['guardianStarted']
      || (run['guardedDamage'] as number) > 0 && !run['guardianStarted']
      || milestones.includes('recover-supplies') && !run['suppliesRecovered']
      || milestones.includes('collect-discovery') && (!run['blueprintClaimed'] || !milestones.includes('recover-supplies'))) throw new SaveValidationError('inconsistent supply run progress');
  }
  const production = chapter['production'];
  if (chapter['status'] === 'legacy') {
    if (production !== null) throw new SaveValidationError('legacy production lesson must be inactive');
  } else {
    if (!isRecord(production)) throw new SaveValidationError('invalid opening production');
    for (const key of ['producedFiber', 'collectedFiber']) {
      requireNonNegativeInteger(production, key);
      if ((production[key] as number) > 2) throw new SaveValidationError('invalid opening production credit');
    }
    if ((production['collectedFiber'] as number) > (production['producedFiber'] as number)) throw new SaveValidationError('unearned production collection');
    if (production['sourceHousingId'] !== null && (typeof production['sourceHousingId'] !== 'string' || !production['sourceHousingId'])) throw new SaveValidationError('invalid production source');
    if (production['sourceAreaKey'] !== null && (typeof production['sourceAreaKey'] !== 'string' || !/^-?[0-3],-?[0-3]$/.test(production['sourceAreaKey']))) throw new SaveValidationError('invalid production area');
    if ((production['sourceAreaKey'] === null) !== (production['sourceHousingId'] === null)
      || production['producedFiber'] !== 0 && production['sourceHousingId'] === null) throw new SaveValidationError('missing production attribution');
    const plan = production['plan'];
    if (plan !== null && (!isRecord(plan) || typeof plan['areaKey'] !== 'string' || !/^-?[0-3],-?[0-3]$/.test(plan['areaKey'])
      || !Number.isSafeInteger(plan['tileX']) || !Number.isSafeInteger(plan['tileY']) || (plan['tileX'] as number) < 0 || (plan['tileY'] as number) < 0
      || (plan['tileX'] as number) + 4 > WORLD_TILES || (plan['tileY'] as number) + 2 > WORLD_TILES)) throw new SaveValidationError('invalid paddock footprint');
    if ((rewards.includes('paddock-recipes') || rewards.includes('paddock-supplies') || plan !== null) && !milestones.includes('weather-fog')) throw new SaveValidationError('unearned paddock supplies');
    if (milestones.includes('collect-production') && (production['collectedFiber'] !== 2 || !milestones.includes('build-paddock'))
      || milestones.includes('build-paddock') && !milestones.includes('weather-fog')
      || milestones.includes('return-to-follow') && !milestones.includes('collect-production')) throw new SaveValidationError('invalid production milestones');
  }
  const threat = chapter['firstThreat'];
  if (chapter['status'] === 'legacy') {
    if (threat !== null) throw new SaveValidationError('legacy opening threat must be inactive');
  } else {
    if (!isRecord(threat) || !['guided', 'ordinary'].includes(String(threat['mode'])) || typeof threat['aftermathAcknowledged'] !== 'boolean') throw new SaveValidationError('invalid opening threat');
    for (const key of ['preparationStartedAtTick', 'fogStartsAtTick', 'fogEndsAtTick', 'releasedAtTick', 'observedCycleIndex', 'lastObservedTick']) {
      if (threat[key] !== null) requireNonNegativeInteger(threat, key);
    }
    requireNonNegativeInteger(threat, 'shelteredTicks');
    if ((threat['shelteredTicks'] as number) > 60) throw new SaveValidationError('invalid opening fog observation');
    const prep = threat['preparationStartedAtTick']; const start = threat['fogStartsAtTick']; const end = threat['fogEndsAtTick'];
    if ((prep === null) !== (start === null) || (prep === null) !== (end === null)
      || prep !== null && ((prep as number) > (state['tick'] as number) || (prep as number) >= (start as number) || (start as number) >= (end as number))
      || threat['mode'] === 'ordinary' && (prep !== null || threat['releasedAtTick'] !== null)
      || prep !== null && !milestones.includes('build-shelter')) throw new SaveValidationError('invalid opening fog schedule');
    for (const key of ['releasedAtTick', 'lastObservedTick']) if (threat[key] !== null && (threat[key] as number) > (state['tick'] as number)) throw new SaveValidationError('opening fog observation is in the future');
  }
  for (const key of ['shelterPlan', 'shelterHome']) {
    const site = chapter[key];
    if (site === null) continue;
    if (!isRecord(site) || typeof site['areaKey'] !== 'string' || !/^-?[0-3],-?[0-3]$/.test(site['areaKey'])
      || !Number.isSafeInteger(site['tileX']) || !Number.isSafeInteger(site['tileY'])
      || (site['tileX'] as number) < 0 || (site['tileY'] as number) < 0
      || (site['tileX'] as number) >= WORLD_TILES || (site['tileY'] as number) >= WORLD_TILES) throw new SaveValidationError('invalid opening shelter site');
    if (key === 'shelterPlan' && ((site['tileX'] as number) + 4 > WORLD_TILES || (site['tileY'] as number) + 2 > WORLD_TILES)) throw new SaveValidationError('opening shelter footprint is outside the map');
  }
  if (chapter['companionId'] !== null && (typeof chapter['companionId'] !== 'string' || !chapter['companionId'])) throw new SaveValidationError('invalid opening companion');
  if (chapter['status'] === 'legacy') {
    if (chapter['starterWildCreatureId'] !== null || chapter['companionId'] !== null || chapter['trustSession'] !== null
      || chapter['shelterPlan'] !== null || chapter['shelterHome'] !== null || milestones.length || rewards.length) throw new SaveValidationError('legacy opening must be inactive');
    return;
  }
  if (chapter['starterWildCreatureId'] !== starterTuftleId(state['seed'] as number)) throw new SaveValidationError('invalid opening creature identity');
  if (chapter['status'] === 'complete') {
    if (!OPENING_MILESTONES.every((milestone) => milestones.includes(milestone.id)) || !rewards.includes('starter-partner') || !rewards.includes('shelter-recipes')
      || chapter['companionId'] === null || chapter['trustSession'] !== null || chapter['shelterHome'] === null) throw new SaveValidationError('incomplete opening partnership');
    return;
  }
  if (milestones.includes('befriend-tuftle')) {
    if (!milestones.includes('meet-tuftle') || chapter['companionId'] === null || !rewards.includes('starter-partner')
      || rewards.includes('shelter-recipes') !== milestones.includes('gather-together')
      || milestones.includes('build-shelter') !== (chapter['shelterHome'] !== null) || chapter['trustSession'] !== null
      || (!milestones.includes('gather-together') && (chapter['shelterPlan'] !== null || rewards.includes('shelter-supplies') || rewards.includes('shelter-grove')))) throw new SaveValidationError('invalid gathering partnership');
    return;
  }
  if (chapter['companionId'] !== null || rewards.length) throw new SaveValidationError('unearned opening partnership');
  const session = chapter['trustSession'];
  if (session === null) return;
  if (!isRecord(session) || !milestones.includes('meet-tuftle') || state['activeEncounter'] !== null) throw new SaveValidationError('invalid opening trust session');
  for (const key of ['beatsRemaining', 'calmBps', 'fearBps', 'peakFearBps', 'boldBeats', 'patientBeats', 'fedBeats', 'bandLowBps', 'bandHighBps']) {
    requireNonNegativeInteger(session, key);
    if ((session[key] as number) > 10_000) throw new SaveValidationError('invalid opening trust meter');
  }
  if ((session['beatsRemaining'] as number) < 1 || (session['beatsRemaining'] as number) > 4
    || (session['bandLowBps'] as number) >= (session['bandHighBps'] as number)
    || (session['peakFearBps'] as number) < (session['fearBps'] as number)
    || !TAMING_MOODS.includes(session['mood'] as typeof TAMING_MOODS[number])
    || session['temperament'] !== 'passive' || session['settled'] !== null || session['finishedEarly'] !== false) throw new SaveValidationError('invalid opening trust state');
}

function validateQuestIds(state: Record<string, unknown>, key: string): void {
  const value = state[key];
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !QUEST_IDS.has(id)) || new Set(value).size !== value.length) {
    throw new SaveValidationError(`invalid ${key}`);
  }
}

function validateNpcMemory(value: unknown): void {
  if (!isRecord(value)) throw new SaveValidationError('invalid npcMemory');
  const visits = value['visits'];
  if (!isRecord(visits)) throw new SaveValidationError('invalid NPC visits');
  for (const npcId of Object.keys(visits)) {
    if (!isNpcId(npcId)) throw new SaveValidationError('invalid NPC visit id');
    requireNonNegativeInteger(visits, npcId);
  }
  const seenMomentIds = value['seenMomentIds'];
  if (!Array.isArray(seenMomentIds)
    || seenMomentIds.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 96)
    || new Set(seenMomentIds).size !== seenMomentIds.length) {
    throw new SaveValidationError('invalid NPC seen moments');
  }
}

function validateQuestProgress(value: unknown): void {
  const progress = asRecord(value);
  const crafted = validateCounterRecord(progress['crafted'], 'quest crafted');
  const validCrafts = new Set([...TOOL_DEFINITION_IDS, 'taming-snare', 'arrows', 'iron-ingot', 'bow', 'cloth-mask']);
  if (Object.keys(crafted).some((key) => !validCrafts.has(key))) throw new SaveValidationError('invalid quest crafted id');
  const placed = validateCounterRecord(progress['buildingsPlaced'], 'quest buildingsPlaced');
  const removed = validateCounterRecord(progress['buildingsRemoved'], 'quest buildingsRemoved');
  if ([...Object.keys(placed), ...Object.keys(removed)].some((key) => !BUILDING_DEFINITION_IDS.has(key))) {
    throw new SaveValidationError('invalid quest building id');
  }
  requireNonNegativeInteger(progress, 'renovationWoodPlaced');
  validateSpeciesCounter(progress['creatureEncounters'], 'creatureEncounters');
  validateSpeciesCounter(progress['creatureDefeats'], 'creatureDefeats');
  validateSpeciesCounter(progress['companionWins'], 'companionWins');
  const abilities = validateCounterRecord(progress['abilityUses'], 'abilityUses');
  if (Object.keys(abilities).some((key) => !isCompanionAbilityId(key))) throw new SaveValidationError('invalid quest ability id');
  const gathered = asRecord(progress['gatheredWithFollower']);
  const areaWithFollower = asRecord(progress['areaKeysVisitedWithFollower']);
  const farmOrders = asRecord(progress['farmOrders']);
  for (const definition of CREATURE_DEFINITIONS) {
    const speciesId = definition.speciesId;
    validateResourceCounter(gathered[speciesId], `gatheredWithFollower.${speciesId}`);
    const areaKeys = areaWithFollower[speciesId];
    if (!Array.isArray(areaKeys) || areaKeys.some((key) => typeof key !== 'string') || new Set(areaKeys).size !== areaKeys.length) {
      throw new SaveValidationError('invalid follower area keys');
    }
    requireNonNegativeInteger(farmOrders, speciesId);
  }
  const areaKeys = progress['areaKeysVisited'];
  if (!Array.isArray(areaKeys) || areaKeys.some((key) => typeof key !== 'string') || new Set(areaKeys).size !== areaKeys.length) {
    throw new SaveValidationError('invalid quest area keys');
  }
  const themes = progress['areaThemesVisited'];
  const validThemes = new Set(['elaris', 'forest', 'mountain', 'meadow', 'thicket', 'marsh']);
  if (!Array.isArray(themes) || themes.some((theme) => typeof theme !== 'string' || !validThemes.has(theme)) || new Set(themes).size !== themes.length) {
    throw new SaveValidationError('invalid quest area themes');
  }
  validateResourceCounter(progress['resourcesSold'], 'quest resourcesSold');
  requireNonNegativeInteger(progress, 'gardenFiberHarvested');
  requireNonNegativeInteger(progress, 'woodlotWoodHarvested');
  requireNonNegativeInteger(progress, 'storageDeposits');
  requireNonNegativeInteger(progress, 'furnaceQueuePeak');
  if ((progress['furnaceQueuePeak'] as number) > 4) throw new SaveValidationError('invalid quest Furnace peak');
  const upgrades = validateCounterRecord(progress['upgradesPurchased'], 'upgradesPurchased');
  if (Object.keys(upgrades).some((key) => !/^(power|speed|durability)-(1|2)$/.test(key))) throw new SaveValidationError('invalid quest upgrade id');
  const roles = asRecord(progress['rolesAssigned']);
  for (const role of ['rest', 'follow', 'work']) requireNonNegativeInteger(roles, role);
  const repairCandidates = progress['criticalIronRepairCandidates'];
  if (!Array.isArray(repairCandidates) || repairCandidates.some((id) => typeof id !== 'string') || new Set(repairCandidates).size !== repairCandidates.length) {
    throw new SaveValidationError('invalid critical repair candidates');
  }
  requireNonNegativeInteger(progress, 'ironToolsRestoredFromCritical');
}

function validateRegionalProgress(value: unknown): void {
  const progress = asRecord(value);
  const validLandmarks = new Set(REGIONAL_IDENTITIES.map((definition) => definition.landmark.id));
  const discovered = progress['discoveredLandmarkIds'];
  if (!Array.isArray(discovered)
    || discovered.some((id) => typeof id !== 'string' || !validLandmarks.has(id))
    || new Set(discovered).size !== discovered.length) {
    throw new SaveValidationError('invalid regional landmark discoveries');
  }
  const contracts = asRecord(progress['contracts']);
  const definitions = new Map(REGIONAL_IDENTITIES.map((definition) => [definition.contract.id, definition]));
  for (const [contractId, rawContract] of Object.entries(contracts)) {
    const definition = definitions.get(contractId);
    if (!definition || !isRecord(rawContract)) throw new SaveValidationError('invalid regional contract');
    requireNonNegativeInteger(rawContract, 'cycleIndex');
    requireNonNegativeInteger(rawContract, 'progress');
    if ((rawContract['progress'] as number) > definition.contract.target
      || typeof rawContract['completed'] !== 'boolean') {
      throw new SaveValidationError('invalid regional contract progress');
    }
  }
  const completionCounts = asRecord(progress['contractCompletionCounts']);
  for (const contractId of Object.keys(completionCounts)) {
    if (!definitions.has(contractId)) throw new SaveValidationError('invalid regional contract completion id');
    requireNonNegativeInteger(completionCounts, contractId);
  }
}

function validateCounterRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);
  for (const key of Object.keys(record)) requireNonNegativeInteger(record, key);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SaveValidationError(`invalid ${label}`);
  return record;
}

function validateSpeciesCounter(value: unknown, label: string): void {
  const record = asRecord(value);
  for (const definition of CREATURE_DEFINITIONS) requireNonNegativeInteger(record, definition.speciesId);
  if (Object.keys(record).some((key) => !isSpeciesId(key))) throw new SaveValidationError(`invalid ${label}`);
}

function validateResourceCounter(value: unknown, label: string): void {
  const record = asRecord(value);
  for (const resource of ['wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot']) requireNonNegativeInteger(record, resource);
  if (Object.keys(record).some((key) => !['wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot'].includes(key))) {
    throw new SaveValidationError(`invalid ${label}`);
  }
}
