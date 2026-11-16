import { BLUEPRINT_QUALITY_COLORS, BLUEPRINT_QUALITY_LABELS, blueprintQuality } from '../content/blueprintQuality';
import type { GameState } from '../simulation/state';
import { BLUEPRINTS, STATION_LABELS } from './blueprintCatalog';
import { div } from './controls';
import { setUiIcon } from './icons';

/** How long one unlock owns the banner before the next queues up. */
const SHOW_MS = 3200;
/** The blink between two unlocks, so a burst reads as separate arrivals. */
const GAP_MS = 220;
/**
 * A notification is not a record. Registering a full bag or collecting several
 * levels' worth of grants can teach a dozen blueprints at once, which is not
 * worth three quarters of a minute of banners, so the tail is summarised in the
 * badge and dropped. The Blueprints tab is where the full list lives.
 */
const QUEUE_LIMIT = 3;

/**
 * The reveal moment for a newly learned blueprint.
 *
 * Learning one used to be a line on the feedback toast, which is the same
 * channel that reports a failed swing — so the payoff for a trip home with
 * paper in the bag scrolled past in a second. This is the quest-complete banner
 * for recipes: it names what was learned, where it is made, and gets out of the
 * way on its own. Tapping it opens the Blueprints tab.
 *
 * It watches the known set rather than being told, because a blueprint becomes
 * known from four places — a claimed level grant, a workbench registration, a
 * drafted sheet, a quest — and every one of them ends in the same array.
 */
export class BlueprintCelebration {
  private readonly strip: HTMLDivElement;
  private readonly card: HTMLButtonElement;
  private readonly icon: HTMLDivElement;
  private readonly eyebrow: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly cta: HTMLDivElement;
  private readonly queueBadge: HTMLDivElement;
  /** Ids already announced, so only genuine arrivals ever open the banner. */
  private readonly seen: Set<string>;
  private readonly queue: string[] = [];
  /** How many arrivals were dropped past the cap, for the badge. */
  private overflow = 0;
  private showing: string | null = null;
  private hidden = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly onOpenBlueprints: () => void,
    /**
     * Where the top of the card should sit, in viewport pixels. The status
     * readouts and the quest banner share this corner and were there first, so
     * the HUD measures what is already up and this drops below it.
     */
    private readonly topPx: () => number,
  ) {
    this.seen = new Set(state.unlockedItemIds);

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
    this.strip.dataset.blueprintCelebration = '';

    this.card = document.createElement('button');
    this.card.type = 'button';
    this.card.dataset.testid = 'blueprint-unlocked-banner';
    Object.assign(this.card.style, {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      width: 'min(320px, calc(100vw - 28px))',
      padding: '9px 14px 10px',
      border: '2px solid rgba(255,210,63,0.55)',
      borderRadius: '10px',
      color: '#fff5cf',
      background: 'linear-gradient(rgba(58,42,8,0.97), rgba(20,32,22,0.97))',
      font: '600 13px system-ui, sans-serif',
      textAlign: 'left',
      lineHeight: '1.3',
      cursor: 'pointer',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      webkitTapHighlightColor: 'transparent',
    });
    // Assertive like the quest banner: this is a payoff, not commentary, and it
    // is gone before a polite queue would have got to it.
    this.card.setAttribute('role', 'alert');

    this.icon = div({ display: 'grid', placeItems: 'center', flex: '0 0 auto', lineHeight: '1' });
    const text = div({ flex: '1', minWidth: '0' });
    this.eyebrow = div({
      font: '800 10px system-ui, sans-serif', letterSpacing: '0.16em',
      color: '#ffd23f', textTransform: 'uppercase',
    });
    this.title = div({
      marginTop: '3px', font: '800 15px "Trebuchet MS", system-ui, sans-serif', color: '#fff8e2',
    });
    this.detail = div({ marginTop: '2px', font: '600 11px system-ui, sans-serif', opacity: '0.9' });
    this.cta = div({
      marginTop: '4px', font: '700 11px system-ui, sans-serif', color: '#e8f0ea', opacity: '0.82',
    });
    text.append(this.eyebrow, this.title, this.detail, this.cta);
    this.queueBadge = div({
      position: 'absolute', top: '-9px', right: '-6px', display: 'none',
      padding: '2px 7px', borderRadius: '999px', border: '1px solid rgba(255,210,63,0.7)',
      background: '#2a1f06', color: '#ffd23f', font: '800 10px system-ui, sans-serif',
    });

    this.card.append(this.icon, text, this.queueBadge);
    this.card.addEventListener('click', () => {
      this.dismiss();
      this.onOpenBlueprints();
    });
    this.strip.appendChild(this.card);
    parent.appendChild(this.strip);
  }

  /** A modal dialog owns the display, so the banner waits its turn. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.strip.style.display = 'none';
    else if (this.showing) this.strip.style.display = 'flex';
  }

  /** Queue anything newly learned and keep the banner moving; called on refresh. */
  sync(): void {
    for (const id of this.state.unlockedItemIds) {
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      if (this.queue.length >= QUEUE_LIMIT) this.overflow += 1;
      else this.queue.push(id);
    }
    if (!this.showing) this.advance();
    else this.refreshBadge();
  }

  private advance(): void {
    const next = this.queue.shift();
    if (next === undefined) {
      this.showing = null;
      this.overflow = 0;
      this.strip.style.display = 'none';
      this.card.classList.remove('elaris-quest-banner');
      return;
    }

    this.showing = next;
    const entry = BLUEPRINTS.find((candidate) => candidate.unlockId === next);
    const name = entry?.displayName ?? next.replace(/-/g, ' ');
    const quality = blueprintQuality(next);
    setUiIcon(this.icon, entry?.icon ?? 'blueprint', 22);
    this.eyebrow.textContent = 'Blueprint unlocked';
    this.title.textContent = name;
    this.detail.textContent = entry
      ? `${BLUEPRINT_QUALITY_LABELS[quality]} · made at ${STATION_LABELS[entry.station]}`
      : BLUEPRINT_QUALITY_LABELS[quality];
    this.detail.style.color = BLUEPRINT_QUALITY_COLORS[quality];
    this.cta.textContent = 'Tap to open Blueprints';
    this.card.setAttribute(
      'aria-label',
      `Blueprint unlocked: ${name}. ${this.detail.textContent}. Tap to open Blueprints.`,
    );
    this.refreshBadge();

    // Measured on each arrival rather than fixed: what is above this — a
    // survival timer, an XP bar, a claim strip, vitals that fade in and out, a
    // quest reward waiting to be tapped — changes minute to minute, and none of
    // it is worth covering with a notification that leaves on its own.
    this.strip.style.top = `${Math.round(this.topPx())}px`;

    // Restart the arrival animation for each blueprint.
    this.card.classList.remove('elaris-quest-banner');
    void this.card.offsetWidth;
    this.card.classList.add('elaris-quest-banner');
    if (!this.hidden) this.strip.style.display = 'flex';

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.dismiss();
    }, SHOW_MS);
  }

  private refreshBadge(): void {
    const waiting = this.queue.length + this.overflow;
    this.queueBadge.textContent = `+${waiting}`;
    this.queueBadge.style.display = waiting > 0 ? 'block' : 'none';
  }

  /** Close the current card and hand the banner to whatever is next. */
  private dismiss(): void {
    if (this.timer) clearTimeout(this.timer);
    this.showing = null;
    this.strip.style.display = 'none';
    this.card.classList.remove('elaris-quest-banner');
    if (this.queue.length === 0) {
      this.overflow = 0;
      this.timer = null;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.advance();
    }, GAP_MS);
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.strip.remove();
  }
}
