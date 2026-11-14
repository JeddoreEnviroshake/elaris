import { CRAFTABLE_TOOL_DEFINITIONS, TOOL_DEFINITIONS } from '../config/balance';
import { BUILDABLES, buildableById } from './buildingParts';
import { COMPANION_ABILITIES, creatureBondLevel } from './companionAbilities';
import { CREATURE_DEFINITIONS } from './creatures';
import { environments, buildOccupancy, boundaryEdgeKey, type EnvironmentInfo } from '../simulation/environmentProgress';
import { knowsBlueprint } from '../simulation/blueprintKnowledge';
import { effectiveBuildingDimensions } from '../simulation/buildingGeometry';
import type {
  AttributeId,
  BuildingDefinitionId,
  BuildingState,
  GameState,
  GatherableResourceId,
  ResourceId,
  SpeciesId,
  ToolDefinitionId,
  ToolInstance,
} from '../simulation/state';

export type QuestId = string;
export type QuestCategory = 'main' | 'unlocks' | 'crafting' | 'creatures' | 'building' | 'facilities' | 'economy' | 'exploration';

export type QuestReward = {
  kind: 'coins';
  amount: number;
} | {
  kind: 'resource';
  resource: ResourceId;
  amount: number;
};

export interface QuestDefinition {
  id: QuestId;
  title: string;
  category: QuestCategory;
  tier: number;
  /** Optional atlas destination for authored travel objectives. */
  mapAreaKey?: string;
  locationLabel?: string;
  objective: (state: GameState) => string;
  complete: (state: GameState) => boolean;
  reward?: QuestReward;
}

export const QUEST_CATEGORY_LABELS: Readonly<Record<QuestCategory, string>> = {
  main: 'Main Journey',
  unlocks: 'Blueprints & Recipes',
  crafting: 'Crafting & Production',
  creatures: 'Creatures & Bonds',
  building: 'Building Mastery',
  facilities: 'Facilities & Automation',
  economy: 'Trade & Contracts',
  exploration: 'Exploration & Character',
};

const coins = (amount: number): QuestReward => ({ kind: 'coins', amount });
const progress = (value: number, target: number): string => `${Math.min(value, target)}/${target}`;
const count = (record: Record<string, number>, key: string): number => record[key] ?? 0;

