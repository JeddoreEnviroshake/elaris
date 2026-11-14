import type { MoveIntent } from '../simulation/commands';

/** Fixed follow orientation used by Elaris' angled 3D camera. */
export const ELARIS_CAMERA_YAW_DEGREES = 20;
export const ELARIS_CAMERA_HORIZONTAL_DISTANCE = Math.hypot(10, 12);
export const ELARIS_CAMERA_HEIGHT = 17;
export const ELARIS_CAMERA_PITCH_DEGREES = Math.atan2(
  ELARIS_CAMERA_HEIGHT,
  ELARIS_CAMERA_HORIZONTAL_DISTANCE,
) * 180 / Math.PI;

export interface ElarisCameraOrientation {
  yawDegrees: number;
  pitchDegrees: number;
}

export const ELARIS_CAMERA_DEFAULT_ORIENTATION: Readonly<ElarisCameraOrientation> = Object.freeze({
  yawDegrees: ELARIS_CAMERA_YAW_DEGREES,
  pitchDegrees: ELARIS_CAMERA_PITCH_DEGREES,
});

/** Admin-editable bounds. Yaw is a full turn; pitch stops short of straight down. */
export const ELARIS_CAMERA_YAW_RANGE = Object.freeze({ min: -180, max: 180 });
export const ELARIS_CAMERA_PITCH_RANGE = Object.freeze({ min: 10, max: 80 });

/**
 * Camera angles are published global balance, and every balance number has to
 * be a whole one (canonicalizeGameState rejects fractions), so the stored form
 * is tenths of a degree — enough resolution for the 47.4° default pitch.
 */
export const CAMERA_TENTHS_PER_DEGREE = 10;

export interface ElarisCameraTenths {
  yawTenths: number;
  pitchTenths: number;
}

export const ELARIS_CAMERA_YAW_TENTHS_RANGE = Object.freeze({
  min: ELARIS_CAMERA_YAW_RANGE.min * CAMERA_TENTHS_PER_DEGREE,
  max: ELARIS_CAMERA_YAW_RANGE.max * CAMERA_TENTHS_PER_DEGREE,
});
export const ELARIS_CAMERA_PITCH_TENTHS_RANGE = Object.freeze({
  min: ELARIS_CAMERA_PITCH_RANGE.min * CAMERA_TENTHS_PER_DEGREE,
  max: ELARIS_CAMERA_PITCH_RANGE.max * CAMERA_TENTHS_PER_DEGREE,
});

export function cameraTenthsFromOrientation(orientation: ElarisCameraOrientation): ElarisCameraTenths {
  const clamped = clampCameraOrientation(orientation);
  return {
    yawTenths: Math.round(clamped.yawDegrees * CAMERA_TENTHS_PER_DEGREE),
    pitchTenths: Math.round(clamped.pitchDegrees * CAMERA_TENTHS_PER_DEGREE),
  };
}

/** Stored tenths back to live degrees, clamped so a bad document cannot tilt. */
export function cameraOrientationFromTenths(tenths: Partial<ElarisCameraTenths> | undefined): ElarisCameraOrientation {
  return clampCameraOrientation({
    yawDegrees: (tenths?.yawTenths ?? ELARIS_CAMERA_DEFAULT_TENTHS.yawTenths) / CAMERA_TENTHS_PER_DEGREE,
    pitchDegrees: (tenths?.pitchTenths ?? ELARIS_CAMERA_DEFAULT_TENTHS.pitchTenths) / CAMERA_TENTHS_PER_DEGREE,
  });
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function clampCameraOrientation(orientation: ElarisCameraOrientation): ElarisCameraOrientation {
  return {
    yawDegrees: clamp(
      orientation.yawDegrees, ELARIS_CAMERA_YAW_RANGE.min, ELARIS_CAMERA_YAW_RANGE.max,
      ELARIS_CAMERA_YAW_DEGREES,
    ),
    pitchDegrees: clamp(
      orientation.pitchDegrees, ELARIS_CAMERA_PITCH_RANGE.min, ELARIS_CAMERA_PITCH_RANGE.max,
      ELARIS_CAMERA_PITCH_DEGREES,
    ),
  };
}

export const ELARIS_CAMERA_DEFAULT_TENTHS: Readonly<ElarisCameraTenths> = Object.freeze({
  yawTenths: Math.round(ELARIS_CAMERA_YAW_DEGREES * CAMERA_TENTHS_PER_DEGREE),
  pitchTenths: Math.round(ELARIS_CAMERA_PITCH_DEGREES * CAMERA_TENTHS_PER_DEGREE),
});

/** Resolve a yaw/pitch pair into the fixed-distance overworld follow offset. */
export function elarisCameraOffset(
  orientation: ElarisCameraOrientation,
): Readonly<{ x: number; y: number; z: number }> {
  const yaw = orientation.yawDegrees * Math.PI / 180;
  const pitch = orientation.pitchDegrees * Math.PI / 180;
  return {
    x: Math.sin(yaw) * ELARIS_CAMERA_HORIZONTAL_DISTANCE,
    y: Math.tan(pitch) * ELARIS_CAMERA_HORIZONTAL_DISTANCE,
    z: Math.cos(yaw) * ELARIS_CAMERA_HORIZONTAL_DISTANCE,
  };
}

export const ELARIS_CAMERA_OFFSET = Object.freeze(elarisCameraOffset({
  yawDegrees: ELARIS_CAMERA_YAW_DEGREES,
  pitchDegrees: ELARIS_CAMERA_PITCH_DEGREES,
}));

/**
 * Rotate screen-space controls onto the ground plane for a camera placed at
 * the given yaw around its target. A positive input y points down-screen.
 */
export function screenToCameraWorldIntent(intent: MoveIntent, yawDegrees: number): MoveIntent {
  const yaw = yawDegrees * Math.PI / 180;
  const cameraX = Math.sin(yaw);
  const cameraZ = Math.cos(yaw);

  return {
    x: cameraZ * intent.x + cameraX * intent.y,
    y: -cameraX * intent.x + cameraZ * intent.y,
    slow: intent.slow,
    sprint: intent.sprint === true,
  };
}

/**
 * Rotate a screen-space control vector into the ground-plane axes seen by the
 * angled 3D camera. This keeps the stick direction aligned with the visible
 * map while leaving the authoritative movement simulation in world space.
 */
export function screenToElarisWorldIntent(intent: MoveIntent): MoveIntent {
  return screenToCameraWorldIntent(intent, ELARIS_CAMERA_YAW_DEGREES);
}
