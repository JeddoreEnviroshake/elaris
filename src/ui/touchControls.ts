/**
 * Translucent on-screen joystick for touch (and pointer/mouse) movement. Built
 * from DOM rather than canvas so it respects safe-area insets and stays usable
 * alongside keyboard/mouse — input modes coexist and are never locked by a
 * one-time device check. Uses Pointer Events; hit target is well over 48×48 px.
 *
 * Milestone 0 exposes only the movement stick; action/menu buttons arrive with
 * the gameplay HUD in later milestones.
 */
export interface JoystickVector {
  x: number;
  y: number;
  magnitude: number;
}

const BASE_RADIUS = 56;
const THUMB_RADIUS = 26;

export class TouchJoystick {
  private readonly root: HTMLDivElement;
  private readonly thumb: HTMLDivElement;
  private activePointerId: number | null = null;
  private vector: JoystickVector = { x: 0, y: 0, magnitude: 0 };
  private originX = 0;
  private originY = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      left: 'calc(env(safe-area-inset-left) + 16px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 16px)',
      width: `${BASE_RADIUS * 2}px`,
      height: `${BASE_RADIUS * 2}px`,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.10)',
      border: '2px solid rgba(255,255,255,0.20)',
      touchAction: 'none',
      userSelect: 'none',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);

    this.thumb = document.createElement('div');
    Object.assign(this.thumb.style, {
      position: 'absolute',
      left: `${BASE_RADIUS - THUMB_RADIUS}px`,
      top: `${BASE_RADIUS - THUMB_RADIUS}px`,
      width: `${THUMB_RADIUS * 2}px`,
      height: `${THUMB_RADIUS * 2}px`,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.28)',
      transition: 'background 0.1s',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.root.appendChild(this.thumb);
    parent.appendChild(this.root);

    this.root.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  getVector(): JoystickVector {
    return this.vector;
  }

  private onDown = (e: PointerEvent): void => {
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    const rect = this.root.getBoundingClientRect();
    this.originX = rect.left + BASE_RADIUS;
    this.originY = rect.top + BASE_RADIUS;
    this.thumb.style.background = 'rgba(255,255,255,0.45)';
    this.update(e.clientX, e.clientY);
    e.preventDefault();
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.update(e.clientX, e.clientY);
    e.preventDefault();
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    this.vector = { x: 0, y: 0, magnitude: 0 };
    this.thumb.style.left = `${BASE_RADIUS - THUMB_RADIUS}px`;
    this.thumb.style.top = `${BASE_RADIUS - THUMB_RADIUS}px`;
    this.thumb.style.background = 'rgba(255,255,255,0.28)';
  };

  private update(clientX: number, clientY: number): void {
    let dx = clientX - this.originX;
    let dy = clientY - this.originY;
    const dist = Math.hypot(dx, dy);
    const max = BASE_RADIUS;
    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }
    const magnitude = Math.min(1, dist / max);
    this.vector = { x: dx / max, y: dy / max, magnitude };
    this.thumb.style.left = `${BASE_RADIUS - THUMB_RADIUS + dx}px`;
    this.thumb.style.top = `${BASE_RADIUS - THUMB_RADIUS + dy}px`;
  }

  destroy(): void {
    this.root.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.root.remove();
  }
}
