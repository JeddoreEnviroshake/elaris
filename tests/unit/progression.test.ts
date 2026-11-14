import { describe, expect, it } from 'vitest';
import { activeQuest, claimQuestReward, pendingQuestRewards, questViews, reconcileQuestProgress } from '../../src/simulation/progression';
import { createInitialState } from '../../src/simulation/state';

describe('data-driven quests', () => {
  it('keeps a live fiber objective after the opening partnership', () => {
    const state = createInitialState(7);
    state.onboarding.status = 'legacy';
    expect(activeQuest(state)).toMatchObject({ id: 'gather-fiber', objective: 'Gather fiber from plants (0/5)' });
    state.resourcesCollected.fiber = 3;
    expect(questViews(state)[0]).toMatchObject({ complete: false, objective: 'Gather fiber from plants (3/5)' });
  });

  it('records satisfied predicates retroactively and only once', () => {
    const state = createInitialState(7);
    state.resourcesCollected.fiber = 5;
    state.tools.push({ instanceId: 'tool-1', definitionId: 'wooden-sickle', durability: 48, maxDurability: 48, powerRank: 0, speedRank: 0, durabilityRank: 0 });
    state.highestAreaTierEver = 4;

    expect(reconcileQuestProgress(state)).toBe(true);
    expect(state.completedQuestIds).toEqual(['gather-fiber', 'craft-wooden-sickle', 'build-nook']);
    // Rewards wait for the player to tap the celebration.
    expect(state.claimedQuestRewardIds).toEqual([]);
    expect(state.coins).toBe(0);
    expect(reconcileQuestProgress(state)).toBe(false);
    expect(new Set(state.completedQuestIds).size).toBe(state.completedQuestIds.length);
  });

  it('queues unclaimed rewards in completion order and clears them as they are collected', () => {
    const state = createInitialState(7);
    state.resourcesCollected.fiber = 5;
    state.highestAreaTierEver = 4;
    reconcileQuestProgress(state);

    expect(pendingQuestRewards(state).map((quest) => quest.id)).toEqual(['gather-fiber', 'build-nook']);
    expect(pendingQuestRewards(state)[0]).toMatchObject({ title: 'First Materials', reward: '1 coins + 1 XP', complete: true, rewardClaimed: false });

    expect(claimQuestReward(state, 'gather-fiber')).toBe(true);
    expect(state.coins).toBe(1);
    expect(state.player.xp).toBe(1);
    expect(pendingQuestRewards(state).map((quest) => quest.id)).toEqual(['build-nook']);

    expect(claimQuestReward(state, 'build-nook')).toBe(true);
    expect(state.coins).toBe(4);
    expect(state.player.xp).toBe(4);
    expect(pendingQuestRewards(state)).toEqual([]);
  });

  it('keeps gathering complete after materials are spent', () => {
    const state = createInitialState(7);
    state.resourcesCollected.fiber = 5;
    state.inventory.fiber = 0;
    reconcileQuestProgress(state);
    expect(questViews(state)[0]).toMatchObject({ complete: true });
  });

  it('finishes the worker quest from lifetime production after cache withdrawal', () => {
    const state = createInitialState(7);
    state.workerResourcesProduced = 4;
    reconcileQuestProgress(state);
    expect(state.completedQuestIds).toContain('put-tuftle-to-work');
  });

  it('claims a completed reward exactly once', () => {
    const state = createInitialState(7);
    state.completedQuestIds.push('gather-fiber');
    expect(claimQuestReward(state, 'gather-fiber')).toBe(true);
    expect(state.coins).toBe(1);
    expect(state.player.xp).toBe(1);
    expect(state.claimedQuestRewardIds).toEqual(['gather-fiber']);
    expect(claimQuestReward(state, 'gather-fiber')).toBe(false);
    expect(state.coins).toBe(1);
    expect(state.player.xp).toBe(1);
  });

  it('pays XP equal to the gold and levels the player when it crosses the threshold', () => {
    const state = createInitialState(7);
    state.player.xp = 95;
    state.completedQuestIds.push('news-for-elaris');
    expect(claimQuestReward(state, 'news-for-elaris')).toBe(true);
    expect(state.coins).toBe(13);
    expect(state.player.level).toBe(2);
    expect(state.player.xp).toBe(8);
  });
});
