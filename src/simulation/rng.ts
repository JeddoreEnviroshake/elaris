/**
 * Deterministic seeded RNG. Simulation systems take an Rng instead of calling
 * Math.random(), so the same seed + command sequence reproduces the same state
 * hash. The internal state is a single u32, fully serializable into GameState.
 *
 * Algorithm: mulberry32 — small, fast, and stable across platforms.
 */
export interface Rng {
  /** Next unsigned 32-bit integer. */
  nextU32(): number;
  /** Next float in [0, 1). */
  nextFloat(): number;
  /** Integer in [minInclusive, maxExclusive). */
  nextInt(minInclusive: number, maxExclusive: number): number;
  /** Serializable internal state. */
  getState(): number;
  setState(state: number): void;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const nextU32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  return {
    nextU32,
    nextFloat: () => nextU32() / 0x1_0000_0000,
    nextInt: (minInclusive, maxExclusive) => {
      const span = maxExclusive - minInclusive;
      if (span <= 0) return minInclusive;
      return minInclusive + (nextU32() % span);
    },
    getState: () => state >>> 0,
    setState: (s) => {
      state = s >>> 0;
    },
  };
}
