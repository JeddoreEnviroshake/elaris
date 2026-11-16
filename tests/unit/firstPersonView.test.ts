import { describe, expect, it } from 'vitest';
import {
  FIRST_PERSON_PITCH_LIMIT_DEGREES,
  FirstPersonLook,
  groundForward,
  headingFromYaw,
  yawForFacing,
} from '../../src/three/firstPersonView';
import { screenToCameraWorldIntent } from '../../src/three/cameraControls';
import { facingFromHeading } from '../../src/simulation/commands';
import { pickCrosshairTarget, type CrosshairCandidate } from '../../src/presentation/crosshairTarget';

describe('first-person look', () => {
  it('turns right when the finger drags right, and looks up when it drags up', () => {
    const look = new FirstPersonLook();
    look.turn(100, 0, 0.3);
    expect(look.yawDegrees).toBeCloseTo(-30);
    expect(look.heading()).toBe(30);
    look.turn(0, -50, 0.3);
    expect(look.pitchDegrees).toBeCloseTo(15);
  });

  it('clamps pitch and wraps yaw', () => {
    const look = new FirstPersonLook();
    look.turnBy(0, 500);
    expect(look.pitchDegrees).toBe(FIRST_PERSON_PITCH_LIMIT_DEGREES);
    look.turnBy(0, -1000);
    expect(look.pitchDegrees).toBe(-FIRST_PERSON_PITCH_LIMIT_DEGREES);
    look.turnBy(370);
    expect(look.yawDegrees).toBeCloseTo(10);
  });

  it('walks forward along the look direction through the same mapping as the overhead stick', () => {
    for (const yaw of [0, 37, -90, 180, 123]) {
      const forward = groundForward(yaw);
      const intent = screenToCameraWorldIntent({ x: 0, y: -1, slow: false }, yaw);
      expect(intent.x).toBeCloseTo(forward.x);
      expect(intent.y).toBeCloseTo(forward.y);
    }
  });

  it('derives the four-way facing from the look heading', () => {
    expect(facingFromHeading(headingFromYaw(yawForFacing('up')))).toBe('up');
    expect(facingFromHeading(headingFromYaw(yawForFacing('left')))).toBe('left');
    expect(facingFromHeading(headingFromYaw(yawForFacing('down')))).toBe('down');
    expect(facingFromHeading(headingFromYaw(yawForFacing('right')))).toBe('right');
  });
});

describe('crosshair target', () => {
  const candidate = (id: string, x: number, y: number, reachPx = 64): CrosshairCandidate => ({
    kind: 'resource', id, x, y, label: id, reachPx,
  });
  const north = { x: 0, y: -1 };

  it('picks the nearest candidate inside the forward cone and reach', () => {
    const picked = pickCrosshairTarget({ x: 0, y: 0 }, north, [
      candidate('far-ahead', 0, -60),
      candidate('near-ahead', 5, -30),
      candidate('behind', 0, 20),
      candidate('beside', 30, 0),
      candidate('out-of-reach', 0, -200),
    ]);
    expect(picked?.id).toBe('near-ahead');
  });

  it('rejects anything outside the cone, however close', () => {
    expect(pickCrosshairTarget({ x: 0, y: 0 }, north, [candidate('side', 20, -10)])).toBeNull();
    expect(pickCrosshairTarget({ x: 0, y: 0 }, north, [candidate('edge', 10, -20)])?.id).toBe('edge');
  });

  it('counts a candidate underfoot as in the cone', () => {
    expect(pickCrosshairTarget({ x: 0, y: 0 }, north, [candidate('underfoot', 2, 2)])?.id).toBe('underfoot');
  });
});
