import { MAX_FRAME_MS } from '../config/platform';

/**
 * Fixed-timestep accumulator. Gameplay advances in discrete equal steps
 * regardless of frame rate; rendering interpolates using the returned alpha.
 * This keeps simulation deterministic and independent of display refresh.
 */
export class FixedStepLoop {
  private accumulatorMs = 0;

  constructor(
    private readonly stepMs: number,
    private readonly onStep: (stepMs: number) => void,
  ) {}

  /**
   * Feed the elapsed frame time; runs zero or more fixed steps.
   * @returns interpolation alpha in [0, 1) for rendering between steps.
   */
  advance(frameMs: number): number {
    this.accumulatorMs += Math.min(frameMs, MAX_FRAME_MS);
    while (this.accumulatorMs >= this.stepMs) {
      this.onStep(this.stepMs);
      this.accumulatorMs -= this.stepMs;
    }
    return this.accumulatorMs / this.stepMs;
  }

  /** Drop any partially accumulated time (e.g. on pause/background). */
  reset(): void {
    this.accumulatorMs = 0;
  }
}
