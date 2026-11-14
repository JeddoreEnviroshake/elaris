import { describe, expect, it } from 'vitest';
import { DurationWindow } from '../../src/platform/durationWindow';

describe('DurationWindow', () => {
  it('summarizes percentiles and long frames', () => {
    const window = new DurationWindow(10);
    for (const duration of [10, 20, 30, 40, 50]) window.record(duration);

    expect(window.snapshot(33)).toEqual({
      count: 5,
      latestMs: 50,
      meanMs: 30,
      p50Ms: 30,
      p95Ms: 50,
      p99Ms: 50,
      maxMs: 50,
      longCount: 2,
    });
  });

  it('retains only the newest samples at capacity', () => {
    const window = new DurationWindow(3);
    for (const duration of [1, 2, 3, 9]) window.record(duration);
    const stats = window.snapshot();
    expect(stats.count).toBe(3);
    expect(stats.latestMs).toBe(9);
    expect(stats.meanMs).toBeCloseTo(14 / 3, 8);
    expect(stats.maxMs).toBe(9);
  });

  it('ignores invalid samples and reports an empty window', () => {
    const window = new DurationWindow(4);
    window.record(-1);
    window.record(Number.NaN);
    expect(window.snapshot()).toMatchObject({ count: 0, latestMs: null, longCount: 0 });
  });

  it('rejects invalid capacities', () => {
    expect(() => new DurationWindow(0)).toThrow('capacity');
    expect(() => new DurationWindow(2.5)).toThrow('capacity');
  });
});
