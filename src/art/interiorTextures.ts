import type Phaser from 'phaser';
import { TILE_SIZE } from '../config/platform';
import { NPC_DEFINITIONS, type NpcDefinition, type NpcId } from '../content/npcs';
import type { InteriorPropPrefab } from '../content/interiors';
import { TOWN_BUILDING_BLUEPRINTS, type InteriorThemePalette } from '../content/townBuildings';

/**
 * Interior pixel art, drawn on the same contract as the overworld: 16px tiles,
 * whole source pixels, chunky readable silhouettes, one texture per subject.
 * Rooms are floors + a wall band + footprint-sized props, so a building's inside
 * is made of the same material as the world outside its door.
 */
const S = TILE_SIZE;

export type InteriorFacingKey = 'down' | 'up' | 'side';

export function interiorFloorTextureKey(themeId: string): string {
  return `tex-interior-floor-${themeId}`;
}

export function interiorWallTextureKey(themeId: string): string {
  return `tex-interior-wall-${themeId}`;
}

export function interiorPropTextureKey(prefab: InteriorPropPrefab): string {
  return `tex-interior-prop-${prefab}`;
}

export function interiorNpcTextureKey(npcId: NpcId, facing: InteriorFacingKey): string {
  return `tex-npc-${npcId}-${facing}`;
}

/** Tile footprint each prop occupies, in the room's own tile grid. */
export interface PropFootprint {
  readonly tilesWide: number;
  readonly tilesHigh: number;
  /**
   * Floor-level pieces with no collider (rune circles, arena sand) read wrong
   * anchored at a corner, so they centre on their authored tile instead.
   */
  readonly centered?: true;
}

const PROP_FOOTPRINTS: Readonly<Record<InteriorPropPrefab, PropFootprint>> = {
  forge: { tilesWide: 3, tilesHigh: 2 },
  anvil: { tilesWide: 1, tilesHigh: 1 },
  workbench: { tilesWide: 3, tilesHigh: 1 },
  'tool-rack': { tilesWide: 1, tilesHigh: 2 },
  counter: { tilesWide: 3, tilesHigh: 1 },
  crate: { tilesWide: 1, tilesHigh: 1 },
  shelf: { tilesWide: 1, tilesHigh: 2 },
  barrel: { tilesWide: 1, tilesHigh: 1 },
  'feed-sacks': { tilesWide: 3, tilesHigh: 1 },
  'animal-pen': { tilesWide: 3, tilesHigh: 4 },
  'ledger-desk': { tilesWide: 2, tilesHigh: 1 },
  'market-stall': { tilesWide: 3, tilesHigh: 2 },
  'merchant-scale': { tilesWide: 1, tilesHigh: 1 },
  'produce-crates': { tilesWide: 2, tilesHigh: 1 },
  pew: { tilesWide: 3, tilesHigh: 1 },
  altar: { tilesWide: 3, tilesHigh: 1 },
  'candle-stand': { tilesWide: 1, tilesHigh: 1 },
  'stained-window': { tilesWide: 1, tilesHigh: 1 },
  'armour-rack': { tilesWide: 1, tilesHigh: 4 },
  'shield-display': { tilesWide: 1, tilesHigh: 1 },
  'practice-dummy': { tilesWide: 1, tilesHigh: 1 },
  'rune-circle': { tilesWide: 3, tilesHigh: 3, centered: true },
  bookcase: { tilesWide: 1, tilesHigh: 4 },
  'staff-display': { tilesWide: 2, tilesHigh: 1 },
  'floating-books': { tilesWide: 1, tilesHigh: 1 },
  hearth: { tilesWide: 2, tilesHigh: 2 },
  'tavern-table': { tilesWide: 2, tilesHigh: 2 },
  stool: { tilesWide: 1, tilesHigh: 1 },
  'notice-board': { tilesWide: 1, tilesHigh: 2 },
  'arena-ring': { tilesWide: 7, tilesHigh: 5, centered: true },
  'training-post': { tilesWide: 1, tilesHigh: 1 },
  'spectator-bench': { tilesWide: 2, tilesHigh: 6 },
  banner: { tilesWide: 1, tilesHigh: 1 },
};

export function interiorPropFootprint(prefab: InteriorPropPrefab): PropFootprint {
  return PROP_FOOTPRINTS[prefab];
}

/** Props that light their own corner of the room. */
const GLOWING_PROPS: ReadonlySet<InteriorPropPrefab> = new Set<InteriorPropPrefab>([
  'forge', 'hearth', 'rune-circle', 'candle-stand', 'stained-window', 'floating-books',
]);

export function isGlowingProp(prefab: InteriorPropPrefab): boolean {
  return GLOWING_PROPS.has(prefab);
}

type FloorStyle = 'plank' | 'flag' | 'sand' | 'arcane';

interface InteriorMaterial {
  readonly floorStyle: FloorStyle;
  readonly floor: number;
  readonly floorLight: number;
  readonly floorDark: number;
  readonly wall: number;
  readonly wallLight: number;
  readonly wallDark: number;
}

/**
 * Hand-tuned room materials per building motif. An unknown motif still receives
 * the generic timber shell, so a future interior renders before it has art.
 */
