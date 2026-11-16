import { describe, expect, it } from 'vitest';
import { interpolateRenderPoint } from '../../src/scenes/renderMotion';

describe('interpolateRenderPoint', () => {
  it('renders between consecutive fixed-step positions', () => {
    expect(interpolateRenderPoint({ x: 10, y: 20 }, { x: 14, y: 12 }, 0.25)).toEqual({
      x: 11,
      y: 18,
    });
  });

  it('clamps alpha so a render frame cannot overshoot the simulation', () => {
    expect(interpolateRenderPoint({ x: 2, y: 3 }, { x: 8, y: 9 }, -1)).toEqual({ x: 2, y: 3 });
    expect(interpolateRenderPoint({ x: 2, y: 3 }, { x: 8, y: 9 }, 2)).toEqual({ x: 8, y: 9 });
  });

});
