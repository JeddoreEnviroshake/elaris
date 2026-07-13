import Phaser from 'phaser';
import { TILE_SIZE } from '../config/platform';
import type { SpeciesId } from '../simulation/state';
import type { NpcId } from '../content/npcs';

/**
 * Procedurally generate all placeholder 16×16 game textures at boot. No
 * downloaded or third-party art: every texture is drawn here from primitives.
 * Silhouettes and palettes are kept distinct so entities stay readable at phone
 * size and small zoom. Regenerate after WebGL context loss.
 */
export const TextureKeys = {
  Ground: 'tex-ground',
  Player: 'tex-player',
  Tree: 'tex-tree',
  Rock: 'tex-rock',
  Plant: 'tex-plant',
  Stump: 'tex-stump',
  Rubble: 'tex-rubble',
  PlantRemains: 'tex-plant-remains',
  DropWood: 'tex-drop-wood',
  DropStone: 'tex-drop-stone',
  DropFiber: 'tex-drop-fiber',
  Wall: 'tex-wall',
  FieldCache: 'tex-field-cache',
  Workbench: 'tex-workbench',
  Planter: 'tex-planter',
  PlanterReady: 'tex-planter-ready',
  GardenBed: 'tex-garden-bed',
  GardenBedReady: 'tex-garden-bed-ready',
  Tuftle: 'tex-tuftle',
  Craghopper: 'tex-craghopper',
  GladeStag: 'tex-glade-stag',
  Snarlfox: 'tex-snarlfox',
  Mara: 'tex-npc-mara',
  Orin: 'tex-npc-orin',
  Tavi: 'tex-npc-tavi',
} as const;

const CREATURE_TEXTURES: Readonly<Record<SpeciesId, string>> = {
  tuftle: TextureKeys.Tuftle,
  craghopper: TextureKeys.Craghopper,
  'glade-stag': TextureKeys.GladeStag,
  snarlfox: TextureKeys.Snarlfox,
};

export function creatureTextureKey(speciesId: SpeciesId): string {
  return CREATURE_TEXTURES[speciesId];
}

const NPC_TEXTURES: Readonly<Record<NpcId, string>> = {
  'mara-smith': TextureKeys.Mara,
  'orin-stockkeeper': TextureKeys.Orin,
  'tavi-trader': TextureKeys.Tavi,
};

export function npcTextureKey(npcId: NpcId): string {
  return NPC_TEXTURES[npcId];
}

const S = TILE_SIZE;

export function generateWorldTextures(scene: Phaser.Scene): void {
  const keys = Object.values(TextureKeys);
  for (const key of keys) {
    if (scene.textures.exists(key)) scene.textures.remove(key);
  }

  drawGround(scene);
  drawPlayer(scene);
  drawTree(scene);
  drawRock(scene);
  drawPlant(scene);
  drawStump(scene);
  drawRubble(scene);
  drawPlantRemains(scene);
  drawDropWood(scene);
  drawDropStone(scene);
  drawDropFiber(scene);
  drawWall(scene);
  drawFieldCache(scene);
  drawWorkbench(scene);
  drawPlanter(scene);
  drawGardenBed(scene);
  drawTuftle(scene);
  drawCraghopper(scene);
  drawGladeStag(scene);
  drawSnarlfox(scene);
  drawNpc(scene, TextureKeys.Mara, 0x7d3e35, 0x3d434c, 'smith');
  drawNpc(scene, TextureKeys.Orin, 0x4d7041, 0xb78b55, 'stockkeeper');
  drawNpc(scene, TextureKeys.Tavi, 0x405f89, 0xd0a23b, 'trader');
}

