import type { NpcBarkView } from '../presentation/npcBarks';
import { div } from './controls';

/** A non-modal, non-interactive subtitle for incidental NPC speech. */
export class NpcBark {
  readonly root: HTMLDivElement;
  private hideTimer: number | null = null;

  constructor(parent: HTMLElement) {
    this.root = div({
      position: 'fixed', left: '50%', bottom: '120px', transform: 'translateX(-50%)', zIndex: '35',
      display: 'none', maxWidth: 'min(560px, calc(100vw - 28px))', padding: '8px 12px', borderRadius: '12px',
      color: '#fff1d5', background: 'rgba(22,19,18,.88)', border: '1px solid rgba(255,190,105,.28)',
      boxShadow: '0 8px 24px rgba(0,0,0,.35)', fontSize: '13px', pointerEvents: 'none', textAlign: 'center',
    });
    this.root.dataset.uiPanel = 'npc-bark';
    this.root.setAttribute('aria-hidden', 'true');
    parent.append(this.root);
  }

  show(view: NpcBarkView, durationMs = 4_500): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.root.textContent = `${view.npcName}: “${view.text}”`;
    this.root.style.display = 'block';
    this.hideTimer = window.setTimeout(() => this.hide(), durationMs);
  }

  hide(): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.root.style.display = 'none';
  }

  destroy(): void { this.hide(); this.root.remove(); }
}
