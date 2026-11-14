import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST, validateAssetManifest, type ArtAsset } from '../../src/art/assetManifest';

describe('art asset manifest', () => {
  it('keeps production asset keys and frame metadata valid', () => {
    expect(validateAssetManifest()).toEqual([]);
    expect(ASSET_MANIFEST.some((asset) => asset.path === '/assets/battle/grassland-arena.png')).toBe(true);
    expect(ASSET_MANIFEST.some((asset) => asset.path === '/assets/battle/hills-arena.png')).toBe(true);
    expect(ASSET_MANIFEST.some((asset) => asset.path === '/assets/battle/forest-arena.png')).toBe(true);
  });

  it('reports duplicate keys and invalid sprite sheet frames', () => {
    const invalid: ArtAsset[] = [
      { kind: 'image', key: 'same', path: '/a.png', optional: true },
      { kind: 'spritesheet', key: 'same', path: 'bad.jpg', optional: true, frameWidth: 12.5, frameHeight: 0, frames: -1 },
    ];
    const errors = validateAssetManifest(invalid);
    expect(errors).toContain('Duplicate texture key: same');
    expect(errors.some((error) => error.includes('root-relative PNG'))).toBe(true);
    expect(errors.some((error) => error.includes('invalid frame width'))).toBe(true);
    expect(errors.some((error) => error.includes('invalid frame height'))).toBe(true);
    expect(errors.some((error) => error.includes('invalid frame count'))).toBe(true);
  });
});
