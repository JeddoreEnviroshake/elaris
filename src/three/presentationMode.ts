import type Phaser from 'phaser';
import type { Elaris3DRenderer } from './Elaris3DRenderer';

export type PresentationMode = '2d' | '3d';

const STORAGE_KEY = 'elaris.presentation-mode';

export function preferredPresentationMode(locationSearch = window.location.search): PresentationMode {
  const requested = new URLSearchParams(locationSearch).get('render');
  if (requested === '2d' || requested === '3d') return requested;
  // Existing browser tests exercise Phaser canvas input. A dedicated 3D test
  // opts in with ?render=3d while the player-facing default stays 3D.
  if (navigator.webdriver) return '2d';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === '2d' ? '2d' : '3d';
}

export interface PresentationModeOptions {
  /** Mount the controller's own top-right toggle button. The Admin menu drives
   *  presentation instead, so the app passes `false`. Defaults to `true`. */
  mountButton?: boolean;
}

export class PresentationModeController {
  private mode: PresentationMode;
  private readonly button: HTMLButtonElement | null;

  constructor(
    parent: HTMLElement,
    private readonly game: Phaser.Game,
    private readonly renderer3d: Elaris3DRenderer,
    options: PresentationModeOptions = {},
  ) {
    this.mode = preferredPresentationMode();
    if (options.mountButton ?? true) {
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.dataset.testid = 'presentation-mode-toggle';
      this.button.setAttribute('aria-label', 'Switch world presentation');
      Object.assign(this.button.style, {
        position: 'absolute',
        top: 'calc(env(safe-area-inset-top) + 8px)',
        right: 'calc(env(safe-area-inset-right) + 8px)',
        zIndex: '18',
        minWidth: '78px',
        minHeight: '38px',
        padding: '6px 10px',
        border: '2px solid #6f8a61',
        borderRadius: '5px',
        background: 'linear-gradient(#294b35, #172a20)',
        boxShadow: '0 0 0 2px #0b120e, 0 4px 12px rgba(0,0,0,.35)',
        color: '#f5ecd6',
        font: '800 12px "Trebuchet MS", system-ui, sans-serif',
        letterSpacing: '.4px',
        cursor: 'pointer',
        pointerEvents: 'auto',
      });
      this.button.addEventListener('click', () => this.setMode(this.mode === '3d' ? '2d' : '3d'));
      parent.appendChild(this.button);
    } else {
      this.button = null;
    }
    this.applyMode();
  }

  get current(): PresentationMode {
    return this.mode;
  }

  setMode(mode: PresentationMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    window.localStorage.setItem(STORAGE_KEY, mode);
    this.applyMode();
  }

  private applyMode(): void {
    const canvas = this.game.canvas;
    const is3d = this.mode === '3d';
    canvas.style.opacity = is3d ? '0' : '1';
    canvas.style.transition = 'opacity 180ms ease';
    canvas.setAttribute('aria-hidden', is3d ? 'true' : 'false');
    const world = this.game.scene.getScene('world');
    world?.cameras?.main?.setVisible(!is3d);
    this.renderer3d.setEnabled(is3d);
    if (this.button) {
      this.button.textContent = is3d ? '3D WORLD' : '2D WORLD';
      this.button.title = is3d ? 'Switch to the original 2D presentation' : 'Switch to the new 3D presentation';
      this.button.setAttribute('aria-pressed', is3d ? 'true' : 'false');
    }
    document.documentElement.dataset.presentation = this.mode;
  }
}