const mainQuests: QuestDefinition[] = [
  {
    id: 'gather-fiber', title: 'First Materials', category: 'main', tier: 1,
    objective: (state) => `Gather fiber from plants (${progress(state.resourcesCollected.fiber, 5)})`,
    complete: (state) => state.resourcesCollected.fiber >= 5, reward: coins(1),
  },
  {
    id: 'craft-wooden-sickle', title: 'A Better Tool', category: 'main', tier: 1,
    objective: (state) => `Craft a Wooden Sickle (${progress(count(state.questProgress.crafted, 'wooden-sickle'), 1)})`,
    complete: (state) => count(state.questProgress.crafted, 'wooden-sickle') >= 1
      || allTools(state).some((tool) => tool.definitionId === 'wooden-sickle'), reward: coins(2),
  },
  {
    id: 'lay-floor-tiles', title: 'Firm Footing', category: 'main', tier: 1,
    objective: (state) => `Lay floor tiles (${progress(floorTileCount(state), 4)})`,
    complete: (state) => floorTileCount(state) >= 4, reward: coins(2),
  },
  {
    id: 'build-nook', title: 'A Nook of Your Own', category: 'main', tier: 1,
    objective: () => 'Enclose the floor tiles with walls and a door',
    complete: (state) => state.highestAreaTierEver >= 4, reward: coins(3),
  },
  {
    id: 'craft-pick-gather-stone', title: 'Apprentice Miner', category: 'main', tier: 1,
    objective: (state) => `Craft a Wooden Pick ${progress(count(state.questProgress.crafted, 'wooden-pick'), 1)} and collect stone ${progress(state.resourcesCollected.stone, 5)}`,
    complete: (state) => (count(state.questProgress.crafted, 'wooden-pick') >= 1
      || allTools(state).some((tool) => tool.definitionId === 'wooden-pick'))
      && state.resourcesCollected.stone >= 5, reward: coins(3),
  },
  {
    id: 'build-air-purifier', title: 'Clean Air', category: 'main', tier: 1,
    objective: () => 'Build an Air Purifier to protect yourself from poison fog',
    complete: (state) => buildingCount(state, 'air-purifier') >= 1, reward: coins(3),
  },
  {
    id: 'craft-workbench', title: 'Set Up a Workshop', category: 'main', tier: 2,
    objective: (state) => `Craft a Workbench (${progress(buildingCount(state, 'workbench'), 1)})`,
    complete: (state) => buildingCount(state, 'workbench') >= 1, reward: coins(4),
  },
  {
    id: 'prepare-night-raid', title: 'Prepare for a Night Raid', category: 'main', tier: 2,
    objective: (state) => `Craft a bow ${progress(count(state.questProgress.crafted, 'bow'), 1)} and arrows ${progress(count(state.questProgress.crafted, 'arrows'), 10)}`,
    complete: (state) => count(state.questProgress.crafted, 'bow') >= 1 && count(state.questProgress.crafted, 'arrows') >= 10,
    reward: coins(4),
  },
  {
    id: 'build-shelter-workbench', title: 'Room to Work', category: 'main', tier: 2,
    objective: (state) => `Expand an enclosed room to 8 floor tiles (best ${state.highestAreaTierEver})`,
    complete: (state) => state.highestAreaTierEver >= 8, reward: coins(4),
  },
  {
    id: 'create-work-yard', title: 'Room to Grow', category: 'main', tier: 2,
    objective: () => 'Create a valid enclosed work yard with eight ground-cover tiles',
    complete: (state) => worldBuildingSets(state).some((buildings) => environments(buildings).some((environment) => environment.kind === 'workYard' && environment.valid && environment.area >= 8)), reward: coins(5),
  },
  {
    id: 'place-worker-infrastructure', title: 'Prepare for a Helper', category: 'main', tier: 2,
    objective: () => 'Place a Small Pen inside a qualifying work yard to house your Tuftle',
    complete: hasPaddockHousing, reward: coins(6),
  },
  {
    id: 'tame-tuftle', title: 'Make a New Friend', category: 'main', tier: 2,
    objective: () => 'Befriend your first Tuftle',
    complete: (state) => state.firstTamedSpeciesIds.includes('tuftle'), reward: coins(8),
  },
  {
    id: 'put-tuftle-to-work', title: 'Working Together', category: 'main', tier: 2,
    objective: (state) => state.ownedCreatures.some((creature) => creature.role === 'work') ? 'Wait for a worker to deliver a resource' : 'Assign your Tuftle to work',
    complete: (state) => state.workerResourcesProduced >= 1, reward: coins(10),
  },
  {
    id: 'basic-stockpile', title: 'Basic Stockpile', category: 'main', tier: 2,
    objective: (state) => `Collect wood ${progress(state.resourcesCollected.wood, 10)}, fiber ${progress(state.resourcesCollected.fiber, 10)}, stone ${progress(state.resourcesCollected.stone, 6)}`,
    complete: (state) => state.resourcesCollected.wood >= 10 && state.resourcesCollected.fiber >= 10 && state.resourcesCollected.stone >= 6,
    reward: coins(2),
  },
  {
    id: 'shelter-from-wilds', title: 'Shelter from the Wilds', category: 'main', tier: 2, reward: coins(4),
    objective: () => 'Build an enclosed 8-square room containing a Bed',
    complete: (state) => hasFacilitiesInEnvironment(state, 8, ['bed']),
  },
  {
    id: 'set-up-shop', title: 'Set Up Shop', category: 'main', tier: 3, reward: coins(5),
    objective: () => 'Build an enclosed 16-square room containing a Workbench',
    complete: (state) => hasFacilitiesInEnvironment(state, 16, ['workbench']),
  },
  {
    id: 'working-yard', title: 'A Working Yard', category: 'main', tier: 3, reward: coins(6),
    objective: () => 'Build a valid enclosed 16-square work yard',
    complete: (state) => hasEnvironment(state, 'workYard', 16),
  },
  {
    id: 'missing-farm-shipments',
    title: 'Missing Farm Shipments',
    category: 'main',
    tier: 3,
    mapAreaKey: '1,0',
    locationLabel: 'Verdant Reach',
    reward: coins(8),
    objective: () => 'Follow the eastern road to Verdant Reach and find Orin’s farm',
    complete: (state) => state.questProgress.areaKeysVisited.includes('1,0'),
  },
  {
    id: 'blights-trail',
    title: 'The Blight’s Trail',
    category: 'main',
    tier: 3,
    mapAreaKey: '2,0',
    locationLabel: 'Sylvaren',
    reward: coins(10),
    objective: () => 'Continue east to seek Selene’s counsel in the elven city of Sylvaren',
    complete: (state) => state.questProgress.areaKeysVisited.includes('2,0'),
  },
  {
    id: 'news-for-elaris',
    title: 'News for Elaris',
    category: 'main',
    tier: 3,
    mapAreaKey: '0,0',
    locationLabel: 'Elaris',
    reward: coins(13),
    objective: () => 'Return to Elaris after reaching Verdant Reach and Sylvaren',
    complete: (state) => state.questProgress.areaKeysVisited.includes('1,0')
      && state.questProgress.areaKeysVisited.includes('2,0')
      && state.currentArea.key === '0,0',
  },
];