/** Distinct 16×20 service silhouettes with small role-readable props. */
function drawNpc(
  scene: Phaser.Scene,
  key: string,
  coat: number,
  accent: number,
  role: 'smith' | 'stockkeeper' | 'trader',
): void {
  withGraphics(scene, key, (g) => {
    g.fillStyle(0x000000, 0.25).fillEllipse(8, 19, 12, 3);
    g.fillStyle(coat, 1).fillRoundedRect(3, 8, 10, 10, 2);
    g.fillStyle(accent, 1).fillRect(4, 10, 8, 3);
    g.fillStyle(0xd9a066, 1).fillCircle(8, 6, 3);
    g.fillStyle(0x3b2a22, 1).fillRect(5, 2, 6, 2);
    if (role === 'smith') {
      g.fillStyle(0xaeb4bb, 1).fillRect(12, 7, 2, 8);
      g.fillRect(10, 7, 5, 2);
    } else if (role === 'stockkeeper') {
      g.fillStyle(0x7b5634, 1).fillRect(1, 8, 2, 10);
      g.fillStyle(0xc7c979, 1).fillTriangle(0, 8, 4, 8, 2, 4);
    } else {
      g.fillStyle(0xc9a227, 1).fillCircle(13, 12, 2);
      g.fillStyle(0x5c4029, 1).fillRect(1, 12, 4, 5);
    }
  }, S, 20);
}

/**
 * Garden Bed: a low bordered soil row, 2×1 tiles. The growing variant shows
 * small green shoots; the ready variant swaps in tall pale-gold fiber tufts so
 * a harvestable bed reads at a glance.
 */
function drawGardenBed(scene: Phaser.Scene): void {
  const base = (g: Phaser.GameObjects.Graphics) => {
    // Wooden border
    g.fillStyle(0x6b4a2b, 1).fillRoundedRect(0, 1, 32, 14, 2);
    // Tilled soil rows
    g.fillStyle(0x3d2c1c, 1).fillRoundedRect(2, 3, 28, 10, 1);
    g.fillStyle(0x4d3826, 1);
    for (const x of [4, 10, 16, 22, 27] as const) g.fillRect(x, 5, 2, 6);
  };
  withGraphics(
    scene,
    TextureKeys.GardenBed,
    (g) => {
      base(g);
      // Young shoots
      g.fillStyle(0x3c8657, 1);
      for (const x of [5, 11, 17, 23] as const) g.fillRect(x, 7, 1, 3);
    },
    S * 2,
    S,
  );
  withGraphics(
    scene,
    TextureKeys.GardenBedReady,
    (g) => {
      base(g);
      // Tall fiber tufts, pale gold over green
      g.fillStyle(0x86bd5f, 1);
      for (const x of [4, 10, 16, 22, 27] as const) g.fillRect(x, 4, 2, 8);
      g.fillStyle(0xd8cf7a, 1);
      for (const x of [4, 10, 16, 22, 27] as const) g.fillRect(x, 3, 2, 4);
    },
    S * 2,
    S,
  );
}

/** Tuftle: a shy, round grassland grazer with a leaf-like tuft. */
function drawTuftle(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Tuftle, (g) => {
    g.fillStyle(0x000000, 0.24).fillEllipse(8, 14, 11, 3);
    g.fillStyle(0xc99b72, 1).fillEllipse(8, 9, 11, 9);
    g.fillStyle(0xe6bd8d, 1).fillEllipse(7, 8, 7, 5);
    g.fillStyle(0x315f36, 1).fillTriangle(8, 4, 5, 1, 10, 3);
    g.fillStyle(0x33251e, 1).fillRect(10, 8, 1, 1);
    g.fillStyle(0x8a6238, 1).fillRect(4, 12, 2, 2);
    g.fillRect(10, 12, 2, 2);
  });
}

/** Craghopper: a squat slate-blue hopper with a bright mineral crest. */
function drawCraghopper(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Craghopper, (g) => {
    g.fillStyle(0x000000, 0.24).fillEllipse(8, 14, 13, 3);
    g.fillStyle(0x59677a, 1).fillEllipse(8, 9, 12, 9);
    g.fillStyle(0x7f91a6, 1).fillTriangle(4, 8, 7, 3, 9, 8);
    g.fillStyle(0x9fc4c7, 1).fillTriangle(8, 6, 11, 2, 12, 8);
    g.fillStyle(0xd8b85d, 1).fillRect(5, 11, 3, 2);
    g.fillRect(10, 11, 4, 2);
    g.fillStyle(0x202833, 1).fillRect(5, 8, 1, 1);
  });
}

