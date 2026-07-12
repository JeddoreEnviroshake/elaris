/**
 * Platform + world tunables. Per the spec, all tunable values live in typed
 * config modules rather than scattered magic numbers. Rendering/layout values
 * live here; gameplay balance will live in balance.ts.
 */

/** Placeholder fixed world seed for Milestone 0 (save-driven seed lands in M1). */
export const DEFAULT_WORLD_SEED = 0xe1a71;

/** Source pixel-art tile size. Rendered at an integer zoom for crispness. */
export const TILE_SIZE = 16;

/** Fixed-seed island is ~160×160 tiles (final size confirmed in balance later). */
export const WORLD_TILES = 160;
export const WORLD_PX = TILE_SIZE * WORLD_TILES;

/** Player movement, in source pixels per second (pre-zoom). */
export const PLAYER_SPEED_PX_PER_S = 96;

/** Partial joystick magnitude / Shift produces a slow walk at this fraction. */
export const SLOW_WALK_FACTOR = 0.45;

/** Below this joystick magnitude, movement is treated as an intentional slow walk. */
export const SLOW_WALK_MAGNITUDE_THRESHOLD = 0.6;

/** Fixed simulation timestep. Rendering interpolates between steps. */
export const FIXED_STEP_MS = 1000 / 60;

/** Guard against spiral-of-death after a long tab stall. */
export const MAX_FRAME_MS = 250;

/**
 * Integer camera zoom tiers keyed off the shorter viewport axis, so pixel art
 * stays crisp across phone portrait (320×568) through 1920×1080 desktop.
 */
export const ZOOM_TIERS: ReadonlyArray<{ maxMinAxis: number; zoom: number }> = [
  { maxMinAxis: 480, zoom: 2 },
  { maxMinAxis: 1080, zoom: 3 },
  { maxMinAxis: Number.POSITIVE_INFINITY, zoom: 4 },
];
