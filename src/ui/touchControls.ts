/**
 * On-screen movement control for touch (and pointer/mouse). Built from DOM
 * rather than canvas so it respects safe-area insets and stays usable
 * alongside keyboard/mouse — input modes coexist and are never locked by a
 * one-time device check.
 *
 * The pad itself is a fixed D-PAD wearing four arrows, in build mode and out:
 * a tapped direction only reads as "north" if the thing you tapped stayed put.
 * A tap on an arrow (or a hold, which repeats) emits one tile of travel via
 * `onStep` — the placement ghost while building, the character otherwise. The
 * moment the finger drags past the tap threshold the gesture becomes ordinary
 * analog walking, so the same thumb both nudges and walks.
 *
 * The rest of the lower-left region stays the free capture zone: press outside
 * the pad and the stick floats up under your finger, and a short, stationary
 * press there is forwarded via `onTap`, preserving tap-to-gather. A radial dead
 * zone absorbs finger jitter; deflection past it rescales to the full 0..1
 * range.
 */
export interface JoystickVector {
  x: number;
  y: number;
  magnitude: number;
}

export interface TouchJoystickOptions {
  /** A short press without drag, outside the pad — forward the context action. */
  onTap?: () => void;
  /** A d-pad direction was tapped or held. One tile of travel per call. */
  onStep?: (dx: number, dy: number) => void;
}

const BASE_RADIUS = 56;
const THUMB_RADIUS = 26;
const DEAD_ZONE = 0.1;
const TAP_MAX_MS = 250;
const TAP_MAX_DRIFT_PX = 10;
/** Keep the floating base fully on-screen when touching near an edge. */
const EDGE_MARGIN_PX = 8;
/** A held direction starts repeating after this, then every REPEAT_MS. */
const HOLD_START_MS = 420;
const HOLD_REPEAT_MS = 130;
/** Presses closer than this to the d-pad centre have no direction. */
const DPAD_CENTER_PX = 14;
/**
 * How far from the pad's centre a press still counts as pressing the pad.
 * Beyond it the zone behaves as the free floating stick, so tap-to-gather and
 * a stick that appears under the thumb both survive the pad being permanent.
 */
const DPAD_HIT_RADIUS = BASE_RADIUS + 8;

interface StepDirection { dx: number; dy: number }

const DPAD_ARROWS: ReadonlyArray<{ dx: number; dy: number; glyph: string; name: string; left: string; top: string }> = [
  { dx: 0, dy: -1, glyph: '▲', name: 'up', left: '50%', top: '13%' },
  { dx: 0, dy: 1, glyph: '▼', name: 'down', left: '50%', top: '87%' },
  { dx: -1, dy: 0, glyph: '◀', name: 'left', left: '13%', top: '50%' },
  { dx: 1, dy: 0, glyph: '▶', name: 'right', left: '87%', top: '50%' },
];

export class TouchJoystick {
  private readonly zone: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly thumb: HTMLDivElement;
  private readonly arrows: HTMLDivElement[] = [];
  private activePointerId: number | null = null;
  private vector: JoystickVector = { x: 0, y: 0, magnitude: 0 };
  private originX = 0;
  private originY = 0;
  private pressX = 0;
  private pressY = 0;
  private downAt = 0;
  private maxDriftPx = 0;
  /** Build mode only: the pad is tinted while it is aiming a placement ghost. */
  private placing = false;
  /** D-pad gesture bookkeeping: which way, whether it already stepped, whether it became a walk. */
  private padPress = false;
  private stepDirection: StepDirection | null = null;
  private stepped = false;
  private dragging = false;
  private holdTimer: number | null = null;

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
    this.base.dataset.dpadBase = '';
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
    this.thumb.dataset.dpadThumb = '';
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
    for (const arrow of DPAD_ARROWS) {
      const glyph = document.createElement('div');
      glyph.textContent = arrow.glyph;
      // The arrows are the pad's only addressable landmarks (the zone is one
      // undivided hit area), so browser tests aim at them by name.
      glyph.dataset.dpadArrow = arrow.name;
      Object.assign(glyph.style, {
        position: 'absolute',
        left: arrow.left,
        top: arrow.top,
        transform: 'translate(-50%, -50%)',
        font: '15px system-ui, sans-serif',
        color: 'rgba(255,255,255,0.72)',
        pointerEvents: 'none',
        transition: 'color 0.08s, transform 0.08s',
      } satisfies Partial<CSSStyleDeclaration>);
      this.arrows.push(glyph);
      this.base.appendChild(glyph);
    }
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