const MATERIALS: Readonly<Record<string, InteriorMaterial>> = {
  // Cool slate underfoot against warm sooted brick keeps the two materials
  // apart by hue, not just by value — they are almost the same darkness.
  forge: { floorStyle: 'flag', floor: 0x3c3b3d, floorLight: 0x53514f, floorDark: 0x222123, wall: 0x4a3a30, wallLight: 0x6b5342, wallDark: 0x241812 },
  barn: { floorStyle: 'plank', floor: 0x6b4a2b, floorLight: 0x8a6238, floorDark: 0x4d3520, wall: 0x59422a, wallLight: 0x7a5936, wallDark: 0x2b1d12 },
  market: { floorStyle: 'flag', floor: 0x5c6570, floorLight: 0x77808a, floorDark: 0x3f4750, wall: 0x6d7885, wallLight: 0x8e9aa6, wallDark: 0x39424c },
  church: { floorStyle: 'flag', floor: 0x5b6478, floorLight: 0x7d8798, floorDark: 0x3c4455, wall: 0x9a9484, wallLight: 0xc6bda8, wallDark: 0x53647c },
  armoury: { floorStyle: 'flag', floor: 0x4c5455, floorLight: 0x666f6f, floorDark: 0x333a3b, wall: 0x778486, wallLight: 0x9aa9a8, wallDark: 0x39484c },
  arcane: { floorStyle: 'arcane', floor: 0x3a2f5c, floorLight: 0x554488, floorDark: 0x241c3c, wall: 0x554278, wallLight: 0x7b62a8, wallDark: 0x2a1f45 },
  tavern: { floorStyle: 'plank', floor: 0x5e3f28, floorLight: 0x825734, floorDark: 0x3f2a1a, wall: 0x6f4c31, wallLight: 0x8d6546, wallDark: 0x3a2418 },
  arena: { floorStyle: 'sand', floor: 0x9a7655, floorLight: 0xbd9469, floorDark: 0x74563c, wall: 0x7d6144, wallLight: 0x9d7c57, wallDark: 0x4a382a },
};

const GENERIC_MATERIAL: InteriorMaterial = MATERIALS.barn!;

function materialFor(theme: InteriorThemePalette): InteriorMaterial {
  return MATERIALS[theme.id] ?? GENERIC_MATERIAL;
}

const THEMES: readonly InteriorThemePalette[] = TOWN_BUILDING_BLUEPRINTS.map((blueprint) => blueprint.interiorTheme);

/** Every key this module owns, so the world generator can verify the full set. */
export function interiorTextureKeys(): readonly string[] {
  return [
    ...THEMES.flatMap((theme) => [interiorFloorTextureKey(theme.id), interiorWallTextureKey(theme.id)]),
    ...(Object.keys(PROP_FOOTPRINTS) as InteriorPropPrefab[]).map(interiorPropTextureKey),
    ...NPC_DEFINITIONS.flatMap((npc) => (['down', 'up', 'side'] as const).map((facing) => interiorNpcTextureKey(npc.id, facing))),
  ];
}

export function generateInteriorTextures(scene: Phaser.Scene): void {
  for (const theme of THEMES) {
    const material = materialFor(theme);
    withGraphics(scene, interiorFloorTextureKey(theme.id), (g) => drawFloorTile(g, material));
    withGraphics(scene, interiorWallTextureKey(theme.id), (g) => drawWallTile(g, material));
  }
  for (const prefab of Object.keys(PROP_FOOTPRINTS) as InteriorPropPrefab[]) {
    const footprint = PROP_FOOTPRINTS[prefab];
    const width = footprint.tilesWide * S;
    const height = footprint.tilesHigh * S;
    withGraphics(scene, interiorPropTextureKey(prefab), (g) => PROP_PAINTERS[prefab](g, width, height), width, height);
  }
  for (const npc of NPC_DEFINITIONS) {
    for (const facing of ['down', 'up', 'side'] as const) {
      withGraphics(scene, interiorNpcTextureKey(npc.id, facing), (g) => drawNpc(g, npc, facing), 24, 32);
    }
  }
}

function withGraphics(
  scene: Phaser.Scene,
  key: string,
  draw: (g: Phaser.GameObjects.Graphics) => void,
  width = S,
  height = S,
): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, width, height);
  g.destroy();
}

