import { TILE_SIZE } from '../config/platform';
export const ENTITY_CHUNK_SIZE_PX = 32 * TILE_SIZE;

export interface ChunkViewRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface EntityActivationCounts {
  active: number;
  total: number;
}

export function entityChunkKey(x: number, y: number, chunkSizePx = ENTITY_CHUNK_SIZE_PX): string {
  validateChunkSize(chunkSizePx);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('entity coordinates must be finite');
  return `${Math.floor(x / chunkSizePx)},${Math.floor(y / chunkSizePx)}`;
}

/**
 * A square view around a point. The overhead camera sees roughly a rectangle
 * around the player; first person sees out to its fog in every direction, so
 * both describe their view as a radius here rather than a camera rectangle.
 */
export function chunkViewRectAround(x: number, y: number, radiusPx: number): ChunkViewRect {
  return { left: x - radiusPx, right: x + radiusPx, top: y - radiusPx, bottom: y + radiusPx };
}

/** Chunk keys intersecting the camera plus whole-chunk activation margins. */
export function activeEntityChunkKeys(
  view: ChunkViewRect,
  marginChunks = 1,
  chunkSizePx = ENTITY_CHUNK_SIZE_PX,
): Set<string> {
  validateChunkSize(chunkSizePx);
  if (!Number.isInteger(marginChunks) || marginChunks < 0) throw new Error('marginChunks must be a non-negative integer');
  if (![view.left, view.right, view.top, view.bottom].every(Number.isFinite)) throw new Error('view bounds must be finite');
  if (view.right < view.left || view.bottom < view.top) throw new Error('view bounds must not be inverted');

  const minChunkX = Math.floor(view.left / chunkSizePx) - marginChunks;
  const maxChunkX = Math.floor(view.right / chunkSizePx) + marginChunks;
  const minChunkY = Math.floor(view.top / chunkSizePx) - marginChunks;
  const maxChunkY = Math.floor(view.bottom / chunkSizePx) + marginChunks;
  const keys = new Set<string>();
  for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) keys.add(`${chunkX},${chunkY}`);
  }
  return keys;
}

/** Mutable fixed-grid index for render entities whose authoritative state lives elsewhere. */
export class EntityChunkIndex {
  private readonly idsByChunk = new Map<string, Set<string>>();
  private readonly chunkById = new Map<string, string>();
  private readonly orderById = new Map<string, number>();
  private nextOrder = 0;

  get size(): number {
    return this.chunkById.size;
  }

  chunkOf(id: string): string | undefined { return this.chunkById.get(id); }

  upsert(id: string, x: number, y: number): void {
    const nextKey = entityChunkKey(x, y);
    const previousKey = this.chunkById.get(id);
    if (previousKey === nextKey) return;
    if (previousKey === undefined) {
      this.orderById.set(id, this.nextOrder);
      this.nextOrder += 1;
    }
    if (previousKey !== undefined) this.removeFromChunk(id, previousKey);
    let ids = this.idsByChunk.get(nextKey);
    if (!ids) {
      ids = new Set<string>();
      this.idsByChunk.set(nextKey, ids);
    }
    ids.add(id);
    this.chunkById.set(id, nextKey);
  }

  delete(id: string): boolean {
    const key = this.chunkById.get(id);
    if (key === undefined) return false;
    this.removeFromChunk(id, key);
    this.chunkById.delete(id);
    this.orderById.delete(id);
    return true;
  }

  idsInChunks(chunkKeys: ReadonlySet<string>): Set<string> {
    const candidates: string[] = [];
    for (const key of chunkKeys) {
      for (const id of this.idsByChunk.get(key) ?? []) candidates.push(id);
    }
    candidates.sort((left, right) => this.orderById.get(left)! - this.orderById.get(right)!);
    return new Set(candidates);
  }

  clear(): void {
    this.idsByChunk.clear();
    this.chunkById.clear();
    this.orderById.clear();
    this.nextOrder = 0;
  }

  private removeFromChunk(id: string, key: string): void {
    const ids = this.idsByChunk.get(key);
    ids?.delete(id);
    if (ids?.size === 0) this.idsByChunk.delete(key);
  }
}

function validateChunkSize(chunkSizePx: number): void {
  if (!Number.isFinite(chunkSizePx) || chunkSizePx <= 0) throw new Error('chunkSizePx must be positive');
}