/** Glade Stag: a pale forest runner with a readable antler silhouette. */
function drawGladeStag(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.GladeStag, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(8, 14, 13, 3);
    g.fillStyle(0xb88b62, 1).fillEllipse(8, 9, 10, 8);
    g.fillStyle(0xd7b184, 1).fillEllipse(10, 6, 6, 6);
    g.lineStyle(1, 0xe1cfaa, 1);
    g.lineBetween(9, 4, 7, 1); g.lineBetween(7, 2, 5, 1);
    g.lineBetween(12, 4, 14, 1); g.lineBetween(14, 2, 15, 1);
    g.fillStyle(0x3b2c24, 1).fillRect(11, 6, 1, 1);
    g.fillStyle(0x6f513b, 1).fillRect(5, 11, 2, 3);
    g.fillRect(10, 11, 2, 3);
  });
}

/** Snarlfox: a sharp rust-red forest hunter with a dark mask and tail. */
function drawSnarlfox(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Snarlfox, (g) => {
    g.fillStyle(0x000000, 0.24).fillEllipse(8, 14, 14, 3);
    g.fillStyle(0xa94f38, 1).fillEllipse(8, 9, 11, 8);
    g.fillTriangle(3, 7, 4, 2, 7, 6);
    g.fillTriangle(9, 6, 12, 2, 13, 8);
    g.fillStyle(0x4a2d32, 1).fillRect(4, 7, 8, 3);
    g.fillStyle(0xf0cf9b, 1).fillTriangle(7, 9, 9, 9, 8, 12);
    g.fillStyle(0xf1df9f, 1).fillRect(5, 8, 1, 1);
    g.fillRect(10, 8, 1, 1);
    g.fillStyle(0x7d382d, 1).fillEllipse(13, 11, 6, 4);
  });
}

function withGraphics(
  scene: Phaser.Scene,
  key: string,
  draw: (g: Phaser.GameObjects.Graphics) => void,
  width = S,
  height = S,
): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, width, height);
  g.destroy();
}

/** A grass tile with a few static detail pixels so tiling reads as ground. */
function drawGround(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Ground, (g) => {
    g.fillStyle(0x2e5b3a, 1).fillRect(0, 0, S, S);
    g.fillStyle(0x356545, 1);
    for (const [x, y] of [
      [2, 3],
      [9, 2],
      [5, 8],
      [12, 11],
      [7, 13],
      [1, 12],
    ] as const) {
      g.fillRect(x, y, 1, 1);
    }
    g.fillStyle(0x274d31, 1);
    for (const [x, y] of [
      [4, 5],
      [11, 6],
      [8, 10],
      [3, 14],
      [14, 3],
    ] as const) {
      g.fillRect(x, y, 1, 1);
    }
  });
}

/** Top-down figure: distinct rounded body + head, readable at 2× on a phone. */
function drawPlayer(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Player, (g) => {
    // Shadow
    g.fillStyle(0x000000, 0.25).fillEllipse(8, 15, 10, 3);
    // Tunic body
    g.fillStyle(0x2f6b43, 1).fillRoundedRect(4, 7, 8, 7, 2);
    g.fillStyle(0x3c8657, 1).fillRect(5, 8, 6, 2);
    // Head
    g.fillStyle(0xd9a066, 1).fillCircle(8, 5, 3);
    // Hair
    g.fillStyle(0x5a3a2a, 1).fillRect(5, 2, 6, 2);
  });
}

function drawTree(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Tree, (g) => {
    g.fillStyle(0x000000, 0.25).fillEllipse(8, 15, 11, 3);
    g.fillStyle(0x6b4a2b, 1).fillRect(7, 9, 2, 6);
    g.fillStyle(0x255834, 1).fillCircle(8, 6, 6);
    g.fillStyle(0x2f6b3f, 1).fillCircle(8, 5, 4);
    g.fillStyle(0x3c8657, 1).fillCircle(6, 4, 2);
  });
}

