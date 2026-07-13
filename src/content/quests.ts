import type { GameState, ResourceId } from '../simulation/state';

export type QuestId =
  | 'gather-wood'
  | 'craft-wooden-tool'
  | 'gather-stone-fiber'
  | 'build-nook'
  | 'build-shelter-workbench'
  | 'create-work-yard'
  | 'place-worker-infrastructure'
  | 'tame-tuftle'
  | 'put-tuftle-to-work';

export interface QuestReward {
  resource: ResourceId;
  amount: number;
}

export interface QuestDefinition {
  id: QuestId;
  title: string;
  objective: (state: GameState) => string;
  isComplete: (state: GameState) => boolean;
  reward?: QuestReward;
}

/** Ordered Milestone 1 onboarding. Predicates only inspect authoritative state. */
export const QUEST_DEFINITIONS: readonly QuestDefinition[] = [
  {
    id: 'gather-wood',
    title: 'First Materials',
    objective: (state) => `Gather wood (${Math.min(state.resourcesCollected.wood, 5)}/5)`,
    isComplete: (state) => state.resourcesCollected.wood >= 5,
  },
  {
    id: 'craft-wooden-tool',
    title: 'A Better Tool',
    objective: () => 'Craft any Wooden tool',
    isComplete: (state) => state.tools.some((tool) => tool.definitionId.startsWith('wooden-')),
  },
  {
    id: 'gather-stone-fiber',
    title: 'Broaden Your Supplies',
    objective: (state) => `Gather stone ${Math.min(state.resourcesCollected.stone, 3)}/3 and fiber ${Math.min(state.resourcesCollected.fiber, 5)}/5`,
    isComplete: (state) => state.resourcesCollected.stone >= 3 && state.resourcesCollected.fiber >= 5,
  },
  {
    id: 'build-nook',
    title: 'A Nook of Your Own',
    objective: () => 'Build an enclosed 4-tile Nook',
    isComplete: (state) => state.highestAreaTierEver >= 4,
  },
  {
    id: 'build-shelter-workbench',
    title: 'Set Up a Workshop',
    objective: (state) => state.highestAreaTierEver < 8 ? 'Expand an enclosure to 8 tiles' : 'Place a Workbench inside your Shelter',
    isComplete: (state) => state.highestAreaTierEver >= 8 && state.buildings.some((building) => building.definitionId === 'workbench'),
  },
  {
    id: 'create-work-yard',
    title: 'Room to Grow',
    objective: () => 'Create a valid 16-tile environment',
    isComplete: (state) => state.highestAreaTierEver >= 16,
  },
  {
    id: 'place-worker-infrastructure',
    title: 'Prepare for a Helper',
    objective: (state) => {
      const hasCache = state.buildings.some((building) => building.definitionId === 'field-cache');
      const hasPlanter = state.buildings.some((building) => building.definitionId === 'woodlot-planter');
      if (!hasCache) return 'Place a Field Cache';
      return hasPlanter ? 'Worker infrastructure ready' : 'Place a Woodlot Planter';
    },
    isComplete: (state) =>
      state.buildings.some((building) => building.definitionId === 'field-cache') &&
      state.buildings.some((building) => building.definitionId === 'woodlot-planter'),
  },
  {
    id: 'tame-tuftle',
    title: 'Make a New Friend',
    objective: () => 'Offer fiber to tame a Tuftle',
    isComplete: (state) => state.ownedCreatures.some((creature) => creature.speciesId === 'tuftle'),
  },
  {
    id: 'put-tuftle-to-work',
    title: 'Working Together',
    objective: (state) => state.ownedCreatures.some((creature) => creature.role === 'work')
      ? 'Wait for your Tuftle to deliver a resource'
      : 'Assign your Tuftle to work',
    isComplete: (state) => state.workerResourcesProduced > 0,
  },
];

export const QUEST_IDS = new Set<string>(QUEST_DEFINITIONS.map((quest) => quest.id));