function drawFloorTile(g: Phaser.GameObjects.Graphics, material: InteriorMaterial): void {
  g.fillStyle(material.floor, 1).fillRect(0, 0, S, S);
  if (material.floorStyle === 'plank') {
    // Boards run east-west with a seam every four pixels, lit along the top.
    g.fillStyle(material.floorDark, 1);
    for (const y of [0, 5, 10, 15] as const) g.fillRect(0, y, S, 1);
    g.fillStyle(material.floorLight, 1).fillRect(0, 1, S, 1).fillRect(0, 11, S, 1);
    g.fillStyle(material.floorDark, 1).fillRect(6, 5, 1, 5).fillRect(12, 10, 1, 5);
    g.fillStyle(material.floorLight, 0.5).fillRect(2, 7, 3, 1).fillRect(9, 2, 4, 1);
  } else if (material.floorStyle === 'flag') {
    // Two staggered flagstones per tile, mortar in the gaps.
    g.fillStyle(material.floorDark, 1).fillRect(0, 0, S, S);
    g.fillStyle(material.floor, 1).fillRect(1, 1, 13, 6).fillRect(3, 9, 12, 6);
    g.fillStyle(material.floorLight, 1).fillRect(1, 1, 13, 1).fillRect(3, 9, 12, 1);
    g.fillStyle(material.floorDark, 1).fillRect(5, 3, 2, 1).fillRect(10, 12, 3, 1);
  } else if (material.floorStyle === 'sand') {
    g.fillStyle(material.floorLight, 1).fillRect(0, 0, S, 2).fillRect(0, 8, S, 1);
    g.fillStyle(material.floorDark, 1);
    for (const [x, y] of [[3, 4], [11, 3], [7, 11], [14, 13], [1, 13]] as const) g.fillRect(x, y, 2, 1);
    g.fillStyle(material.floorLight, 0.7).fillRect(5, 6, 4, 1).fillRect(9, 14, 4, 1);
  } else {
    // Arcane: dark inlay tile with a faint sigil fleck at the joint.
    g.fillStyle(material.floorDark, 1).fillRect(0, 0, S, 1).fillRect(0, 0, 1, S);
    g.fillStyle(material.floorLight, 1).fillRect(2, 2, 12, 1).fillRect(2, 2, 1, 12);
    g.fillStyle(material.floorDark, 1).fillRect(2, 13, 12, 1).fillRect(13, 2, 1, 12);
    g.fillStyle(0x77e5f0, 0.5).fillRect(7, 7, 2, 2);
  }
}

function drawWallTile(g: Phaser.GameObjects.Graphics, material: InteriorMaterial): void {
  g.fillStyle(material.wallDark, 1).fillRect(0, 0, S, S);
  g.fillStyle(material.wall, 1).fillRect(0, 1, 7, 6).fillRect(8, 1, 8, 6).fillRect(0, 9, 11, 6).fillRect(12, 9, 4, 6);
  g.fillStyle(material.wallLight, 1)
    .fillRect(0, 1, 7, 1).fillRect(8, 1, 8, 1)
    .fillRect(0, 9, 11, 1).fillRect(12, 9, 4, 1);
  g.fillStyle(material.wallDark, 1).fillRect(3, 3, 2, 1).fillRect(11, 12, 2, 1);
}

// --- Props ------------------------------------------------------------------
// Each painter draws in its own footprint's source pixels, top-left anchored,
// with a contact shadow so a prop sits on the floor rather than floating.

type PropPainter = (g: Phaser.GameObjects.Graphics, width: number, height: number) => void;

function contactShadow(g: Phaser.GameObjects.Graphics, width: number, height: number, inset = 2): void {
  g.fillStyle(0x000000, 0.24).fillEllipse(width / 2, height - inset, width - inset * 2, Math.max(3, height / 5));
}

