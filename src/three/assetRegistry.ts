export type ModelAssetKey =
  | 'nature.tree'
  | 'nature.tree-dark'
  | 'nature.pine'
  | 'nature.rock-small-a'
  | 'nature.rock-small-b'
  | 'nature.rock-large'
  | 'nature.stump'
  | 'nature.grass'
  | 'nature.bush'
  | 'nature.flower-yellow'
  | 'nature.bridge-wood-round'
  | 'nature.log-stack'
  | 'nature.signpost'
  | 'nature.mushrooms-red'
  | 'town.stall-green'
  | 'town.stall-red'
  | 'town.chimney'
  | 'town.fence'
  | 'town.fence-gate'
  | 'town.roof-gable'
  | 'town.roof-gable-high'
  | 'town.door-stone'
  | 'town.window-stone'
  | 'town.door-wood'
  | 'town.window-wood'
  | 'town.lantern'
  | 'town.cart'
  | 'town.banner-red'
  | 'town.banner-green'
  | 'town.pillar-stone'
  | 'town.blade-sign'
  | 'survival.workbench-anvil'
  | 'survival.chest'
  | 'survival.barrel'
  | 'survival.axe'
  | 'survival.pickaxe'
  | 'survival.axe-upgraded'
  | 'survival.pickaxe-upgraded'
  | 'entrance.tree'
  | 'entrance.tree-broad'
  | 'entrance.pine'
  | 'entrance.fern'
  | 'entrance.grass'
  | 'entrance.bush'
  | 'entrance.flowers'
  | 'entrance.flowers-blue'
  | 'entrance.rock'
  | 'entrance.pebble'
  | 'entrance.mushroom'
  | 'entrance.path-stone'
  | 'entrance.roof'
  | 'entrance.wall'
  | 'entrance.wall-door'
  | 'entrance.wall-window'
  | 'entrance.door'
  | 'entrance.shutters'
  | 'entrance.chimney'
  | 'entrance.crate'
  | 'entrance.wagon'
  | 'entrance.vine'
  | 'entrance.paving'
  | 'entrance.deck'
  | 'entrance.railing'
  | 'detail.dormer'
  | 'detail.tower-roof'
  | 'detail.wood-roof'
  | 'detail.support'
  | 'detail.arch-wall'
  | 'detail.arch-frame'
  | 'detail.round-door'
  | 'detail.vine'
  | 'detail.balcony'
  | 'character.player-placeholder';

export type KenneyPackId = 'nature-kit' | 'fantasy-town-kit' | 'survival-kit' | 'mini-characters';
export type ModelPackId = KenneyPackId | 'quaternius-nature' | 'quaternius-village';

export interface ModelAssetEntry {
  readonly key: ModelAssetKey;
  readonly path: string;
  readonly pack: ModelPackId;
  readonly sourceUrl: string;
  readonly author: 'Kenney' | 'Quaternius';
  readonly license: 'CC0-1.0';
  /** Desired height after normalization into Elaris world units. */
  readonly targetHeight: number;
  /** One-time correction for the source model's authored forward axis. */
  readonly rotationY?: number;
}

const SOURCES: Readonly<Record<ModelPackId, string>> = {
  'quaternius-nature': 'https://quaternius.com/packs/stylizednaturemegakit.html',
  'quaternius-village': 'https://quaternius.com/packs/medievalvillagemegakit.html',
  'nature-kit': 'https://kenney.nl/assets/nature-kit',
  'fantasy-town-kit': 'https://kenney.nl/assets/fantasy-town-kit',
  'survival-kit': 'https://kenney.nl/assets/survival-kit',
  'mini-characters': 'https://kenney.nl/assets/mini-characters',
};

function entry(
  key: ModelAssetKey,
  pack: ModelPackId,
  filename: string,
  targetHeight: number,
  rotationY?: number,
): ModelAssetEntry {
  return {
    key,
    path: `/assets/3d/${pack}/${filename}`,
    pack,
    sourceUrl: SOURCES[pack],
    author: pack.startsWith('quaternius-') ? 'Quaternius' : 'Kenney',
    license: 'CC0-1.0',
    targetHeight,
    ...(rotationY === undefined ? {} : { rotationY }),
  };
}

/**
 * Runtime 3D assets are deliberately addressed by semantic keys. A later art
 * pass can replace a model without changing gameplay or scene composition.
 */