  /**
   * Tint the pad while a build ghost is out, so it is obvious the arrows are
   * aiming the ghost rather than walking. Any in-flight gesture is dropped so
   * the change never leaves a step repeating into the wrong target.
   */
  setPlacementMode(enabled: boolean): void {
    if (this.placing === enabled) return;
    this.placing = enabled;
    this.releaseGesture();
    this.base.style.borderColor = enabled ? 'rgba(255,224,138,0.42)' : 'rgba(255,255,255,0.20)';
    this.restBase();
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
    this.pressX = e.clientX;
    this.pressY = e.clientY;
    this.stepped = false;
    this.dragging = false;

    // The base stays home: a direction is only meaningful against a fixed
    // centre, so the press resolves against the resting d-pad, not the thumb.
    const rect = this.base.getBoundingClientRect();
    const offsetX = e.clientX - (rect.left + BASE_RADIUS);
    const offsetY = e.clientY - (rect.top + BASE_RADIUS);
    this.padPress = Math.hypot(offsetX, offsetY) <= DPAD_HIT_RADIUS;
    if (this.padPress) {
      this.stepDirection = directionFrom(offsetX, offsetY);
      this.highlight(this.stepDirection);
      if (this.stepDirection) this.scheduleRepeat(HOLD_START_MS);
      e.preventDefault();
      return;
    }

    this.beginAnalog(e.clientX, e.clientY);
    this.update(e.clientX, e.clientY);
    e.preventDefault();
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.maxDriftPx = Math.max(this.maxDriftPx, Math.hypot(e.clientX - this.pressX, e.clientY - this.pressY));
    if (this.padPress && !this.dragging) {
      // Past the tap threshold the gesture is a walk, not a nudge. The base
      // floats to where the finger started so the drag feels like the normal
      // stick from its first pixel.
      if (this.maxDriftPx <= TAP_MAX_DRIFT_PX) return;
      this.dragging = true;
      this.cancelRepeat();
      this.highlight(null);
      this.beginAnalog(this.pressX, this.pressY);
    }
    this.update(e.clientX, e.clientY);
    e.preventDefault();
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    const tapped =
      e.type === 'pointerup' &&
      performance.now() - this.downAt <= TAP_MAX_MS &&
      this.maxDriftPx <= TAP_MAX_DRIFT_PX;
    const direction = this.stepDirection;
    const stepped = this.stepped;
    const wasPad = this.padPress && !this.dragging;
    this.releaseGesture();

    if (wasPad) {
      // A hold already emitted its steps; only an un-repeated tap owes one.
      if (tapped && !stepped && direction) this.options.onStep?.(direction.dx, direction.dy);
      return;
    }
    if (tapped) this.options.onTap?.();
  };

  /** Float the base under a press and make it the analog origin. */
  private beginAnalog(clientX: number, clientY: number): void {
    this.originX = clamp(clientX, BASE_RADIUS + EDGE_MARGIN_PX, window.innerWidth - BASE_RADIUS - EDGE_MARGIN_PX);
    this.originY = clamp(clientY, BASE_RADIUS + EDGE_MARGIN_PX, window.innerHeight - BASE_RADIUS - EDGE_MARGIN_PX);
    const rect = this.zone.getBoundingClientRect();
    this.base.style.bottom = 'auto';
    this.base.style.left = `${this.originX - rect.left - BASE_RADIUS}px`;
    this.base.style.top = `${this.originY - rect.top - BASE_RADIUS}px`;
    this.base.style.opacity = '1';
    this.thumb.style.background = 'rgba(255,255,255,0.45)';
    // The arrows label a fixed pad; a base that has floated under the thumb is
    // an analog stick, and stale arrows on it would claim directions it no
    // longer measures.
    for (const arrow of this.arrows) arrow.style.display = 'none';
  }

  private update(clientX: number, clientY: number): void {
    let dx = clientX - this.originX;
    let dy = clientY - this.originY;
    const dist = Math.hypot(dx, dy);

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

  /** Repeat a held direction so laying a long wall is one press, not twelve. */
  private scheduleRepeat(delay: number): void {
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = null;
      if (this.activePointerId === null || this.dragging || !this.stepDirection) return;
      this.stepped = true;
      this.options.onStep?.(this.stepDirection.dx, this.stepDirection.dy);
      this.scheduleRepeat(HOLD_REPEAT_MS);
    }, delay);
  }

  private cancelRepeat(): void {
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private highlight(direction: StepDirection | null): void {
    DPAD_ARROWS.forEach((arrow, index) => {
      const glyph = this.arrows[index]!;
      const lit = direction !== null && direction.dx === arrow.dx && direction.dy === arrow.dy;
      glyph.style.color = lit ? '#ffe08a' : 'rgba(255,255,255,0.72)';
      glyph.style.transform = lit ? 'translate(-50%, -50%) scale(1.35)' : 'translate(-50%, -50%)';
    });
  }

  /** Drop any in-flight gesture and return the stick to rest. */
  private releaseGesture(): void {
    this.activePointerId = null;
    this.vector = { x: 0, y: 0, magnitude: 0 };
    this.padPress = false;
    this.stepDirection = null;
    this.stepped = false;
    this.dragging = false;
    this.cancelRepeat();
    this.highlight(null);
    this.restBase();
  }

  /** Park the pad, arrows and all, at the classic corner spot while idle. */
  private restBase(): void {
    for (const arrow of this.arrows) arrow.style.display = 'block';
    this.base.style.left = '16px';
    this.base.style.top = 'auto';
    this.base.style.bottom = '32px';
    this.base.style.opacity = this.placing ? '0.85' : '0.7';
    this.thumb.style.left = `${BASE_RADIUS - THUMB_RADIUS}px`;
    this.thumb.style.top = `${BASE_RADIUS - THUMB_RADIUS}px`;
    this.thumb.style.background = 'rgba(255,255,255,0.28)';
  }

  destroy(): void {
    this.cancelRepeat();
    this.zone.removeEventListener('pointerdown', this.onDown);
    this.zone.removeEventListener('pointermove', this.onMove);
    this.zone.removeEventListener('pointerup', this.onUp);
    this.zone.removeEventListener('pointercancel', this.onUp);
    this.zone.removeEventListener('lostpointercapture', this.onUp);
    this.zone.remove();
  }
}

/** Dominant axis of a press offset from the d-pad centre; null near the hub. */
function directionFrom(dx: number, dy: number): StepDirection | null {
  if (Math.hypot(dx, dy) < DPAD_CENTER_PX) return null;
  return Math.abs(dx) >= Math.abs(dy)
    ? { dx: Math.sign(dx), dy: 0 }
    : { dx: 0, dy: Math.sign(dy) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
