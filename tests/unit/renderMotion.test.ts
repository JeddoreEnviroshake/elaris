import { describe, expect, it } from 'vitest';
import { interpolateRenderPoint, mountedActorDepths, mountTransformForFacing } from '../../src/scenes/renderMotion';

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

  it('renders a mount in front of its rider', () => {
    const depths = mountedActorDepths(480);
    expect(depths.mount).toBeGreaterThan(depths.player);
  });

  it('rotates the left-facing Glade Stag art into all four movement directions', () => {
    expect(mountTransformForFacing('left')).toEqual({ angle: 0, flipX: false });
    expect(mountTransformForFacing('right')).toEqual({ angle: 0, flipX: true });
    expect(mountTransformForFacing('up')).toEqual({ angle: 90, flipX: false });
    expect(mountTransformForFacing('down')).toEqual({ angle: -90, flipX: false });
  });
});
