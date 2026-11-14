import { buildableById } from '../content/buildingParts';
import type {
  AreaThemeId,
  BuildingDefinitionId,
  CompanionAbilityId,
  GameState,
  GatherableResourceId,
  ResourceId,
  SpeciesId,
  ToolDefinitionId,
} from './state';

export function incrementQuestCounter(record: Record<string, number>, key: string, amount = 1): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) return;
  record[key] = (record[key] ?? 0) + amount;
}

export function recordCraft(state: GameState, id: ToolDefinitionId | 'taming-snare' | 'reinforced-snare' | 'arrows' | 'iron-ingot' | 'bow' | 'cloth-mask', amount = 1): void {
  incrementQuestCounter(state.questProgress.crafted, id, amount);
}

export function recordBuildingPlaced(state: GameState, id: BuildingDefinitionId): void {
  incrementQuestCounter(state.questProgress.buildingsPlaced, id);
  if (buildableById(id).material === 'wood') {
    const removedThatch = Object.entries(state.questProgress.buildingsRemoved)
      .filter(([definitionId]) => buildableById(definitionId as BuildingDefinitionId).material === 'thatch')
      .reduce((sum, [, count]) => sum + count, 0);
    if (state.questProgress.renovationWoodPlaced < removedThatch) state.questProgress.renovationWoodPlaced += 1;
  }
}

export function recordBuildingRemoved(state: GameState, id: BuildingDefinitionId): void {
  incrementQuestCounter(state.questProgress.buildingsRemoved, id);
}

export function recordEncounter(state: GameState, speciesId: SpeciesId): void {
  state.questProgress.creatureEncounters[speciesId] += 1;
}

export function recordCreatureDefeat(state: GameState, speciesId: SpeciesId): void {
  state.questProgress.creatureDefeats[speciesId] += 1;
}

export function recordCompanionWin(state: GameState, speciesId: SpeciesId | null): void {
  if (speciesId) state.questProgress.companionWins[speciesId] += 1;
}

export function recordAbilityUse(state: GameState, abilityId: CompanionAbilityId): void {
  incrementQuestCounter(state.questProgress.abilityUses, abilityId);
}

export function recordFollowerGather(state: GameState, resource: GatherableResourceId, amount: number): void {
  for (const creature of state.ownedCreatures) {
    if (creature.role !== 'follow') continue;
    state.questProgress.gatheredWithFollower[creature.speciesId][resource] += amount;
  }
}

export function recordAreaVisit(state: GameState): void {
  pushUnique(state.questProgress.areaKeysVisited, state.currentArea.key);
  pushUnique(state.questProgress.areaThemesVisited, state.currentArea.theme);
  for (const creature of state.ownedCreatures) {
    if (creature.role === 'follow') pushUnique(state.questProgress.areaKeysVisitedWithFollower[creature.speciesId], state.currentArea.key);
  }
}

export function recordResourceSale(state: GameState, resource: ResourceId, amount: number): void {
  // Only gathered resources carry a sale ledger; crafted supplies have no quest.
  const sold = state.questProgress.resourcesSold;
  if (resource in sold) sold[resource as keyof typeof sold] += amount;
}

export function recordUpgrade(state: GameState, axis: 'power' | 'speed' | 'durability', rank: number): void {
  incrementQuestCounter(state.questProgress.upgradesPurchased, `${axis}-${rank}`);
}

export function recordFarmOrder(state: GameState, speciesId: SpeciesId): void {
  state.questProgress.farmOrders[speciesId] += 1;
}

function pushUnique<T extends string>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

/** Runtime guard used by migration validation without importing world content. */
export function isAreaThemeId(value: unknown): value is AreaThemeId {
  return value === 'elaris' || value === 'forest' || value === 'mountain'
    || value === 'meadow' || value === 'thicket' || value === 'marsh';
}
