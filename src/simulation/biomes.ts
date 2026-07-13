import { WORLD_PX } from '../config/platform';

export type StarterBiome = 'grassland' | 'forest';

/**
 * Stable, inexpensive starter-region biome map. The central clearing remains
 * grassland while the north-west and western reaches form a broad forest.
 * The seed only roughens the boundary; classification never uses mutable RNG.
 */
export function starterBiomeAt(seed: number, x: number, y: number): StarterBiome {
  const nx = x / WORLD_PX;
  const ny = y / WORLD_PX;
  const boundaryNoise = (coordinateHash(seed, Math.floor(x / 64), Math.floor(y / 64)) - 0.5) * 0.12;
  const forestScore = (0.48 - nx) + (0.34 - ny) * 0.38 + boundaryNoise;
  return forestScore > 0.08 ? 'forest' : 'grassland';
}

/** Seed-stable value in [0, 1), suitable for visual detail and boundaries. */
export function coordinateHash(seed: number, x: number, y: number): number {
  let value = (seed ^ Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x119de1f3)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return value / 0x1_0000_0000;
}
