import { QUEST_DEFINITIONS, type QuestDefinition, type QuestId } from '../content/quests';
import type { GameState } from './state';

export interface QuestView {
  id: QuestId;
  title: string;
  objective: string;
  complete: boolean;
  rewardClaimed: boolean;
}

/** Records every satisfied predicate, including progress made out of sequence. */
export function reconcileQuestProgress(state: GameState): boolean {
  const completed = new Set(state.completedQuestIds);
  let changed = false;
  for (const quest of QUEST_DEFINITIONS) {
    if (!completed.has(quest.id) && quest.isComplete(state)) {
      state.completedQuestIds.push(quest.id);
      completed.add(quest.id);
      changed = true;
    }
  }
  return changed;
}

export function questViews(state: GameState): readonly QuestView[] {
  const completed = new Set(state.completedQuestIds);
  const claimed = new Set(state.claimedQuestRewardIds);
  return QUEST_DEFINITIONS.map((quest) => ({
    id: quest.id,
    title: quest.title,
    objective: quest.objective(state),
    complete: completed.has(quest.id) || quest.isComplete(state),
    rewardClaimed: claimed.has(quest.id),
  }));
}

export function activeQuest(state: GameState): QuestView | null {
  return questViews(state).find((quest) => !quest.complete) ?? null;
}

/** Optional rewards are explicit and idempotent. Initial quests have none yet. */
export function claimQuestReward(state: GameState, questId: QuestId): boolean {
  const definition: QuestDefinition | undefined = QUEST_DEFINITIONS.find((quest) => quest.id === questId);
  if (!definition?.reward || !state.completedQuestIds.includes(questId) || state.claimedQuestRewardIds.includes(questId)) return false;
  state.inventory[definition.reward.resource] += definition.reward.amount;
  state.claimedQuestRewardIds.push(questId);
  return true;
}

// Compatibility aliases retained for existing callers while the guide becomes a quest log.
export const progressionSteps = questViews;
export const nextProgressionStep = activeQuest;
