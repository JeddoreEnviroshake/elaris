import type { NpcDefinition } from '../content/npcs';
import { div, uiButton } from './controls';

/** Touch-first conversation card for protected service NPCs. */
export class NpcPanel {
  private readonly root: HTMLDivElement;
  private readonly portrait: HTMLDivElement;
  private readonly name: HTMLHeadingElement;
  private readonly title: HTMLDivElement;
  private readonly greeting: HTMLParagraphElement;
  private readonly serviceName: HTMLDivElement;
  private readonly serviceSummary: HTMLDivElement;
  private readonly availability: HTMLDivElement;
  private readonly closeButton: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    this.root = div({
      position: 'absolute', inset: '0', zIndex: '28', display: 'none', alignItems: 'flex-end',
      justifyContent: 'center', padding: '18px 18px calc(env(safe-area-inset-bottom) + 18px)',
      background: 'rgba(3,9,6,0.48)', pointerEvents: 'auto',
    });
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Conversation');
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.close();
    });

    const card = div({
      width: 'min(560px, 100%)', padding: '18px', borderRadius: '16px', color: '#e8f0ea',
      background: 'linear-gradient(155deg, rgba(30,48,37,0.99), rgba(9,20,14,0.99))',
      border: '1px solid rgba(255,224,138,0.34)', boxShadow: '0 18px 52px rgba(0,0,0,0.55)',
      font: '14px/1.5 system-ui, sans-serif',
    });
    const identity = div({ display: 'grid', gridTemplateColumns: '58px 1fr', gap: '12px', alignItems: 'center' });
    this.portrait = div({
      width: '58px', height: '58px', display: 'grid', placeItems: 'center', borderRadius: '14px',
      color: '#142319', background: '#ffe08a', fontSize: '25px', fontWeight: '800',
      border: '2px solid rgba(255,255,255,0.4)',
    });
    const identityText = div({});
    this.name = document.createElement('h2');
    Object.assign(this.name.style, { margin: '0', font: '750 22px system-ui, sans-serif' });
    this.title = div({ marginTop: '1px', color: '#b8e6c5', fontSize: '13px', fontWeight: '650' });
    identityText.append(this.name, this.title);
    identity.append(this.portrait, identityText);

    this.greeting = document.createElement('p');
    Object.assign(this.greeting.style, { margin: '16px 0', fontSize: '15px' });
    const service = div({
      padding: '13px', borderRadius: '11px', background: 'rgba(255,255,255,0.055)',
      border: '1px solid rgba(255,255,255,0.12)',
    });
    this.serviceName = div({ color: '#ffe08a', fontWeight: '750' });
    this.serviceSummary = div({ marginTop: '5px' });
    this.availability = div({ marginTop: '8px', color: 'rgba(232,240,234,0.66)', fontSize: '12px' });
    service.append(this.serviceName, this.serviceSummary, this.availability);

    this.closeButton = uiButton('Continue', () => this.close());
    Object.assign(this.closeButton.style, { width: '100%', marginTop: '14px', fontWeight: '700' });
    card.append(identity, this.greeting, service, this.closeButton);
    this.root.appendChild(card);
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.root.style.display !== 'none';
  }

  open(npc: NpcDefinition): void {
    this.root.setAttribute('aria-label', `Conversation with ${npc.name}`);
    this.portrait.textContent = npc.name[0] ?? '';
    this.name.textContent = npc.name;
    this.title.textContent = npc.title;
    this.greeting.textContent = `“${npc.greeting}”`;
    this.serviceName.textContent = npc.serviceLabel;
    this.serviceSummary.textContent = `${npc.summary} ${npc.servicePreview}`;
    this.availability.textContent = npc.availability;
    this.root.style.display = 'flex';
    this.closeButton.focus();
  }

  close(): void {
    this.root.style.display = 'none';
  }

  destroy(): void {
    this.root.remove();
  }
}