type UnlockQuestSpec = readonly [BuildingDefinitionId | ToolDefinitionId, string, number, number];
const unlockSpecs: readonly UnlockQuestSpec[] = [
  ['thatch-floor', 'Thatch Underfoot', 2, 4], ['thatch-ground', 'Prepared Earth', 2, 4],
  ['thatch-wall', 'Woven Walls', 2, 4], ['thatch-door', 'A Proper Entrance', 2, 1],
  ['thatch-fence', 'Boundaries', 2, 4], ['thatch-gate', 'Way Through', 2, 1],
  ['wooden-axe', 'Apprentice Woodcutter', 2, 1], ['wooden-pick', 'Apprentice Miner', 2, 1],
  ['wooden-sickle', 'Apprentice Harvester', 2, 1], ['field-cache', 'Safe Keeping', 3, 1],
  ['bed', 'A Place to Rest', 3, 1], ['wood-floor', 'Wooden Foundations', 5, 8],
  ['wood-ground', 'The Wooden Yard', 5, 8], ['wood-wall', 'Stronger Walls', 5, 8],
  ['wood-door', "Carpenter's Door", 4, 1], ['wood-fence', 'Sturdy Perimeter', 5, 8],
  ['wood-gate', 'The Main Gate', 4, 1], ['stone-axe', 'Stone Woodcutter', 6, 1],
  ['wood-bridge', 'Bridge the Gap', 6, 1], ['water', 'Shape the Shore', 4, 4],
  ['stone-floor', 'Stone Foundations', 8, 8], ['stone-ground', 'Flagstone Yard', 8, 8],
  ['stone-wall', 'Masonry Walls', 9, 8], ['stone-door', 'Mason’s Door', 8, 1],
  ['stone-fence', 'Stone Perimeter', 9, 8], ['stone-gate', 'Stone Gateway', 8, 1],
  ['stone-bridge', 'Bridge of Stone', 10, 1],
  ['metal-floor', 'Iron Foundations', 15, 8], ['metal-ground', 'Iron Yard', 15, 8],
  ['metal-wall', 'Fortified Walls', 18, 8], ['metal-door', 'Iron Door', 15, 1],
  ['metal-fence', 'Iron Perimeter', 18, 8], ['metal-gate', 'Iron Gateway', 15, 1],
  ['stone-pick', 'Stone Miner', 6, 1], ['stone-sickle', 'Stone Harvester', 6, 1],
  ['workbench', 'Equipped Workshop', 6, 1], ['garden-bed', 'Cultivated Ground', 7, 1],
  ['woodlot-planter', 'Managed Forest', 8, 1], ['furnace', 'Fire and Ore', 10, 1],
  ['farm-counter', 'Orders From Home', 9, 1], ['small-pen', 'Room for One', 9, 1],
  ['barn', 'A Working Barn', 14, 1],
  ['stone-yard', 'Stone Delivery', 14, 1], ['cart-dock', 'Unload the Cart', 14, 1],
  ['warehouse', 'Bulk Storage', 18, 1], ['logistics-hub', 'Linked Supply Lines', 23, 1],
  ['iron-axe', 'Iron Woodcutter', 12, 1], ['iron-pick', 'Iron Miner', 12, 1],
  ['iron-sickle', 'Iron Harvester', 12, 1], ['air-purifier', 'Clean Air', 3, 1],
  ['war-table', 'Plans for the Worst', 9, 1], ['turret', 'Hold the Line', 14, 2],
  ['wooden-sword', 'First Blade', 4, 1], ['stone-sword', 'Tempered Edge', 7, 1],
  ['iron-sword', 'Iron Blade', 13, 1], ['bow', 'Ready the Bow', 6, 1],
];

const toolIds = new Set<string>(TOOL_DEFINITIONS.map((definition) => definition.definitionId));
const unlockQuests: QuestDefinition[] = unlockSpecs.map(([id, title, gold, target], index) => {
  const isTool = toolIds.has(id);
  const label = isTool ? TOOL_DEFINITIONS.find((definition) => definition.definitionId === id)!.displayName : buildableById(id as BuildingDefinitionId).displayName;
  return {
    id: `unlock-${id}`, title, category: 'unlocks', tier: 1 + Math.floor(index / 10), reward: coins(gold),
    objective: (state) => isTool
      ? `Learn and craft ${label} (${progress(count(state.questProgress.crafted, id), target)})`
      : `Learn and place ${target} ${label}${target === 1 ? '' : ' parts'} (${progress(buildingCount(state, id as BuildingDefinitionId), target)})`,
    complete: (state) => knowsBlueprint(state, id) && (isTool
      ? count(state.questProgress.crafted, id) >= target
      : buildingCount(state, id as BuildingDefinitionId) >= target),
  };
});

const craftingQuests: QuestDefinition[] = [
  eventQuest('craft-snare', "A Hunter's Tool", 'crafting', 1, 2, (s) => count(s.questProgress.crafted, 'taming-snare'), 1, 'Craft Taming Snares'),
  eventQuest('craft-arrows', 'Ready the Quiver', 'crafting', 1, 2, (s) => count(s.questProgress.crafted, 'arrows'), 12, 'Craft arrows'),
  eventQuest('first-ingot', 'First Ingot', 'crafting', 2, 5, (s) => count(s.questProgress.crafted, 'iron-ingot'), 1, 'Smelt Iron Ingots'),
  toolSetQuest('wooden-toolkit', 'Wooden Toolkit', 'wooden-', 6, 2),
  toolSetQuest('stone-toolkit', 'Stone Toolkit', 'stone-', 12, 3),
  toolSetQuest('iron-toolkit', 'Iron Toolkit', 'iron-', 25, 4),
  eventQuest('handy-repairs', 'Handy Repairs', 'crafting', 2, 8, (s) => s.repairsMade, 5, 'Repair tools'),
  eventQuest('foundry-runs', 'The Foundry Runs', 'crafting', 4, 15, (s) => count(s.questProgress.crafted, 'iron-ingot'), 25, 'Smelt Iron Ingots'),
  {
    id: 'master-toolmaker', title: 'Master Toolmaker', category: 'crafting', tier: 5, reward: coins(30),
    objective: (state) => `Craft all tools (${progress(CRAFTABLE_TOOL_DEFINITIONS.filter((tool) => count(state.questProgress.crafted, tool.definitionId) > 0).length, CRAFTABLE_TOOL_DEFINITIONS.length)})`,
    complete: (state) => CRAFTABLE_TOOL_DEFINITIONS.every((tool) => count(state.questProgress.crafted, tool.definitionId) > 0),
  },
  eventQuest('production-line', 'Production Line', 'crafting', 4, 25, (s) => s.questProgress.furnaceQueuePeak, 4, 'Reach a Furnace queue of'),
  {
    id: 'well-supplied', title: 'Well Supplied', category: 'crafting', tier: 4, reward: coins(15),
    objective: (state) => `Hold snares ${progress(state.inventory['taming-snare'], 10)}, arrows ${progress(state.inventory.arrow, 30)}, berries ${progress(state.inventory.berry, 10)}`,
    complete: (state) => state.inventory['taming-snare'] >= 10 && state.inventory.arrow >= 30 && state.inventory.berry >= 10,
  },
  eventQuest('nothing-wasted', 'Nothing Wasted', 'crafting', 5, 18,(s) => s.questProgress.ironToolsRestoredFromCritical, 1, 'Restore critical Iron tools to full'),
];

