import { describe, expect, it } from 'vitest';
import { activeQuest, claimQuestReward, questViews, reconcileQuestProgress } from '../../src/simulation/progression';
import { createInitialState } from '../../src/simulation/state';

describe('data-driven quests', () => {
  it('starts with a live wood objective', () => {
    const state = createInitialState(7);
    expect(activeQuest(state)).toMatchObject({ id: 'gather-wood', objective: 'Gather wood (0/5)' });
    state.resourcesCollected.wood = 3;
    expect(questViews(state)[0]).toMatchObject({ complete: false, objective: 'Gather wood (3/5)' });
  });

  it('records satisfied predicates retroactively and only once', () => {
    const state = createInitialState(7);
    state.resourcesCollected.wood = 5;
    state.tools.push({ instanceId: 'tool-1', definitionId: 'wooden-pick', durability: 48, maxDurability: 48 });
    state.highestAreaTierEver = 8;
    state.buildings.push({ id: 'bench-1', definitionId: 'workbench', tileX: 1, tileY: 1 });

    expect(reconcileQuestProgress(state)).toBe(true);
    expect(state.completedQuestIds).toEqual(['gather-wood', 'craft-wooden-tool', 'build-nook', 'build-shelter-workbench']);
    expect(reconcileQuestProgress(state)).toBe(false);
    expect(new Set(state.completedQuestIds).size).toBe(state.completedQuestIds.length);
  });

  it('keeps gathering complete after materials are spent', () => {
    const state = createInitialState(7);
    state.resourcesCollected.wood = 5;
    state.inventory.wood = 0;
    reconcileQuestProgress(state);
    expect(questViews(state)[0]).toMatchObject({ complete: true });
  });

  it('finishes the worker quest from lifetime production after cache withdrawal', () => {
    const state = createInitialState(7);
    state.workerResourcesProduced = 4;
    reconcileQuestProgress(state);
    expect(state.completedQuestIds).toContain('put-tuftle-to-work');
  });

  it('does not claim absent or duplicate rewards', () => {
    const state = createInitialState(7);
    state.completedQuestIds.push('gather-wood');
    expect(claimQuestReward(state, 'gather-wood')).toBe(false);
    expect(state.claimedQuestRewardIds).toEqual([]);
  });
});
