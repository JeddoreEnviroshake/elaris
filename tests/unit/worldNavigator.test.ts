import { describe, expect, it } from 'vitest';
import { worldCoordinates } from '../../src/ui/worldNavigator';

describe('worldCoordinates', () => {
  it('maps source-pixel positions to the 160-tile navigation grid', () => {
    expect(worldCoordinates(0, 0)).toEqual({ x: 0, y: 0 });
    expect(worldCoordinates(1280, 1280)).toEqual({ x: 80, y: 80 });
    expect(worldCoordinates(2560, 2560)).toEqual({ x: 160, y: 160 });
  });

  it('clamps out-of-bounds positions to the displayed world edges', () => {
    expect(worldCoordinates(-12, 3000)).toEqual({ x: 0, y: 160 });
  });
});
