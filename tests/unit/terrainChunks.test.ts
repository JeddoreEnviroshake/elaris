import { describe, expect, it } from 'vitest';
import { TERRAIN_CHUNK_TILES, prioritizeTerrainChunks, terrainChunkLayout } from '../../src/scenes/terrainChunks';

describe('terrainChunkLayout', () => {
  it('splits the 160-tile world into twenty-five 512px terrain chunks', () => {
    const chunks = terrainChunkLayout(160);
    expect(TERRAIN_CHUNK_TILES).toBe(32);
    expect(chunks).toHaveLength(25);
    expect(chunks[0]).toEqual({ tileX: 0, tileY: 0, tilesWide: 32, tilesHigh: 32 });
    expect(chunks.at(-1)).toEqual({ tileX: 128, tileY: 128, tilesWide: 32, tilesHigh: 32 });
  });

  it('shrinks edge chunks without gaps when dimensions are not divisible', () => {
    const chunks = terrainChunkLayout(70, 32);
    expect(chunks).toHaveLength(9);
    expect(chunks.at(-1)).toEqual({ tileX: 64, tileY: 64, tilesWide: 6, tilesHigh: 6 });

    const covered = new Set<string>();
    for (const chunk of chunks) {
      for (let y = chunk.tileY; y < chunk.tileY + chunk.tilesHigh; y += 1) {
        for (let x = chunk.tileX; x < chunk.tileX + chunk.tilesWide; x += 1) {
          const key = `${x},${y}`;
          expect(covered.has(key)).toBe(false);
          covered.add(key);
        }
      }
    }
    expect(covered.size).toBe(70 * 70);
  });

  it('rejects invalid dimensions', () => {
    expect(() => terrainChunkLayout(0)).toThrow('worldTiles');
    expect(() => terrainChunkLayout(160, 2.5)).toThrow('chunkTiles');
  });

  it('builds the player-adjacent terrain first and orders the remainder by distance', () => {
    const chunks = terrainChunkLayout(160);
    const center = prioritizeTerrainChunks(chunks, 80, 80);
    expect(center.immediate).toHaveLength(9);
    expect(center.deferred).toHaveLength(16);
    expect(center.immediate[0]).toMatchObject({ tileX: 64, tileY: 64 });

    const corner = prioritizeTerrainChunks(chunks, 0, 0);
    expect(corner.immediate).toHaveLength(4);
    expect(corner.immediate[0]).toMatchObject({ tileX: 0, tileY: 0 });
    expect(corner.deferred[0]).toMatchObject({ tileX: 64, tileY: 0 });
  });
});
