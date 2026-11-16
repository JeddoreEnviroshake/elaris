import { describe, expect, it } from 'vitest';
import { bearingDegrees, compassMarks, compassPips, relativeBearing, stripOffset } from '../../src/presentation/compass';
import { headingFromYaw } from '../../src/three/firstPersonView';

describe('compass maths', () => {
  it('measures bearings clockwise from north with +y south', () => {
    expect(bearingDegrees(0, -10)).toBe(0);
    expect(bearingDegrees(10, 0)).toBe(90);
    expect(bearingDegrees(0, 10)).toBe(180);
    expect(bearingDegrees(-10, 0)).toBe(270);
  });

  it('wraps relative bearings into (-180, 180]', () => {
    expect(relativeBearing(10, 350)).toBe(20);
    expect(relativeBearing(350, 10)).toBe(-20);
    expect(relativeBearing(180, 0)).toBe(180);
  });

  it('puts what is ahead in the middle, right of ahead to the right, and drops what is behind', () => {
    expect(stripOffset(90, 90)).toBe(0);
    expect(stripOffset(135, 90)).toBe(0.5);
    expect(stripOffset(45, 90)).toBe(-0.5);
    expect(stripOffset(270, 90)).toBeNull();
  });

  it('agrees with the first-person heading convention', () => {
    // Looking west (yaw +90) puts a target due west dead ahead.
    const heading = headingFromYaw(90);
    expect(stripOffset(bearingDegrees(-50, 0), heading)).toBe(0);
  });

  it('builds pips with whole-tile distances, nearest drawn last', () => {
    const pips = compassPips({ x: 0, y: 0 }, 0, [
      { id: 'far', kind: 'site', label: 'Far', x: 0, y: -320 },
      { id: 'near', kind: 'bed', label: 'Bed', x: 32, y: -32 },
      { id: 'behind', kind: 'cache', label: 'Cache', x: 0, y: 100 },
      { id: 'underfoot', kind: 'site', label: 'Here', x: 0, y: 0 },
    ], 16);
    expect(pips.map((pip) => pip.id)).toEqual(['far', 'near']);
    expect(pips[0]!.distanceTiles).toBe(20);
    expect(pips[1]!.offset).toBe(0.5);
  });

  it('shows the letters within the strip', () => {
    expect(compassMarks(0).map((mark) => mark.label)).toEqual(['N', 'NE', 'E', 'W', 'NW']);
  });
});
