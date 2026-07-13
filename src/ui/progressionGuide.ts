import { activeQuest, questViews } from '../simulation/progression';
import type { GameState } from '../simulation/state';
import type { InventoryPanel } from './inventoryPanel';

/** Data-driven quest log displayed inside the shared gameplay menu. */
export class ProgressionGuide {
  private readonly panel: HTMLElement;
  private readonly summary: HTMLSpanElement;
  private readonly activeObjective: HTMLDivElement;
  private readonly list: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly state: GameState) {
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
    const quests = questViews(this.state);
    const complete = quests.filter((quest) => quest.complete).length;
    const next = activeQuest(this.state);
    this.summary.textContent = `${complete}/${quests.length} complete`;
    this.activeObjective.textContent = next ? `Next: ${next.objective}` : 'Milestone quests complete!';
    this.activeObjective.style.color = next ? '#ffe08a' : '#b8e6c5';
    this.list.textContent = '';

    for (const quest of quests) {
      const row = document.createElement('div');
      const current = quest.id === next?.id;
      Object.assign(row.style, {
        display: 'flex', gap: '10px', marginTop: '10px', padding: '10px 12px',
        border: `1px solid ${current ? '#ffe08a' : 'rgba(255,255,255,0.16)'}`,
        borderRadius: '9px', background: current ? 'rgba(47,107,67,0.96)' : 'rgba(30,48,37,0.94)',
        color: quest.complete ? 'rgba(232,240,234,0.58)' : '#e8f0ea', lineHeight: '1.35',
      } satisfies Partial<CSSStyleDeclaration>);
      const mark = document.createElement('span');
      mark.textContent = quest.complete ? '✓' : '○';
      mark.setAttribute('aria-hidden', 'true');
      Object.assign(mark.style, { color: quest.complete ? '#b8e6c5' : current ? '#ffe08a' : 'rgba(232,240,234,0.58)', fontWeight: '700' });
      const text = document.createElement('span');
      text.style.flex = '1';
      const title = document.createElement('strong');
      title.textContent = quest.title;
      if (quest.complete) title.style.textDecoration = 'line-through';
      const objective = document.createElement('div');
      Object.assign(objective.style, { marginTop: '3px', fontSize: '12px', opacity: '0.72' });
      objective.textContent = quest.objective;
      text.append(title, objective);
      row.append(mark, text);
      this.list.appendChild(row);
    }
  }

  destroy(): void {
    this.panel.remove();
  }
}
