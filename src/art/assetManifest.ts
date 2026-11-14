import type Phaser from 'phaser';
import { TextureKeys } from './textureKeys';

export interface ImageAsset {
  readonly kind: 'image';
  readonly key: string;
  readonly path: string;
  readonly optional: boolean;
}

export interface SpriteSheetAsset {
  readonly kind: 'spritesheet';
  readonly key: string;
  readonly path: string;
  readonly optional: boolean;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frames: number;
}

export type ArtAsset = ImageAsset | SpriteSheetAsset;

/** Authored files are local/PWA-safe. Optional entries retain procedural fallback. */
export const ASSET_MANIFEST: readonly ArtAsset[] = [
  {
    kind: 'image',
    key: TextureKeys.BattleGrassland,
    path: '/assets/battle/grassland-arena.png',
    optional: false,
  },
  {
    kind: 'image',
    key: TextureKeys.BattleHills,
    path: '/assets/battle/hills-arena.png',
    optional: false,
  },
  {
    kind: 'image',
    key: TextureKeys.BattleForest,
    path: '/assets/battle/forest-arena.png',
    optional: false,
  },
] as const;

export function validateAssetManifest(entries: readonly ArtAsset[] = ASSET_MANIFEST): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const entry of entries) {
    if (keys.has(entry.key)) errors.push(`Duplicate texture key: ${entry.key}`);
    keys.add(entry.key);
    if (!entry.path.startsWith('/') || !entry.path.toLowerCase().endsWith('.png')) {
      errors.push(`Asset ${entry.key} must use a root-relative PNG path`);
    }
    if (entry.kind === 'spritesheet') {
      if (!Number.isInteger(entry.frameWidth) || entry.frameWidth <= 0) errors.push(`${entry.key} has an invalid frame width`);
      if (!Number.isInteger(entry.frameHeight) || entry.frameHeight <= 0) errors.push(`${entry.key} has an invalid frame height`);
      if (!Number.isInteger(entry.frames) || entry.frames <= 0) errors.push(`${entry.key} has an invalid frame count`);
    }
  }
  return errors;
}

export function preloadArtAssets(scene: Phaser.Scene): void {
  const errors = validateAssetManifest();
  if (errors.length > 0) throw new Error(`Invalid art manifest:\n${errors.join('\n')}`);
  for (const asset of ASSET_MANIFEST) {
    if (scene.textures.exists(asset.key)) continue;
    if (asset.kind === 'image') scene.load.image(asset.key, asset.path);
    else scene.load.spritesheet(asset.key, asset.path, { frameWidth: asset.frameWidth, frameHeight: asset.frameHeight });
  }
  scene.load.on('loaderror', (file: Phaser.Loader.File) => {
    const asset = ASSET_MANIFEST.find((entry) => entry.key === file.key);
    if (asset?.optional) console.warn(`[art] Missing optional asset ${asset.path}; using procedural fallback.`);
    else console.error(`[art] Failed to load required asset ${asset?.path ?? file.key}`);
  });
}
