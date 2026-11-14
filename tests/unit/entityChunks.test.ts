import { describe, expect, it } from 'vitest';
import {
  activeEntityChunkKeys,
  ENTITY_CHUNK_SIZE_PX,
  EntityChunkIndex,
  entityChunkKey,
} from '../../src/scenes/entityChunks';

describe('entity chunking', () => {
  it('uses the same 512px grid as terrain chunks', () => {
    expect(ENTITY_CHUNK_SIZE_PX).toBe(512);
    expect(entityChunkKey(0, 0)).toBe('0,0');
    expect(entityChunkKey(511.99, 511.99)).toBe('0,0');
    expect(entityChunkKey(512, 512)).toBe('1,1');
  });

  it('selects the camera chunk and a one-chunk activation margin', () => {
    const keys = activeEntityChunkKeys({ left: 1100, right: 1450, top: 1080, bottom: 1380 });
    expect(keys).toHaveLength(9);
    expect(keys).toContain('1,1');
    expect(keys).toContain('2,2');
    expect(keys).toContain('3,3');
    expect(keys).not.toContain('0,0');
  });

  it('reindexes moving entities without leaving stale chunk membership', () => {
    const index = new EntityChunkIndex();
    index.upsert('node-a', 100, 100);
    index.upsert('node-b', 900, 100);
    expect(index.idsInChunks(new Set(['0,0']))).toEqual(new Set(['node-a']));

    index.upsert('node-a', 900, 100);
    expect(index.idsInChunks(new Set(['0,0']))).toEqual(new Set());
    expect(index.idsInChunks(new Set(['1,0']))).toEqual(new Set(['node-b', 'node-a']));
    expect(index.size).toBe(2);
  });

  it('returns candidates in original insertion order across queried chunks', () => {
    const index = new EntityChunkIndex();
    index.upsert('first', 900, 100);
    index.upsert('second', 100, 100);
    index.upsert('third', 900, 100);
    expect([...index.idsInChunks(new Set(['0,0', '1,0']))]).toEqual(['first', 'second', 'third']);
  });

  it('removes entities and rejects malformed inputs', () => {
    const index = new EntityChunkIndex();
    index.upsert('drop-1', 20, 20);
    expect(index.delete('drop-1')).toBe(true);
    expect(index.delete('drop-1')).toBe(false);
    expect(index.size).toBe(0);
    expect(() => activeEntityChunkKeys({ left: 10, right: 0, top: 0, bottom: 10 })).toThrow('inverted');
    expect(() => entityChunkKey(Number.NaN, 0)).toThrow('finite');
  });
});