const PROP_PAINTERS: Readonly<Record<InteriorPropPrefab, PropPainter>> = {
  forge: (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x2f2724, 1).fillRect(1, 4, w - 2, h - 7);
    g.fillStyle(0x4c4038, 1).fillRect(2, 5, w - 4, h - 11);
    // Stone hood over a lit coal bed.
    g.fillStyle(0x3a3230, 1).fillRect(3, 1, w - 6, 6);
    g.fillStyle(0x5d504a, 1).fillRect(4, 2, w - 8, 2);
    g.fillStyle(0x53251b, 1).fillRect(6, h - 14, w - 12, 9);
    g.fillStyle(0xd66a32, 1).fillRect(8, h - 12, w - 16, 6);
    g.fillStyle(0xfff0a6, 1).fillRect(11, h - 11, w - 22, 3);
    g.fillStyle(0xffd07a, 0.65).fillRect(13, h - 17, 4, 3).fillRect(w - 18, h - 19, 3, 3);
    g.fillStyle(0x241812, 1).fillRect(2, h - 5, w - 4, 3);
  },
  anvil: (g, w, h) => {
    // Darker than the forge's slate floor, with a lit face, so the silhouette
    // still reads where the world's anvil sits on grass instead.
    contactShadow(g, w, h, 1);
    g.fillStyle(0x14171a, 1).fillRect(3, 6, 11, 6).fillTriangle(0, 7, 7, 3, 15, 7);
    g.fillStyle(0x2b3134, 1).fillRect(4, 7, 9, 4);
    g.fillStyle(0x8d979a, 1).fillRect(3, 4, 10, 3);
    g.fillStyle(0xc2cbcc, 1).fillRect(4, 4, 8, 1);
    g.fillStyle(0x14171a, 1).fillRect(6, 11, 4, 3);
    g.fillStyle(0x513a29, 1).fillRect(4, 13, 8, 3);
  },
  workbench: (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x4b3321, 1).fillRect(1, 3, w - 2, h - 5);
    g.fillStyle(0x8b5d31, 1).fillRect(2, 4, w - 4, h - 9);
    g.fillStyle(0xb08454, 1).fillRect(2, 4, w - 4, 2);
    g.fillStyle(0x2b2119, 1).fillRect(3, h - 5, 3, 4).fillRect(w - 6, h - 5, 3, 4);
    // Loose tools on the bench top.
    g.fillStyle(0xcbd0c6, 1).fillRect(7, 6, 8, 2);
    g.fillStyle(0x513a29, 1).fillRect(15, 6, 5, 2);
    g.fillStyle(0x737b7e, 1).fillRect(w - 14, 7, 6, 3);
  },
  'tool-rack': (g, w, h) => {
    g.fillStyle(0x3a2a1c, 1).fillRect(2, 1, w - 4, h - 2);
    g.fillStyle(0x6b4a2b, 1).fillRect(3, 2, w - 6, h - 4);
    g.fillStyle(0x8a6238, 1).fillRect(3, 2, w - 6, 1);
    g.fillStyle(0x737b7e, 1).fillRect(5, 4, 2, 9).fillRect(9, 6, 2, 11);
    g.fillStyle(0xcbd0c6, 1).fillRect(4, 4, 4, 2).fillRect(8, 6, 4, 2);
    g.fillStyle(0x513a29, 1).fillRect(5, 13, 2, 5).fillRect(9, 17, 2, 5);
  },
  counter: (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x3a2a1c, 1).fillRect(0, 2, w, h - 4);
    g.fillStyle(0x6a482e, 1).fillRect(1, 3, w - 2, h - 7);
    g.fillStyle(0xb08454, 1).fillRect(1, 3, w - 2, 2);
    g.fillStyle(0x2b2119, 1).fillRect(1, h - 5, w - 2, 2);
    g.fillStyle(0x8b5d31, 1);
    for (let x = 4; x < w - 4; x += 9) g.fillRect(x, 6, 5, 1);
  },
  crate: (g, w, h) => {
    contactShadow(g, w, h, 1);
    g.fillStyle(0x4b3321, 1).fillRect(1, 3, 14, 11);
    g.fillStyle(0x8b5d31, 1).fillRect(2, 4, 12, 9);
    g.fillStyle(0xc69a4b, 1).fillRect(1, 7, 14, 2);
    g.fillStyle(0x4b3321, 1).fillRect(7, 4, 2, 9);
  },
  shelf: (g, w, h) => {
    g.fillStyle(0x3a2a1c, 1).fillRect(1, 1, w - 2, h - 2);
    g.fillStyle(0x6b4a2b, 1).fillRect(2, 2, w - 4, h - 4);
    g.fillStyle(0x8a6238, 1);
    for (let y = 5; y < h - 3; y += 8) g.fillRect(2, y, w - 4, 2);
    g.fillStyle(0xc9b184, 1).fillRect(4, 3, 3, 2).fillRect(9, 3, 3, 2);
    g.fillStyle(0x77a750, 1).fillRect(5, 11, 3, 3);
    g.fillStyle(0xc94f43, 1).fillRect(9, 12, 3, 2);
  },
  barrel: (g, w, h) => {
    contactShadow(g, w, h, 2);
    g.fillStyle(0x573b27, 1).fillRoundedRect(3, 2, 10, 12, 3);
    g.fillStyle(0x8b5d35, 1).fillRoundedRect(4, 3, 8, 10, 2);
    g.fillStyle(0x303538, 1).fillRect(3, 5, 10, 2).fillRect(3, 10, 10, 2);
    g.fillStyle(0xb17a43, 1).fillRect(6, 3, 2, 9);
  },
  'feed-sacks': (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x8c6a2d, 1);
    for (let x = 2; x < w - 6; x += 11) g.fillRoundedRect(x, 4, 10, 10, 3);
    g.fillStyle(0xd9bd61, 1);
    for (let x = 2; x < w - 6; x += 11) g.fillRoundedRect(x + 1, 5, 8, 7, 2);
    g.fillStyle(0x8c6a2d, 1);
    for (let x = 2; x < w - 6; x += 11) g.fillRect(x + 3, 4, 4, 2);
    g.fillStyle(0xf1d77a, 1);
    for (let x = 2; x < w - 6; x += 11) g.fillRect(x + 2, 7, 3, 1);
  },
  'animal-pen': (g, w, h) => {
    // Bedded straw yard behind a rail fence.
    g.fillStyle(0x53401f, 1).fillRect(1, 1, w - 2, h - 2);
    g.fillStyle(0x7d6432, 1).fillRect(2, 2, w - 4, h - 4);
    g.fillStyle(0xa98d45, 1);
    for (let y = 6; y < h - 4; y += 7) g.fillRect(4, y, w - 10, 1);
    g.fillStyle(0xd9bd61, 0.7);
    for (const [x, y] of [[6, 10], [18, 22], [12, 34], [26, 16]] as const) g.fillRect(x % (w - 8) + 3, y % (h - 8) + 3, 4, 1);
    // Rails: posts on the corners, two horizontal bars per side.
    g.fillStyle(0x6b4a2b, 1)
      .fillRect(0, 0, w, 3).fillRect(0, h - 3, w, 3)
      .fillRect(0, 0, 3, h).fillRect(w - 3, 0, 3, h);
    g.fillStyle(0x8a6238, 1).fillRect(0, 0, w, 1).fillRect(0, h - 3, w, 1).fillRect(0, 0, 1, h);
    g.fillStyle(0x4d3520, 1);
    for (let x = 4; x < w - 4; x += 10) g.fillRect(x, 0, 2, h);
    // A drinking trough against the near rail.
    g.fillStyle(0x3f2b1b, 1).fillRect(w / 2 - 6, h - 10, 12, 6);
    g.fillStyle(0x41688a, 1).fillRect(w / 2 - 5, h - 9, 10, 4);
    g.fillStyle(0x7398b5, 1).fillRect(w / 2 - 5, h - 9, 10, 1);
  },
  'ledger-desk': (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x3a2a1c, 1).fillRect(0, 2, w, h - 4);
    g.fillStyle(0x6a482e, 1).fillRect(1, 3, w - 2, h - 7);
    g.fillStyle(0xb08454, 1).fillRect(1, 3, w - 2, 2);
    g.fillStyle(0xe9dfc7, 1).fillRect(6, 6, 9, 6);
    g.fillStyle(0x8f8368, 1).fillRect(6, 6, 9, 1).fillRect(10, 7, 1, 5);
    g.fillStyle(0x2b2119, 1).fillRect(w - 9, 5, 1, 6);
    g.fillStyle(0xd5ae58, 1).fillRect(w - 10, 4, 3, 2);
  },
  'market-stall': (g, w, h) => {
    contactShadow(g, w, h);
    // Striped awning above a goods table.
    g.fillStyle(0x2b2119, 1).fillRect(1, 1, w - 2, 8);
    for (let x = 2; x < w - 2; x += 6) {
      g.fillStyle(Math.floor(x / 6) % 2 === 0 ? 0xf0c85b : 0xece5d2, 1).fillRect(x, 2, 6, 6);
    }
    g.fillStyle(0x4b3321, 1).fillRect(2, 10, w - 4, h - 13);
    g.fillStyle(0x8b5d31, 1).fillRect(3, 11, w - 6, h - 17);
    g.fillStyle(0xc94f43, 1).fillCircle(8, 14, 3).fillCircle(w - 10, 15, 3);
    g.fillStyle(0x77a750, 1).fillCircle(15, 13, 3);
    g.fillStyle(0xf0c85b, 1).fillCircle(w - 18, 14, 2);
    g.fillStyle(0x2b2119, 1).fillRect(3, h - 4, 3, 3).fillRect(w - 6, h - 4, 3, 3);
  },
  'merchant-scale': (g, w, h) => {
    contactShadow(g, w, h, 1);
    g.fillStyle(0x513a29, 1).fillRect(7, 8, 2, 6);
    g.fillStyle(0x3a2a1c, 1).fillRect(5, 13, 6, 2);
    g.fillStyle(0xd5ae58, 1).fillRect(2, 6, 12, 1).fillRect(7, 3, 2, 4);
    g.fillStyle(0xe8c15a, 1).fillRect(1, 7, 5, 2).fillRect(10, 7, 5, 2);
    g.fillStyle(0x9c7647, 1).fillRect(3, 9, 1, 1).fillRect(12, 9, 1, 1);
  },
  'produce-crates': (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x4b3321, 1).fillRect(1, 5, w - 2, h - 7);
    g.fillStyle(0x8b5d31, 1).fillRect(2, 7, w - 4, h - 11);
    g.fillStyle(0xc94f43, 1).fillCircle(6, 6, 3).fillCircle(w - 8, 6, 3);
    g.fillStyle(0x78a64e, 1).fillCircle(w / 2, 5, 3);
    g.fillStyle(0xc69a4b, 1).fillRect(1, 8, w - 2, 2);
  },
  pew: (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x3a2a1c, 1).fillRect(0, 2, w, h - 5);
    g.fillStyle(0x6a482e, 1).fillRect(1, 3, w - 2, 5);
    g.fillStyle(0xa07a4c, 1).fillRect(1, 3, w - 2, 1);
    g.fillStyle(0x4b3321, 1).fillRect(1, 9, w - 2, 3);
    g.fillStyle(0x2b2119, 1).fillRect(2, h - 4, 3, 3).fillRect(w - 5, h - 4, 3, 3);
  },
  altar: (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x6f6a5c, 1).fillRect(1, 3, w - 2, h - 5);
    g.fillStyle(0x9a9484, 1).fillRect(2, 4, w - 4, h - 9);
    g.fillStyle(0xc6bda8, 1).fillRect(2, 4, w - 4, 2);
    // Cloth runner with a gold seal, flanked by candles.
    g.fillStyle(0x41688a, 1).fillRect(w / 2 - 7, 5, 14, 8);
    g.fillStyle(0xf3d98b, 1).fillRect(w / 2 - 1, 7, 2, 5).fillRect(w / 2 - 4, 8, 8, 2);
    g.fillStyle(0xe9dfc7, 1).fillRect(4, 5, 2, 6).fillRect(w - 6, 5, 2, 6);
    g.fillStyle(0xffd07a, 1).fillRect(4, 3, 2, 2).fillRect(w - 6, 3, 2, 2);
  },
  'candle-stand': (g, w, h) => {
    contactShadow(g, w, h, 2);
    g.fillStyle(0x3a3230, 1).fillRect(5, 12, 6, 3);
    g.fillStyle(0x6f6a5c, 1).fillRect(7, 5, 2, 8);
    g.fillStyle(0xe9dfc7, 1).fillRect(3, 4, 3, 4).fillRect(10, 4, 3, 4).fillRect(6, 2, 4, 4);
    g.fillStyle(0xffd07a, 1).fillRect(4, 2, 1, 2).fillRect(11, 2, 1, 2).fillRect(7, 0, 2, 2);
    g.fillStyle(0xfff0a6, 1).fillRect(7, 0, 1, 1);
  },
  'stained-window': (g) => {
    g.fillStyle(0x2b2119, 1).fillRect(1, 0, 14, 14);
    g.fillStyle(0x8eb8e8, 1).fillRect(2, 1, 12, 12);
    g.fillStyle(0xc95845, 1).fillRect(3, 2, 4, 5);
    g.fillStyle(0x77a750, 1).fillRect(9, 2, 4, 5);
    g.fillStyle(0xf3d98b, 1).fillRect(3, 8, 10, 4);
    g.fillStyle(0x2b2119, 1).fillRect(7, 1, 2, 12).fillRect(2, 7, 12, 1);
    g.fillStyle(0xfff0d6, 0.35).fillRect(2, 13, 12, 3);
  },
  'armour-rack': (g, w, h) => {
    g.fillStyle(0x2f3739, 1).fillRect(2, 1, w - 4, h - 2);
    g.fillStyle(0x4c5455, 1).fillRect(3, 2, w - 6, h - 4);
    g.fillStyle(0x737b7e, 1).fillRect(3, 2, w - 6, 1);
    // Three hung harnesses down the rack.
    for (let y = 4; y < h - 6; y += 14) {
      g.fillStyle(0x9aa9a8, 1).fillRect(4, y, 8, 7);
      g.fillStyle(0xc8d1d1, 1).fillRect(5, y + 1, 6, 3);
      g.fillStyle(0x39484c, 1).fillRect(7, y + 4, 2, 3);
    }
    g.fillStyle(0x241812, 1).fillRect(2, h - 3, w - 4, 2);
  },
  'shield-display': (g) => {
    g.fillStyle(0x3a2a1c, 1).fillRect(2, 1, 12, 3);
    g.fillStyle(0x3a474b, 1).fillCircle(8, 8, 6);
    g.fillStyle(0x9aa9a8, 1).fillCircle(8, 8, 5);
    g.fillStyle(0xc8d1d1, 1).fillTriangle(8, 3, 3, 8, 8, 14);
    g.fillStyle(0x39484c, 1).fillCircle(8, 8, 2);
    g.fillStyle(0xd5ae58, 1).fillRect(7, 7, 2, 2);
  },
  'practice-dummy': (g, w, h) => {
    contactShadow(g, w, h, 2);
    g.fillStyle(0x3a2a1c, 1).fillRect(6, 10, 4, 5);
    g.fillStyle(0x8c6a2d, 1).fillRoundedRect(3, 2, 10, 9, 3);
    g.fillStyle(0xd9bd61, 1).fillRoundedRect(4, 3, 8, 6, 2);
    g.fillStyle(0x6b4a2b, 1).fillRect(1, 5, 14, 2);
    g.fillStyle(0xc94f43, 1).fillCircle(8, 6, 2);
    g.fillStyle(0x2b2119, 1).fillRect(7, 5, 1, 1);
  },
  'rune-circle': (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    g.lineStyle(2, 0x6cd7e8, 0.85).strokeCircle(cx, cy, w / 2 - 4);
    g.lineStyle(1, 0xd8a8ff, 0.8).strokeCircle(cx, cy, w / 2 - 10);
    g.fillStyle(0x77e5f0, 0.16).fillCircle(cx, cy, w / 2 - 5);
    g.fillStyle(0xd8a8ff, 1);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [0.7, -0.7], [-0.7, 0.7]] as const) {
      g.fillRect(cx + dx * (w / 2 - 7) - 1, cy + dy * (h / 2 - 7) - 1, 3, 3);
    }
    g.fillStyle(0xefe2ff, 1).fillRect(cx - 2, cy - 2, 4, 4);
    g.fillStyle(0x77e5f0, 0.6).fillRect(cx - 6, cy - 1, 12, 2).fillRect(cx - 1, cy - 6, 2, 12);
  },
  bookcase: (g, w, h) => {
    g.fillStyle(0x2c2038, 1).fillRect(1, 1, w - 2, h - 2);
    g.fillStyle(0x4a3660, 1).fillRect(2, 2, w - 4, h - 4);
    g.fillStyle(0x7b62a8, 1).fillRect(2, 2, w - 4, 1);
    const spines = [0xc94f43, 0x41688a, 0xd5ae58, 0x77a750, 0x9a5fbf] as const;
    for (let y = 4, index = 0; y < h - 6; y += 8, index += 1) {
      g.fillStyle(0x241c3c, 1).fillRect(3, y + 6, w - 6, 2);
      for (let x = 3; x < w - 4; x += 3) {
        g.fillStyle(spines[(index + x) % spines.length]!, 1).fillRect(x, y, 2, 6);
      }
    }
  },
  'staff-display': (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x2c2038, 1).fillRect(0, 3, w, h - 5);
    g.fillStyle(0x4a3660, 1).fillRect(1, 4, w - 2, h - 8);
    g.fillStyle(0x7b62a8, 1).fillRect(1, 4, w - 2, 1);
    // Two staves laid on velvet, focus crystals lit.
    g.fillStyle(0x6b4a2b, 1).fillRect(4, 6, w - 12, 2).fillRect(6, 10, w - 12, 2);
    g.fillStyle(0x6cd7e8, 1).fillCircle(w - 7, 7, 2);
    g.fillStyle(0xd8a8ff, 1).fillCircle(w - 5, 11, 2);
    g.fillStyle(0xefe2ff, 1).fillRect(w - 8, 6, 1, 1);
  },
  'floating-books': (g) => {
    g.fillStyle(0x77e5f0, 0.2).fillCircle(8, 8, 7);
    g.fillStyle(0x41688a, 1).fillRect(2, 3, 5, 4);
    g.fillStyle(0xe9dfc7, 1).fillRect(3, 4, 4, 2);
    g.fillStyle(0xc94f43, 1).fillRect(9, 7, 5, 4);
    g.fillStyle(0xe9dfc7, 1).fillRect(10, 8, 4, 2);
    g.fillStyle(0xd8a8ff, 1).fillRect(5, 11, 4, 3);
    g.fillStyle(0xefe2ff, 0.8).fillRect(7, 1, 2, 1).fillRect(1, 9, 1, 2).fillRect(14, 4, 1, 2);
  },
  hearth: (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x3a3230, 1).fillRect(1, 1, w - 2, h - 3);
    g.fillStyle(0x6f6a5c, 1).fillRect(2, 2, w - 4, 6);
    g.fillStyle(0x9a9484, 1).fillRect(2, 2, w - 4, 1);
    g.fillStyle(0x241812, 1).fillRect(5, 9, w - 10, h - 13);
    g.fillStyle(0xd76b3f, 1).fillRect(6, 12, w - 12, h - 17);
    g.fillStyle(0xffbc68, 1).fillTriangle(w / 2 - 5, h - 6, w / 2, 12, w / 2 + 5, h - 6);
    g.fillStyle(0xfff0a6, 1).fillTriangle(w / 2 - 2, h - 7, w / 2, 16, w / 2 + 2, h - 7);
    g.fillStyle(0x513a29, 1).fillRect(4, h - 6, w - 8, 3);
  },
  'tavern-table': (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x3a2a1c, 1).fillEllipse(w / 2, h / 2, w - 4, h - 8);
    g.fillStyle(0x6a482e, 1).fillEllipse(w / 2, h / 2 - 1, w - 8, h - 12);
    g.fillStyle(0xa07a4c, 1).fillEllipse(w / 2, h / 2 - 3, w - 14, h - 20);
    // Two tankards and a candle stub.
    g.fillStyle(0x737b7e, 1).fillRect(7, 10, 4, 5).fillRect(w - 12, 12, 4, 5);
    g.fillStyle(0xe5b76b, 1).fillRect(7, 10, 4, 2).fillRect(w - 12, 12, 4, 2);
    g.fillStyle(0xe9dfc7, 1).fillRect(w / 2 - 1, 8, 2, 4);
    g.fillStyle(0xffd07a, 1).fillRect(w / 2 - 1, 6, 2, 2);
  },
  stool: (g, w, h) => {
    contactShadow(g, w, h, 3);
    g.fillStyle(0x3a2a1c, 1).fillEllipse(8, 8, 11, 8);
    g.fillStyle(0x6a482e, 1).fillEllipse(8, 7, 9, 6);
    g.fillStyle(0xa07a4c, 1).fillEllipse(8, 6, 6, 3);
    g.fillStyle(0x2b2119, 1).fillRect(4, 11, 2, 3).fillRect(10, 11, 2, 3);
  },
  'notice-board': (g, w, h) => {
    g.fillStyle(0x2b2119, 1).fillRect(1, 1, w - 2, h - 4);
    g.fillStyle(0x6b4a2b, 1).fillRect(2, 2, w - 4, h - 6);
    g.fillStyle(0x8a6238, 1).fillRect(2, 2, w - 4, 1);
    g.fillStyle(0xe9dfc7, 1).fillRect(3, 4, 5, 6).fillRect(9, 6, 4, 5).fillRect(4, 13, 6, 7);
    g.fillStyle(0x8f8368, 1).fillRect(3, 4, 5, 1).fillRect(4, 13, 6, 1);
    g.fillStyle(0xc94f43, 1).fillRect(5, 5, 1, 1).fillRect(11, 7, 1, 1).fillRect(6, 14, 1, 1);
    g.fillStyle(0x3a2a1c, 1).fillRect(6, h - 4, 3, 4);
  },
  'arena-ring': (g, w, h) => {
    // Raked sand inside a rope ring; the ring is floor, so no contact shadow.
    g.fillStyle(0xbd9469, 1).fillEllipse(w / 2, h / 2, w - 4, h - 4);
    g.fillStyle(0xa8814f, 1).fillEllipse(w / 2, h / 2, w - 14, h - 14);
    g.lineStyle(3, 0xe4bd69, 1).strokeEllipse(w / 2, h / 2, w - 6, h - 6);
    g.lineStyle(1, 0x74563c, 1).strokeEllipse(w / 2, h / 2, w - 20, h - 20);
    g.fillStyle(0x8a6238, 1);
    for (const [x, y] of [[4, h / 2], [w - 4, h / 2], [w / 2, 3], [w / 2, h - 3]] as const) g.fillRect(x - 2, y - 2, 4, 4);
    g.fillStyle(0xd9583b, 0.85).fillRect(w / 2 - 8, h / 2 - 1, 16, 2);
  },
  'training-post': (g, w, h) => {
    contactShadow(g, w, h, 2);
    g.fillStyle(0x3a2a1c, 1).fillRect(5, 3, 6, 12);
    g.fillStyle(0x6b4a2b, 1).fillRect(6, 4, 4, 10);
    g.fillStyle(0x8a6238, 1).fillRect(6, 4, 2, 9);
    g.fillStyle(0x8c6a2d, 1).fillRect(2, 5, 12, 3);
    g.fillStyle(0xd9bd61, 1).fillRect(2, 5, 12, 1);
    g.fillStyle(0x2b2119, 1).fillRect(4, 13, 8, 2);
  },
  'spectator-bench': (g, w, h) => {
    contactShadow(g, w, h);
    g.fillStyle(0x3a2a1c, 1).fillRect(1, 1, w - 2, h - 3);
    // Tiered planks stepping back from the ring.
    for (let y = 2, step = 0; y < h - 4; y += 10, step += 1) {
      g.fillStyle(step % 2 === 0 ? 0x72513b : 0x6a482e, 1).fillRect(2, y, w - 4, 8);
      g.fillStyle(0xa07a4c, 1).fillRect(2, y, w - 4, 1);
      g.fillStyle(0x4d3520, 1).fillRect(2, y + 7, w - 4, 1);
    }
    g.fillStyle(0xcf9f4d, 1).fillRect(1, 1, w - 2, 1);
  },
  banner: (g) => {
    g.fillStyle(0x3a2a1c, 1).fillRect(1, 0, 14, 2);
    g.fillStyle(0xb84232, 1).fillRect(3, 2, 10, 11);
    g.fillStyle(0x8c2f24, 1).fillRect(3, 2, 10, 1);
    g.fillStyle(0xe4bd69, 1).fillRect(7, 4, 2, 6).fillRect(5, 6, 6, 2);
    g.fillStyle(0xb84232, 1).fillTriangle(3, 13, 8, 15, 13, 13);
    g.fillStyle(0x000000, 0.2).fillRect(3, 12, 10, 1);
  },
};

