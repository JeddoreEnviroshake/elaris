/**
 * When the player's HP / SP / MP bars are worth showing.
 *
 * The rule is activity, not fullness: a bar the player is not using tells them
 * nothing, so it stays out of the way until its value actually moves. Spending
 * mana brings the mana bar up; so does regenerating it, one point at a time,
 * because a bar climbing back is still a bar the player is watching. Five
 * seconds after the last movement — which for a slow regen means five seconds
 * after it finishes topping up — it fades back out.
 *
 * Danger is deliberately *not* an override. A raid or a fog phase moves health
 * and stamina on its own, which brings those bars up through the same activity
 * rule; pinning all three up just because something is nearby put bars on
 * screen that the player was not using.
 *
 * Pure and clock-injected so the whole policy is unit-testable; the HUD only
 * translates the result into opacity.
 */

/** How long a bar stays up after its last value change. */
export const VITAL_BAR_ACTIVE_MS = 5_000;
/** Fade duration once the active window has passed. */
export const VITAL_BAR_FADE_MS = 260;

export interface VitalBarInput {
  readonly max: number;
  /** Timestamp this bar's value last moved; -Infinity if it never has. */
  readonly lastChangedAtMs: number;
  readonly nowMs: number;
}

/** Target opacity, 0–1. The HUD lerps nothing; CSS handles the transition. */
export function vitalBarOpacity(input: VitalBarInput): number {
  const { max, lastChangedAtMs, nowMs } = input;
  if (max <= 0) return 0;
  if (!Number.isFinite(lastChangedAtMs)) return 0;
  const since = nowMs - lastChangedAtMs;
  if (since <= VITAL_BAR_ACTIVE_MS) return 1;
  if (since >= VITAL_BAR_ACTIVE_MS + VITAL_BAR_FADE_MS) return 0;
  return 1 - (since - VITAL_BAR_ACTIVE_MS) / VITAL_BAR_FADE_MS;
}

/** Whether a bar is effectively invisible, and so should leave the a11y tree. */
export function vitalBarHidden(opacity: number): boolean {
  return opacity <= 0.01;
}

/**
 * Per-bar memory of the last reading, so the HUD can tell a value that moved
 * from one that has been sitting still.
 *
 * The first reading of a bar is deliberately *not* activity: a fresh HUD, or
 * one rebuilt on an area change, would otherwise flash every bar for five
 * seconds just for existing.
 */
export class VitalBarActivity {
  private readonly lastSample = new Map<string, string>();
  private readonly changedAtMs = new Map<string, number>();

  /**
   * Record one reading and report when this bar last moved. A change in either
   * the value or its maximum counts — a level-up that widens the health bar is
   * as visible as spending the health.
   */
  record(key: string, current: number, max: number, nowMs: number): number {
    const sample = `${current}/${max}`;
    const previous = this.lastSample.get(key);
    this.lastSample.set(key, sample);
    if (previous !== undefined && previous !== sample) this.changedAtMs.set(key, nowMs);
    return this.changedAtMs.get(key) ?? Number.NEGATIVE_INFINITY;
  }
}