export const MODEL_ASSETS: readonly ModelAssetEntry[] = [
  entry('detail.dormer', 'quaternius-village', 'Roof_Dormer_RoundTile.glb', 1),
  entry('detail.tower-roof', 'quaternius-village', 'Roof_Tower_RoundTiles.glb', 2.1),
  entry('detail.wood-roof', 'quaternius-village', 'Roof_Wooden_2x1.glb', 1.4),
  entry('detail.support', 'quaternius-village', 'Prop_Support.glb', 2),
  entry('detail.arch-wall', 'quaternius-village', 'Wall_Arch.glb', 2.8),
  entry('detail.arch-frame', 'quaternius-village', 'DoorFrame_Round_Brick.glb', 2),
  entry('detail.round-door', 'quaternius-village', 'Door_1_Round.glb', 1.9),
  entry('detail.vine', 'quaternius-village', 'Prop_Vine4.glb', 1.6),
  entry('detail.balcony', 'quaternius-village', 'Balcony_Cross_Straight.glb', .7),
  entry('entrance.tree', 'quaternius-nature', 'CommonTree_1.glb', 4.6),
  entry('entrance.tree-broad', 'quaternius-nature', 'CommonTree_3.glb', 4.9),
  entry('entrance.pine', 'quaternius-nature', 'Pine_1.glb', 5.2),
  entry('entrance.fern', 'quaternius-nature', 'Fern_1.glb', 0.45),
  entry('entrance.grass', 'quaternius-nature', 'Grass_Common_Short.glb', 0.25),
  entry('entrance.bush', 'quaternius-nature', 'Bush_Common.glb', 0.75),
  entry('entrance.flowers', 'quaternius-nature', 'Flower_3_Group.glb', 0.4),
  entry('entrance.flowers-blue', 'quaternius-nature', 'Flower_4_Group.glb', 0.35),
  entry('entrance.rock', 'quaternius-nature', 'Rock_Medium_1.glb', 1.05),
  entry('entrance.pebble', 'quaternius-nature', 'Pebble_Round_1.glb', 0.18),
  entry('entrance.mushroom', 'quaternius-nature', 'Mushroom_Common.glb', 0.22),
  entry('entrance.path-stone', 'quaternius-nature', 'RockPath_Round_Small_1.glb', 0.08),
  entry('entrance.roof', 'quaternius-village', 'Roof_RoundTiles_6x6.glb', 2.1),
  entry('entrance.wall', 'quaternius-village', 'Wall_Plaster_Straight.glb', 2.4),
  entry('entrance.wall-door', 'quaternius-village', 'Wall_Plaster_Door_Flat.glb', 2.4),
  entry('entrance.wall-window', 'quaternius-village', 'Wall_Plaster_Window_Wide_Flat.glb', 2.4),
  entry('entrance.door', 'quaternius-village', 'Door_1_Flat.glb', 1.85),
  entry('entrance.shutters', 'quaternius-village', 'WindowShutters_Wide_Flat_Open.glb', 1.1),
  entry('entrance.chimney', 'quaternius-village', 'Prop_Chimney.glb', 2.4),
  entry('entrance.crate', 'quaternius-village', 'Prop_Crate.glb', 0.65),
  entry('entrance.wagon', 'quaternius-village', 'Prop_Wagon.glb', 1.25),
  entry('entrance.vine', 'quaternius-village', 'Prop_Vine1.glb', 1.4),
  entry('entrance.paving', 'quaternius-village', 'Floor_UnevenBrick.glb', 0.12),
  entry('entrance.deck', 'quaternius-village', 'Floor_WoodDark.glb', 0.12),
  entry('entrance.railing', 'quaternius-village', 'Prop_WoodenFence_Single.glb', 0.75),
  entry('nature.tree', 'nature-kit', 'tree_default.glb', 3.9),
  entry('nature.tree-dark', 'nature-kit', 'tree_default_dark.glb', 4.2),
  entry('nature.pine', 'nature-kit', 'tree_pineRoundA.glb', 4.6),
  entry('nature.rock-small-a', 'nature-kit', 'rock_smallA.glb', 0.72),
  entry('nature.rock-small-b', 'nature-kit', 'rock_smallB.glb', 0.82),
  entry('nature.rock-large', 'nature-kit', 'rock_largeA.glb', 1.3),
  entry('nature.stump', 'nature-kit', 'stump_roundDetailed.glb', 0.7),
  entry('nature.grass', 'nature-kit', 'grass_large.glb', 0.48),
  entry('nature.bush', 'nature-kit', 'plant_bushDetailed.glb', 0.78),
  entry('nature.flower-yellow', 'nature-kit', 'flower_yellowA.glb', 0.38),
  entry('nature.bridge-wood-round', 'nature-kit', 'bridge_woodRound.glb', 0.95),
  entry('nature.log-stack', 'nature-kit', 'log_stackLarge.glb', 0.85),
  entry('nature.signpost', 'nature-kit', 'sign.glb', 1.4),
  entry('nature.mushrooms-red', 'nature-kit', 'mushroom_redGroup.glb', 0.28),
  entry('town.stall-green', 'fantasy-town-kit', 'stall-green.glb', 2.25),
  entry('town.stall-red', 'fantasy-town-kit', 'stall-red.glb', 2.25),
  entry('town.chimney', 'fantasy-town-kit', 'chimney.glb', 2.1),
  entry('town.fence', 'fantasy-town-kit', 'fence.glb', 1.15, Math.PI / 2),
  entry('town.fence-gate', 'fantasy-town-kit', 'fence-gate.glb', 1.2, Math.PI / 2),
  entry('town.roof-gable', 'fantasy-town-kit', 'roof-gable-detail.glb', 1.45),
  entry('town.roof-gable-high', 'fantasy-town-kit', 'roof-high-gable-detail.glb', 2),
  entry('town.door-stone', 'fantasy-town-kit', 'wall-door.glb', 2.1),
  entry('town.window-stone', 'fantasy-town-kit', 'wall-window-shutters.glb', 1.1),
  entry('town.door-wood', 'fantasy-town-kit', 'wall-wood-door.glb', 2.1),
  entry('town.window-wood', 'fantasy-town-kit', 'wall-wood-window-shutters.glb', 1.1),
  entry('town.lantern', 'fantasy-town-kit', 'lantern.glb', 1.05),
  entry('town.cart', 'fantasy-town-kit', 'cart.glb', 1.05),
  entry('town.banner-red', 'fantasy-town-kit', 'banner-red.glb', 1.6),
  entry('town.banner-green', 'fantasy-town-kit', 'banner-green.glb', 1.6),
  entry('town.pillar-stone', 'fantasy-town-kit', 'pillar-stone.glb', 2.1),
  entry('town.blade-sign', 'fantasy-town-kit', 'blade.glb', 1.4),
  entry('survival.workbench-anvil', 'survival-kit', 'workbench-anvil.glb', 1.2),
  entry('survival.chest', 'survival-kit', 'chest.glb', 0.85),
  entry('survival.barrel', 'survival-kit', 'barrel.glb', 1.15),
  entry('survival.axe', 'survival-kit', 'tool-axe.glb', 0.8),
  entry('survival.pickaxe', 'survival-kit', 'tool-pickaxe.glb', 0.8),
  entry('survival.axe-upgraded', 'survival-kit', 'tool-axe-upgraded.glb', 0.85),
  entry('survival.pickaxe-upgraded', 'survival-kit', 'tool-pickaxe-upgraded.glb', 0.85),
  entry('character.player-placeholder', 'mini-characters', 'character-male-a.glb', 1.55),
] as const;