const creatureReward: Readonly<Record<SpeciesId, readonly [number, number, number, number, number]>> = {
  tuftle: [3, 4, 8, 14, 22], craghopper: [5, 5, 10, 18, 28],
  'glade-stag': [5, 6, 13, 20, 30], snarlfox: [6, 7, 15, 23, 33],
  // The defence roster is later work and pays like it.
  masonmole: [7, 9, 18, 26, 38], 'bulwark-boar': [8, 10, 20, 29, 41],
  quillfinch: [7, 8, 17, 25, 36], mistmoth: [9, 11, 22, 32, 45],
  slingtail: [8, 9, 19, 28, 40],
};

/**
 * The species-specific chapter of each creature's quest line.
 *
 * A table rather than the ternary chain this used to be: the chain's fallback
 * arm silently handed every species added after it the Snarlfox's objective,
 * counter, and title, which is a bug that type-checks. A missing row here is a
 * compile error instead.
 *
 * The defence roster's specialists are all "keep the base standing" counters,
 * because that is the job — every one of them is measured by structures that
 * survived, not by material carried home.
 */
interface CreatureSpecialistQuest {
  title: string;
  objective: string;
  target: number;
  progress: (state: GameState) => number;
}

const creatureSpecialist: Readonly<Record<SpeciesId, CreatureSpecialistQuest>> = {
  tuftle: {
    title: 'Put Down Roots', objective: 'Have Tuftles deliver resources', target: 10,
    progress: (state) => state.workerResourcesProduced,
  },
  craghopper: {
    title: 'Mining Partners', objective: 'Gather stone with a Craghopper following', target: 30,
    progress: (state) => state.questProgress.gatheredWithFollower.craghopper.stone,
  },
  'glade-stag': {
    title: 'Across the Wilds', objective: 'Visit regions with a Glade Stag following', target: 3,
    progress: (state) => state.questProgress.areaKeysVisitedWithFollower['glade-stag'].length,
  },
  snarlfox: {
    title: 'Safer Together', objective: 'Win encounters with a Snarlfox companion', target: 5,
    progress: (state) => state.questProgress.companionWins.snarlfox,
  },
  masonmole: {
    title: 'The Wall Keeper', objective: 'Win encounters with a Masonmole companion', target: 4,
    progress: (state) => state.questProgress.companionWins.masonmole,
  },
  'bulwark-boar': {
    title: 'Hold the Line', objective: 'Win encounters with a Bulwark Boar companion', target: 4,
    progress: (state) => state.questProgress.companionWins['bulwark-boar'],
  },
  quillfinch: {
    title: 'Never Dry', objective: 'Win encounters with a Quillfinch companion', target: 4,
    progress: (state) => state.questProgress.companionWins.quillfinch,
  },
  mistmoth: {
    title: 'Room to Breathe', objective: 'Win encounters with a Mistmoth companion', target: 4,
    progress: (state) => state.questProgress.companionWins.mistmoth,
  },
  slingtail: {
    title: 'Stones and Patience', objective: 'Win encounters with a Slingtail companion', target: 4,
    progress: (state) => state.questProgress.companionWins.slingtail,
  },
};

const creatureQuests: QuestDefinition[] = CREATURE_DEFINITIONS.flatMap((definition) => {
  const id = definition.speciesId; const name = definition.displayName; const reward = creatureReward[id];
  const speciesAbility = COMPANION_ABILITIES[id];
  const { progress: specialist, target: specialistTarget, title: specialistTitle } = creatureSpecialist[id];
  return [
    eventQuest(`meet-${id}`, `Meet the ${name}`, 'creatures', 1, reward[0], (s) => s.questProgress.creatureEncounters[id], 1, `Encounter ${name}`),
    eventQuest(`defeat-${id}`, id === 'snarlfox' ? 'Outfoxed' : `Best the ${name}`, 'creatures', 2, reward[1], (s) => s.questProgress.creatureDefeats[id], 1, `Defeat ${name}`),
    // specialistObjective is the sentence; the counter behind it lives in
    // creatureSpecialist so the two can never describe different things.
    {
      id: `tame-${id}-species`, title: `Befriend the ${name}`, category: 'creatures' as const, tier: 2, reward: coins(Math.max(6, reward[1] + 3)),
      objective: () => `Tame a ${name}`, complete: (state: GameState) => state.firstTamedSpeciesIds.includes(id),
    },
    eventQuest(`specialist-${id}`, specialistTitle, 'creatures', 3, reward[2], specialist, specialistTarget, specialistObjective(id)),
    {
      id: `bond-2-${id}`, title: speciesAbility[1]!.displayName, category: 'creatures' as const, tier: 3, reward: coins(Math.round(reward[3] * 0.65)),
      objective: (state: GameState) => `Reach Bond 2 and trigger ${speciesAbility[1]!.displayName} (${progress(count(state.questProgress.abilityUses, speciesAbility[1]!.id), 1)})`,
      complete: (state: GameState) => maxBond(state, id) >= 2 && count(state.questProgress.abilityUses, speciesAbility[1]!.id) >= 1,
    },
    {
      id: `bond-4-${id}`, title: speciesAbility[2]!.displayName, category: 'creatures' as const, tier: 4, reward: coins(reward[3]),
      objective: (state: GameState) => `Raise ${name} to Bond 4 (${progress(maxBond(state, id), 4)})`, complete: (state: GameState) => maxBond(state, id) >= 4,
    },
    {
      id: `bond-6-${id}`, title: speciesAbility[3]!.displayName, category: 'creatures' as const, tier: 5, reward: coins(reward[4]),
      objective: (state: GameState) => `Raise ${name} to Bond 6 (${progress(maxBond(state, id), 6)})`, complete: (state: GameState) => maxBond(state, id) >= 6,
    },
  ];
});

