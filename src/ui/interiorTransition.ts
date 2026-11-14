import { div } from './controls';

export class InteriorTransitionOverlay {
  private readonly root: HTMLDivElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.root = div({
      position: 'absolute', inset: '0', zIndex: '39', display: 'none', pointerEvents: 'none',
      opacity: '0', background: '#080504', transition: 'opacity 180ms ease',
    });
    this.root.setAttribute('aria-hidden', 'true');
    this.root.dataset.testid = 'interior-transition';
    parent.appendChild(this.root);
  }

  enter(onCovered: () => void, reducedMotion: boolean): void {
    this.cancel();
    this.root.style.display = 'block';
    this.root.style.transitionDuration = reducedMotion ? '0ms' : '180ms';
    this.root.style.opacity = '1';
    onCovered();
    requestAnimationFrame(() => {
      this.root.style.opacity = '0';
      this.timer = setTimeout(() => { this.root.style.display = 'none'; this.timer = null; }, reducedMotion ? 0 : 190);
    });
  }

  exit(onCovered: () => void, reducedMotion: boolean): void {
    this.cancel();
    this.root.style.display = 'block';
    this.root.style.transitionDuration = reducedMotion ? '0ms' : '180ms';
    requestAnimationFrame(() => { this.root.style.opacity = '1'; });
    this.timer = setTimeout(() => {
      onCovered();
      this.root.style.opacity = '0';
      this.timer = setTimeout(() => { this.root.style.display = 'none'; this.timer = null; }, reducedMotion ? 0 : 190);
    }, reducedMotion ? 0 : 190);
  }

  destroy(): void { this.cancel(); this.root.remove(); }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
