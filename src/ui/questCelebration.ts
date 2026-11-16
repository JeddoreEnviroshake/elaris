import { pendingQuestRewards, type QuestView } from '../simulation/progression';
import type { GameState } from '../simulation/state';
import { div } from './controls';

/** How long the payout animation owns the banner before the next quest queues up. */
const BURST_MS = 1000;
const SPARK_COUNT = 10;

/**
 * The reward moment for a finished quest. Completion used to be a one-line
 * toast that scrolled past while the player was still swinging an axe, so the
 * coins are now held back until the player taps this banner and watches them
 * land.
 */
export class QuestCelebration {
  private readonly strip: HTMLDivElement;
  private readonly card: HTMLButtonElement;
  private readonly eyebrow: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly objective: HTMLDivElement;
  private readonly rewardLine: HTMLDivElement;
  private readonly cta: HTMLDivElement;
  private readonly queueBadge: HTMLDivElement;
  private readonly sparkLayer: HTMLDivElement;
  private shown: QuestView | null = null;
  private claiming = false;
  private hidden = false;
  private burstTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly onClaim: (questId: string) => boolean,
  ) {
    // The card is centred by its own strip rather than by a translate, because
    // the arrival and payout keyframes own the card's transform outright.
    this.strip = div({
      position: 'absolute',
      left: '0',
      right: '0',
      top: 'calc(env(safe-area-inset-top) + 108px)',
      display: 'none',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: '4',
    });

    this.strip.dataset.questCelebration = '';

    this.card = document.createElement('button');
    this.card.type = 'button';
    this.card.dataset.testid = 'quest-complete-banner';
    Object.assign(this.card.style, {
      position: 'relative',
      width: 'min(320px, calc(100vw - 28px))',
      padding: '9px 14px 10px',
      border: '2px solid rgba(255,210,63,0.55)',
      borderRadius: '10px',
      color: '#fff5cf',
      background: 'linear-gradient(rgba(58,42,8,0.97), rgba(20,32,22,0.97))',
      font: '600 13px system-ui, sans-serif',
      textAlign: 'center',
      lineHeight: '1.3',
      cursor: 'pointer',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      webkitTapHighlightColor: 'transparent',
    });
    // Assertive: this is the payoff, and it should not queue behind the running
    // commentary on the polite status line.
    this.card.setAttribute('role', 'alert');

    this.eyebrow = div({
      font: '800 10px system-ui, sans-serif', letterSpacing: '0.16em',
      color: '#ffd23f', textTransform: 'uppercase',
    });
    this.title = div({ marginTop: '3px', font: '800 15px "Trebuchet MS", system-ui, sans-serif', color: '#fff8e2' });
    // The task the player just finished, so the payout names what earned it
    // rather than leaving the title to carry the whole story.
    this.objective = div({
      marginTop: '2px', font: '600 11px system-ui, sans-serif', color: '#dfe8dc', opacity: '0.85',
    });
    this.rewardLine = div({
      marginTop: '4px', font: '800 15px system-ui, sans-serif', color: '#ffe88a',
      fontVariantNumeric: 'tabular-nums',
    });
    this.cta = div({ marginTop: '5px', font: '700 11px system-ui, sans-serif', color: '#e8f0ea', opacity: '0.82' });
    this.queueBadge = div({
      position: 'absolute', top: '-9px', right: '-6px', display: 'none',
      padding: '2px 7px', borderRadius: '999px', border: '1px solid rgba(255,210,63,0.7)',
      background: '#2a1f06', color: '#ffd23f', font: '800 10px system-ui, sans-serif',
    });
    this.sparkLayer = div({
      position: 'absolute', inset: '0', overflow: 'visible', pointerEvents: 'none',
    });

    this.card.append(this.eyebrow, this.title, this.objective, this.rewardLine, this.cta, this.queueBadge, this.sparkLayer);
    this.card.addEventListener('click', () => this.claim());
    this.strip.appendChild(this.card);
    parent.appendChild(this.strip);
  }

  /**
   * Where the card ends in viewport pixels, or 0 when it is not up. Other
   * banners share this corner and stack under whatever is already there.
   */
  get cardBottom(): number {
    if (this.strip.style.display === 'none') return 0;
    return this.card.getBoundingClientRect().bottom;
  }

  /** A modal dialog owns the display, so the banner waits its turn. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.strip.style.display = 'none';
    else if (this.shown) this.strip.style.display = 'flex';
  }

  /** Show the oldest unclaimed reward; called after every state change. */
  sync(): void {
    if (this.claiming) return;
    const pending = pendingQuestRewards(this.state);
    const next = pending[0] ?? null;
    if (!next) {
      this.shown = null;
      this.strip.style.display = 'none';
      this.card.classList.remove('elaris-quest-banner');
      return;
    }
    if (next.id !== this.shown?.id) {
      this.shown = next;
      this.eyebrow.textContent = 'Quest complete';
      this.title.textContent = next.title;
      this.objective.textContent = next.objective;
      this.objective.style.display = next.objective ? 'block' : 'none';
      this.rewardLine.textContent = next.reward ? `Reward: ${next.reward}` : 'Reward ready';
      this.cta.textContent = 'Tap to collect';
      this.card.setAttribute(
        'aria-label',
        `Quest complete: ${next.title}. ${next.objective} Tap to collect ${next.reward ?? 'your reward'}.`,
      );
      // Restart the arrival animation for each new quest.
      this.card.classList.remove('elaris-quest-banner', 'elaris-quest-claimed');
      void this.card.offsetWidth;
      this.card.classList.add('elaris-quest-banner');
    }
    this.queueBadge.textContent = `+${pending.length - 1}`;
    this.queueBadge.style.display = pending.length > 1 ? 'block' : 'none';
    this.card.disabled = false;
    if (!this.hidden) this.strip.style.display = 'flex';
  }

  private claim(): void {
    const quest = this.shown;
    if (!quest || this.claiming) return;
    this.claiming = true;
    if (!this.onClaim(quest.id)) {
      // The credit was refused (a full purse); leave the banner up to retry.
      this.claiming = false;
      return;
    }
    this.card.disabled = true;
    this.eyebrow.textContent = 'Collected';
    this.rewardLine.textContent = quest.reward ? `+ ${quest.reward}` : 'Reward collected';
    this.rewardLine.style.font = '900 22px system-ui, sans-serif';
    this.cta.style.display = 'none';
    this.card.classList.remove('elaris-quest-banner');
    void this.card.offsetWidth;
    this.card.classList.add('elaris-quest-claimed');
    this.spark();
    if (this.burstTimer) clearTimeout(this.burstTimer);
    this.burstTimer = setTimeout(() => {
      this.burstTimer = null;
      this.claiming = false;
      this.shown = null;
      this.rewardLine.style.font = '800 15px system-ui, sans-serif';
      this.cta.style.display = 'block';
      this.card.classList.remove('elaris-quest-claimed');
      this.strip.style.display = 'none';
      this.sync();
    }, BURST_MS);
  }

  private spark(): void {
    this.sparkLayer.textContent = '';
    for (let index = 0; index < SPARK_COUNT; index += 1) {
      const angle = (Math.PI * index) / (SPARK_COUNT - 1) + (Math.random() - 0.5) * 0.3;
      const distance = 42 + Math.random() * 34;
      const spark = div({
        position: 'absolute', left: '50%', top: '52%', font: '900 13px system-ui, sans-serif',
        color: index % 2 === 0 ? '#ffd23f' : '#fff8e2',
      });
      spark.textContent = '✦';
      spark.style.setProperty('--spark-x', `${Math.round(Math.cos(angle) * distance)}px`);
      spark.style.setProperty('--spark-y', `${Math.round(-Math.sin(angle) * distance)}px`);
      spark.style.animationDelay = `${index * 18}ms`;
      spark.classList.add('elaris-quest-spark');
      this.sparkLayer.appendChild(spark);
    }
    setTimeout(() => { this.sparkLayer.textContent = ''; }, BURST_MS);
  }

  destroy(): void {
    if (this.burstTimer) clearTimeout(this.burstTimer);
    this.strip.remove();
  }
}