// --- NPCs -------------------------------------------------------------------

/**
 * Townsfolk share the player's 24×32 top-down build so a room's occupants read
 * as the same species of sprite, recolored from the NPC's own palette.
 */
function drawNpc(g: Phaser.GameObjects.Graphics, npc: NpcDefinition, facing: InteriorFacingKey): void {
  const robe = cssColor(npc.appearance.primaryColor);
  const trim = cssColor(npc.appearance.accentColor);
  const shade = shadeColor(robe, 0.62);
  const light = shadeColor(robe, 1.28);
  g.fillStyle(0x000000, 0.22).fillEllipse(12, 29, 14, 4);
  g.fillStyle(0x2b2119, 1).fillRect(7, 25, 4, 4).fillRect(13, 25, 4, 4);
  g.fillStyle(shade, 1).fillRoundedRect(5, 12, 14, 15, 3);
  g.fillStyle(robe, 1).fillRoundedRect(6, 12, 12, 13, 2);
  g.fillStyle(light, 1).fillRect(7, 13, 10, 4);
  g.fillStyle(trim, 1).fillRect(6, 20, 12, 2);
  g.fillStyle(0x17231c, 1).fillCircle(12, 9, 7);
  g.fillStyle(0xd0a466, 1).fillCircle(12, 9, 5);
  g.fillStyle(shade, 1).fillRect(7, 4, 10, 4);
  if (facing === 'down') g.fillStyle(0x17231c, 1).fillRect(9, 9, 1, 1).fillRect(14, 9, 1, 1);
  else if (facing === 'side') g.fillStyle(0x17231c, 1).fillRect(15, 9, 1, 1);
  else g.fillStyle(shade, 1).fillRect(7, 8, 10, 4);
  // A shoulder mantle in the accent color separates NPCs from the player at a glance.
  g.fillStyle(trim, 1).fillRect(5, 12, 14, 2);
}

/** `#rrggbb` (or `#rgb`) to the 0xrrggbb form Phaser Graphics wants. */
function cssColor(value: string): number {
  const hex = value.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((digit) => digit + digit).join('') : hex;
  const parsed = Number.parseInt(full, 16);
  return Number.isNaN(parsed) ? 0x808080 : parsed;
}

function shadeColor(color: number, factor: number): number {
  const channel = (shift: number) => Math.min(255, Math.round(((color >> shift) & 0xff) * factor));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
