/**
 * The taming session — what a landed snare opens instead of a battle.
 *
 * A snare captures; it does not tame. The session that follows is 4–6 beats of
 * nudging a held creature's Calm up and its Fear down, and it *always* yields
 * the creature. What the player plays for is the creature's disposition, which
 * is written by how they got there rather than rolled.
 *
 * This module is deliberately free of `GameState`: it takes a session, an
 * action, and an RNG word, and returns the next session and RNG word. That
 * keeps the readability gate (see tests/unit/taming.test.ts) cheap to run
 * across thousands of seeded sessions, and it keeps the balance math out of the
 * command layer entirely.
 */
import {
  TAMING_ACTION_EFFECTS,
  TAMING_APPROACH_CALM_CALM_BPS,
  TAMING_APPROACH_CALM_FEAR_BPS,
  TAMING_BAND_HIGH_BPS,
  TAMING_BAND_LOW_BPS,
  TAMING_BAND_WIDEN_BPS,
  TAMING_BEATS_BASIC,
  TAMING_BEATS_REINFORCED,
  TAMING_FEAR_BREAK_BPS,
  TAMING_FEAR_SKEW_BPS,
  TAMING_MOOD_DRIFT,
  TAMING_MOOD_WEIGHTS,
  TAMING_OFFER_BERRY_COST,
  TAMING_START_CALM_BPS,
  TAMING_START_FEAR_BPS,
  TAMING_WARY_FEAR_BPS,
} from '../config/balance';
import { createRng } from './rng';

export type TamingMood = 'settling' | 'watching' | 'straining' | 'panicking';
export type TamingAction = 'steady' | 'approach' | 'offer' | 'back-off';
export type TameDisposition = 'eager' | 'wary' | 'docile' | 'broken';
export type CreatureTemperament = 'passive' | 'neutral' | 'skittish' | 'aggressive';
export type SnareItemId = 'taming-snare' | 'reinforced-snare';

export const TAMING_ACTIONS: readonly TamingAction[] = ['steady', 'approach', 'offer', 'back-off'];
export const TAMING_MOODS: readonly TamingMood[] = ['settling', 'watching', 'straining', 'panicking'];

const METER_MIN_BPS = 0;
const METER_MAX_BPS = 10_000;

/**
 * Everything the panel draws and the settle grades from. Integers only — this
 * shape lands in `GameState`, and `canonicalizeGameState` throws on fractions.
 */
export interface TamingSession {
  beatsRemaining: number;
  calmBps: number;
  fearBps: number;
  /** Highest Fear the session ever reached; the `wary` grade reads this, not the ending value. */
  peakFearBps: number;
  /** Telegraphed: governs both the drift about to land and the cost of Approach. */
  mood: TamingMood;
  boldBeats: number;
  patientBeats: number;
  fedBeats: number;
  bandLowBps: number;
  bandHighBps: number;
  temperament: CreatureTemperament;
  /** Non-null once the session has ended; the disposition to stamp on the companion. */
  settled: TameDisposition | null;
  /** True when the band's top edge was reached with beats still in hand. */
  finishedEarly: boolean;
}

export interface TamingBeatResult {
  session: TamingSession;
  rngState: number;
  /** Set when the action could not be taken; the session is returned unchanged. */
  blocked?: string;
  /** Berries the beat consumed. */
  berriesSpent: number;
}

export function beatsForSnare(snareItemId: SnareItemId): number {
  return snareItemId === 'reinforced-snare' ? TAMING_BEATS_REINFORCED : TAMING_BEATS_BASIC;
}

/**
 * Open a session. The Reinforced Snare buys beats *and* a lower band floor,
 * rather than a bigger success percentage — the trophy snare whose cost is one
 * material from every species should feel like a different tool, not a bigger
 * number.
 */
export function beginTamingSession(
  temperament: CreatureTemperament,
  snareItemId: SnareItemId,
  rngState: number,
): { session: TamingSession; rngState: number } {
  const reinforced = snareItemId === 'reinforced-snare';
  const session: TamingSession = {
    beatsRemaining: beatsForSnare(snareItemId),
    calmBps: TAMING_START_CALM_BPS,
    fearBps: TAMING_START_FEAR_BPS,
    peakFearBps: TAMING_START_FEAR_BPS,
    mood: 'watching',
    boldBeats: 0,
    patientBeats: 0,
    fedBeats: 0,
    bandLowBps: reinforced ? TAMING_BAND_LOW_BPS - TAMING_BAND_WIDEN_BPS : TAMING_BAND_LOW_BPS,
    bandHighBps: TAMING_BAND_HIGH_BPS,
    temperament,
    settled: null,
    finishedEarly: false,
  };
  // The opening mood is rolled, not fixed, so the first read is a real read.
  const rolled = rollMood(session, rngState);
  return { session: { ...session, mood: rolled.mood }, rngState: rolled.rngState };
}

export function isMoodTense(mood: TamingMood): boolean {
  return TAMING_MOOD_DRIFT[mood].tense;
}

export function tamingMoodLabel(mood: TamingMood): string {
  if (mood === 'settling') return 'Going still';
  if (mood === 'watching') return 'Watching you';
  if (mood === 'straining') return 'Straining';
  return 'Panicking';
}

export function tamingDispositionLabel(disposition: TameDisposition): string {
  if (disposition === 'eager') return 'Eager';
  if (disposition === 'wary') return 'Wary';
  if (disposition === 'docile') return 'Docile';
  return 'Broken-spirited';
}

/**
 * What an action would do to the meters right now, before the mood's drift.
 * The panel shows this on the buttons so Approach's tense-mood fear spike is
 * visible *before* it is paid, which is the entire skill of the mechanic.
 */
