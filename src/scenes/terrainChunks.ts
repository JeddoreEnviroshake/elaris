/** 32 source tiles = 512px with the current 16px tile size. */
export const TERRAIN_CHUNK_TILES = 32;

export interface TerrainChunk {
  tileX: number;
  tileY: number;
  tilesWide: number;
  tilesHigh: number;
}

export interface PrioritizedTerrainChunks {
  immediate: TerrainChunk[];
  deferred: TerrainChunk[];
}

/**
 * Partition a square world into stable, non-overlapping chunks. Edge chunks
 * shrink when a future world size is not divisible by the preferred size.
 */
export function terrainChunkLayout(
  worldTiles: number,
  chunkTiles = TERRAIN_CHUNK_TILES,
): TerrainChunk[] {
  if (!Number.isInteger(worldTiles) || worldTiles <= 0) throw new Error('worldTiles must be a positive integer');
  if (!Number.isInteger(chunkTiles) || chunkTiles <= 0) throw new Error('chunkTiles must be a positive integer');

  const chunks: TerrainChunk[] = [];
  for (let tileY = 0; tileY < worldTiles; tileY += chunkTiles) {
    for (let tileX = 0; tileX < worldTiles; tileX += chunkTiles) {
      chunks.push({
        tileX,
        tileY,
        tilesWide: Math.min(chunkTiles, worldTiles - tileX),
        tilesHigh: Math.min(chunkTiles, worldTiles - tileY),
      });
    }
  }
  return chunks;
}

/** Order chunks around the player's spawn and split out the first-frame set. */
export function prioritizeTerrainChunks(
  chunks: readonly TerrainChunk[],
  playerTileX: number,
  playerTileY: number,
  chunkTiles = TERRAIN_CHUNK_TILES,
): PrioritizedTerrainChunks {
  const playerChunkX = Math.floor(playerTileX / chunkTiles) * chunkTiles;
  const playerChunkY = Math.floor(playerTileY / chunkTiles) * chunkTiles;
  const distance = (chunk: TerrainChunk): number => (
    Math.abs(chunk.tileX - playerChunkX) / chunkTiles
    + Math.abs(chunk.tileY - playerChunkY) / chunkTiles
  );
  const ordered = [...chunks].sort((left, right) => distance(left) - distance(right));
  const immediate = ordered.filter((chunk) => (
    Math.abs(chunk.tileX - playerChunkX) <= chunkTiles
    && Math.abs(chunk.tileY - playerChunkY) <= chunkTiles
  ));
  const immediateKeys = new Set(immediate.map((chunk) => `${chunk.tileX},${chunk.tileY}`));
  return {
    immediate,
    deferred: ordered.filter((chunk) => !immediateKeys.has(`${chunk.tileX},${chunk.tileY}`)),
  };
}
