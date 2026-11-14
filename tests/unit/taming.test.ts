import { describe, expect, it } from 'vitest';
import {
  abandonTamingSession,
  beatsForSnare,
  beginTamingSession,
  isMoodTense,
  resolveTamingBeat,
  tamingActionPreview,
  TAMING_ACTIONS,
  type CreatureTemperament,
  type TameDisposition,
  type TamingAction,
  type TamingSession,
  type SnareItemId,
} from '../../src/simulation/taming';
import { TAMING_APPROACH_CALM_FEAR_BPS, TAMING_FEAR_BREAK_BPS, TAMING_WARY_FEAR_BPS } from '../../src/config/balance';

type Policy = (session: TamingSession) => TamingAction;

/** Plays one seeded session to its settle and reports the disposition. */
function playSession(
  policy: Policy,
  seed: number,
  temperament: CreatureTemperament = 'neutral',
  snare: SnareItemId = 'taming-snare',
  berries = 99,
): { disposition: TameDisposition; session: TamingSession } {
  let { session, rngState } = beginTamingSession(temperament, snare, seed);
  let remainingBerries = berries;
  // Bounded well above the longest possible session; a session that does not
  // settle inside this is a bug, and the expectation below catches it.
  for (let guard = 0; guard < 32 && session.settled === null; guard += 1) {
    const beat = resolveTamingBeat(session, policy(session), rngState, {
      berriesAvailable: remainingBerries,
    });
    session = beat.session;
    rngState = beat.rngState;
    remainingBerries -= beat.berriesSpent;
  }
  expect(session.settled).not.toBeNull();
  return { disposition: session.settled!, session };
}

function distributionWith(
  policy: Policy,
  runs: number,
  temperament: CreatureTemperament,
  snare: SnareItemId,
): Record<TameDisposition, number> {
  const counts: Record<TameDisposition, number> = { eager: 0, wary: 0, docile: 0, broken: 0 };
  for (let seed = 1; seed <= runs; seed += 1) {
    counts[playSession(policy, seed * 7919, temperament, snare).disposition] += 1;
  }
  return counts;
}

function distribution(policy: Policy, runs: number, temperament: CreatureTemperament = 'neutral'): Record<TameDisposition, number> {
  return distributionWith(policy, runs, temperament, 'taming-snare');
}

/** The naive line: one button, no reading. */
const alwaysSteady: Policy = () => 'steady';

/**
 * The skilled line: push when the creature is not tense, calm it down when it
 * is. This is exactly the read the mood telegraph is there to enable.
 */
const readTheMood: Policy = (session) => {
  if (!isMoodTense(session.mood)) return 'approach';
  if (session.fearBps >= TAMING_WARY_FEAR_BPS - 1_500) return 'back-off';
  return 'steady';
};

/** The blind line: the strongest single move, taken without reading anything. */
const alwaysApproach: Policy = () => 'approach';

/** The patient line: spend berries to break tension instead of pushing through it. */
const feedWhenTense: Policy = (session) => (isMoodTense(session.mood) ? 'offer' : 'steady');

