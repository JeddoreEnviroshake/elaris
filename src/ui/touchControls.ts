/**
 * Floating on-screen joystick for touch (and pointer/mouse) movement. Built
 * from DOM rather than canvas so it respects safe-area insets and stays usable
 * alongside keyboard/mouse — input modes coexist and are never locked by a
 * one-time device check.
 *
 * The whole lower-left region is the capture zone: touch anywhere in it and
 * the stick appears under your finger, so players never have to hit a small
 * fixed circle mid-fight. A faint resting ring advertises the zone while idle.
 * Short, near-stationary presses are treated as taps and forwarded via
 * `onTap`, preserving tap-to-gather inside the zone. A radial dead zone
 * absorbs finger jitter; deflection past it rescales to the full 0..1 range.
 */
export interface JoystickVector {
  x: number;
  y: number;
  magnitude: number;
}

export interface TouchJoystickOptions {
  /** A short press without drag — forward the context action (e.g. gather). */
  onTap?: () => void;
}

const BASE_RADIUS = 56;
const THUMB_RADIUS = 26;
const DEAD_ZONE = 0.1;
const TAP_MAX_MS = 250;
const TAP_MAX_DRIFT_PX = 10;
/** Keep the floating base fully on-screen when touching near an edge. */
const EDGE_MARGIN_PX = 8;

export class TouchJoystick {
  private readonly zone: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly thumb: HTMLDivElement;
  private activePointerId: number | null = null;
  private vector: JoystickVector = { x: 0, y: 0, magnitude: 0 };
  private originX = 0;
  private originY = 0;
  private downAt = 0;
  private maxDriftPx = 0;

  constructor(
    parent: HTMLElement,
    private readonly options: TouchJoystickOptions = {},
  ) {
    this.zone = document.createElement('div');
    Object.assign(this.zone.style, {
      position: 'absolute',
      left: '0',
      bottom: '0',
      width: 'min(46vw, 300px)',
      height: 'min(40vh, 280px)',
      touchAction: 'none',
      userSelect: 'none',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);
    this.zone.setAttribute('aria-hidden', 'true');

    this.base = document.createElement('div');
    Object.assign(this.base.style, {
      position: 'absolute',
      width: `${BASE_RADIUS * 2}px`,
      height: `${BASE_RADIUS * 2}px`,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.10)',
      border: '2px solid rgba(255,255,255,0.20)',
      pointerEvents: 'none',
      transition: 'opacity 0.15s',
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

    this.base.appendChild(this.thumb);
    this.zone.appendChild(this.base);
    parent.appendChild(this.zone);
    this.restBase();

    this.zone.addEventListener('pointerdown', this.onDown);
    this.zone.addEventListener('pointermove', this.onMove);
    this.zone.addEventListener('pointerup', this.onUp);
    this.zone.addEventListener('pointercancel', this.onUp);
    this.zone.addEventListener('lostpointercapture', this.onUp);
  }

  getVector(): JoystickVector {
    return this.vector;
  }

  private onDown = (e: PointerEvent): void => {
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an enhancement (tracking beyond the zone edge); a pointer
      // that cannot be captured still drives the stick inside the zone.
    }
    this.downAt = performance.now();
    this.maxDriftPx = 0;

    // Float the base to the touch point, clamped fully on-screen.
    this.originX = clamp(e.clientX, BASE_RADIUS + EDGE_MARGIN_PX, window.innerWidth - BASE_RADIUS - EDGE_MARGIN_PX);
    this.originY = clamp(e.clientY, BASE_RADIUS + EDGE_MARGIN_PX, window.innerHeight - BASE_RADIUS - EDGE_MARGIN_PX);
    const rect = this.zone.getBoundingClientRect();
    this.base.style.bottom = 'auto';
    this.base.style.left = `${this.originX - rect.left - BASE_RADIUS}px`;
    this.base.style.top = `${this.originY - rect.top - BASE_RADIUS}px`;
    this.base.style.opacity = '1';
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
    this.restBase();

    const isTap =
      e.type === 'pointerup' &&
      performance.now() - this.downAt <= TAP_MAX_MS &&
      this.maxDriftPx <= TAP_MAX_DRIFT_PX;
    if (isTap) this.options.onTap?.();
  };

  private update(clientX: number, clientY: number): void {
    let dx = clientX - this.originX;
    let dy = clientY - this.originY;
    const dist = Math.hypot(dx, dy);
    this.maxDriftPx = Math.max(this.maxDriftPx, dist);

    const max = BASE_RADIUS;
    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }
    const raw = Math.min(1, dist / max);
    // Inside the dead zone the stick reports rest; beyond it, rescale so the
    // rim still reads as full deflection (slow-walk stays reachable).
    const magnitude = raw <= DEAD_ZONE ? 0 : (raw - DEAD_ZONE) / (1 - DEAD_ZONE);
    this.vector =
      magnitude === 0 || dist === 0
        ? { x: 0, y: 0, magnitude: 0 }
        : { x: (dx / Math.min(dist, max)) * magnitude, y: (dy / Math.min(dist, max)) * magnitude, magnitude };
    this.thumb.style.left = `${BASE_RADIUS - THUMB_RADIUS + dx}px`;
    this.thumb.style.top = `${BASE_RADIUS - THUMB_RADIUS + dy}px`;
  }

  /** Park the faint hint ring at the classic corner spot while idle. */
  private restBase(): void {
    this.base.style.left = '16px';
    this.base.style.top = 'auto';
    this.base.style.bottom = '32px';
    this.base.style.opacity = '0.55';
    this.thumb.style.left = `${BASE_RADIUS - THUMB_RADIUS}px`;
    this.thumb.style.top = `${BASE_RADIUS - THUMB_RADIUS}px`;
    this.thumb.style.background = 'rgba(255,255,255,0.28)';
  }

  destroy(): void {
    this.zone.removeEventListener('pointerdown', this.onDown);
    this.zone.removeEventListener('pointermove', this.onMove);
    this.zone.removeEventListener('pointerup', this.onUp);
    this.zone.removeEventListener('pointercancel', this.onUp);
    this.zone.removeEventListener('lostpointercapture', this.onUp);
    this.zone.remove();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
