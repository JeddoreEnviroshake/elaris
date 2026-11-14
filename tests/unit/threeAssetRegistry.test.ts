import { describe, expect, it } from 'vitest';
import { MODEL_ASSETS, modelAsset, validateModelAssets } from '../../src/three/assetRegistry';
import { worldToThree } from '../../src/three/Elaris3DRenderer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('3D asset registry', () => {
  it('ships all curated Quaternius models as self-contained GLBs within the offline cache budget', () => {
    const curated = MODEL_ASSETS.filter((asset) => asset.author === 'Quaternius');
    expect(curated.length).toBeGreaterThan(30);
    for (const asset of curated) {
      expect(asset.author).toBe('Quaternius');
      const bytes = readFileSync(resolve('public', asset.path.slice(1)));
      expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
      expect(bytes.length).toBeLessThan(4 * 1024 * 1024);
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
        buffers: Array<{uri?: string}>; images?: Array<{uri?: string; bufferView?: number}>;
      };
      expect(gltf.buffers.every((buffer) => buffer.uri === undefined)).toBe(true);
      expect(gltf.images?.every((image) => image.uri === undefined && image.bufferView !== undefined)).toBe(true);
    }
  });
  it('keeps every runtime model uniquely keyed with complete provenance', () => {
    expect(validateModelAssets()).toEqual([]);
    expect(new Set(MODEL_ASSETS.map((asset) => asset.key)).size).toBe(MODEL_ASSETS.length);
    expect(MODEL_ASSETS.every((asset) => asset.license === 'CC0-1.0')).toBe(true);
  });

  it('maps semantic keys to replaceable local GLBs', () => {
    expect(modelAsset('nature.tree').path).toBe('/assets/3d/nature-kit/tree_default.glb');
    expect(modelAsset('nature.bridge-wood-round').path).toBe('/assets/3d/nature-kit/bridge_woodRound.glb');
    expect(modelAsset('town.roof-gable').pack).toBe('fantasy-town-kit');
    expect(modelAsset('town.fence').rotationY).toBe(Math.PI / 2);
    expect(modelAsset('town.fence-gate').rotationY).toBe(Math.PI / 2);
    expect(modelAsset('survival.axe-upgraded').license).toBe('CC0-1.0');
    expect(modelAsset('character.player-placeholder').pack).toBe('mini-characters');
  });

  it('maps the legacy 16-pixel simulation grid onto one 3D world unit', () => {
    expect(worldToThree(1280, 960)).toEqual({ x: 80, z: 60 });
  });
});
