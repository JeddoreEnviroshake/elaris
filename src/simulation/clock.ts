/**
 * Injected clock. Simulation systems must never read the wall clock directly;
 * they take a Clock so tests can drive time deterministically and offline
 * settlement (Milestone 2) can be validated with fixed values.
 */
export interface Clock {
  /** Milliseconds since epoch. */
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** Test/dev clock with an explicit, advanceable time. */
export class ManualClock implements Clock {
  private ms: number;

  constructor(startMs = 0) {
    this.ms = startMs;
  }

  now(): number {
    return this.ms;
  }

  advance(deltaMs: number): void {
    this.ms += deltaMs;
  }

  set(ms: number): void {
    this.ms = ms;
  }
}
