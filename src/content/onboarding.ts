import type { GameState } from '../simulation/state';
import type { ShelterSite } from '../simulation/openingShelter';

export const OPENING_CHAPTER_VERSION = 7;
export const OPENING_NEXT_GOALS = ['expand-home', 'explore', 'befriend'] as const;
export type OpeningNextGoal = typeof OPENING_NEXT_GOALS[number];
export interface OpeningGardenState {
  plan: ShelterSite | null;
  bedId: string | null;
  harvestedFiber: number;
  recapAcknowledged: boolean;
  nextGoal: OpeningNextGoal | null;
}
export function createOpeningGarden(): OpeningGardenState {
  return { plan: null, bedId: null, harvestedFiber: 0, recapAcknowledged: false, nextGoal: null };
}
export interface OpeningSupplyRunState {
  site: ShelterSite | null;
  discovered: boolean;
  suppliesRecovered: boolean;
  sideCacheOpened: boolean;
  blueprintClaimed: boolean;
  blueprintInstanceId: string | null;
  blueprintDropId: string | null;
}
export function createOpeningSupplyRun(): OpeningSupplyRunState {
  return { site: null, discovered: false, suppliesRecovered: false, sideCacheOpened: false,
    blueprintClaimed: false, blueprintInstanceId: null, blueprintDropId: null };
}
export const openingSupplyCacheId = (seed: number) => `opening-supplies-${seed}`;
export const openingSideCacheId = (seed: number) => `opening-side-cache-${seed}`;
export function isOpeningDiscoveryPaper(state: Pick<GameState, 'onboarding' | 'unlockedItemIds'>, id: string): boolean {
  return state.onboarding.supplyRun?.blueprintInstanceId === id && !state.unlockedItemIds.includes('garden-bed');
}
export interface OpeningProductionState {
  plan: ShelterSite | null;
  sourceHousingId: string | null;
  sourceAreaKey: string | null;
  producedFiber: number;
  collectedFiber: number;
}
export function createOpeningProduction(): OpeningProductionState {
  return { plan: null, sourceHousingId: null, sourceAreaKey: null, producedFiber: 0, collectedFiber: 0 };
}
export const OPENING_PADDOCK_BLUEPRINTS = ['thatch-ground', 'thatch-fence', 'thatch-gate', 'small-pen'] as const;
export const OPENING_FOG_PREPARATION_SECONDS = 45;
export const OPENING_FOG_SECONDS = 45;
export interface OpeningThreatState {
  /** Upgraded saves retain the ordinary tick-based schedule. */
  mode: 'guided' | 'ordinary';
  preparationStartedAtTick: number | null;
  fogStartsAtTick: number | null;
  fogEndsAtTick: number | null;
  /** Leaving Elaris releases the guided schedule permanently. */
  releasedAtTick: number | null;
  observedCycleIndex: number | null;
  shelteredTicks: number;
  lastObservedTick: number | null;
  aftermathAcknowledged: boolean;
}
export function createOpeningThreat(mode: OpeningThreatState['mode'] = 'guided'): OpeningThreatState {
  return { mode, preparationStartedAtTick: null, fogStartsAtTick: null, fogEndsAtTick: null,
    releasedAtTick: null, observedCycleIndex: null, shelteredTicks: 0, lastObservedTick: null, aftermathAcknowledged: false };
}
export const STARTER_TUFTLE_POSITION = { x: 82 * 16, y: 82 * 16 } as const;
export const OPENING_MILESTONES = [
  { id: 'pick-berries', requires: [], title: 'Forage', objective: 'Walk up to a berry bush and Gather to pick its berries. Berries are food for you and for wild creatures.' },
  { id: 'craft-axe', requires: ['pick-berries'], title: 'A first tool', objective: 'Gather wood from trees by hand, then craft a Wooden Axe (5 wood) from the Craft menu.' },
  { id: 'craft-snare', requires: ['craft-axe'], title: 'Set a snare', objective: 'Your axe taught you the Taming Snare. Gather fiber from the tall leafy plants, then craft a Taming Snare (1 wood, 2 fiber).' },
  { id: 'meet-tuftle', requires: ['craft-snare'], title: 'A nervous little neighbour', objective: 'Approach the Tuftle by the road southeast of where you started and choose Help Tuftle.' },
  { id: 'befriend-tuftle', requires: ['meet-tuftle'], title: 'Tame the Tuftle', objective: 'Add a Berry and your Taming Snare to your hotbar (Bag → tap the item → Add to Hotbar). Use the Berry beside the Tuftle, then throw the Snare at it.' },
  { id: 'gather-together', requires: ['befriend-tuftle'], title: 'Better together', objective: 'Take your following Tuftle through the west gate to the resource grove. Harvest fiber plants together to earn shelter recipes.' },
  { id: 'build-shelter', requires: ['gather-together'], title: 'A home together', objective: 'Build an enclosed eight-tile room with a usable door, Air Purifier, and Storage Box. Open the Shelter guide for a suggested layout.' },
  { id: 'weather-fog', requires: ['build-shelter'], title: 'Weather the first fog', objective: 'Stay in purified air during the fog. Organize storage or build safely, then watch the air clear. Elaris sanctuary is always a fallback.' },
  { id: 'build-paddock', requires: ['weather-fog'], title: 'A place to work', objective: 'Build an enclosed eight-tile work yard with a Small Pen. Open the Paddock guide for a suggested layout and your Tuftle’s assignment.' },
  { id: 'collect-production', requires: ['build-paddock'], title: 'Our first delivery', objective: 'Assign your Tuftle to Work in its housing, then collect its first two fiber from the Pen.' },
  { id: 'return-to-follow', requires: ['collect-production'], title: 'Together again', objective: 'Choose Follow for the same Tuftle before your next adventure. Its housing stays reserved.' },
  { id: 'recover-supplies', requires: ['return-to-follow'], title: 'The lost supply cart', objective: 'Follow Elaris’s west road to the supply cart. Open Supply Run for directions.' },
  { id: 'collect-discovery', requires: ['recover-supplies'], title: 'A discovery to bring home', objective: 'Collect the guaranteed Garden Bed blueprint. If your bag is full, the paper waits safely at the cart or Elaris public workbench.' },
  { id: 'register-discovery', requires: ['collect-discovery'], title: 'Make the discovery yours', objective: 'Bring the Garden Bed paper to a workbench and register it. Open Garden for directions. The recipe stays yours after defeat.' },
  { id: 'build-garden', requires: ['register-discovery'], title: 'Room to grow', objective: 'Return to your paddock and build a Garden Bed for 4 wood and 2 fiber. Open Garden for a placement preview; a custom garden in Elaris counts too.' },
  { id: 'harvest-garden', requires: ['build-garden'], title: 'Our first garden harvest', objective: 'Let the Garden Bed grow, then collect its fiber nearby. Open Garden for its timer, storage, and your journey recap.' },
] as const;
export const OPENING_SHELTER_BLUEPRINTS = [
  'thatch-floor', 'thatch-wall', 'thatch-door', 'wooden-axe', 'wooden-pick', 'wooden-sickle', 'air-purifier', 'field-cache',
] as const;
export type OpeningMilestoneId = typeof OPENING_MILESTONES[number]['id'];