function drawRock(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Rock, (g) => {
    g.fillStyle(0x000000, 0.25).fillEllipse(8, 14, 11, 3);
    g.fillStyle(0x6a6f78, 1).fillRoundedRect(3, 6, 10, 8, 3);
    g.fillStyle(0x8a8f98, 1).fillRoundedRect(4, 6, 7, 4, 2);
    g.fillStyle(0x565b63, 1).fillRect(6, 11, 4, 1);
  });
}

/** Harvestable flax-like plant, deliberately distinct from the ground texture. */
function drawPlant(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Plant, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 14, 10, 3);
    g.fillStyle(0x255834, 1);
    g.fillRect(7, 5, 2, 9);
    g.fillRect(4, 8, 2, 6);
    g.fillRect(10, 7, 2, 7);
    g.fillStyle(0x65a84a, 1);
    g.fillTriangle(8, 4, 4, 9, 7, 10);
    g.fillTriangle(8, 5, 12, 8, 9, 10);
    g.fillTriangle(5, 7, 2, 11, 6, 11);
    g.fillTriangle(11, 7, 14, 11, 10, 11);
  });
}

/** Felled tree remains: a low ringed trunk so depleted trees stay legible. */
function drawStump(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Stump, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 14, 9, 3);
    g.fillStyle(0x6b4a2b, 1).fillRect(5, 9, 6, 5);
    g.fillStyle(0x8a6238, 1).fillEllipse(8, 9, 6, 4);
    g.fillStyle(0x6b4a2b, 1).fillEllipse(8, 9, 3, 2);
  });
}

/** Mined-out stone: a scatter of low pebbles. */
function drawRubble(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Rubble, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 14, 10, 3);
    g.fillStyle(0x6a6f78, 1).fillRoundedRect(4, 10, 4, 3, 1);
    g.fillStyle(0x7d828b, 1).fillRoundedRect(9, 11, 3, 2, 1);
    g.fillStyle(0x565b63, 1).fillRoundedRect(7, 8, 3, 3, 1);
  });
}

/** Cut stalks remain after a plant is harvested. */
function drawPlantRemains(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.PlantRemains, (g) => {
    g.fillStyle(0x000000, 0.16).fillEllipse(8, 14, 10, 2);
    g.fillStyle(0x7b7f42, 1);
    g.fillRect(4, 11, 2, 3);
    g.fillRect(7, 10, 2, 4);
    g.fillRect(10, 11, 2, 3);
  });
}

/** Ground drop: a small bundle of logs awaiting pickup. */
function drawDropWood(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropWood, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 9, 3);
    g.fillStyle(0x6b4a2b, 1).fillRoundedRect(3, 9, 10, 3, 1);
    g.fillStyle(0x8a6238, 1).fillRoundedRect(4, 6, 10, 3, 1);
    g.fillStyle(0xd9a066, 1).fillRect(12, 6, 2, 3);
    g.fillStyle(0xd9a066, 1).fillRect(3, 9, 2, 3);
  });
}

/** Ground drop: a chunk of quarried stone. */
function drawDropStone(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropStone, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 9, 3);
    g.fillStyle(0x6a6f78, 1).fillRoundedRect(4, 6, 8, 7, 2);
    g.fillStyle(0x8a8f98, 1).fillRoundedRect(5, 6, 5, 3, 1);
    g.fillStyle(0x565b63, 1).fillRect(6, 11, 4, 1);
  });
}

/** Ground drop: a tied bundle of plant fiber. */
function drawDropFiber(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropFiber, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 10, 3);
    g.lineStyle(2, 0xc7c979, 1);
    g.lineBetween(4, 7, 11, 12);
    g.lineBetween(6, 6, 13, 11);
    g.lineBetween(3, 9, 10, 13);
    g.fillStyle(0x8a6238, 1).fillRect(7, 9, 4, 2);
  });
}