export function tamingActionPreview(
  session: TamingSession,
  action: TamingAction,
): { calmBps: number; fearBps: number } {
  const effect = TAMING_ACTION_EFFECTS[action];
  if (action !== 'approach') return { calmBps: effect.calmBps, fearBps: effect.fearBps };
  // The stored Approach figures are the tense case; reading a settled creature
  // upgrades both axes at once.
  if (isMoodTense(session.mood)) return { calmBps: effect.calmBps, fearBps: effect.fearBps };
  return { calmBps: TAMING_APPROACH_CALM_CALM_BPS, fearBps: TAMING_APPROACH_CALM_FEAR_BPS };
}

/**
 * Resolve one beat.
 *
 * Order matters and is chosen for readability: the mood the player *saw* is the
 * mood that prices Approach and the mood whose drift lands this beat. Nothing
 * is decided by information the player did not have.
 */
export function resolveTamingBeat(
  session: TamingSession,
  action: TamingAction,
  rngState: number,
  options: { berriesAvailable: number } = { berriesAvailable: 0 },
): TamingBeatResult {
  if (session.settled !== null) {
    return { session, rngState, blocked: 'This creature is already settled', berriesSpent: 0 };
  }
  if (action === 'offer' && options.berriesAvailable < TAMING_OFFER_BERRY_COST) {
    return { session, rngState, blocked: 'No berries available', berriesSpent: 0 };
  }

  const preview = tamingActionPreview(session, action);
  const drift = TAMING_MOOD_DRIFT[session.mood];
  const next: TamingSession = {
    ...session,
    calmBps: clampMeter(session.calmBps + preview.calmBps + drift.calmBps),
    fearBps: clampMeter(session.fearBps + preview.fearBps + drift.fearBps),
    boldBeats: session.boldBeats + (action === 'approach' ? 1 : 0),
    patientBeats: session.patientBeats + (action === 'steady' || action === 'back-off' ? 1 : 0),
    fedBeats: session.fedBeats + (action === 'offer' ? 1 : 0),
  };
  next.peakFearBps = Math.max(session.peakFearBps, next.fearBps);

  // Fear past the break point ends it: the creature is beyond calming and comes
  // home broken-spirited. This is the cost that makes Approach a decision rather
  // than a dominant line, and the reason Back off is on the panel at all.
  if (next.fearBps >= TAMING_FEAR_BREAK_BPS) {
    next.beatsRemaining = 0;
    next.finishedEarly = false;
    next.settled = 'broken';
    return { session: next, rngState, berriesSpent: berriesFor(action) };
  }

  // Reaching the band's top edge ends the session on the spot. Beats left over
  // are the only route to `eager`, so a clean read is worth more than a long one.
  if (next.calmBps >= next.bandHighBps) {
    next.beatsRemaining = Math.max(0, next.beatsRemaining - 1);
    next.finishedEarly = next.beatsRemaining > 0;
    next.settled = gradeTame(next);
    return { session: next, rngState, berriesSpent: berriesFor(action) };
  }

  next.beatsRemaining = Math.max(0, next.beatsRemaining - 1);
  if (next.beatsRemaining === 0) {
    next.settled = gradeTame(next);
    return { session: next, rngState, berriesSpent: berriesFor(action) };
  }

  const rolled = rollMood(next, rngState);
  next.mood = rolled.mood;
  return { session: next, rngState: rolled.rngState, berriesSpent: berriesFor(action) };
}

/**
 * Abandoning a live session — the always-available skip — settles for the
 * mediocre middle rather than losing the creature. Nobody mid-errand gets
 * trapped in a ceremony, and nobody is punished for leaving.
 */
export function abandonTamingSession(session: TamingSession): TamingSession {
  if (session.settled !== null) return session;
  return { ...session, beatsRemaining: 0, settled: 'broken', finishedEarly: false };
}

/**
 * The grade. Fear is checked first on purpose: a creature dragged into the band
 * through panic is `wary` no matter how efficiently it was dragged, which is
 * what stops Approach-spam from being the dominant line.
 */
function gradeTame(session: TamingSession): TameDisposition {
  if (session.calmBps < session.bandLowBps) return 'broken';
  if (session.peakFearBps >= TAMING_WARY_FEAR_BPS) return 'wary';
  if (session.finishedEarly) return 'eager';
  if (session.fedBeats + session.patientBeats > session.boldBeats) return 'docile';
  return 'wary';
}

function berriesFor(action: TamingAction): number {
  return action === 'offer' ? TAMING_OFFER_BERRY_COST : 0;
}

function clampMeter(value: number): number {
  return Math.max(METER_MIN_BPS, Math.min(METER_MAX_BPS, Math.round(value)));
}

/**
 * Roll the next telegraphed mood. Species temperament sets the base weights;
 * current Fear scales the tense moods up, so a fear spiral genuinely is harder
 * to read and Back off has to be spent to break it.
 */
function rollMood(session: TamingSession, rngState: number): { mood: TamingMood; rngState: number } {
  const base = TAMING_MOOD_WEIGHTS[session.temperament];
  const skewBps = 10_000 + Math.floor((session.fearBps * TAMING_FEAR_SKEW_BPS) / 10_000);
  const weights = TAMING_MOODS.map((mood) => {
    const weight = base[mood];
    return isMoodTense(mood) ? Math.floor((weight * skewBps) / 10_000) : weight;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const rng = createRng(rngState);
  let pick = rng.nextInt(0, total);
  for (let index = 0; index < weights.length; index += 1) {
    pick -= weights[index]!;
    if (pick < 0) return { mood: TAMING_MOODS[index]!, rngState: rng.getState() };
  }
  return { mood: 'watching', rngState: rng.getState() };
}
