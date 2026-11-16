import type { NpcService } from '../content/npcs';
import { npcServiceModel, type NpcServiceActionModel, type NpcServiceOfferModel } from '../presentation/npcServiceModel';
import type { CommandResult } from '../simulation/gameplayCommands';
import type { GameState } from '../simulation/state';
import { div, uiButton } from './controls';

/**
 * Shared DOM renderer for the renderer-neutral service model. Every offer an NPC
 * can provide is listed on the one screen; there is no staged flow in front of it.
 */
export class NpcServiceActions {
  readonly root: HTMLDivElement;
  private readonly balance: HTMLDivElement;
  private readonly actions: HTMLDivElement;
  private readonly feedback: HTMLDivElement;
  private service: NpcService = 'market';
  private inFlight = false;

  constructor(private readonly state: GameState, private readonly onChanged: (result: CommandResult) => void) {
    this.root = div({ minWidth: '0' });
    this.root.dataset.uiPanel = 'npc-service-actions';
    this.balance = div({
      padding: '9px 11px', borderRadius: '9px',
      background: 'rgba(255,255,255,0.09)', color: 'var(--town-accent)', fontWeight: '750',
    });
    this.actions = div({ display: 'grid', gap: '9px', marginTop: '12px' });
    this.actions.classList.add('elaris-service-offers');this.balance.classList.add('elaris-service-balance');
    this.feedback = div({ minHeight: '22px', marginTop: '10px', fontSize: '13px', fontWeight: '650' });
    this.feedback.setAttribute('aria-live', 'polite');
    this.root.append(this.balance, this.actions, this.feedback);
  }

  show(service: NpcService): void {
    this.service = service;
    this.feedback.textContent = '';
    this.refresh();
  }

  refresh(): void {
    const model = npcServiceModel(this.state, this.service);
    this.balance.textContent = model.balance;
    this.actions.replaceChildren();
    for (const offer of model.offers) this.actions.append(this.renderOffer(offer));
  }

  private transact(action: NpcServiceActionModel, button: HTMLButtonElement, alreadyUsed: { value: boolean }): void {
    if (this.inFlight || alreadyUsed.value) return;
    this.inFlight = true;
    alreadyUsed.value = true;
    button.disabled = true;
    const result = action.execute();
    this.feedback.textContent = result.message;
    this.feedback.style.color = result.ok ? '#c9f0cf' : '#ffb7a8';
    if (result.ok) this.onChanged(result);
    this.inFlight = false;
    this.refresh();
    this.feedback.textContent = result.message;
  }

  private renderOffer(offer: NpcServiceOfferModel): HTMLDivElement {
    const row = div({
      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '8px',
      padding: '11px', borderRadius: '10px',
      background: 'rgba(255,255,255,0.065)', border: '1px solid rgba(255,255,255,0.13)',
    });
    row.dataset.offerId = offer.id;
    if (offer.accessibilityLabel) row.setAttribute('aria-label', offer.accessibilityLabel);
    const copy = div({ minWidth: '0' });
    const heading = div({ fontWeight: '750' }); heading.textContent = offer.title;
    const sub = div({ fontSize: '12px', opacity: '0.72' }); sub.textContent = offer.detail;
    copy.append(heading, sub);
    row.append(copy);
    const actionBar = div({ display: 'flex', flexWrap: 'wrap', gap: '8px' });
    for (const action of offer.actions) {
      const alreadyUsed = { value: false };
      let button!: HTMLButtonElement;
      button = uiButton(action.label, () => this.transact(action, button, alreadyUsed));
      button.dataset.actionId = action.id;
      button.setAttribute('aria-label', action.accessibilityLabel);
      button.disabled = action.disabledReason !== null;
      button.title = action.title;
      actionBar.append(button);
    }
    if (offer.actions.length > 0) row.append(actionBar);
    return row;
  }
}
