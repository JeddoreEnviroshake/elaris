import type { DangerThreat } from '../simulation/state';

/**
 * Every danger element, in one place.
 *
 * This list is the Admin display order and the set of threats everything keyed
 * by threat must cover: because those are `Record<DangerThreat, ...>`, adding a
 * threat here fails type-checking until it has a name, a duration default, and
 * a presentation style. What a given cycle brings is the schedule below.
 */
export const DANGER_THREAT_IDS = ['fog', 'raid', 'storm'] as const;

/**
 * The first cycles of a new world, in order.
 *
 * Fog and Raid teach the two preparation loops — a purified room, then walls
 * and a bow — and a player who has learned neither has no business being asked
 * to read a three-second telegraph as well. So the storm waits until both have
 * been survived twice.
 */
export const DANGER_ONBOARDING_THREATS = ['fog', 'raid', 'fog', 'raid'] as const;

/**
 * What repeats forever once onboarding is done: storm, fog, raid. The storm
 * leads because it arrives immediately after the onboarding raid, which is the
 * moment the schedule stops being predictable and starts being a rotation.
 */
export const DANGER_ROTATION_THREATS = ['storm', 'fog', 'raid'] as const;

/** Player-facing names, used by Admin labels and validation messages. */
export const DANGER_THREAT_NAMES: Readonly<Record<DangerThreat, string>> = {
  fog: 'Poison Fog',
  raid: 'Night Raid',
  storm: 'Arcane Storm',
};

/**
 * Everything the HUD, the War Table, and screen readers say about a threat.
 *
 * One exhaustive table rather than `fog ? ... : raid` expressions scattered
 * across the UI: with three threats those ternaries silently mislabel the new
 * one, whereas a missing key here is a compile error.
 */
export interface DangerThreatCopy {
  /** Player-facing name — the same string as DANGER_THREAT_NAMES. */
  name: string;
  /** Uppercase timer label, e.g. `ARCANE STORM`. */
  timerLabel: string;
  /** Lower-case name for mid-sentence use in ARIA text. */
  spokenName: string;
  /** Sentence-case name for the start of an ARIA sentence. */
  spokenNameCapitalized: string;
  /** What the player should be doing during the safe phase before it. */
  preparation: string;
  /** What the player should be doing while it runs. */
  active: string;
  /**
   * How the player is protected, if standing somewhere can protect them.
   * `null` means nowhere is safe by standing still — the answer is movement.
   */
  cover: DangerThreatCover | null;
}

export interface DangerThreatCover {
  /** Uppercase HUD badge shown while covered, e.g. `SHELTERED`. */
  badge: string;
  /** Lower-case equivalent for ARIA text. */
  spoken: string;
}

export const DANGER_THREAT_COPY: Readonly<Record<DangerThreat, DangerThreatCopy>> = {
  fog: {
    name: 'Poison Fog',
    timerLabel: 'POISON FOG',
    spokenName: 'poison fog',
    spokenNameCapitalized: 'Poison fog',
    preparation: 'Seal a room and run an Air Purifier inside it.',
    active: 'Stay in purified air until the fog lifts.',
    cover: { badge: 'SHELTERED', spoken: 'sheltered' },
  },
  raid: {
    name: 'Night Raid',
    timerLabel: 'NIGHT RAID',
    spokenName: 'night raid',
    spokenNameCapitalized: 'Night raid',
    preparation: 'Close your walls, load the turrets, and carry arrows.',
    active: 'Hold the walls or seal yourself in until dawn.',
    cover: { badge: 'SEALED IN', spoken: 'sealed in' },
  },
  storm: {
    name: 'Arcane Storm',
    timerLabel: 'ARCANE STORM',
    spokenName: 'arcane storm',
    spokenNameCapitalized: 'Arcane storm',
    // Walls stop a strike, but nothing else does: no purifier, no turret, no
    // amount of health. Outside, the only answer is the three-second telegraph.
    preparation: 'Get four walls around you, or keep room to move outside.',
    active: 'Stay inside, or move out of every ring before it lands.',
    cover: { badge: 'UNDER COVER', spoken: 'under cover' },
  },
};

/** Uppercase badge for a player standing somewhere the threat cannot reach. */
export const DANGER_SANCTUARY_BADGE = 'SANCTUARY';
