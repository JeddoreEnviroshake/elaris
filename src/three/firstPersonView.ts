/**
 * First-person view: an opt-in, per-device presentation of the overworld.
 *
 * Nothing here is game state. The view mode, look angles and sensitivity live
 * in this module and in localStorage only; they never reach GameState or the
 * published balance. The simulation only ever sees the integer `heading` that
 * WorldScene derives from the look yaw.
 *
 * Comfort is the whole point of this file. The user is prone to motion
 * sickness, so the camera moves only when a thumb asks it to:
 * - look angles change only in `turn`/`turnBy`, directly from input, with no
 *   smoothing, inertia or easing;
 * - pitch is clamped and never moves on its own;
 * - there is no bob, sway, roll, shake or FOV change anywhere.
 */

export type ViewMode = 'overhead' | 'first-person';

/** Vertical field of view in degrees. Fixed: sprinting never changes it. */
export const FIRST_PERSON_FOV_DEGREES = 70;
export const FIRST_PERSON_NEAR = 0.05;
export const FIRST_PERSON_FAR = 120;
/** Eye height above the player's render pose, in tiles (one tile = one world unit). */
export const FIRST_PERSON_EYE_HEIGHT = 1.5;
/** Fog tuned for a camera at the player, so the loaded area's edge never shows. */
export const FIRST_PERSON_FOG_NEAR = 10;
export const FIRST_PERSON_FOG_FAR = 45;
/** Chunks and entities are shown out to the fog, plus a margin, around the player. */
export const FIRST_PERSON_VIEW_RADIUS_TILES = FIRST_PERSON_FOG_FAR + 3;
export const FIRST_PERSON_PITCH_LIMIT_DEGREES = 60;
/** Degrees of turn per CSS pixel of drag. */
export const DEFAULT_LOOK_SENSITIVITY = 0.3;
/** Q/E keyboard fallback turn rate, degrees per second. */
export const KEYBOARD_TURN_DEGREES_PER_SECOND = 110;

const VIEW_MODE_KEY = 'elaris.viewMode';
const SENSITIVITY_KEY = 'elaris.lookSensitivity';

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private windows and blocked storage simply forget the preference.
  }
}

/**
 * Look angles in the same yaw convention as the overhead camera
 * (`screenToCameraWorldIntent`): yaw 0 looks north (-y), and positive yaw turns
 * the view counter-clockwise seen from above. Forward on the ground is
 * (-sin yaw, -cos yaw) in world x/y.
 */
export class FirstPersonLook {
  yawDegrees = 0;
  pitchDegrees = 0;

  /** Turn by a drag of (dx, dy) CSS pixels: drag right turns right, drag up looks up. */
  turn(dxPx: number, dyPx: number, sensitivity: number): void {
    this.turnBy(-dxPx * sensitivity, -dyPx * sensitivity);
  }

  turnBy(yawDegrees: number, pitchDegrees = 0): void {
    if (Number.isFinite(yawDegrees)) this.yawDegrees = wrapDegrees(this.yawDegrees + yawDegrees);
    if (Number.isFinite(pitchDegrees)) {
      this.pitchDegrees = Math.max(
        -FIRST_PERSON_PITCH_LIMIT_DEGREES,
        Math.min(FIRST_PERSON_PITCH_LIMIT_DEGREES, this.pitchDegrees + pitchDegrees),
      );
    }
  }

  /** Whole degrees clockwise from north, the form `MoveIntent.heading` takes. */
  heading(): number {
    return headingFromYaw(this.yawDegrees);
  }
}

export function headingFromYaw(yawDegrees: number): number {
  return ((Math.round(-yawDegrees) % 360) + 360) % 360;
}

/** Yaw that looks along a four-way facing, used when entering first person. */
export function yawForFacing(facing: 'up' | 'down' | 'left' | 'right'): number {
  return facing === 'up' ? 0 : facing === 'left' ? 90 : facing === 'down' ? 180 : -90;
}

/** Unit forward vector on the ground, in world x/y (y grows south). */
export function groundForward(yawDegrees: number): { x: number; y: number } {
  const yaw = yawDegrees * Math.PI / 180;
  return { x: -Math.sin(yaw), y: -Math.cos(yaw) };
}

function wrapDegrees(degrees: number): number {
  const wrapped = ((degrees + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * The per-device view preference plus the live look angles. One instance is
 * shared by WorldScene (movement mapping, targeting) and the renderer (camera).
 */
export class FirstPersonView {
  readonly look = new FirstPersonLook();
  /** What the player picked. `active` may still be overhead (build mode, interiors, taming). */
  requested: ViewMode;
  sensitivity: number;
  /** Set by WorldScene each frame: requested first person and nothing forcing overhead. */
  active = false;
  private readonly listeners = new Set<(mode: ViewMode) => void>();

  constructor() {
    this.requested = readStorage(VIEW_MODE_KEY) === 'first-person' ? 'first-person' : 'overhead';
    const stored = Number(readStorage(SENSITIVITY_KEY));
    this.sensitivity = Number.isFinite(stored) && stored > 0.02 && stored < 3 ? stored : DEFAULT_LOOK_SENSITIVITY;
  }

  setRequested(mode: ViewMode): void {
    if (this.requested === mode) return;
    this.requested = mode;
    writeStorage(VIEW_MODE_KEY, mode);
    for (const listener of this.listeners) listener(mode);
  }

  toggle(): ViewMode {
    this.setRequested(this.requested === 'first-person' ? 'overhead' : 'first-person');
    return this.requested;
  }

  setSensitivity(value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    this.sensitivity = value;
    writeStorage(SENSITIVITY_KEY, String(value));
  }

  onChange(listener: (mode: ViewMode) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const firstPersonView = new FirstPersonView();