creatureQuests.push(
  eventQuest('tuftle-companion', 'Tuftle Companion', 'creatures', 3, 8, (s) => s.questProgress.gatheredWithFollower.tuftle.fiber, 25, 'Gather fiber with a Tuftle following'),
  speciesCountQuest('two-of-a-kind', 'Two of a Kind', 2, 10, 2),
  speciesCountQuest('diverse-roster', 'A Diverse Roster', 3, 20, 3),
  speciesCountQuest('four-friends', 'Four Friends', 4, 40, 4),
  {
    id: 'everybody-job', title: 'Everybody Has a Job', category: 'creatures', tier: 3, reward: coins(18),
    objective: () => 'Have creatures resting, following, and working at the same time',
    complete: (state) => (['rest', 'follow', 'work'] as const).every((role) => state.ownedCreatures.some((creature) => creature.role === role)),
  },
  {
    id: 'battle-tested-companions', title: 'Battle-Tested Companions', category: 'creatures', tier: 4, reward: coins(25),
    objective: (state) => `Win with three species (${progress(CREATURE_DEFINITIONS.filter((c) => state.questProgress.companionWins[c.speciesId] > 0).length, 3)})`,
    complete: (state) => CREATURE_DEFINITIONS.filter((c) => state.questProgress.companionWins[c.speciesId] > 0).length >= 3,
  },
  {
    id: 'signature-moves', title: 'Signature Moves', category: 'creatures', tier: 4, reward: coins(25),
    objective: (state) => `Trigger every signature ability (${progress(CREATURE_DEFINITIONS.filter((c) => count(state.questProgress.abilityUses, COMPANION_ABILITIES[c.speciesId][0]!.id) > 0).length, 4)})`,
    complete: (state) => CREATURE_DEFINITIONS.every((c) => count(state.questProgress.abilityUses, COMPANION_ABILITIES[c.speciesId][0]!.id) > 0),
  },
  {
    id: 'perfect-bonds', title: 'Perfect Bonds', category: 'creatures', tier: 6, reward: coins(75),
    objective: () => 'Raise all four species to Bond 6', complete: (state) => CREATURE_DEFINITIONS.every((c) => maxBond(state, c.speciesId) >= 6),
  },
);

const buildingQuests: QuestDefinition[] = [
  {
    id: 'thatch-nook', title: 'Thatch Nook', category: 'building', tier: 1, reward: coins(3),
    objective: () => 'Build one enclosed 4-square all-Thatch room', complete: (state) => hasMaterialEnvironment(state, 'indoor', 4, 'thatch'),
  },
  areaQuest('area-32-yard', 'Yard', 3, 12, 32),
  {
    id: 'wooden-great-hall', title: 'Wooden Great Hall', category: 'building', tier: 4, reward: coins(25),
    objective: () => 'Build one enclosed 64-square all-Wood room', complete: (state) => hasMaterialEnvironment(state, 'indoor', 64, 'wood'),
  },
  areaQuest('area-128-compound', 'Compound', 5, 40, 128),
  areaQuest('area-256-estate', 'Estate', 6, 70, 256),
  catalogQuest('thatchwright', 'Thatchwright', 'thatch', 2, 8),
  catalogQuest('carpenter', 'Carpenter', 'wood', 3, 16),
  materialCountQuest('woven-construction', 'Woven Construction', 'thatch', 2, 8, 50),
  materialCountQuest('timber-construction', 'Timber Construction', 'wood', 3, 15, 50),
  {
    id: 'wooden-cabin', title: 'Wooden Cabin', category: 'building', tier: 3, reward: coins(12),
    objective: () => 'Build one enclosed 16-square all-Wood room', complete: (state) => hasMaterialEnvironment(state, 'indoor', 16, 'wood'),
  },
  {
    id: 'timber-homestead', title: 'Timber Homestead', category: 'building', tier: 5, reward: coins(30),
    objective: () => 'Build a 64-square all-Wood room containing a Bed, Workbench, Furnace, and Storage Box',
    complete: (state) => hasFurnishedMaterialEnvironment(state, 64, ['bed', 'workbench', 'furnace', 'field-cache']),
  },
  {
    id: 'defensible-yard', title: 'Defensible Yard', category: 'building', tier: 5, reward: coins(25),
    objective: () => 'Enclose 64 Wood Ground squares with Wood Fences and Gates', complete: (state) => hasMaterialEnvironment(state, 'workYard', 64, 'wood'),
  },
  eventQuest('renovation-project', 'Renovation Project', 'building', 5, 25,(s) => s.questProgress.renovationWoodPlaced, 32, 'Replace Thatch parts with Wood'),
  {
    id: 'master-builder', title: 'Master Builder', category: 'building', tier: 6, reward: coins(50),
    objective: () => 'Maintain three valid 64-square environments, including a room and a work yard',
    complete: (state) => {
      const valid = worldBuildingSets(state).flatMap((set) => environments(set).filter((environment) => environment.valid && environment.area >= 64));
      return valid.length >= 3 && valid.some((environment) => environment.kind === 'indoor') && valid.some((environment) => environment.kind !== 'indoor');
    },
  },
  ratingQuest('rating-100', 'Rated Homestead', 2, 8, 100),
  ratingQuest('rating-250', 'Recognized Builder', 3, 18, 250),
  ratingQuest('rating-500', 'Master Homestead', 4, 30, 500),
  ratingQuest('rating-1000', 'Renowned Estate', 5, 50, 1000),
  ratingQuest('rating-2500', 'Wonder of Elaris', 6, 100, 2500),
];