export interface OpeningChapterState {
  version: number;
  status: 'active' | 'complete' | 'legacy';
  completedMilestoneIds: OpeningMilestoneId[];
  issuedRewardIds: string[];
  starterWildCreatureId: string | null;
  companionId: string | null;
  shelterPlan: ShelterSite | null;
  shelterHome: ShelterSite | null;
  firstThreat: OpeningThreatState | null;
  production: OpeningProductionState | null;
  supplyRun: OpeningSupplyRunState | null;
  garden: OpeningGardenState | null;
}

export function starterTuftleId(seed: number): string { return `opening-tuftle-${seed}`; }

export function createOpeningChapter(seed: number, legacy = false): OpeningChapterState {
  return {
    version: OPENING_CHAPTER_VERSION, status: legacy ? 'legacy' : 'active',
    completedMilestoneIds: [], issuedRewardIds: [],
    starterWildCreatureId: legacy ? null : starterTuftleId(seed), companionId: null,
    shelterPlan: null, shelterHome: null, firstThreat: legacy ? null : createOpeningThreat(), production: legacy ? null : createOpeningProduction(), supplyRun: legacy ? null : createOpeningSupplyRun(), garden: legacy ? null : createOpeningGarden(),
  };
}

/** Only the authored introduction is protected; ordinary wild Tuftles keep their rules. */
export function isOpeningTuftle(state: Pick<GameState, 'onboarding'>, id: string): boolean {
  return state.onboarding?.status === 'active' && !state.onboarding.completedMilestoneIds.includes('befriend-tuftle')
    && state.onboarding.starterWildCreatureId === id;
}

export function activeOpeningMilestone(state: Pick<GameState, 'onboarding'>) {
  const chapter = state.onboarding;
  if (!chapter || chapter.status !== 'active') return null;
  const completed = new Set<string>(chapter.completedMilestoneIds);
  return OPENING_MILESTONES.find((milestone) => !completed.has(milestone.id)
    && milestone.requires.every((id) => completed.has(id))) ?? null;
}
