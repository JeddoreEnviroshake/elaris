import { QUEST_CATEGORY_LABELS, QUEST_DEFINITIONS, type QuestCategory, type QuestDefinition, type QuestId } from '../content/quests';
import type { GameState } from './state';
import { creditCoins } from './coins';
import { grantXp } from './characterProgression';
import { activeOpeningMilestone, OPENING_MILESTONES } from '../content/onboarding';
import { reconcileOpeningChapter } from './onboarding';
import { reconcileOpeningShelter } from './openingShelter';
import { advanceOpeningFog, openingFogGuidance } from './openingFog';
import { paddockView, reconcileOpeningPaddock } from './openingPaddock';
import { reconcileOpeningSupplyRun } from './openingSupplyRun';
import { openingGardenView, openingNextGoal, reconcileOpeningGarden } from './openingGarden';

export interface QuestView {
  id: QuestId;
  title: string;
  objective: string;
  complete: boolean;
  rewardClaimed: boolean;
  reward: string | null;
  category: QuestCategory;
  categoryLabel: string;
  tier: number;
  mapAreaKey: string | null;
  locationLabel: string | null;
}

const questById = new Map<QuestId, QuestDefinition>(QUEST_DEFINITIONS.map((quest) => [quest.id, quest]));

/**
 * Records every satisfied predicate, including progress made out of sequence.
 * Rewards are deliberately left unclaimed: the payout is the celebration, and
 * the player collects it by tapping the quest instead of finding coins already
 * in their purse.
 */
export function reconcileQuestProgress(state: GameState): boolean {
  const completed = new Set(state.completedQuestIds);
  let changed = reconcileOpeningChapter(state);
  if (reconcileOpeningShelter(state)) changed = true;
  if (advanceOpeningFog(state)) changed = true;
  if (reconcileOpeningPaddock(state)) changed = true;
  if (reconcileOpeningSupplyRun(state)) changed = true;
  if (reconcileOpeningGarden(state)) changed = true;
  for (const quest of QUEST_DEFINITIONS) {
    if (completed.has(quest.id) || !quest.complete(state)) continue;
    state.completedQuestIds.push(quest.id);
    completed.add(quest.id);
    changed = true;
  }
  return changed;
}

export function questViews(state: GameState): readonly QuestView[] {
  const completed = new Set(state.completedQuestIds);
  const claimed = new Set(state.claimedQuestRewardIds);
  return QUEST_DEFINITIONS.map((quest) => questView(
    quest,
    state,
    completed.has(quest.id) || quest.complete(state),
    claimed.has(quest.id),
  ));
}

/**
 * Completed quests still holding an unclaimed reward, in the order they were
 * finished, so the celebration queue pays out oldest first.
 */
export function pendingQuestRewards(state: GameState): readonly QuestView[] {
  const claimed = new Set(state.claimedQuestRewardIds);
  const pending: QuestView[] = [];
  for (const id of state.completedQuestIds) {
    if (claimed.has(id)) continue;
    const definition = questById.get(id);
    if (!definition?.reward) continue;
    pending.push(questView(definition, state, true, false));
  }
  return pending;
}

function questView(quest: QuestDefinition, state: GameState, complete: boolean, rewardClaimed: boolean): QuestView {
  return {
    id: quest.id,
    title: quest.title,
    objective: quest.objective(state),
    complete,
    rewardClaimed,
    reward: quest.reward ? formatQuestReward(quest.reward) : null,
    category: quest.category,
    categoryLabel: QUEST_CATEGORY_LABELS[quest.category],
    tier: quest.tier,
    mapAreaKey: quest.mapAreaKey ?? null,
    locationLabel: quest.locationLabel ?? null,
  };
}