const facilityQuests: QuestDefinition[] = [
  eventQuest('organized-supplies', 'Organized Supplies', 'facilities', 1, 4, (s) => s.questProgress.storageDeposits, 1, 'Deposit items in Storage'),
  {
    id: 'storage-network', title: 'Storage Network', category: 'facilities', tier: 2, reward: coins(10),
    objective: (state) => `Place three Storage Boxes and store three items (${buildingCount(state, 'field-cache')}/3, ${progress(state.questProgress.storageDeposits, 3)})`,
    complete: (state) => buildingCount(state, 'field-cache') >= 3 && state.questProgress.storageDeposits >= 3,
  },
  {
    id: 'home-comforts', title: 'Home Comforts', category: 'facilities', tier: 3, reward: coins(15),
    objective: () => 'Place a Bed, Workbench, and Storage Box in one enclosed room',
    complete: (state) => hasFacilitiesInEnvironment(state, 4, ['bed', 'workbench', 'field-cache']),
  },
  eventQuest('first-harvest', 'First Harvest', 'facilities', 2, 5, (s) => s.questProgress.gardenFiberHarvested, 1, 'Harvest fiber from Garden Beds'),
  eventQuest('community-garden', 'Community Garden', 'facilities', 3, 13, (s) => s.questProgress.gardenFiberHarvested, 50, 'Harvest fiber from Garden Beds'),
  eventQuest('first-woodlot', 'First Woodlot', 'facilities', 2, 5, (s) => s.questProgress.woodlotWoodHarvested, 1, 'Harvest wood from Woodlots'),
  eventQuest('sustainable-timber', 'Sustainable Timber', 'facilities', 3, 13, (s) => s.questProgress.woodlotWoodHarvested, 40, 'Harvest wood from Woodlots'),
  {
    id: 'self-sufficient', title: 'Self-Sufficient', category: 'facilities', tier: 4, reward: coins(25),
    objective: (state) => `Renewable wood ${progress(state.questProgress.woodlotWoodHarvested, 100)}, fiber ${progress(state.questProgress.gardenFiberHarvested, 100)}`,
    complete: (state) => state.questProgress.woodlotWoodHarvested >= 100 && state.questProgress.gardenFiberHarvested >= 100,
  },
  {
    id: 'industrial-workshop', title: 'Industrial Workshop', category: 'facilities', tier: 5, reward: coins(30),
    objective: (state) => `Operate two Furnaces and smelt 50 ingots (${buildingCount(state, 'furnace')}/2, ${progress(count(state.questProgress.crafted, 'iron-ingot'), 50)})`,
    complete: (state) => buildingCount(state, 'furnace') >= 2 && count(state.questProgress.crafted, 'iron-ingot') >= 50,
  },
  eventQuest('workers-yard', "Worker's Yard", 'facilities', 4, 18,(s) => s.workerResourcesProduced, 50, 'Have workers deliver resources'),
];

const economyQuests: QuestDefinition[] = [
  saleQuest('timber-merchant', 'Timber Merchant', 'wood', 25, 3),
  saleQuest('fiber-merchant', 'Fiber Merchant', 'fiber', 25, 3),
  saleQuest('stone-merchant', 'Stone Merchant', 'stone', 25, 4),
  saleQuest('ore-merchant', 'Ore Merchant', 'iron-ore', 10, 6),
  saleQuest('iron-merchant', 'Iron Merchant', 'iron-ingot', 10, 10),
  eventQuest('market-regular', 'Market Regular', 'economy', 3, 15, (s) => s.resourcesSold, 100, 'Sell resource units'),
  eventQuest('trading-company', 'Trading Company', 'economy', 5, 30, (s) => s.resourcesSold, 500, 'Sell resource units'),
  ...(['power', 'speed', 'durability'] as const).flatMap((axis) => ([1, 2] as const).map((rank) => ({
    id: `blacksmith-${axis}-${rank}`, title: `${axis[0]!.toUpperCase()}${axis.slice(1)} Rank ${rank}`,
    category: 'economy' as const, tier: rank + 2, reward: coins(rank === 1 ? 6 : 13),
    objective: (state: GameState) => `Purchase ${axis} rank ${rank} (${progress(count(state.questProgress.upgradesPurchased, `${axis}-${rank}`), 1)})`,
    complete: (state: GameState) => count(state.questProgress.upgradesPurchased, `${axis}-${rank}`) >= 1,
  }))),
  {
    id: 'fully-upgraded', title: 'Fully Upgraded', category: 'economy', tier: 5, reward: coins(30),
    objective: () => 'Bring one tool to rank 2 in Power, Speed, and Durability',
    complete: (state) => allTools(state).some((tool) => tool.powerRank >= 2 && tool.speedRank >= 2 && tool.durabilityRank >= 2),
  },
  ...CREATURE_DEFINITIONS.map((definition) => eventQuest(
    `farm-order-${definition.speciesId}`, `${definition.displayName} Breeder`, 'economy', 4,
    definition.speciesId === 'tuftle' ? 10 : definition.speciesId === 'craghopper' ? 13 : 15,
    (state) => state.questProgress.farmOrders[definition.speciesId], 1, `Order trained ${definition.displayName}`,
  )),
  {
    id: 'trusted-stockkeeper', title: 'Trusted Stockkeeper', category: 'economy', tier: 5, reward: coins(35),
    objective: (state) => `Order every species (${progress(CREATURE_DEFINITIONS.filter((c) => state.questProgress.farmOrders[c.speciesId] > 0).length, CREATURE_DEFINITIONS.length)})`,
    complete: (state) => CREATURE_DEFINITIONS.every((c) => state.questProgress.farmOrders[c.speciesId] > 0),
  },
];