/** Palisade wall segment: upright planks with lashed caps, tile-tileable. */
function drawWall(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Wall, (g) => {
    g.fillStyle(0x000000, 0.25).fillRect(1, 13, 14, 2);
    g.fillStyle(0x6b4a2b, 1).fillRect(1, 2, 4, 12);
    g.fillStyle(0x7d5732, 1).fillRect(6, 2, 4, 12);
    g.fillStyle(0x6b4a2b, 1).fillRect(11, 2, 4, 12);
    g.fillStyle(0x8a6238, 1);
    g.fillRect(1, 1, 4, 2);
    g.fillRect(6, 0, 4, 2);
    g.fillRect(11, 1, 4, 2);
    g.fillStyle(0x4d3520, 1).fillRect(1, 6, 14, 1);
    g.fillRect(1, 10, 14, 1);
  });
}

/** Field Cache: a strapped storage crate. */
function drawFieldCache(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.FieldCache, (g) => {
    g.fillStyle(0x000000, 0.25).fillEllipse(8, 14, 12, 3);
    g.fillStyle(0x6b4a2b, 1).fillRoundedRect(2, 4, 12, 10, 2);
    g.fillStyle(0x8a6238, 1).fillRoundedRect(3, 5, 10, 4, 1);
    g.fillStyle(0x4d3520, 1).fillRect(2, 9, 12, 1);
    g.fillStyle(0xc9a227, 1).fillRect(7, 4, 2, 10);
  });
}

/** Workbench: a two-tile-wide work table with a saw slot and vice block. */
function drawWorkbench(scene: Phaser.Scene): void {
  withGraphics(
    scene,
    TextureKeys.Workbench,
    (g) => {
      g.fillStyle(0x000000, 0.25).fillRect(2, 13, 28, 2);
      // Legs
      g.fillStyle(0x4d3520, 1);
      g.fillRect(3, 8, 2, 6);
      g.fillRect(27, 8, 2, 6);
      // Tabletop
      g.fillStyle(0x8a6238, 1).fillRoundedRect(1, 3, 30, 6, 1);
      g.fillStyle(0x7d5732, 1).fillRect(1, 6, 30, 3);
      // Vice block + saw line
      g.fillStyle(0x565b63, 1).fillRect(24, 1, 4, 4);
      g.fillStyle(0xd9d9d9, 1).fillRect(6, 4, 10, 1);
    },
    S * 2,
    S,
  );
}

/** Woodlot Planter: a bordered soil bed with sprouting saplings, 2×2 tiles. */
function drawPlanter(scene: Phaser.Scene): void {
  const base = (g: Phaser.GameObjects.Graphics) => {
      // Wooden border
      g.fillStyle(0x6b4a2b, 1).fillRoundedRect(0, 2, 32, 30, 3);
      // Soil bed
      g.fillStyle(0x3d2c1c, 1).fillRoundedRect(3, 5, 26, 24, 2);
      g.fillStyle(0x4d3826, 1);
      for (const [x, y] of [
        [6, 8],
        [14, 12],
        [22, 9],
        [9, 20],
        [19, 23],
        [25, 18],
      ] as const) {
        g.fillRect(x, y, 2, 2);
      }
  };
  withGraphics(
    scene,
    TextureKeys.Planter,
    (g) => {
      base(g);
      // Saplings
      g.fillStyle(0x2f6b3f, 1);
      g.fillRect(8, 9, 2, 4);
      g.fillRect(21, 20, 2, 4);
      g.fillStyle(0x3c8657, 1);
      g.fillRect(7, 8, 4, 2);
      g.fillRect(20, 19, 4, 2);
    },
    S * 2,
    S * 2,
  );
  withGraphics(
    scene,
    TextureKeys.PlanterReady,
    (g) => {
      base(g);
      // Mature coppiced trees make the ready state readable without color.
      for (const [x, y] of [[9, 9], [22, 19]] as const) {
        g.fillStyle(0x704726, 1).fillRect(x - 1, y + 5, 3, 9);
        g.fillStyle(0x285b38, 1).fillCircle(x, y + 3, 6);
        g.fillStyle(0x3f8050, 1).fillCircle(x - 3, y + 1, 3);
      }
    },
    S * 2,
    S * 2,
  );
}