export function activeQuest(state: GameState): QuestView | null {
  const opening = activeOpeningMilestone(state);
  let openingObjective = opening?.objective ?? '';
  if (opening?.id === 'gather-together') {
    const companion = state.ownedCreatures.find((creature) => creature.id === state.onboarding.companionId);
    if (!companion) openingObjective = 'Bring a Tuftle along: tame one or order a trained Tuftle, then assign it to Follow.';
    else if (state.expeditions.some((expedition) => expedition.creatureId === companion.id)) openingObjective = `${companion.name} is away on an expedition. Collect its return before gathering together.`;
    else if (companion.role !== 'follow') openingObjective = `Assign ${companion.name} to Follow in Creatures, then harvest fiber plants at the grove outside the west gate.`;
  }
  if (opening?.id === 'weather-fog') openingObjective = `${openingFogGuidance(state)?.title ?? opening.title}. Stay in purified air; open the Shelter guide for help.`;
  if (opening?.id === 'collect-production') openingObjective = `${paddockView(state).status}. Open the Paddock guide to assign Work and collect the first delivery.`;
  if (opening?.id === 'harvest-garden') openingObjective = `${openingGardenView(state).status} Open Garden to collect nearby and review your journey.`;
  if (opening) return {
    id: `opening-${opening.id}`, title: opening.title, objective: openingObjective,
    complete: false, rewardClaimed: true, reward: null, category: 'main', categoryLabel: 'Main Journey',
    tier: 1, mapAreaKey: '0,0', locationLabel: 'Elaris roadside',
  };
  const garden = state.onboarding.garden;
  if (state.onboarding.status === 'complete' && garden && !garden.recapAcknowledged) return {
    id: 'opening-journey-recap', title: 'A home and a companion', objective: 'Your first garden harvest is in. Open Garden to see what you built together and choose your next direction.',
    complete: false, rewardClaimed: true, reward: null, category: 'main', categoryLabel: 'Main Journey', tier: 1, mapAreaKey: '0,0', locationLabel: 'Your home',
  };
  const next = openingNextGoal(state);
  if (next && !next.complete) return {
    id: `opening-next-${next.goal}`, title: next.title, objective: next.objective,
    complete: false, rewardClaimed: true, reward: null, category: 'main', categoryLabel: 'Next Direction', tier: 1, mapAreaKey: null, locationLabel: null,
  };
  return questViews(state).find((quest) => !quest.complete) ?? null;
}

/** Chapter history shares the quest log without adding synthetic IDs to legacy quest saves. */
export function openingQuestViews(state: GameState): readonly QuestView[] {
  if (state.onboarding.status === 'legacy') return [];
  return OPENING_MILESTONES.map((milestone) => ({
    id: `opening-${milestone.id}`, title: milestone.title, objective: milestone.objective,
    complete: state.onboarding.completedMilestoneIds.includes(milestone.id),
    rewardClaimed: true, reward: null, category: 'main', categoryLabel: 'Main Journey',
    tier: 1, mapAreaKey: '0,0', locationLabel: 'Elaris roadside',
  }));
}

/** One suggested objective per parallel quest line. */
export function activeQuests(state: GameState): readonly QuestView[] {
  const result = new Map<QuestCategory, QuestView>();
  for (const quest of questViews(state)) {
    if (!quest.complete && !result.has(quest.category)) result.set(quest.category, quest);
  }
  return [...result.values()];
}

/**
 * Experience paid alongside a quest's coins, one XP per gold. Quest gold is
 * already tiered by how hard the objective is, so it doubles as the difficulty
 * curve for levelling and the two can never drift apart. Resource rewards have
 * no gold value and so pay no XP.
 */
export function questRewardXp(reward: NonNullable<QuestDefinition['reward']>): number {
  return reward.kind === 'coins' ? reward.amount : 0;
}

/** Optional rewards are explicit and idempotent. */
export function claimQuestReward(state: GameState, questId: QuestId): boolean {
  const definition: QuestDefinition | undefined = questById.get(questId);
  if (!definition?.reward || !state.completedQuestIds.includes(questId) || state.claimedQuestRewardIds.includes(questId)) return false;
  if (definition.reward.kind === 'coins') {
    const credited = creditCoins(state, definition.reward.amount, `${definition.title} reward`);
    if (!credited.ok) return false;
  } else {
    state.inventory[definition.reward.resource] += definition.reward.amount;
  }
  // Only after the payout is certain: a refused credit leaves the quest
  // unclaimed, and the retry must not have already banked the XP.
  grantXp(state, questRewardXp(definition.reward));
  state.claimedQuestRewardIds.push(questId);
  return true;
}

export function formatQuestReward(reward: NonNullable<QuestDefinition['reward']>): string {
  const base = reward.kind === 'coins'
    ? `${reward.amount} coins`
    : `${reward.amount} ${reward.resource}`;
  const xp = questRewardXp(reward);
  return xp > 0 ? `${base} + ${xp} XP` : base;
}

// Compatibility aliases retained for existing callers while the guide becomes a quest log.
export const progressionSteps = questViews;
export const nextProgressionStep = activeQuest;
