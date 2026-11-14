import { TILE_SIZE } from '../config/platform';
import {
  regionalIdentityForArea,
  regionalIdentityForLandmark,
  type RegionalIdentityDefinition,
} from '../content/regions';
import { creditCoins } from './coins';
import type { GameState, GatherableResourceId, RegionalContractProgressState } from './state';
import { survivalSchedule } from './survivalCycle';

const LANDMARK_DISCOVERY_RADIUS_PX = TILE_SIZE * 4;

export interface RegionalContractView {
  readonly definition: RegionalIdentityDefinition;
  readonly cycleIndex: number;
  readonly progress: number;
  readonly completed: boolean;
}

export interface RegionalProgressResult {
  readonly definition: RegionalIdentityDefinition;
  readonly message: string;
  readonly completed: boolean;
}

export type RegionalMasteryTier = 'Unknown' | 'Surveyed' | 'Familiar' | 'Mastered';

export interface RegionalMasteryView {
  readonly definition: RegionalIdentityDefinition;
  readonly tier: RegionalMasteryTier;
  readonly contractCompletions: number;
  readonly nextTier: RegionalMasteryTier | null;
  readonly nextTierRequirement: string | null;
}

export function regionalContractView(state: GameState, areaKey: string): RegionalContractView | null {
  const definition = regionalIdentityForArea(areaKey);
  if (!definition) return null;
  const cycleIndex = survivalSchedule(state).cycleIndex;
  const saved = state.regionalProgress.contracts[definition.contract.id];
  const current = saved?.cycleIndex === cycleIndex
    ? saved
    : { cycleIndex, progress: 0, completed: false };
  return { definition, ...current };
}

export function recordRegionalGather(
  state: GameState,
  resourceId: GatherableResourceId,
  amount: number,
): RegionalProgressResult | null {
  const view = regionalContractView(state, state.currentArea.key);
  if (!view || view.completed || view.definition.contract.resourceId !== resourceId || amount <= 0) return null;

  const progress: RegionalContractProgressState = {
    cycleIndex: view.cycleIndex,
    progress: Math.min(view.definition.contract.target, view.progress + amount),
    completed: false,
  };
  const completed = progress.progress >= view.definition.contract.target;
  progress.completed = completed;
  state.regionalProgress.contracts[view.definition.contract.id] = progress;

  if (!completed) {
    return {
      definition: view.definition,
      completed: false,
      message: `${view.definition.contract.title} ${progress.progress}/${view.definition.contract.target}`,
    };
  }

  creditCoins(state, view.definition.contract.rewardCoins, `${view.definition.contract.title} complete`);
  state.regionalProgress.contractCompletionCounts[view.definition.contract.id] =
    (state.regionalProgress.contractCompletionCounts[view.definition.contract.id] ?? 0) + 1;
  return {
    definition: view.definition,
    completed: true,
    message: `${view.definition.contract.title} complete · +${view.definition.contract.rewardCoins} coins`,
  };
}

/**
 * Regional mastery is derived, not independently awarded:
 * landmark discovery surveys a region, and repeat visits are proven by
 * completing its cycle contract. Three different completed cycles master it.
 */
export function regionalMasteryView(state: GameState, areaKey: string): RegionalMasteryView | null {
  const definition = regionalIdentityForArea(areaKey);
  if (!definition) return null;
  const landmarkDiscovered = state.regionalProgress.discoveredLandmarkIds.includes(definition.landmark.id);
  const contractCompletions = state.regionalProgress.contractCompletionCounts[definition.contract.id] ?? 0;
  const tier: RegionalMasteryTier = !landmarkDiscovered
    ? 'Unknown'
    : contractCompletions === 0
      ? 'Surveyed'
      : contractCompletions < 3 ? 'Familiar' : 'Mastered';
  const nextTier = tier === 'Unknown' ? 'Surveyed'
    : tier === 'Surveyed' ? 'Familiar'
      : tier === 'Familiar' ? 'Mastered' : null;
  const nextTierRequirement = tier === 'Unknown'
    ? `Discover ${definition.landmark.name}`
    : tier === 'Surveyed'
      ? `Complete ${definition.contract.title} once`
      : tier === 'Familiar'
        ? `Complete ${definition.contract.title} ${Math.max(0, 3 - contractCompletions)} more cycle${3 - contractCompletions === 1 ? '' : 's'}`
        : null;
  return { definition, tier, contractCompletions, nextTier, nextTierRequirement };
}

export function isRegionalMastered(state: GameState, areaKey: string): boolean {
  return regionalMasteryView(state, areaKey)?.tier === 'Mastered';
}

export function discoverNearbyRegionalLandmark(state: GameState): RegionalProgressResult | null {
  const definition = regionalIdentityForArea(state.currentArea.key);
  if (!definition || state.regionalProgress.discoveredLandmarkIds.includes(definition.landmark.id)) return null;
  const landmarkX = (definition.landmark.tileX + 0.5) * TILE_SIZE;
  const landmarkY = (definition.landmark.tileY + 0.5) * TILE_SIZE;
  if (Math.hypot(state.player.x - landmarkX, state.player.y - landmarkY) > LANDMARK_DISCOVERY_RADIUS_PX) return null;

  state.regionalProgress.discoveredLandmarkIds.push(definition.landmark.id);
  creditCoins(state, definition.discoveryReward.coins, `Discovered ${definition.landmark.name}`);
  return {
    definition,
    completed: true,
    message: `Discovered ${definition.landmark.name} · +${definition.discoveryReward.coins} coins`,
  };
}

export function hasDiscoveredRegionalLandmark(state: GameState, areaKey: string): boolean {
  const definition = regionalIdentityForArea(areaKey);
  return definition !== null && state.regionalProgress.discoveredLandmarkIds.includes(definition.landmark.id);
}

export function discoveredRegionalIdentity(state: GameState, landmarkId: string): RegionalIdentityDefinition | null {
  if (!state.regionalProgress.discoveredLandmarkIds.includes(landmarkId)) return null;
  return regionalIdentityForLandmark(landmarkId);
}
