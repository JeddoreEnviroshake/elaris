import { describe, expect, it } from 'vitest';
import {
  ELARIS_CAMERA_DEFAULT_ORIENTATION,
  ELARIS_CAMERA_PITCH_DEGREES,
  ELARIS_CAMERA_PITCH_RANGE,
  ELARIS_CAMERA_YAW_DEGREES,
  ELARIS_CAMERA_YAW_RANGE,
  ELARIS_CAMERA_DEFAULT_TENTHS,
  cameraOrientationFromTenths,
  cameraTenthsFromOrientation,
  clampCameraOrientation,
  elarisCameraOffset,
  screenToCameraWorldIntent,
  screenToElarisWorldIntent,
} from '../../src/three/cameraControls';

describe('3D camera-relative controls', () => {
  it('maps directions along the visible map axes back to world axes', () => {
    const yaw = ELARIS_CAMERA_YAW_DEGREES * Math.PI / 180;
    const mapUpOnScreen = screenToElarisWorldIntent({ x: Math.sin(yaw), y: -Math.cos(yaw), slow: false });
    const mapLeftOnScreen = screenToElarisWorldIntent({ x: -Math.cos(yaw), y: -Math.sin(yaw), slow: false });

    expect(mapUpOnScreen.x).toBeCloseTo(0);
    expect(mapUpOnScreen.y).toBeLessThan(0);
    expect(mapLeftOnScreen.x).toBeLessThan(0);
    expect(mapLeftOnScreen.y).toBeCloseTo(0);
  });

  it('uses the intended overworld map rotation and camera pitch', () => {
    expect(ELARIS_CAMERA_YAW_DEGREES).toBe(20);
    expect(ELARIS_CAMERA_PITCH_DEGREES).toBeCloseTo(47.42, 2);
  });

  it('turns admin yaw and pitch values into a fixed-distance camera offset', () => {
    const offset = elarisCameraOffset({ yawDegrees: 20, pitchDegrees: 45 });

    expect(Math.hypot(offset.x, offset.z)).toBeCloseTo(Math.hypot(10, 12));
    expect(offset.y).toBeCloseTo(Math.hypot(10, 12));
    expect(Math.atan2(offset.x, offset.z) * 180 / Math.PI).toBeCloseTo(20);
  });

  it('preserves vector magnitude and the slow-walk modifier', () => {
    const intent = { x: 0.3, y: -0.4, slow: true };
    const aligned = screenToElarisWorldIntent(intent);

    expect(Math.hypot(aligned.x, aligned.y)).toBeCloseTo(Math.hypot(intent.x, intent.y));
    expect(aligned.slow).toBe(true);
  });

  it('keeps cardinal keyboard input on its expected dominant world axis', () => {
    const up = screenToElarisWorldIntent({ x: 0, y: -1, slow: false });
    const right = screenToElarisWorldIntent({ x: 1, y: 0, slow: false });

    expect(Math.abs(up.y)).toBeGreaterThan(Math.abs(up.x));
    expect(up.y).toBeLessThan(0);
    expect(Math.abs(right.x)).toBeGreaterThan(Math.abs(right.y));
    expect(right.x).toBeGreaterThan(0);
  });

  it('keeps up and right aligned to the screen for cameras on either side of a room', () => {
    const frontUp = screenToCameraWorldIntent({ x: 0, y: -1, slow: false }, ELARIS_CAMERA_YAW_DEGREES);
    const frontRight = screenToCameraWorldIntent({ x: 1, y: 0, slow: false }, ELARIS_CAMERA_YAW_DEGREES);
    const reverseUp = screenToCameraWorldIntent({ x: 0, y: -1, slow: false }, ELARIS_CAMERA_YAW_DEGREES + 180);
    const reverseRight = screenToCameraWorldIntent({ x: 1, y: 0, slow: false }, ELARIS_CAMERA_YAW_DEGREES + 180);

    expect(frontUp.x).toBeLessThan(0);
    expect(frontUp.y).toBeLessThan(0);
    expect(frontRight.x).toBeGreaterThan(0);
    expect(frontRight.y).toBeLessThan(0);
    expect(reverseUp.x).toBeGreaterThan(0);
    expect(reverseUp.y).toBeGreaterThan(0);
    expect(reverseRight.x).toBeLessThan(0);
    expect(reverseRight.y).toBeGreaterThan(0);
  });
});

describe('admin camera angle preference', () => {
  it('holds admin edits inside the editable range', () => {
    expect(clampCameraOrientation({ yawDegrees: 900, pitchDegrees: 0 })).toEqual({
      yawDegrees: ELARIS_CAMERA_YAW_RANGE.max,
      pitchDegrees: ELARIS_CAMERA_PITCH_RANGE.min,
    });
    expect(clampCameraOrientation({ yawDegrees: -900, pitchDegrees: 900 })).toEqual({
      yawDegrees: ELARIS_CAMERA_YAW_RANGE.min,
      pitchDegrees: ELARIS_CAMERA_PITCH_RANGE.max,
    });
  });

  it('falls back to the default angles rather than propagating a bad number', () => {
    expect(clampCameraOrientation({ yawDegrees: Number.NaN, pitchDegrees: Number.POSITIVE_INFINITY }))
      .toEqual(ELARIS_CAMERA_DEFAULT_ORIENTATION);
  });

  it('round-trips a flattened camera through the whole-numbered stored form', () => {
    const stored = cameraTenthsFromOrientation({ yawDegrees: 0, pitchDegrees: 70 });

    expect(stored).toEqual({ yawTenths: 0, pitchTenths: 700 });
    expect(cameraOrientationFromTenths(stored)).toEqual({ yawDegrees: 0, pitchDegrees: 70 });
  });

  it('keeps the default tilt whole in tenths of a degree', () => {
    expect(ELARIS_CAMERA_DEFAULT_TENTHS).toEqual({ yawTenths: 200, pitchTenths: 474 });
    expect(cameraOrientationFromTenths(ELARIS_CAMERA_DEFAULT_TENTHS)).toEqual({
      yawDegrees: ELARIS_CAMERA_YAW_DEGREES,
      pitchDegrees: 47.4,
    });
  });

  it('falls back to the default angles for a published document missing the field', () => {
    expect(cameraOrientationFromTenths(undefined)).toEqual({
      yawDegrees: ELARIS_CAMERA_YAW_DEGREES,
      pitchDegrees: 47.4,
    });
    expect(cameraOrientationFromTenths({ yawTenths: 9_000, pitchTenths: -100 })).toEqual({
      yawDegrees: ELARIS_CAMERA_YAW_RANGE.max,
      pitchDegrees: ELARIS_CAMERA_PITCH_RANGE.min,
    });
  });
});