describe('taming session mechanics', () => {
  it('gives the reinforced snare more beats and a lower band floor', () => {
    const basic = beginTamingSession('neutral', 'taming-snare', 1).session;
    const reinforced = beginTamingSession('neutral', 'reinforced-snare', 1).session;
    expect(reinforced.beatsRemaining).toBeGreaterThan(basic.beatsRemaining);
    expect(reinforced.bandLowBps).toBeLessThan(basic.bandLowBps);
    expect(beatsForSnare('reinforced-snare')).toBe(reinforced.beatsRemaining);
  });

  it('prices Approach by the mood the player was shown', () => {
    const session = beginTamingSession('neutral', 'taming-snare', 3).session;
    const tense = { ...session, mood: 'straining' as const };
    const calm = { ...session, mood: 'settling' as const };
    expect(tamingActionPreview(calm, 'approach').fearBps).toBe(TAMING_APPROACH_CALM_FEAR_BPS);
    expect(tamingActionPreview(tense, 'approach').fearBps)
      .toBeGreaterThan(tamingActionPreview(calm, 'approach').fearBps);
  });

  it('keeps every meter an integer inside 0..10000', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const { session } = playSession(readTheMood, seed * 31, 'skittish');
      for (const value of [session.calmBps, session.fearBps, session.peakFearBps, session.beatsRemaining]) {
        expect(Number.isInteger(value)).toBe(true);
      }
      expect(session.calmBps).toBeGreaterThanOrEqual(0);
      expect(session.calmBps).toBeLessThanOrEqual(10_000);
      expect(session.fearBps).toBeGreaterThanOrEqual(0);
      expect(session.fearBps).toBeLessThanOrEqual(10_000);
    }
  });

  it('is fully deterministic for a given seed and action sequence', () => {
    const first = playSession(readTheMood, 4242, 'skittish');
    const second = playSession(readTheMood, 4242, 'skittish');
    expect(second.session).toEqual(first.session);
  });

  it('always yields the creature — there is no fail-to-nothing outcome', () => {
    for (const action of TAMING_ACTIONS) {
      const { disposition } = playSession(() => action, 99, 'aggressive');
      expect(['eager', 'wary', 'docile', 'broken']).toContain(disposition);
    }
  });

  it('blocks Offer with no berries without consuming the beat', () => {
    const { session, rngState } = beginTamingSession('neutral', 'taming-snare', 11);
    const beat = resolveTamingBeat(session, 'offer', rngState, { berriesAvailable: 0 });
    expect(beat.blocked).toBe('No berries available');
    expect(beat.session).toEqual(session);
    expect(beat.berriesSpent).toBe(0);
  });

  it('settles an abandoned session to broken rather than losing the creature', () => {
    const { session } = beginTamingSession('neutral', 'taming-snare', 5);
    expect(abandonTamingSession(session).settled).toBe('broken');
  });

  it('ends the session broken when fear crosses the break point', () => {
    // Approaching a panicking creature repeatedly is the fear spiral; it must
    // terminate the session rather than merely grading it down.
    let { session, rngState } = beginTamingSession('skittish', 'reinforced-snare', 17);
    session = { ...session, fearBps: TAMING_FEAR_BREAK_BPS - 1_000, mood: 'panicking' };
    const beat = resolveTamingBeat(session, 'approach', rngState);
    expect(beat.session.fearBps).toBeGreaterThanOrEqual(TAMING_FEAR_BREAK_BPS);
    expect(beat.session.settled).toBe('broken');
    expect(beat.session.beatsRemaining).toBe(0);
  });

  it('makes Approach better on both axes against a creature that is not tense', () => {
    const base = beginTamingSession('neutral', 'taming-snare', 21).session;
    const calm = tamingActionPreview({ ...base, mood: 'settling' }, 'approach');
    const tense = tamingActionPreview({ ...base, mood: 'panicking' }, 'approach');
    expect(calm.calmBps).toBeGreaterThan(tense.calmBps);
    expect(calm.fearBps).toBeLessThan(tense.fearBps);
  });
});

/**
 * THE GATE. If reading the mood does not clearly beat mashing one button, the
 * telegraph is not readable and the whole modal is a coin flip in a costume —
 * in which case the honest move is to delete the screen, not ship it.
 */
describe('taming readability gate', () => {
  const RUNS = 200;

  it('punishes mashing a single button', () => {
    // Steady alone cannot carry a creature into the band inside a basic snare's
    // beats. If this ever passes comfortably, the session has become free.
    expect(distribution(alwaysSteady, RUNS).broken).toBeGreaterThan(RUNS / 2);
  });

  it('rewards reading the mood over ignoring it', () => {
    const read = distribution(readTheMood, RUNS);
    const blind = distribution(alwaysApproach, RUNS);
    // The read is worth making precisely because it halves the disaster rate;
    // a blind rusher still gets creatures, just worse ones, more often ruined.
    expect(blind.broken).toBeGreaterThan(read.broken * 1.5);
  });

  it('lets the player choose which creature they are making', () => {
    const bold = distribution(readTheMood, RUNS);
    const patient = distribution(feedWhenTense, RUNS);
    // This is the authored-outcome property, and the whole justification for a
    // modal screen: the same species answers to the policy, not to the dice.
    expect(patient.docile).toBeGreaterThan(patient.eager + patient.wary);
    expect(bold.eager + bold.wary).toBeGreaterThan(bold.docile);
  });

  it('makes the Reinforced Snare a different tool, not a bigger number', () => {
    const basic = distributionWith(readTheMood, RUNS, 'neutral', 'taming-snare');
    const reinforced = distributionWith(readTheMood, RUNS, 'neutral', 'reinforced-snare');
    expect(reinforced.broken).toBeLessThan(basic.broken);
    expect(reinforced.eager).toBeGreaterThan(basic.eager);
  });

  it('makes skittish creatures meaningfully harder than passive ones', () => {
    const passive = distribution(readTheMood, RUNS, 'passive');
    const skittish = distribution(readTheMood, RUNS, 'skittish');
    expect(skittish.broken).toBeGreaterThan(passive.broken);
  });

  it('reaches every disposition across the seed space', () => {
    const policies: Policy[] = [
      alwaysSteady,
      readTheMood,
      () => 'approach',
      (session) => (session.fedBeats < 2 ? 'offer' : 'steady'),
    ];
    const seen = new Set<TameDisposition>();
    for (const policy of policies) {
      for (const temperament of ['passive', 'neutral', 'skittish', 'aggressive'] as const) {
        for (const snare of ['taming-snare', 'reinforced-snare'] as const) {
          for (let seed = 1; seed <= 40; seed += 1) {
            seen.add(playSession(policy, seed * 104_729, temperament, snare).disposition);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(['broken', 'docile', 'eager', 'wary']);
  });
});