const MODEL_ASSET_BY_KEY = new Map(MODEL_ASSETS.map((asset) => [asset.key, asset]));

export function modelAsset(key: ModelAssetKey): ModelAssetEntry {
  const asset = MODEL_ASSET_BY_KEY.get(key);
  if (!asset) throw new Error(`Unknown 3D model asset: ${key}`);
  return asset;
}

export function validateModelAssets(entries: readonly ModelAssetEntry[] = MODEL_ASSETS): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const asset of entries) {
    if (keys.has(asset.key)) errors.push(`Duplicate 3D asset key: ${asset.key}`);
    keys.add(asset.key);
    if (!asset.path.startsWith('/assets/3d/') || !asset.path.endsWith('.glb')) {
      errors.push(`${asset.key} must use a root-relative GLB path`);
    }
    if (!Number.isFinite(asset.targetHeight) || asset.targetHeight <= 0) {
      errors.push(`${asset.key} has an invalid target height`);
    }
    if (asset.license !== 'CC0-1.0' || asset.sourceUrl !== SOURCES[asset.pack]
      || asset.author !== (asset.pack.startsWith('quaternius-') ? 'Quaternius' : 'Kenney')) {
      errors.push(`${asset.key} has incomplete provenance`);
    }
  }
  return errors;
}