const explorationQuests: QuestDefinition[] = [
  eventQuest('leaving-elaris', 'Leaving Elaris', 'exploration', 1, 4, (s) => s.questProgress.areaKeysVisited.length, 2, 'Visit regions'),
  eventQuest('pathfinder', 'Pathfinder', 'exploration', 2, 8, (s) => s.questProgress.areaKeysVisited.length, 3, 'Visit regions'),
  eventQuest('cartographer', 'Cartographer', 'exploration', 4, 20, (s) => s.questProgress.areaThemesVisited.length, 6, 'Visit region themes'),
  levelQuest('level-5', 'Growing Adventurer', 2, 8, 5),
  levelQuest('level-10', 'Seasoned Adventurer', 4, 20, 10),
  levelQuest('level-20', 'Veteran of the Wilds', 6, 50, 20),
  {
    id: 'well-rounded', title: 'Well Rounded', category: 'exploration', tier: 4, reward: coins(25),
    objective: (state) => `Invest in all attributes (${progress(Object.values(state.player.attributes).filter((value) => value > 0).length, 8)})`,
    complete: (state) => (Object.keys(state.player.attributes) as AttributeId[]).every((attribute) => state.player.attributes[attribute] >= 1),
  },
  {
    id: 'specialist', title: 'Specialist', category: 'exploration', tier: 5, reward: coins(30),
    objective: (state) => `Raise one attribute to 10 (${progress(Math.max(...Object.values(state.player.attributes)), 10)})`,
    complete: (state) => Object.values(state.player.attributes).some((value) => value >= 10),
  },
];

export const QUEST_DEFINITIONS: readonly QuestDefinition[] = [
  ...mainQuests, ...unlockQuests, ...craftingQuests, ...creatureQuests,
  ...buildingQuests, ...facilityQuests, ...economyQuests, ...explorationQuests,
];

export const QUEST_IDS = new Set<string>(QUEST_DEFINITIONS.map((quest) => quest.id));

function eventQuest(
  id: string, title: string, category: QuestCategory, tier: number, gold: number,
  value: (state: GameState) => number, target: number, label: string,
): QuestDefinition {
  return {
    id, title, category, tier, reward: coins(gold),
    objective: (state) => `${label} (${progress(value(state), target)})`,
    complete: (state) => value(state) >= target,
  };
}

function toolSetQuest(id: string, title: string, prefix: string, gold: number, tier: number): QuestDefinition {
  const ids = TOOL_DEFINITIONS.filter((tool) => tool.definitionId.startsWith(prefix)).map((tool) => tool.definitionId);
  return {
    id, title, category: 'crafting', tier, reward: coins(gold),
    objective: (state) => `Own the complete set (${progress(ids.filter((toolId) => allTools(state).some((tool) => tool.definitionId === toolId)).length, 3)})`,
    complete: (state) => ids.every((toolId) => allTools(state).some((tool) => tool.definitionId === toolId)),
  };
}

function speciesCountQuest(id: string, title: string, tier: number, gold: number, target: number): QuestDefinition {
  return eventQuest(id, title, 'creatures', tier, gold, (state) => state.firstTamedSpeciesIds.length, target, 'Tame different species');
}

function specialistObjective(speciesId: SpeciesId): string {
  return creatureSpecialist[speciesId].objective;
}

function areaQuest(id: string, title: string, tier: number, gold: number, target: number): QuestDefinition {
  return {
    id, title, category: 'building', tier, reward: coins(gold),
    objective: (state) => `Build a valid ${target}-square environment (best ${state.highestAreaTierEver})`,
    complete: (state) => state.highestAreaTierEver >= target,
  };
}

function catalogQuest(id: string, title: string, material: 'thatch' | 'wood', tier: number, gold: number): QuestDefinition {
  const definitions = BUILDABLES.filter((definition) => definition.material === material);
  return {
    id, title, category: 'building', tier, reward: coins(gold),
    objective: (state) => `Place every ${material} part (${progress(definitions.filter((definition) => buildingCount(state, definition.id) > 0).length, definitions.length)})`,
    complete: (state) => definitions.every((definition) => buildingCount(state, definition.id) > 0),
  };
}

function materialCountQuest(id: string, title: string, material: 'thatch' | 'wood', tier: number, gold: number, target: number): QuestDefinition {
  return eventQuest(id, title, 'building', tier, gold, (state) => worldBuildings(state).filter((building) => buildableById(building.definitionId).material === material).length, target, `Place ${material} parts`);
}

