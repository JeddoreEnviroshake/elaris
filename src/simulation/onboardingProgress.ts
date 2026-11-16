import { OPENING_MILESTONES, OPENING_SHELTER_BLUEPRINTS, type OpeningMilestoneId } from '../content/onboarding';
import { learnBlueprint } from './blueprintKnowledge';
import type { GameState } from './state';
import { GARDEN_BED_YIELD_FIBER } from '../config/balance';

/** Facts are independent of UI, ordering, and optional reward banners. */
export function completeOpeningMilestone(state: GameState, id: OpeningMilestoneId): boolean {
  const chapter = state.onboarding;
  if (chapter.status !== 'active' || !OPENING_MILESTONES.some((milestone) => milestone.id === id)
    || chapter.completedMilestoneIds.includes(id)) return false;
  chapter.completedMilestoneIds.push(id);
  return true;
}

/** A berry bush paid out berries: the first foraging lesson. */
export function recordOpeningBerryPick(state: GameState): boolean {
  return completeOpeningMilestone(state, 'pick-berries');
}

/**
 * The crafting lessons are read off the craft counters, so a tool or snare made
 * by any route — the Craft menu, a workbench, before or after the berries —
 * counts. Crafting the axe teaches the Taming Snare: the tutorial's one early
 * recipe, granted so the player can make the snare that tames their partner.
 */
export function reconcileOpeningCrafts(state: GameState): boolean {
  const chapter = state.onboarding;
  if (chapter.status !== 'active') return false;
  let changed = false;
  if ((state.questProgress.crafted['wooden-axe'] ?? 0) > 0 && completeOpeningMilestone(state, 'craft-axe')) changed = true;
  if (chapter.completedMilestoneIds.includes('craft-axe') && !state.unlockedItemIds.includes('taming-snare')
    && !chapter.completedMilestoneIds.includes('befriend-tuftle')) {
    learnBlueprint(state, 'taming-snare');
    changed = true;
  }
  if ((state.questProgress.crafted['taming-snare'] ?? 0) > 0 && completeOpeningMilestone(state, 'craft-snare')) changed = true;
  return changed;
}

/** Called only after real bonus fiber has been awarded by a harvest. */
export function recordOpeningGatherAssistance(state: GameState, creatureId: string, bonusUnits: number): boolean {
  const chapter = state.onboarding;
  if (chapter.status !== 'active' || !Number.isSafeInteger(bonusUnits) || bonusUnits <= 0
    || chapter.companionId !== creatureId || !chapter.completedMilestoneIds.includes('befriend-tuftle')
    || chapter.issuedRewardIds.includes('shelter-recipes')) return false;
  completeOpeningMilestone(state, 'gather-together');
  for (const id of OPENING_SHELTER_BLUEPRINTS) learnBlueprint(state, id);
  state.pendingBlueprintGrantIds = state.pendingBlueprintGrantIds.filter((id) => !OPENING_SHELTER_BLUEPRINTS.some((recipe) => recipe === id));
  chapter.issuedRewardIds.push('shelter-recipes');
  return true;
}

/** Attribution comes from normal worker settlement, including ordinary offline production. */
export function recordOpeningProduction(state: GameState, creatureId: string, housingId: string, amount: number): void {
  const chapter = state.onboarding; const production = chapter.production;
  if (!production || chapter.status !== 'active' || chapter.companionId !== creatureId || amount <= 0
    || chapter.completedMilestoneIds.includes('collect-production')) return;
  if (production.sourceHousingId !== housingId || production.sourceAreaKey !== state.currentArea.key) {
    production.sourceHousingId = housingId; production.sourceAreaKey = state.currentArea.key;
    production.producedFiber = 0; production.collectedFiber = 0;
  }
  production.producedFiber = Math.min(2, production.producedFiber + amount);
}

/** Collection is credited only after the shared bin command actually moved attributed output. */
export function recordOpeningProductionCollection(state: GameState, housingId: string, amount: number): void {
  const chapter = state.onboarding; const production = chapter.production;
  if (!production || chapter.status !== 'active' || production.sourceHousingId !== housingId || production.sourceAreaKey !== state.currentArea.key) return;
  production.collectedFiber = Math.min(production.producedFiber, production.collectedFiber + amount);
}

/** Only a successful, real Garden Bed collection can finish the garden lesson. */
export function recordOpeningGardenHarvest(state: GameState, buildingId: string, amount: number): void {
  const garden = state.onboarding.garden;
  if (!garden || state.onboarding.status !== 'active' || state.currentArea.key !== '0,0'
    || !state.onboarding.completedMilestoneIds.includes('register-discovery')
    || !state.buildings.some((building) => building.id === buildingId && building.definitionId === 'garden-bed')
    || !Number.isSafeInteger(amount) || amount <= 0) return;
  garden.bedId = buildingId;
  completeOpeningMilestone(state, 'build-garden');
  garden.harvestedFiber = Math.min(GARDEN_BED_YIELD_FIBER, garden.harvestedFiber + amount);
}
