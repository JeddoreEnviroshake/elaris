export interface DurationStats {
  count: number;
  latestMs: number | null;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  longCount: number;
}

/** Fixed-memory rolling duration samples; sorting occurs only on snapshot. */
export class DurationWindow {
  private readonly values: Float64Array;
  private count = 0;
  private nextIndex = 0;
  private latestMs: number | null = null;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('capacity must be a positive integer');
    this.values = new Float64Array(capacity);
  }

  record(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.values[this.nextIndex] = durationMs;
    this.nextIndex = (this.nextIndex + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
    this.latestMs = durationMs;
  }

  snapshot(longFrameMs = Number.POSITIVE_INFINITY): DurationStats {
    if (this.count === 0) {
      return {
        count: 0,
        latestMs: null,
        meanMs: null,
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
        maxMs: null,
        longCount: 0,
      };
    }

    const sorted = Array.from(this.values.subarray(0, this.count)).sort((left, right) => left - right);
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
      count: this.count,
      latestMs: this.latestMs,
      meanMs: sum / this.count,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      p99Ms: percentile(sorted, 0.99),
      maxMs: sorted[this.count - 1]!,
      longCount: sorted.filter((value) => value > longFrameMs).length,
    };
  }
}

function percentile(sorted: readonly number[], proportion: number): number {
  const index = Math.max(0, Math.ceil(proportion * sorted.length) - 1);
  return sorted[index]!;
}
