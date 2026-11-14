import { activeQuest, pendingQuestRewards, questViews, openingQuestViews } from '../simulation/progression';
import type { GameState } from '../simulation/state';
import type { InventoryPanel } from './inventoryPanel';

/** Data-driven quest log displayed inside the shared gameplay menu. */
export class ProgressionGuide {
  private readonly panel: HTMLElement;
  private readonly summary: HTMLSpanElement;
  private readonly activeObjective: HTMLDivElement;
  private readonly list: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly onClaimReward: (questId: string) => boolean = () => false,
  ) {
    this.panel = document.createElement('section');
    Object.assign(this.panel.style, {
      width: '100%',
      padding: '0',
      color: '#e8f0ea',
      font: '13px system-ui, sans-serif',
      pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);
    this.panel.setAttribute('aria-label', 'Quest log');

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', width: '100%', minHeight: '36px', alignItems: 'center',
      justifyContent: 'space-between', font: '600 13px system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>);
    const title = document.createElement('span');
    title.textContent = 'Quest log';
    this.summary = document.createElement('span');
    this.summary.style.opacity = '0.78';
    header.append(title, this.summary);

    this.activeObjective = document.createElement('div');
    Object.assign(this.activeObjective.style, {
      marginTop: '8px', padding: '10px 12px', borderRadius: '9px', color: '#ffe08a', lineHeight: '1.4',
      background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.1)',
    });
    this.activeObjective.setAttribute('aria-live', 'polite');

    this.list = document.createElement('div');
    Object.assign(this.list.style, {
      marginTop: '8px', paddingBottom: '8px',
    } satisfies Partial<CSSStyleDeclaration>);
    this.list.id = 'quest-log';
    this.panel.append(header, this.activeObjective, this.list);
    parent.appendChild(this.panel);
    this.refresh();
  }

  attachToMenu(menu: InventoryPanel): void {
    menu.registerTab('quests', 'Quests', this.panel, () => this.refresh());
  }

  refresh(): void {
    const quests = [...openingQuestViews(this.state), ...questViews(this.state)];
    const complete = quests.filter((quest) => quest.complete).length;
    const next = activeQuest(this.state);
    const unclaimedIds = new Set(pendingQuestRewards(this.state).map((quest) => quest.id));
    this.summary.textContent = unclaimedIds.size > 0
      ? `${complete}/${quests.length} complete · ${unclaimedIds.size} reward${unclaimedIds.size === 1 ? '' : 's'} waiting`
      : `${complete}/${quests.length} complete`;
    this.summary.style.color = unclaimedIds.size > 0 ? '#ffd23f' : '';
    this.activeObjective.textContent = next
      ? `Next: ${next.objective}${next.reward ? ` · Reward: ${next.reward}` : ''}`
      : 'Milestone quests complete!';
    this.activeObjective.style.color = next ? '#ffe08a' : '#b8e6c5';
    this.list.textContent = '';

    let previousCategory = '';
    for (const quest of quests) {
      if (quest.category !== previousCategory) {
        previousCategory = quest.category;
        const category = document.createElement('h3');
        category.textContent = quest.categoryLabel;
        Object.assign(category.style, {
          margin: '18px 2px 4px', color: '#b8e6c5', font: '700 13px system-ui, sans-serif',
          letterSpacing: '0.02em',
        } satisfies Partial<CSSStyleDeclaration>);
        this.list.appendChild(category);
      }
      // Only rewards the sim has actually banked can be collected, so the
      // button never appears for a predicate that reconciliation has not seen.
      const claimable = unclaimedIds.has(quest.id);
      const row = document.createElement('div');
      const current = quest.id === next?.id;
      Object.assign(row.style, {
        display: 'flex', gap: '10px', marginTop: '10px', padding: '10px 12px',
        border: `1px solid ${claimable ? 'rgba(255,210,63,0.55)' : current ? '#ffe08a' : 'rgba(255,255,255,0.16)'}`,
        borderRadius: '9px',
        background: claimable ? 'rgba(58,42,8,0.96)' : current ? 'rgba(47,107,67,0.96)' : 'rgba(30,48,37,0.94)',
        color: quest.complete && !claimable ? 'rgba(232,240,234,0.58)' : '#e8f0ea', lineHeight: '1.35',
      } satisfies Partial<CSSStyleDeclaration>);
      if (claimable) row.classList.add('elaris-quest-ready');
      const mark = document.createElement('span');
      mark.textContent = claimable ? '★' : quest.complete ? '✓' : '○';
      mark.setAttribute('aria-hidden', 'true');
      Object.assign(mark.style, {
        color: claimable ? '#ffd23f' : quest.complete ? '#b8e6c5' : current ? '#ffe08a' : 'rgba(232,240,234,0.58)',
        fontWeight: '700',
      });
      const text = document.createElement('span');
      text.style.flex = '1';
      const title = document.createElement('strong');
      title.textContent = `${quest.title} · Tier ${quest.tier}`;
      if (quest.complete) title.style.textDecoration = 'line-through';
      const objective = document.createElement('div');
      Object.assign(objective.style, { marginTop: '3px', fontSize: '12px', opacity: '0.72' });
      objective.textContent = quest.objective;
      const reward = document.createElement('div');
      Object.assign(reward.style, { marginTop: '3px', fontSize: '12px', color: '#ffe08a', opacity: quest.rewardClaimed ? '0.62' : '0.9' });
      reward.textContent = quest.reward ? `Reward: ${quest.reward}${quest.rewardClaimed ? ' · received' : ''}` : 'No reward';
      text.append(title, objective, reward);
      row.append(mark, text);
      if (claimable) row.append(this.claimButton(quest.id, quest.reward!));
      this.list.appendChild(row);
    }
  }

  /** The log's own payout control, for rewards the player let the banner scroll past. */
  private claimButton(questId: string, reward: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Collect';
    button.dataset.claimQuest = questId;
    button.setAttribute('aria-label', `Collect ${reward} for this quest`);
    Object.assign(button.style, {
      alignSelf: 'center', minHeight: '38px', padding: '8px 12px', flexShrink: '0',
      border: '1px solid rgba(255,210,63,0.75)', borderRadius: '7px',
      color: '#2a1f06', background: 'linear-gradient(#ffe88a, #e0b232)',
      font: '800 12px system-ui, sans-serif', cursor: 'pointer',
      touchAction: 'manipulation',
    } satisfies Partial<CSSStyleDeclaration>);
    button.addEventListener('click', () => {
      if (this.onClaimReward(questId)) this.refresh();
    });
    return button;
  }

  destroy(): void {
    this.panel.remove();
  }
}
