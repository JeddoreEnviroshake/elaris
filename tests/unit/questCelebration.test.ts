import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestCelebration } from '../../src/ui/questCelebration';
import { claimQuestReward, reconcileQuestProgress } from '../../src/simulation/progression';
import { createInitialState } from '../../src/simulation/state';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const banner = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-testid="quest-complete-banner"]')!;
const strip = (): HTMLDivElement => document.querySelector<HTMLDivElement>('[data-quest-celebration]')!;

describe('quest completion celebration', () => {
  it('announces the finished quest and pays out only when tapped', () => {
    vi.useFakeTimers();
    const state = createInitialState(7);
    state.resourcesCollected.fiber = 5;
    reconcileQuestProgress(state);

    const celebration = new QuestCelebration(document.body, state, (questId) => claimQuestReward(state, questId));
    celebration.sync();

    expect(strip().style.display).toBe('flex');
    expect(banner().textContent).toContain('First Materials');
    expect(banner().textContent).toContain('1 coins');
    expect(banner().classList.contains('elaris-quest-banner')).toBe(true);
    expect(state.coins).toBe(0);

    banner().click();
    expect(state.coins).toBe(1);
    expect(banner().textContent).toContain('Collected');
    expect(banner().disabled).toBe(true);

    // A second tap during the payout cannot double-claim.
    banner().click();
    expect(state.coins).toBe(1);

    vi.advanceTimersByTime(2_000);
    expect(strip().style.display).toBe('none');

    celebration.destroy();
  });

  it('advances through a backlog one reward at a time', () => {
    vi.useFakeTimers();
    const state = createInitialState(7);
    state.resourcesCollected.fiber = 5;
    state.highestAreaTierEver = 4;
    reconcileQuestProgress(state);

    const celebration = new QuestCelebration(document.body, state, (questId) => claimQuestReward(state, questId));
    celebration.sync();
    expect(banner().textContent).toContain('First Materials');
    expect(banner().textContent).toContain('+1');

    banner().click();
    vi.advanceTimersByTime(2_000);
    expect(strip().style.display).toBe('flex');
    expect(banner().textContent).toContain('A Nook of Your Own');

    banner().click();
    vi.advanceTimersByTime(2_000);
    expect(strip().style.display).toBe('none');
    expect(state.coins).toBe(4);

    celebration.destroy();
  });

  it('stays out of the way while the battle screen is up', () => {
    const state = createInitialState(7);
    state.resourcesCollected.fiber = 5;
    reconcileQuestProgress(state);

    const celebration = new QuestCelebration(document.body, state, () => true);
    celebration.sync();
    celebration.setHidden(true);
    expect(strip().style.display).toBe('none');
    celebration.sync();
    expect(strip().style.display).toBe('none');
    celebration.setHidden(false);
    expect(strip().style.display).toBe('flex');

    celebration.destroy();
  });
});