function ratingQuest(id: string, title: string, tier: number, gold: number, target: number): QuestDefinition {
  return eventQuest(id, title, 'building', tier, gold, (state) => Math.floor(state.highestRatingEverTenths / 10), target, 'Reach Homestead Rating');
}

function saleQuest(id: string, title: string, resource: GatherableResourceId, target: number, gold: number): QuestDefinition {
  return eventQuest(id, title, 'economy', 2, gold, (state) => state.questProgress.resourcesSold[resource], target, `Sell ${resource}`);
}

function levelQuest(id: string, title: string, tier: number, gold: number, target: number): QuestDefinition {
  return eventQuest(id, title, 'exploration', tier, gold, (state) => state.player.level, target, 'Reach player level');
}

function worldBuildingSets(state: GameState): BuildingState[][] {
  const byArea = new Map<string, BuildingState[]>();
  for (const [key, area] of Object.entries(state.visitedAreas)) byArea.set(key, area.buildings);
  byArea.set(state.currentArea.key, state.buildings);
  return [...byArea.values()];
}

function worldBuildings(state: GameState): BuildingState[] {
  const unique = new Map<string, BuildingState>();
  for (const buildings of worldBuildingSets(state)) for (const building of buildings) unique.set(building.id, building);
  return [...unique.values()];
}

function buildingCount(state: GameState, id: BuildingDefinitionId): number {
  return worldBuildings(state).filter((building) => building.definitionId === id).length;
}

function floorTileCount(state: GameState): number {
  return worldBuildings(state).filter((building) => buildableById(building.definitionId).surfaceKind === 'floor').length;
}

function allTools(state: GameState): ToolInstance[] {
  return [...state.tools, ...worldBuildings(state).flatMap((building) => building.storedTools ?? [])];
}

function maxBond(state: GameState, speciesId: SpeciesId): number {
  return state.ownedCreatures.filter((creature) => creature.speciesId === speciesId)
    .reduce((highest, creature) => Math.max(highest, creatureBondLevel(creature)), 0);
}

function hasEnvironment(state: GameState, kind: 'indoor' | 'workYard', area: number): boolean {
  return worldBuildingSets(state).some((buildings) => environments(buildings)
    .some((environment) => environment.valid && environment.kind === kind && environment.area >= area));
}

function hasMaterialEnvironment(state: GameState, kind: 'indoor' | 'workYard', area: number, material: 'thatch' | 'wood'): boolean {
  return worldBuildingSets(state).some((buildings) => environments(buildings)
    .some((environment) => environment.valid && environment.kind === kind && environment.area >= area
      && environmentUsesMaterial(buildings, environment, material)));
}

function environmentUsesMaterial(buildings: readonly BuildingState[], environment: EnvironmentInfo, material: 'thatch' | 'wood'): boolean {
  const occupancy = buildOccupancy(buildings);
  const expectedSurface = environment.kind === 'indoor' ? `${material}-floor` : `${material}-ground`;
  const allowedBoundary = environment.kind === 'indoor'
    ? new Set([`${material}-wall`, `${material}-door`])
    : new Set([`${material}-fence`, `${material}-gate`]);
  const steps = [
    { dx: 0, dy: -1, edge: 'north' }, { dx: -1, dy: 0, edge: 'west' },
    { dx: 1, dy: 0, edge: 'east' }, { dx: 0, dy: 1, edge: 'south' },
  ] as const;
  for (const key of environment.cells) {
    if (occupancy.surfaces.get(key)?.definitionId !== expectedSurface) return false;
    const [x, y] = key.split(',').map(Number) as [number, number];
    for (const { dx, dy, edge } of steps) {
      if (environment.cells.has(`${x + dx},${y + dy}`)) continue;
      const boundary = occupancy.boundaries.get(boundaryEdgeKey(x, y, edge));
      if (!boundary || !allowedBoundary.has(boundary.definitionId)) return false;
    }
  }
  return true;
}

function hasPaddockHousing(state: GameState): boolean {
  return worldBuildingSets(state).some((buildings) => environments(buildings).some((yard) => {
    if (!yard.valid || yard.kind !== 'workYard' || yard.area < 8) return false;
    return buildings.some((building) => {
      if (building.definitionId !== 'small-pen' && building.definitionId !== 'barn') return false;
      const size = effectiveBuildingDimensions(building);
      for (let dy = 0; dy < size.tilesHigh; dy++) for (let dx = 0; dx < size.tilesWide; dx++) {
        if (!yard.cells.has(`${building.tileX + dx},${building.tileY + dy}`)) return false;
      }
      return true;
    });
  }));
}

function hasFacilitiesInEnvironment(state: GameState, area: number, facilityIds: readonly BuildingDefinitionId[]): boolean {
  return worldBuildingSets(state).some((buildings) => environments(buildings).some((environment) => {
    if (!environment.valid || environment.kind !== 'indoor' || environment.area < area) return false;
    return facilityIds.every((id) => buildings.some((building) => building.definitionId === id && environment.cells.has(`${building.tileX},${building.tileY}`)));
  }));
}

function hasFurnishedMaterialEnvironment(state: GameState, area: number, facilityIds: readonly BuildingDefinitionId[]): boolean {
  return worldBuildingSets(state).some((buildings) => environments(buildings).some((environment) => {
    if (!environment.valid || environment.kind !== 'indoor' || environment.area < area || !environmentUsesMaterial(buildings, environment, 'wood')) return false;
    return facilityIds.every((id) => buildings.some((building) => building.definitionId === id && environment.cells.has(`${building.tileX},${building.tileY}`)));
  }));
}
