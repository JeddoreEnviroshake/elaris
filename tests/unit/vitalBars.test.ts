import { describe, expect, it } from 'vitest';
import {
  VITAL_BAR_ACTIVE_MS,
  VITAL_BAR_FADE_MS,
  VitalBarActivity,
  vitalBarHidden,
  vitalBarOpacity,
} from '../../src/ui/vitalBars';

const base = {
  max: 100,
  lastChangedAtMs: Number.NEGATIVE_INFINITY,
  nowMs: 100_000,
};

describe('vitalBarOpacity', () => {
  it('hides a bar that has never moved', () => {
    expect(vitalBarOpacity(base)).toBe(0);
  });

  it('shows a bar for the full active window after a change', () => {
    expect(vitalBarOpacity({ ...base, lastChangedAtMs: base.nowMs })).toBe(1);
    expect(vitalBarOpacity({
      ...base,
      lastChangedAtMs: base.nowMs - VITAL_BAR_ACTIVE_MS,
    })).toBe(1);
  });

  it('fades out after the active window and settles at hidden', () => {
    const midway = vitalBarOpacity({
      ...base,
      lastChangedAtMs: base.nowMs - VITAL_BAR_ACTIVE_MS - VITAL_BAR_FADE_MS / 2,
    });
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);
    expect(vitalBarOpacity({
      ...base,
      lastChangedAtMs: base.nowMs - VITAL_BAR_ACTIVE_MS - VITAL_BAR_FADE_MS,
    })).toBe(0);
  });

  it('hides an idle bar even though it is nowhere near full', () => {
    // Fullness is not the question any more: a half-empty bar the player is
    // not touching is as uninteresting as a topped-up one.
    expect(vitalBarOpacity({
      ...base,
      lastChangedAtMs: base.nowMs - 60_000,
    })).toBe(0);
  });

  it('keeps an idle bar hidden even in danger', () => {
    // Danger is not an override. Whatever the threat is doing to the player
    // moves a value, and that movement is what raises the bar; a bar nothing
    // has touched stays out of the way.
    expect(vitalBarOpacity({ ...base, lastChangedAtMs: base.nowMs - 60_000 })).toBe(0);
  });

  it('treats a zero maximum as nothing to show', () => {
    expect(vitalBarOpacity({ ...base, max: 0, lastChangedAtMs: base.nowMs })).toBe(0);
  });
});

describe('VitalBarActivity', () => {
  it('does not treat the first reading of a bar as a change', () => {
    const activity = new VitalBarActivity();
    expect(activity.record('mp', 40, 100, 1_000)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('stamps the moment a value moves and holds it while the value sits still', () => {
    const activity = new VitalBarActivity();
    activity.record('mp', 100, 100, 1_000);
    expect(activity.record('mp', 80, 100, 2_000)).toBe(2_000); // spent on a spell
    expect(activity.record('mp', 80, 100, 3_000)).toBe(2_000); // idle, clock keeps running
    expect(activity.record('mp', 80, 100, 9_000)).toBe(2_000);
  });

  it('counts regeneration as activity, so the window restarts on each tick up', () => {
    const activity = new VitalBarActivity();
    activity.record('mp', 60, 100, 1_000);
    expect(activity.record('mp', 61, 100, 2_000)).toBe(2_000);
    expect(activity.record('mp', 62, 100, 3_000)).toBe(3_000);
    // Topped up: the last change is the one that filled it, and the bar stays
    // up for the active window measured from there.
    expect(activity.record('mp', 63, 100, 4_000)).toBe(4_000);
    expect(vitalBarOpacity({
      ...base, lastChangedAtMs: 4_000, nowMs: 4_000 + VITAL_BAR_ACTIVE_MS,
    })).toBe(1);
    expect(vitalBarOpacity({
      ...base,
      lastChangedAtMs: 4_000,
      nowMs: 4_000 + VITAL_BAR_ACTIVE_MS + VITAL_BAR_FADE_MS,
    })).toBe(0);
  });

  it('counts a change in the maximum, such as a level-up, as activity', () => {
    const activity = new VitalBarActivity();
    activity.record('hp', 100, 100, 1_000);
    expect(activity.record('hp', 100, 120, 2_000)).toBe(2_000);
  });

  it('tracks each bar separately', () => {
    const activity = new VitalBarActivity();
    activity.record('hp', 100, 100, 1_000);
    activity.record('mp', 100, 100, 1_000);
    activity.record('hp', 90, 100, 2_000);
    expect(activity.record('mp', 100, 100, 3_000)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('vitalBarHidden', () => {
  it('marks only a fully faded bar as hidden', () => {
    expect(vitalBarHidden(0)).toBe(true);
    expect(vitalBarHidden(1)).toBe(false);
    expect(vitalBarHidden(0.5)).toBe(false);
  });
});
