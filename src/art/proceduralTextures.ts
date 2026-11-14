import Phaser from 'phaser';
import { TILE_SIZE } from '../config/platform';
import { TOWN_BUILDINGS, type TownBuildingDefinition } from '../content/townBuildings';
import { WALL_VISUAL_THICKNESS } from './buildingTextures';
import { generateInteriorTextures, interiorTextureKeys } from './interiorTextures';
import { TextureKeys, townBuildingTextureKey } from './textureKeys';

export { TextureKeys, creatureTextureKey, townBuildingTextureKey } from './textureKeys';

/**
 * Generate local pixel textures at their category contract: 16px tiles/drops,
 * 24×32 resources/player frames, 32×32 creatures, and footprint-sized
 * facilities. Silhouettes and palettes stay distinct at phone zoom, and the
 * complete set can be regenerated after WebGL context loss.
 */
const S = TILE_SIZE;

export function generateWorldTextures(scene: Phaser.Scene): void {
  const keys = [
    ...Object.values(TextureKeys).filter((key) => key !== TextureKeys.BattleGrassland
      && key !== TextureKeys.BattleHills
      && key !== TextureKeys.BattleForest),
    ...TOWN_BUILDINGS.map((building) => townBuildingTextureKey(building.id)),
    ...interiorTextureKeys(),
  ];
  // These textures are global and area-independent. Reuse the complete set
  // across area swaps; only a partial set (for example after context loss)
  // needs to be regenerated.
  if (keys.every((key) => scene.textures.exists(key))) return;
  for (const key of keys) {
    if (scene.textures.exists(key)) scene.textures.remove(key);
  }

  drawGround(scene);
  drawTerrainVariants(scene);
  drawPlayer(scene);
  drawTree(scene);
  drawTree(scene, true);
  drawRock(scene);
  drawRock(scene, true);
  drawIronVein(scene);
  drawIronRubble(scene);
  drawPlant(scene);
  drawBerryBush(scene);
  drawStump(scene);
  drawRubble(scene);
  drawPlantRemains(scene);
  drawBerryRemains(scene);
  drawDropWood(scene);
  drawDropStone(scene);
  drawDropFiber(scene);
  drawDropIronOre(scene);
  drawDropIronIngot(scene);
  drawDropTamingSnare(scene);
  drawDropReinforcedSnare(scene);
  drawDropBerry(scene);
  drawDropArrow(scene);
  drawDropClothMask(scene);
  drawDropSafeguardCharm(scene);
  drawDropTool(scene);
  drawDropTrophies(scene);
  drawWorldContainers(scene);
  drawWall(scene);
  drawBuildingParts(scene);
  drawFieldCache(scene);
  drawWorkbench(scene);
  drawFurnace(scene);
  drawBed(scene);
  drawAirPurifier(scene);
  drawPlanter(scene);
  drawGardenBed(scene);
  drawWarTable(scene);
  drawTurret(scene);
  drawRaiders(scene);
  drawTownProps(scene);
  drawTuftle(scene);
  drawCraghopper(scene);
  drawGladeStag(scene);
  drawSnarlfox(scene);
  drawDefenceRoster(scene);
  for (const building of TOWN_BUILDINGS) drawTownBuilding(scene, building);
  // Interiors share this pass so a room's floors, props, and townsfolk are
  // regenerated with the world after a WebGL context loss.
  generateInteriorTextures(scene);
}

/** Distinct 16×20 service silhouettes with small role-readable props. */
function drawTownBuilding(scene: Phaser.Scene, building: TownBuildingDefinition): void {
  const width = building.footprint.tilesWide * S;
  const height = building.footprint.tilesHigh * S;
  const doorX = (building.door.tileX - building.footprint.tileX) * S;
  const doorY = (building.door.tileY - building.footprint.tileY) * S;
  const doorPixelWidth = building.doorWidth * S;
  const theme = building.interiorTheme;
  withGraphics(scene, townBuildingTextureKey(building.id), (g) => {
    g.fillStyle(0x000000, 0.28).fillRoundedRect(3, 6, width - 3, height - 3, 5);
    g.fillStyle(theme.exteriorWall, 1).fillRoundedRect(2, 12, width - 4, height - 14, 3);
    g.fillStyle(theme.exteriorRoof, 1).fillTriangle(0, 22, width / 2, 1, width, 22);
    g.fillRect(4, 18, width - 8, 18);
    g.fillStyle(theme.exteriorAccent, 1).fillRect(8, 21, width - 16, 3);
    g.fillStyle(0x201814, 1).fillRect(doorX + 3, doorY + 1, doorPixelWidth - 6, S - 1);
    g.fillStyle(theme.exteriorAccent, 1).fillRect(doorX + 5, doorY + 3, doorPixelWidth - 10, S - 4);
    g.fillStyle(0xffe6a3, 1).fillCircle(doorX + doorPixelWidth - 5, doorY + 9, 1);

    if (theme.id === 'forge') {
      // Chunky stone chimney, soot-dark roof, lit forge window and anvil sign.
      g.fillStyle(0x24292b, 1).fillRect(width - 24, 2, 12, 29);
      g.fillStyle(0x697375, 1).fillRect(width - 22, 3, 8, 4);
      g.fillStyle(0x17231c, 0.72).fillEllipse(width - 18, 29, 28, 10);
      g.fillStyle(0x53251b, 1).fillRect(10, 41, 18, 15);
      g.fillStyle(0xd66a32, 1).fillRect(13, 44, 12, 9);
      g.fillStyle(0xfff0a6, 1).fillRect(15, 45, 5, 5);
      g.fillStyle(0x24292b, 1).fillTriangle(35, 52, 47, 44, 60, 52);
      g.fillRect(42, 52, 12, 6);
      g.fillStyle(0xcbd0c6, 1).fillRect(69, 42, 3, 18);
      g.fillStyle(0x513a29, 1).fillRect(65, 47, 11, 3);
      // Stone foundation keeps the facade materially distinct from the barn.
      for (let x = 3; x < width - 3; x += 13) {
        if (x > doorX - 10 && x < doorX + doorPixelWidth) continue;
        g.fillStyle(x % 2 === 0 ? 0x697375 : 0x454e50, 1).fillRect(x, height - 10, 11, 7);
      }
    } else if (theme.id === 'barn') {
      // Tall central ridge, loft vent, timber framing and stacked hay make the
      // farm readable before its text label does.
      g.lineStyle(4, theme.exteriorAccent, 1).lineBetween(width / 2, 4, width / 2, 36);
      g.lineBetween(12, 22, width - 12, 22);
      g.fillStyle(0x33251c, 1).fillRect(width / 2 - 6, 12, 12, 9);
      g.fillStyle(0xe5cf82, 1).fillRect(width / 2 - 3, 14, 6, 5);
      g.fillStyle(0x6b3a2f, 1);
      for (let x = 12; x < width - 10; x += 14) g.fillRect(x, 37, 2, height - 42);
      g.lineStyle(3, theme.exteriorAccent, 1);
      g.lineBetween(doorX + 3, doorY + 3, doorX + doorPixelWidth - 3, doorY + S - 3);
      g.lineBetween(doorX + doorPixelWidth - 3, doorY + 3, doorX + 3, doorY + S - 3);
      g.fillStyle(0xd7bf73, 1);
      for (const x of [10, 18, width - 22, width - 14]) g.fillRect(x, height - 24, 7, 11);
      g.fillStyle(0x8e7135, 1);
      for (const x of [12, 20, width - 20, width - 12]) g.fillRect(x, height - 22, 1, 7);
    } else if (theme.id === 'market') {
      // The market is an open pavilion: a central north-facing aisle divides
      // two striped stalls, with pennants and produce visible at phone scale.
      g.fillStyle(0x1c2730, 1).fillRect(doorX + 1, 0, doorPixelWidth - 2, 58);
      g.fillStyle(0xb88848, 1).fillRect(doorX + 4, 5, doorPixelWidth - 8, 53);
      g.fillStyle(0x24313a, 1).fillRect(doorX + 6, 5, doorPixelWidth - 12, 53);
      for (let x = 8; x < width - 8; x += 12) {
        if (x > doorX - 8 && x < doorX + doorPixelWidth) continue;
        const stripe = Math.floor(x / 12) % 2 === 0 ? theme.exteriorAccent : 0xece5d2;
        g.fillStyle(stripe, 1).fillRect(x, 35, 11, 10);
        g.fillTriangle(x, 45, x + 5, 50, x + 11, 45);
      }
      g.fillStyle(0x2b2119, 1).fillRect(7, 48, 33, 13).fillRect(width - 40, 48, 33, 13);
      g.fillStyle(0x6a482e, 1).fillRect(8, 54, 32, 8).fillRect(width - 40, 54, 32, 8);
      g.fillStyle(0xc95845, 1).fillCircle(16, 53, 3).fillCircle(width - 17, 53, 3);
      g.fillStyle(0x77a750, 1).fillCircle(24, 52, 3).fillCircle(width - 25, 52, 3);
      g.lineStyle(1, 0xf1d172, 1).lineBetween(18, 25, width - 18, 25);
      for (let x = 24; x <= width - 24; x += 16) {
        g.fillStyle(x % 32 === 8 ? 0xd45f4c : 0xf0c85b, 1).fillTriangle(x, 26, x + 7, 26, x + 3, 33);
      }
    } else if (theme.id === 'church') {
      g.fillStyle(0x8eb8e8, 1).fillCircle(width / 2, 33, 9);
      g.fillStyle(0xf3d98b, 1).fillRect(width / 2 - 2, 25, 4, 17).fillRect(width / 2 - 7, 30, 14, 4);
      g.lineStyle(2, 0x776f65, 1);
      for (let x = 12; x < width - 12; x += 18) g.strokeRect(x, height - 33, 10, 17);
    } else if (theme.id === 'armoury') {
      g.fillStyle(0x3a474b, 1).fillCircle(width / 2, 45, 14);
      g.fillStyle(0xc8d1d1, 1).fillTriangle(width / 2, 34, width / 2 - 10, 40, width / 2, 59);
      g.fillTriangle(width / 2, 34, width / 2 + 10, 40, width / 2, 59);
      g.lineStyle(3, 0x9aa9a8, 1).lineBetween(12, 35, 29, 58).lineBetween(29, 35, 12, 58);
    } else if (theme.id === 'arcane') {
      g.fillStyle(0x6cd7e8, 0.9).fillCircle(width / 2, 43, 12);
      g.fillStyle(0xefe2ff, 1).fillCircle(width / 2 - 3, 39, 3);
      g.lineStyle(2, 0xd8a8ff, 1).strokeCircle(width / 2, 43, 17);
      for (const [x, y] of [[15, 37], [27, 53], [width - 18, 39], [width - 31, 55]] as const) {
        g.fillStyle(0xd8a8ff, 1).fillCircle(x, y, 2);
      }
    } else if (theme.id === 'tavern') {
      g.fillStyle(0x4c2d20, 1).fillRect(11, 37, 27, 20).fillRect(width - 38, 37, 27, 20);
      g.fillStyle(0xffd27a, 1).fillRect(15, 41, 19, 12).fillRect(width - 34, 41, 19, 12);
      g.fillStyle(0x593b28, 1).fillCircle(width - 14, 27, 9);
      g.fillStyle(0xe5b76b, 1).fillRect(width - 17, 21, 6, 11).fillRect(width - 20, 29, 12, 3);
    } else if (theme.id === 'arena') {
      g.fillStyle(0x72513b, 1);
      for (let x = 12; x < width - 12; x += 24) g.fillRect(x, 35, 7, height - 42);
      g.fillStyle(0xcf9f4d, 1).fillRect(8, 33, width - 16, 5);
      g.fillStyle(0xb84232, 1).fillTriangle(25, 40, 39, 40, 32, 58).fillTriangle(width - 39, 40, width - 25, 40, width - 32, 58);
    }
  }, width, height);
}

/** Reusable town dressing. These stay decorative and never alter collision. */
function drawTownProps(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.TownAnvil, (g) => {
    g.fillStyle(0x000000, 0.24).fillEllipse(8, 14, 13, 3);
    g.fillStyle(0x31373a, 1).fillRect(4, 7, 9, 4);
    g.fillTriangle(1, 7, 7, 4, 14, 7);
    g.fillStyle(0x737b7e, 1).fillRect(4, 5, 9, 2);
    g.fillStyle(0x454b4e, 1).fillRect(7, 10, 3, 4);
  });

  withGraphics(scene, TextureKeys.TownHayBale, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 14, 14, 3);
    g.fillStyle(0xa97d32, 1).fillRoundedRect(1, 4, 14, 10, 2);
    g.fillStyle(0xd9bd61, 1).fillRoundedRect(2, 4, 12, 8, 1);
    g.fillStyle(0x8c6a2d, 1).fillRect(5, 4, 2, 9).fillRect(11, 4, 1, 9);
    g.fillStyle(0xf1d77a, 1).fillRect(3, 6, 3, 1).fillRect(8, 9, 3, 1);
  });

  withGraphics(scene, TextureKeys.TownProduceCrate, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(8, 14, 14, 3);
    g.fillStyle(0x4b3321, 1).fillRect(1, 6, 14, 8);
    g.fillStyle(0x8b5d31, 1).fillRect(2, 8, 12, 5);
    g.fillStyle(0xc94f43, 1).fillCircle(5, 7, 3).fillCircle(11, 7, 3);
    g.fillStyle(0x78a64e, 1).fillCircle(8, 6, 3);
    g.fillStyle(0xc69a4b, 1).fillRect(1, 9, 14, 2);
  });

  withGraphics(scene, TextureKeys.TownBarrel, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(8, 14, 12, 3);
    g.fillStyle(0x573b27, 1).fillRoundedRect(3, 2, 10, 12, 3);
    g.fillStyle(0x8b5d35, 1).fillRoundedRect(4, 3, 8, 10, 2);
    g.fillStyle(0x303538, 1).fillRect(3, 5, 10, 2).fillRect(3, 10, 10, 2);
    g.fillStyle(0xb17a43, 1).fillRect(6, 3, 2, 9);
  });
}

/**
 * Garden Bed: a low bordered soil row, 2×1 tiles. The growing variant shows
 * small green shoots; the ready variant plants the fiber node's own motif so a
 * matured bed looks like the resource it yields.
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
      // Freshly planted: seed dimples, no visible crop yet.
      g.fillStyle(0x2b2119, 1);
      for (const x of [5, 11, 17, 23, 28] as const) g.fillRect(x, 7, 1, 1);
    },
    S * 2,
    S,
  );
  withGraphics(
    scene,
    TextureKeys.GardenBedGrowing,
    (g) => {
      base(g);
      g.fillStyle(0x356246, 1);
      for (const x of [5, 11, 17, 23, 28] as const) g.fillRect(x, 6, 2, 6);
      g.fillStyle(0x78a365, 1);
      for (const x of [5, 11, 17, 23, 28] as const) g.fillTriangle(x + 1, 5, x - 1, 8, x + 1, 8);
    },
    S * 2,
    S,
  );
  withGraphics(
    scene,
    TextureKeys.GardenBedReady,
    (g) => {
      base(g);
      // Matured: the bed grows the fiber plant itself, so a ready bed reads as
      // the same harvestable silhouette as a wild fiber node.
      for (const originX of [2, 11, 20] as const) plantMotif(motifPen(g, originX, -1, 0.5));
    },
    S * 2,
    S,
  );
}

/** Two-tile sleeping bed: timber frame, pale pillow, and a blue wool blanket. */
function drawBed(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Bed, (g) => {
    g.fillStyle(0x000000, 0.24).fillEllipse(16, 14, 29, 4);
    g.fillStyle(0x4d3520, 1).fillRoundedRect(1, 2, 30, 13, 2);
    g.fillStyle(0x8a6238, 1).fillRect(2, 3, 28, 2).fillRect(2, 13, 28, 2);
    g.fillStyle(0xe9dfc7, 1).fillRoundedRect(4, 4, 8, 8, 2);
    g.fillStyle(0x41688a, 1).fillRoundedRect(12, 4, 17, 8, 1);
    g.fillStyle(0x7398b5, 1).fillRect(13, 5, 15, 2);
    g.fillStyle(0x29485f, 1).fillRect(12, 10, 17, 2);
    g.fillStyle(0xb88848, 1).fillRect(1, 1, 3, 14);
  }, S * 2, S);
}

/** Air Purifier: a single-tile steel column with a lit intake grille and vent plume. */
function drawAirPurifier(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.AirPurifier, (g) => {
    g.fillStyle(0x000000, 0.24).fillEllipse(8, 15, 13, 3);
    g.fillStyle(0x3c4550, 1).fillRoundedRect(3, 2, 10, 12, 2);
    g.fillStyle(0x5c6875, 1).fillRoundedRect(4, 3, 8, 10, 2);
    // Intake grille slats.
    g.fillStyle(0x22282f, 1);
    for (let y = 6; y < 12; y += 2) g.fillRect(5, y, 6, 1);
    // Status light and the clean-air plume rising from the top vent.
    g.fillStyle(0x7fe3b0, 1).fillRect(7, 4, 2, 2);
    g.fillStyle(0xa9e8ff, 0.6).fillRect(6, 0, 4, 2).fillRect(7, 1, 2, 2);
  }, S, S);
}

/** Tuftle: a shy, round grassland grazer with a leaf-like tuft. */
function drawTuftle(scene: Phaser.Scene): void {
  const frames = [
    [TextureKeys.Tuftle, 0, false], [TextureKeys.TuftleIdleA, 0, false],
    [TextureKeys.TuftleIdleB, -1, false], [TextureKeys.TuftleMoveA, 0, false],
    [TextureKeys.TuftleMoveB, 0, true], [TextureKeys.TuftleHurt, 1, true],
  ] as const;
  for (const [key, bob, step] of frames) withGraphics(scene, key, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(16, 28, step ? 19 : 21, 5);
    g.fillStyle(0x17231c, 1).fillEllipse(16, 18 + bob, 23, 19);
    g.fillStyle(0x397052, 1).fillEllipse(15, 17 + bob, 21, 18);
    g.fillStyle(0x5fb98a, 1).fillEllipse(13, 14 + bob, 15, 11);
    g.fillStyle(0x8dd0a2, 1).fillRect(8, 11 + bob, 8, 3);
    g.fillStyle(0x35643f, 1).fillTriangle(16, 9 + bob, 10, 3 + bob, 16, 5 + bob);
    g.fillStyle(0x4d8a55, 1).fillTriangle(16, 8 + bob, 22, 2 + bob, 20, 9 + bob);
    g.fillStyle(0x17231c, 1).fillRect(20, 15 + bob, 2, 2);
    g.fillStyle(0xf5ecd6, 1).fillRect(20, 15 + bob, 1, 1);
    g.fillStyle(0x294a37, 1).fillRect(step ? 7 : 9, 24 + bob, 5, 4);
    g.fillRect(step ? 20 : 18, 24 + bob, 5, 4);
  }, 32, 32);
}

/** Craghopper: a squat slate-blue hopper with a bright mineral crest. */
function drawCraghopper(scene: Phaser.Scene): void {
  const frames = [
    [TextureKeys.Craghopper, 0, 'rest'],
    [TextureKeys.CraghopperIdleA, 0, 'rest'],
    [TextureKeys.CraghopperIdleB, -1, 'rest'],
    [TextureKeys.CraghopperMoveA, 2, 'crouch'],
    [TextureKeys.CraghopperMoveB, -5, 'leap'],
    [TextureKeys.CraghopperHurt, 1, 'hurt'],
  ] as const;
  for (const [key, bob, pose] of frames) withGraphics(scene, key, (g) => {
    const airborne = pose === 'leap';
    const crestBob = Math.max(bob, -1);
    g.fillStyle(0x000000, airborne ? 0.14 : 0.24).fillEllipse(16, 29, airborne ? 14 : 23, airborne ? 3 : 5);
    // Spring-like hind legs create a different silhouette from every resource node.
    g.fillStyle(0x17231c, 1);
    if (airborne) {
      g.fillTriangle(7, 22 + bob, 2, 28 + bob, 13, 25 + bob);
      g.fillTriangle(25, 21 + bob, 30, 27 + bob, 20, 25 + bob);
    } else {
      g.fillTriangle(8, 21 + bob, 2, 28, 13, 27);
      g.fillTriangle(24, 21 + bob, 30, 28, 19, 27);
    }
    g.fillStyle(pose === 'hurt' ? 0x765054 : 0x454e50, 1).fillEllipse(16, 18 + bob, pose === 'crouch' ? 25 : 23, pose === 'crouch' ? 16 : 19);
    g.fillStyle(pose === 'hurt' ? 0xa86d69 : 0x697375, 1).fillEllipse(14, 15 + bob, 18, 12);
    g.fillStyle(0x929b96, 1).fillRect(8, 12 + bob, 13, 4);
    // Rust-gold crystal crest ties it to the hills without resembling an ore seam.
    g.fillStyle(0x8f4f32, 1).fillTriangle(10, 10 + crestBob, 13, 2 + crestBob, 16, 11 + crestBob);
    g.fillStyle(0xd08b54, 1).fillTriangle(15, 10 + crestBob, 19, 1 + crestBob, 21, 12 + crestBob);
    g.fillStyle(0xe6b85c, 1).fillTriangle(19, 11 + crestBob, 24, 5 + crestBob, 24, 14 + crestBob);
    g.fillStyle(0x17231c, 1).fillRect(7, 16 + bob, 3, 3);
    g.fillStyle(0xf5ecd6, 1).fillRect(7, 16 + bob, 1, 1);
    g.fillStyle(0xd0a466, 1).fillRect(11, 24 + bob, 5, 3).fillRect(19, 24 + bob, 5, 3);
    if (pose === 'hurt') g.fillStyle(0xf5ecd6, 1).fillRect(13, 17 + bob, 2, 1).fillRect(15, 18 + bob, 1, 2);
  }, 32, 32);
}

/** Glade Stag: a pale forest runner with a readable antler silhouette. */
function drawGladeStag(scene: Phaser.Scene): void {
  const frames = [
    [TextureKeys.GladeStag, 0, 'rest'],
    [TextureKeys.GladeStagIdleA, 0, 'rest'],
    [TextureKeys.GladeStagIdleB, -1, 'rest'],
    [TextureKeys.GladeStagMoveA, 0, 'stride-a'],
    [TextureKeys.GladeStagMoveB, -1, 'stride-b'],
    [TextureKeys.GladeStagHurt, 1, 'hurt'],
  ] as const;
  for (const [key, bob, pose] of frames) withGraphics(scene, key, (g) => {
    const moving = pose === 'stride-a' || pose === 'stride-b';
    g.fillStyle(0x000000, moving ? 0.17 : 0.23).fillEllipse(17, 29, moving ? 22 : 25, 4);

    // Slim legs and a lifted neck keep the stag separate from round grazers.
    g.fillStyle(pose === 'hurt' ? 0x68463a : 0x6f513b, 1);
    if (pose === 'stride-a') {
      g.fillRect(12, 22 + bob, 3, 7).fillRect(24, 21 + bob, 3, 5);
      g.fillRect(25, 26 + bob, 5, 2);
    } else if (pose === 'stride-b') {
      g.fillRect(11, 21 + bob, 3, 5).fillRect(22, 22 + bob, 3, 7);
      g.fillRect(7, 26 + bob, 5, 2);
    } else {
      g.fillRect(12, 22 + bob, 3, 7).fillRect(23, 22 + bob, 3, 7);
    }
    g.fillStyle(0x2b2119, 1).fillRect(11, 28, 4, 1).fillRect(22, 28, 4, 1);

    g.fillStyle(0x17231c, 1).fillEllipse(19, 19 + bob, 24, 13);
    g.fillStyle(pose === 'hurt' ? 0x8f6252 : 0xa9794a, 1).fillEllipse(19, 18 + bob, 22, 11);
    g.fillStyle(0xd0a466, 1).fillEllipse(15, 16 + bob, 12, 7);
    g.fillStyle(pose === 'hurt' ? 0x8f6252 : 0xa9794a, 1)
      .fillRect(8, 10 + bob, 6, 10)
      .fillEllipse(10, 10 + bob, 10, 8);
    g.fillStyle(0xf5ecd6, 1).fillRect(6, 9 + bob, 5, 4).fillRect(9, 13 + bob, 4, 5);
    g.fillStyle(0x17231c, 1).fillRect(6, 9 + bob, 2, 2);
    g.fillStyle(0xf5ecd6, 1).fillRect(6, 9 + bob, 1, 1);
    g.fillStyle(0x513a29, 1).fillTriangle(8, 7 + bob, 3, 5 + bob, 7, 10 + bob);

    // Wide branching antlers are the species signature at overworld scale.
    g.lineStyle(2, 0xd9c38f, 1);
    g.lineBetween(9, 7 + bob, 8, 2 + bob);
    g.lineBetween(8, 3 + bob, 4, 1 + bob);
    g.lineBetween(7, 4 + bob, 3, 5 + bob);
    g.lineBetween(11, 7 + bob, 13, 2 + bob);
    g.lineBetween(13, 3 + bob, 17, 1 + bob);
    g.lineBetween(13, 4 + bob, 17, 5 + bob);
    g.fillStyle(0x78a365, 1).fillRect(26, 15 + bob, 3, 2);
    if (pose === 'hurt') g.fillStyle(0xf5ecd6, 1).fillRect(18, 18 + bob, 2, 1).fillRect(20, 19 + bob, 1, 2);
  }, 32, 32);
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

/**
 * The homestead-defence roster, each a single static 16px pose.
 *
 * Deliberately not given the six-frame idle/move/hurt sets the founding four
 * carry: these read at a glance by silhouette and palette, and shipping five
 * half-animated sets would have been five times the art for a creature the
 * player mostly sees standing at a worksite. WorldScene plays no animation for
 * them, so a static key is exactly what it asks for.
 */
function drawDefenceRoster(scene: Phaser.Scene): void {
  // Masonmole: low, broad, slate digger with pale mortar-dusted claws.
  withGraphics(scene, TextureKeys.Masonmole, (g) => {
    g.fillStyle(0x000000, 0.24).fillEllipse(8, 14, 15, 3);
    g.fillStyle(0x6c6a74, 1).fillEllipse(8, 10, 13, 7);
    g.fillStyle(0x8d8a96, 1).fillEllipse(7, 9, 9, 4);
    g.fillStyle(0x4b4954, 1).fillRect(2, 8, 3, 4);
    g.fillStyle(0xe3ddcd, 1).fillRect(1, 11, 2, 1).fillRect(4, 12, 2, 1);
    g.fillStyle(0xf1df9f, 1).fillRect(5, 8, 1, 1);
  });
  // Bulwark Boar: heavy russet body, low head, one bright tusk.
  withGraphics(scene, TextureKeys.BulwarkBoar, (g) => {
    g.fillStyle(0x000000, 0.24).fillEllipse(8, 14, 15, 3);
    g.fillStyle(0x7b4b34, 1).fillEllipse(9, 8, 13, 8);
    g.fillStyle(0x9a6244, 1).fillEllipse(9, 7, 9, 4);
    g.fillStyle(0x5e3826, 1).fillRect(2, 8, 4, 4);
    g.fillStyle(0xf1ece0, 1).fillTriangle(2, 10, 1, 7, 3, 9);
    g.fillStyle(0x2b2119, 1).fillRect(5, 12, 2, 3).fillRect(11, 12, 2, 3);
    g.fillStyle(0xf1df9f, 1).fillRect(4, 8, 1, 1);
  });
  // Quillfinch: small, sand-gold, with a fan of quills off its back.
  withGraphics(scene, TextureKeys.Quillfinch, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 14, 10, 3);
    g.fillStyle(0xc9a95c, 1).fillEllipse(7, 9, 9, 7);
    g.fillStyle(0xe6d296, 1).fillEllipse(6, 8, 5, 4);
    g.lineStyle(1, 0xf1ece0, 1);
    g.lineBetween(10, 7, 14, 4);
    g.lineBetween(11, 9, 15, 7);
    g.lineBetween(11, 10, 15, 10);
    g.fillStyle(0xd98b3f, 1).fillTriangle(2, 8, 2, 10, 0, 9);
    g.fillStyle(0x20232a, 1).fillRect(4, 7, 1, 1);
  });
  // Mistmoth: pale blue-green with broad wings and a soft glow.
  withGraphics(scene, TextureKeys.Mistmoth, (g) => {
    g.fillStyle(0x000000, 0.16).fillEllipse(8, 14, 9, 3);
    g.fillStyle(0x7fc7cf, 0.55).fillEllipse(4, 7, 8, 9);
    g.fillStyle(0x7fc7cf, 0.55).fillEllipse(12, 7, 8, 9);
    g.fillStyle(0xa8d8e0, 1).fillEllipse(8, 9, 5, 8);
    g.fillStyle(0xe6f4f6, 1).fillEllipse(8, 6, 4, 3);
    g.fillStyle(0x20232a, 1).fillRect(7, 5, 1, 1).fillRect(9, 5, 1, 1);
    g.lineStyle(1, 0xe6f4f6, 0.8).lineBetween(7, 4, 5, 1).lineBetween(9, 4, 11, 1);
  });
  // Slingtail: lean, sand-coloured, with a long tail curled around a stone.
  withGraphics(scene, TextureKeys.Slingtail, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(8, 14, 13, 3);
    g.fillStyle(0xb9a074, 1).fillEllipse(7, 9, 11, 7);
    g.fillStyle(0xd8c79c, 1).fillEllipse(6, 8, 6, 4);
    g.lineStyle(2, 0x8f7a55, 1).lineBetween(12, 9, 15, 5);
    g.fillStyle(0x6d7b6a, 1).fillCircle(15, 4, 2);
    g.fillStyle(0x2b2119, 1).fillRect(4, 12, 2, 3).fillRect(9, 12, 2, 3);
    g.fillStyle(0xf1df9f, 1).fillRect(4, 7, 1, 1);
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

function drawTerrainVariants(scene: Phaser.Scene): void {
  const variants = [
    [TextureKeys.GroundQuietA, 0x36543b, [[3, 5], [12, 10]]],
    [TextureKeys.GroundQuietB, 0x395a3e, [[5, 12], [13, 3]]],
    [TextureKeys.GroundQuietC, 0x33513a, [[2, 9], [9, 4]]],
    [TextureKeys.ForestGround, 0x243f30, [[4, 4], [11, 13], [14, 7]]],
  ] as const;
  for (const [key, base, details] of variants) withGraphics(scene, key, (g) => {
    g.fillStyle(base, 1).fillRect(0, 0, S, S);
    g.fillStyle(key === TextureKeys.ForestGround ? 0x365845 : 0x557a45, 0.7);
    for (const [x, y] of details) g.fillRect(x, y, 1, 2);
  });
  withGraphics(scene, TextureKeys.Path, (g) => {
    g.fillStyle(0x76543a, 1).fillRect(0, 0, S, S);
    g.fillStyle(0x936847, 1).fillRect(0, 1, S, 2);
    g.fillStyle(0x5d432f, 1).fillRect(3, 7, 3, 1).fillRect(11, 12, 2, 2);
    g.fillStyle(0xb08454, 1).fillRect(8, 4, 2, 1);
  });
}

/** Top-down figure: distinct rounded body + head, readable at 2× on a phone. */
function drawPlayer(scene: Phaser.Scene): void {
  const frames = [
    [TextureKeys.Player, 'down', 0], [TextureKeys.PlayerIdleDown, 'down', 0],
    [TextureKeys.PlayerIdleUp, 'up', 0], [TextureKeys.PlayerIdleSide, 'side', 0],
    [TextureKeys.PlayerWalkDownA, 'down', -1], [TextureKeys.PlayerWalkDownB, 'down', 1],
    [TextureKeys.PlayerWalkUpA, 'up', -1], [TextureKeys.PlayerWalkUpB, 'up', 1],
    [TextureKeys.PlayerWalkSideA, 'side', -1], [TextureKeys.PlayerWalkSideB, 'side', 1],
    [TextureKeys.PlayerGather, 'gather', 0],
  ] as const;
  for (const [key, facing, step] of frames) withGraphics(scene, key, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(12, 29, 14, 4);
    g.fillStyle(0x2b2119, 1).fillRect(7 + Math.min(0, step), 25, 4, 4);
    g.fillRect(13 + Math.max(0, step), 25, 4, 4);
    g.fillStyle(0x17231c, 1).fillRoundedRect(5, 12, 14, 15, 3);
    g.fillStyle(0x36543b, 1).fillRoundedRect(6, 12, 12, 13, 2);
    g.fillStyle(0x557a45, 1).fillRect(7, 13, 10, 4);
    g.fillStyle(0xd5ae58, 1).fillRect(6, 20, 12, 2);
    g.fillStyle(0x17231c, 1).fillCircle(12, 9, 7);
    g.fillStyle(0xd0a466, 1).fillCircle(12, 9, 5);
    g.fillStyle(0x513a29, 1).fillRect(7, 4, 10, 4);
    if (facing === 'down' || facing === 'gather') g.fillStyle(0x17231c, 1).fillRect(9, 9, 1, 1).fillRect(14, 9, 1, 1);
    else if (facing === 'side') g.fillStyle(0x17231c, 1).fillRect(15, 9, 1, 1);
    else g.fillStyle(0x513a29, 1).fillRect(7, 8, 10, 4);
    if (facing === 'gather') {
      g.fillStyle(0xd0a466, 1).fillRect(18, 14, 3, 8);
      g.fillStyle(0xcbd0c6, 1).fillTriangle(18, 10, 23, 7, 22, 14);
    }
  }, 24, 32);
}

/**
 * Placed/scaled draw surface for a resource motif. A matured facility shows the
 * same silhouette as the world node it yields, so each motif has one definition
 * drawn in the node's own 24×32 coordinates and re-anchored per use.
 */
interface MotifPen {
  fill(color: number, alpha?: number): MotifPen;
  rect(x: number, y: number, width: number, height: number): MotifPen;
  circle(x: number, y: number, radius: number): MotifPen;
  ellipse(x: number, y: number, width: number, height: number): MotifPen;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): MotifPen;
}

function motifPen(g: Phaser.GameObjects.Graphics, originX = 0, originY = 0, scale = 1): MotifPen {
  // Round in draw space, and never let a detail scale away to nothing.
  const t = (value: number) => Math.max(1, Math.round(value * scale));
  const px = (x: number) => originX + Math.round(x * scale);
  const py = (y: number) => originY + Math.round(y * scale);
  const pen: MotifPen = {
    fill(color, alpha = 1) { g.fillStyle(color, alpha); return pen; },
    rect(x, y, width, height) { g.fillRect(px(x), py(y), t(width), t(height)); return pen; },
    circle(x, y, radius) { g.fillCircle(px(x), py(y), t(radius)); return pen; },
    ellipse(x, y, width, height) { g.fillEllipse(px(x), py(y), t(width), t(height)); return pen; },
    triangle(x1, y1, x2, y2, x3, y3) {
      g.fillTriangle(px(x1), py(y1), px(x2), py(y2), px(x3), py(y3));
      return pen;
    },
  };
  return pen;
}

/** Broadleaf tree silhouette — the wood node, and what a matured planter grows. */
function treeMotif(p: MotifPen, alternate = false): void {
  p.fill(0x000000, 0.24).ellipse(12, 30, 18, 4);
  p.fill(0x2b2119).rect(10, 18, 5, 11);
  p.fill(0x7a5435).rect(10, 17, 3, 11);
  p.fill(0x17231c).circle(12, alternate ? 13 : 12, 11);
  p.fill(0x244331).circle(alternate ? 9 : 12, 13, 9);
  p.fill(0x356246).circle(alternate ? 15 : 9, alternate ? 9 : 10, 7);
  p.fill(0x4e7955).circle(alternate ? 8 : 14, 7, 4);
}

/** Flax-like fiber plant — the fiber node, and what a matured garden bed grows. */
function plantMotif(p: MotifPen): void {
  p.fill(0x000000, 0.2).ellipse(12, 29, 15, 3);
  p.fill(0x244331).rect(11, 10, 2, 18).rect(7, 15, 2, 13).rect(15, 14, 2, 14);
  p.fill(0x4e7955)
    .triangle(12, 9, 6, 16, 11, 18).triangle(12, 11, 19, 16, 13, 19)
    .triangle(8, 14, 3, 21, 9, 20).triangle(16, 13, 21, 20, 15, 20);
  p.fill(0xd8cf7a).rect(10, 7, 4, 3).rect(6, 12, 3, 3).rect(15, 11, 3, 3);
  p.fill(0xf1e2a0).rect(11, 7, 2, 1).rect(7, 12, 1, 1);
}

function drawTree(scene: Phaser.Scene, alternate = false): void {
  withGraphics(scene, alternate ? TextureKeys.TreeAlt : TextureKeys.Tree, (g) => {
    treeMotif(motifPen(g), alternate);
  }, 24, 32);
}

function drawRock(scene: Phaser.Scene, alternate = false): void {
  withGraphics(scene, alternate ? TextureKeys.RockAlt : TextureKeys.Rock, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(12, 29, 18, 4);
    // The dark foot overlaps the shadow by a pixel so the stone feels planted.
    g.fillStyle(0x24292b, 1).fillRect(4, 25, 18, 4);
    g.fillTriangle(3, 28, alternate ? 10 : 7, 11, 22, 28);
    g.fillStyle(0x697375, 1).fillTriangle(4, 27, alternate ? 11 : 8, 12, 20, 27);
    g.fillStyle(0x929b96, 1).fillTriangle(8, 20, alternate ? 11 : 8, 12, 15, 18);
    g.fillStyle(0x454e50, 1).fillRect(11, 22, 7, 3);
  }, 24, 32);
}

function drawIronVein(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.IronVein, (g) => {
    g.fillStyle(0x000000, 0.24).fillEllipse(12, 29, 19, 4);
    g.fillStyle(0x24292b, 1).fillRect(3, 25, 19, 4);
    g.fillTriangle(3, 27, 8, 10, 22, 28);
    g.fillStyle(0x454e50, 1).fillTriangle(5, 26, 9, 11, 20, 27);
    g.fillStyle(0x697375, 1).fillTriangle(9, 11, 14, 14, 20, 27);
    g.fillStyle(0x8f4f32, 1).fillRect(8, 16, 3, 2).fillRect(10, 18, 2, 5).fillRect(15, 21, 4, 2);
    g.fillStyle(0xd08b54, 1).fillRect(9, 15, 2, 2).fillRect(16, 20, 2, 2);
    g.fillStyle(0xcbd0c6, 1).fillRect(7, 13, 2, 2);
  }, 24, 32);
}

/** Mined iron leaves dark tailings with a few unmistakable rust fragments. */
function drawIronRubble(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.IronRubble, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(12, 29, 17, 3);
    g.fillStyle(0x24292b, 1).fillRoundedRect(4, 24, 7, 4, 1).fillRoundedRect(14, 25, 5, 3, 1);
    g.fillStyle(0x454e50, 1).fillTriangle(8, 24, 12, 20, 15, 27);
    g.fillStyle(0xa45e39, 1).fillRect(10, 22, 2, 2).fillRect(16, 25, 2, 1);
    g.fillStyle(0xd08b54, 1).fillRect(11, 21, 1, 1);
  }, 24, 32);
}

/** Harvestable flax-like plant, deliberately distinct from the ground texture. */
function drawPlant(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Plant, (g) => {
    plantMotif(motifPen(g));
  }, 24, 32);
}

/** Low thorny shrub with bright harvestable fruit. */
function drawBerryBush(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.BerryBush, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(12, 29, 19, 4);
    g.fillStyle(0x17231c, 1).fillCircle(8, 22, 7).fillCircle(16, 21, 8).fillCircle(12, 16, 8);
    g.fillStyle(0x244331, 1).fillCircle(8, 21, 6).fillCircle(16, 20, 7);
    g.fillStyle(0x356246, 1).fillCircle(12, 15, 7).fillCircle(6, 17, 4);
    g.fillStyle(0x4e7955, 1).fillCircle(15, 13, 4);
    g.fillStyle(0x8f3346, 1);
    for (const [x, y] of [[7, 18], [11, 13], [16, 17], [18, 22], [10, 22]] as const) g.fillCircle(x, y, 2);
    g.fillStyle(0xe38a83, 1).fillRect(6, 17, 1, 1).fillRect(10, 12, 1, 1).fillRect(15, 16, 1, 1);
  }, 24, 32);
}

/** Felled tree remains: a low ringed trunk so depleted trees stay legible. */
function drawStump(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Stump, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(12, 29, 15, 3);
    g.fillStyle(0x2b2119, 1).fillRect(7, 21, 11, 7);
    g.fillStyle(0x7a5435, 1).fillRect(8, 20, 9, 7);
    g.fillStyle(0xa9794a, 1).fillEllipse(12, 20, 10, 5);
    g.fillStyle(0x513a29, 1).fillEllipse(12, 20, 6, 3);
    g.fillStyle(0xd0a466, 1).fillRect(11, 19, 3, 1);
    g.fillStyle(0x513a29, 1).fillTriangle(7, 25, 3, 28, 9, 28).fillTriangle(17, 25, 21, 28, 15, 28);
  }, 24, 32);
}

/** Mined-out stone: a scatter of low pebbles. */
function drawRubble(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Rubble, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(12, 29, 17, 3);
    g.fillStyle(0x454e50, 1).fillRoundedRect(4, 24, 7, 4, 1).fillRoundedRect(14, 25, 5, 3, 1);
    g.fillStyle(0x697375, 1).fillTriangle(8, 24, 12, 20, 15, 27);
    g.fillStyle(0x929b96, 1).fillRect(10, 21, 3, 2).fillRect(5, 24, 2, 1);
  }, 24, 32);
}

/** Cut stalks remain after a plant is harvested. */
function drawPlantRemains(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.PlantRemains, (g) => {
    g.fillStyle(0x000000, 0.16).fillEllipse(12, 29, 15, 2);
    g.fillStyle(0x7b7f42, 1);
    g.fillRect(6, 24, 2, 4); g.fillRect(10, 22, 2, 6); g.fillRect(15, 24, 2, 4);
    g.fillStyle(0xb8ad62, 1).fillRect(10, 22, 2, 2);
  }, 24, 32);
}

/** Picked bushes keep their thorny woody frame, unlike soft cut stalks. */
function drawBerryRemains(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.BerryRemains, (g) => {
    g.fillStyle(0x000000, 0.18).fillEllipse(12, 29, 16, 3);
    g.lineStyle(2, 0x513a29, 1);
    g.lineBetween(5, 27, 11, 20); g.lineBetween(18, 27, 12, 19); g.lineBetween(8, 24, 17, 22);
    g.fillStyle(0x69724a, 1).fillTriangle(8, 22, 5, 20, 7, 25).fillTriangle(15, 22, 19, 20, 17, 25);
    g.fillStyle(0x8f3346, 1).fillRect(12, 24, 2, 2);
  }, 24, 32);
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

function drawDropIronOre(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropIronOre, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(8, 14, 10, 3);
    g.fillStyle(0x24292b, 1).fillTriangle(2, 13, 6, 5, 14, 13);
    g.fillStyle(0x697375, 1).fillTriangle(6, 5, 11, 7, 14, 13);
    g.fillStyle(0xc17a49, 1).fillRect(5, 8, 3, 2).fillRect(10, 10, 2, 2);
  });
}

function drawDropIronIngot(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropIronIngot, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(8, 14, 11, 3);
    g.fillStyle(0x454e50, 1).fillTriangle(2, 10, 4, 6, 13, 6).fillTriangle(2, 10, 11, 10, 13, 6);
    g.fillStyle(0x929b96, 1).fillRect(4, 6, 9, 2);
    g.fillStyle(0x697375, 1).fillTriangle(4, 13, 6, 9, 15, 9).fillTriangle(4, 13, 13, 13, 15, 9);
    g.fillStyle(0xcbd0c6, 1).fillRect(6, 9, 9, 2);
  });
}

/** Ground drop: a coiled snare cord with its wooden toggle. */
function drawDropTamingSnare(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropTamingSnare, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 9, 3);
    g.lineStyle(2, 0xb9a06a, 1).strokeCircle(8, 9, 4);
    g.lineStyle(1, 0x8d7a4d, 1).strokeCircle(8, 9, 2);
    g.fillStyle(0x6b4a2b, 1).fillRect(11, 4, 4, 2);
  });
}

/** Ground drop: Elowen's charm — a blessed token on a cord. */
function drawDropSafeguardCharm(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropSafeguardCharm, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 8, 3);
    g.lineStyle(1, 0xb9a06a, 1).strokeCircle(8, 5, 3);
    g.fillStyle(0xe6d38a, 1).fillCircle(8, 10, 4);
    g.fillStyle(0xfff4c9, 1).fillCircle(8, 10, 2);
    g.lineStyle(1, 0x9a7f45, 1).strokeCircle(8, 10, 4);
  });
}

/**
 * Ground drop: a tool lying on its side — a haft and a light head.
 *
 * One silhouette serves every tool because the scene tints the head to the
 * tool's tier; what a player needs from sixteen pixels away is "that is my
 * tool, not a stack of wood", and the tint says which grade it was.
 */
function drawDropTool(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropTool, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 11, 3);
    g.fillStyle(0x8a6238, 1).fillRoundedRect(2, 9, 12, 2, 1);
    g.fillStyle(0xd9d9d9, 1).fillRoundedRect(10, 5, 5, 5, 1);
    g.fillStyle(0xffffff, 1).fillRect(11, 6, 2, 1);
  });
}

/** Ground drop: the trophy snare — same coil, bound with hide and antler. */
function drawDropReinforcedSnare(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropReinforcedSnare, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 9, 3);
    g.lineStyle(2, 0xc8b27a, 1).strokeCircle(8, 9, 4);
    g.lineStyle(1, 0x6b4a2b, 1).strokeCircle(8, 9, 2);
    g.fillStyle(0x8d5a34, 1).fillRect(11, 4, 4, 2);
    g.fillStyle(0xe4dcc4, 1).fillRect(3, 8, 2, 3);
  });
}

/**
 * Ground drops for the four creature trophies. Each reads at a glance by
 * silhouette alone, because a trophy is most often seen as a 16px sprite lying
 * where a creature fell rather than in the Bag.
 */
function drawDropTrophies(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropTuftleDown, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 9, 3);
    g.fillStyle(0xf1ece0, 1).fillCircle(8, 8, 4);
    g.fillStyle(0xd8d0bc, 1).fillCircle(5, 10, 2).fillCircle(11, 10, 2);
    g.lineStyle(1, 0xb5ab93, 1).lineBetween(8, 4, 8, 12);
  });
  withGraphics(scene, TextureKeys.DropCraghopperShell, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 10, 3);
    g.fillStyle(0x6d7b6a, 1).fillEllipse(8, 9, 11, 8);
    g.fillStyle(0x8a9a85, 1).fillEllipse(8, 8, 8, 5);
    g.lineStyle(1, 0x49543f, 1).lineBetween(3, 9, 13, 9).lineBetween(8, 5, 8, 12);
  });
  withGraphics(scene, TextureKeys.DropStagAntler, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 9, 3);
    g.lineStyle(2, 0xcdb48b, 1);
    g.lineBetween(5, 12, 7, 5);
    g.lineBetween(7, 5, 4, 3);
    g.lineBetween(7, 8, 11, 6);
    g.lineBetween(11, 6, 12, 3);
  });
  withGraphics(scene, TextureKeys.DropSnarlfoxPelt, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 10, 3);
    g.fillStyle(0xa5522c, 1).fillRoundedRect(3, 5, 10, 7, 3);
    g.fillStyle(0xe8dccb, 1).fillRoundedRect(5, 8, 6, 4, 2);
    g.fillStyle(0x7a3a1e, 1).fillCircle(4, 5, 2).fillCircle(12, 5, 2);
  });
  withGraphics(scene, TextureKeys.DropMasonmoleClaw, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 9, 3);
    g.lineStyle(2, 0xd8d0bc, 1).lineBetween(5, 12, 9, 4);
    g.lineStyle(1, 0x8d8a96, 1).lineBetween(9, 4, 12, 6);
    g.fillStyle(0x6c6a74, 1).fillRect(4, 11, 4, 2);
  });
  withGraphics(scene, TextureKeys.DropBoarTusk, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 10, 3);
    g.fillStyle(0xf1ece0, 1).fillTriangle(3, 12, 6, 3, 8, 12);
    g.fillStyle(0xd8d0bc, 1).fillTriangle(8, 12, 10, 6, 12, 12);
    g.fillStyle(0x9a6244, 1).fillRect(3, 11, 9, 2);
  });
  withGraphics(scene, TextureKeys.DropQuillfinchQuill, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 9, 3);
    g.lineStyle(1, 0xe6d296, 1);
    g.lineBetween(3, 12, 12, 3);
    g.lineBetween(5, 12, 13, 5);
    g.fillStyle(0xd98b3f, 1).fillTriangle(11, 2, 14, 3, 12, 6);
  });
  withGraphics(scene, TextureKeys.DropMistmothScale, (g) => {
    g.fillStyle(0x000000, 0.16).fillEllipse(8, 13, 9, 3);
    g.fillStyle(0xa8d8e0, 1).fillEllipse(8, 8, 9, 8);
    g.fillStyle(0xe6f4f6, 1).fillEllipse(7, 7, 5, 4);
    g.lineStyle(1, 0x5d99a3, 1).lineBetween(4, 8, 12, 8);
  });
  withGraphics(scene, TextureKeys.DropSlingtailStone, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(8, 13, 10, 3);
    g.fillStyle(0x6d7b6a, 1).fillCircle(8, 8, 5);
    g.fillStyle(0x8a9a85, 1).fillCircle(6, 6, 2);
    g.lineStyle(1, 0xb9a074, 1).lineBetween(3, 10, 13, 6);
  });
}

/**
 * Findable containers, drawn at two tiles square so they read as scenery worth
 * walking to rather than as another pickup lying in the grass.
 */
const CONTAINER_TEXTURE_PX = S * 2;

function drawWorldContainers(scene: Phaser.Scene): void {
  const container = (key: string, draw: (g: Phaser.GameObjects.Graphics) => void) =>
    withGraphics(scene, key, draw, CONTAINER_TEXTURE_PX, CONTAINER_TEXTURE_PX);
  container(TextureKeys.ContainerHollowLog, (g) => {
    g.fillStyle(0x000000, 0.25).fillEllipse(16, 26, 24, 6);
    g.fillStyle(0x6b4a2b, 1).fillRoundedRect(4, 12, 24, 12, 5);
    g.fillStyle(0x53381f, 1).fillEllipse(8, 18, 9, 11);
    g.fillStyle(0x2b1c10, 1).fillEllipse(8, 18, 6, 8);
    g.lineStyle(1, 0x8a6238, 1).lineBetween(14, 13, 26, 13).lineBetween(15, 22, 27, 22);
  });
  container(TextureKeys.ContainerSupplyCache, (g) => {
    g.fillStyle(0x000000, 0.25).fillEllipse(16, 27, 22, 6);
    g.fillStyle(0x7a5a33, 1).fillRoundedRect(6, 10, 20, 15, 2);
    g.fillStyle(0x95713f, 1).fillRect(6, 14, 20, 3);
    g.fillStyle(0x5b4225, 1).fillRect(6, 19, 20, 2);
    g.fillStyle(0xb9a06a, 1).fillRect(14, 10, 4, 15);
    g.lineStyle(1, 0x3d2c17, 1).strokeRoundedRect(6, 10, 20, 15, 2);
  });
  container(TextureKeys.ContainerCollapsedCellar, (g) => {
    g.fillStyle(0x000000, 0.3).fillEllipse(16, 26, 26, 7);
    g.fillStyle(0x4a4a46, 1).fillRoundedRect(4, 12, 24, 13, 3);
    g.fillStyle(0x14100d, 1).fillRoundedRect(9, 15, 14, 9, 2);
    g.fillStyle(0x6a6a63, 1).fillRect(4, 12, 24, 3);
    g.fillStyle(0x8a8a80, 1).fillRect(3, 20, 5, 4).fillRect(24, 18, 5, 5);
  });
  // The storm cache reads as arcane rather than built: a shard half-buried in
  // scorched ground, lit from inside. It only ever appears during a storm, so
  // it has to be recognisable at a glance from across a field the player is
  // trying to cross without standing still.
  container(TextureKeys.ContainerStormCache, (g) => {
    g.fillStyle(0x000000, 0.28).fillEllipse(16, 26, 22, 6);
    g.fillStyle(0x2b2340, 1).fillEllipse(16, 24, 20, 7);
    g.fillStyle(0x6f5ac4, 1).fillTriangle(16, 5, 25, 24, 7, 24);
    g.fillStyle(0x9d8ce8, 1).fillTriangle(16, 8, 21, 23, 12, 23);
    g.fillStyle(0xd8ceff, 1).fillTriangle(16, 10, 18, 22, 14, 22);
    g.lineStyle(1, 0xbfaef5, 1).lineBetween(6, 18, 11, 16).lineBetween(26, 17, 21, 15);
  });
}

/** Ground drop: a small handful of berries. */
function drawDropBerry(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropBerry, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 9, 3);
    g.fillStyle(0x8e2436, 1).fillCircle(6, 10, 3).fillCircle(11, 10, 3);
    g.fillStyle(0xc0384f, 1).fillCircle(8, 7, 3);
    g.fillStyle(0x3f6b32, 1).fillRect(8, 3, 1, 3);
  });
}

/** Ground drop: a loose sheaf of arrows. */
function drawDropArrow(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropArrow, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 10, 3);
    g.lineStyle(1, 0x8a6238, 1);
    g.lineBetween(3, 12, 12, 4);
    g.lineBetween(5, 12, 14, 4);
    g.fillStyle(0x929b96, 1).fillTriangle(12, 4, 14, 2, 14, 6);
    g.fillStyle(0xc7c979, 1).fillRect(3, 11, 3, 2);
  });
}

/** Ground drop: a folded cloth mask with its tie. */
function drawDropClothMask(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.DropClothMask, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(8, 13, 9, 3);
    g.fillStyle(0xd7d2c2, 1).fillRoundedRect(3, 6, 10, 6, 2);
    g.fillStyle(0xb3ae9c, 1).fillRect(3, 8, 10, 1).fillRect(3, 10, 10, 1);
    g.lineStyle(1, 0x8d7a4d, 1).lineBetween(2, 5, 4, 7).lineBetween(14, 5, 12, 7);
  });
}

/** Solid timber wall segment: tightly joined horizontal boards, tile-tileable. */
function drawWall(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.Wall, (g) => {
    const top = (S - WALL_VISUAL_THICKNESS) / 2;
    // Six painted pixels: exactly three times the two-pixel red guide. The
    // remaining source pixels stay transparent so the edge reads precisely.
    g.fillStyle(0x3f2b1b, 1).fillRect(0, top, S, WALL_VISUAL_THICKNESS);
    g.fillStyle(0x6b4a2b, 1).fillRect(1, top + 1, 14, WALL_VISUAL_THICKNESS - 2);
    g.fillStyle(0x8a6238, 1)
      .fillRect(1, top + 1, 14, 1)
      .fillRect(1, top + 3, 14, 1);
    g.fillStyle(0x4d3520, 1)
      .fillRect(0, top + 2, S, 1)
      .fillRect(0, top + 4, S, 1)
      .fillRect(5, top + 1, 1, 1)
      .fillRect(11, top + 3, 1, 1);
    g.fillStyle(0x9c7647, 1).fillRect(0, top, S, 1);
  });
}

/** Ordered swing frames per door material: index 0 is closed, last is open. */
const DOOR_WOOD_FRAMES = [
  TextureKeys.DoorWood, TextureKeys.DoorWoodSwing1, TextureKeys.DoorWoodSwing2,
  TextureKeys.DoorWoodSwing3, TextureKeys.DoorWoodSwing4,
] as const;
const DOOR_THATCH_FRAMES = [
  TextureKeys.DoorThatch, TextureKeys.DoorThatchSwing1, TextureKeys.DoorThatchSwing2,
  TextureKeys.DoorThatchSwing3, TextureKeys.DoorThatchSwing4,
] as const;
const GATE_WOOD_FRAMES = [
  TextureKeys.GateWood, TextureKeys.GateWoodSwing1, TextureKeys.GateWoodSwing2,
  TextureKeys.GateWoodSwing3, TextureKeys.GateWoodSwing4,
] as const;
const GATE_THATCH_FRAMES = [
  TextureKeys.GateThatch, TextureKeys.GateThatchSwing1, TextureKeys.GateThatchSwing2,
  TextureKeys.GateThatchSwing3, TextureKeys.GateThatchSwing4,
] as const;

// Dark timber frame + a saturated leaf color set doors apart from the flat wall
// band. Wood reads as warm oak-red; thatch as a deep woven gold.
const DOOR_FRAME = 0x241812;
const DOOR_INTERIOR = 0x110b07;
const DOOR_LEAF = {
  wood: { dark: 0x5e3016, mid: 0x8a4b24, light: 0xb2703a },
  thatch: { dark: 0x7a6420, mid: 0xb2942f, light: 0xdcc766 },
} as const;

/**
 * A front-facing paneled doorway. The leaf is hinged at the left jamb (x=4) and
 * swings inward: at `openness` 0 it fills the opening, and as openness rises its
 * visible width collapses toward the hinge, revealing the dark interior behind.
 */
function drawDoor(
  g: Phaser.GameObjects.Graphics,
  leaf: { readonly dark: number; readonly mid: number; readonly light: number },
  openness: number,
): void {
  // Timber frame: jambs full height, lintel across the top, sill shadow.
  g.fillStyle(0x000000, 0.28).fillRect(2, 14, 12, 2);
  g.fillStyle(DOOR_FRAME, 1)
    .fillRect(1, 0, 3, 15)   // left jamb (hinge side)
    .fillRect(12, 0, 3, 15)  // right jamb (latch side)
    .fillRect(1, 0, 14, 2);  // lintel
  // Dark interior fills the whole opening; the leaf is painted on top of it.
  g.fillStyle(DOOR_INTERIOR, 1).fillRect(4, 2, 8, 12);

  const hinge = 4;
  const closedRight = 12;
  const leafRight = hinge + Math.round((closedRight - hinge) * (1 - openness * 0.9));
  const leafWidth = leafRight - hinge;
  if (leafWidth >= 1) {
    g.fillStyle(leaf.mid, 1).fillRect(hinge, 2, leafWidth, 12);
    g.fillStyle(leaf.dark, 1)
      .fillRect(hinge, 8, leafWidth, 1)      // mid rail
      .fillRect(leafRight - 1, 2, 1, 12);    // free edge falls into shadow
    g.fillStyle(leaf.light, 1)
      .fillRect(hinge, 2, leafWidth, 1)      // top highlight
      .fillRect(hinge, 3, 1, 10);            // lit hinge stile
    if (leafWidth >= 5) {
      g.fillStyle(leaf.dark, 1)
        .fillRect(hinge + 1, 4, leafWidth - 2, 1).fillRect(hinge + 1, 6, leafWidth - 2, 1)
        .fillRect(hinge + 1, 10, leafWidth - 2, 1).fillRect(hinge + 1, 12, leafWidth - 2, 1);
    }
    // Brass knob rides the free (latch) edge so the door reads at a glance.
    g.fillStyle(0xe8c15a, 1).fillCircle(leafRight - 2, 9, 1.3);
  }
  // Hinges pinned to the jamb, always visible so the pivot side stays clear.
  g.fillStyle(0x0c0805, 1).fillRect(3, 4, 2, 1).fillRect(3, 11, 2, 1);
}

/** A braced gate whose leaf foreshortens toward its left-hand hinge. */
function drawGate(
  g: Phaser.GameObjects.Graphics,
  palette: { readonly dark: number; readonly mid: number; readonly light: number },
  openness: number,
): void {
  g.fillStyle(0x000000, 0.2).fillRect(1, 13, 14, 2);
  // The two fixed posts remain in place while the leaf swings between them.
  g.fillStyle(palette.dark, 1).fillRect(1, 4, 2, 10).fillRect(13, 4, 2, 10);
  const hinge = 3;
  const closedRight = 13;
  const leafRight = hinge + Math.round((closedRight - hinge) * (1 - openness * 0.9));
  const leafWidth = leafRight - hinge;
  if (leafWidth >= 1) {
    g.fillStyle(palette.light, 1)
      .fillRect(hinge, 5, leafWidth, 2)
      .fillRect(hinge, 11, leafWidth, 2);
    g.fillStyle(palette.mid, 1).fillRect(hinge, 6, 2, 7);
    if (leafWidth >= 5) {
      g.lineStyle(2, palette.mid, 1);
      g.lineBetween(hinge + 1, 6, leafRight - 1, 12);
      g.lineBetween(leafRight - 1, 6, hinge + 1, 12);
    }
    g.fillStyle(0xc9a227, 1).fillRect(Math.max(hinge, leafRight - 2), 8, 2, 2);
  }
  g.fillStyle(0x1d140d, 1).fillRect(2, 6, 2, 1).fillRect(2, 11, 2, 1);
}

/**
 * Structural part set for both Phase 1 materials. Thatch reads as pale woven
 * straw, wood as the established plank browns; silhouettes differ by class
 * (solid wall, framed door, open-rail fence, braced gate) so boundaries stay
 * readable without relying on color alone.
 */
function drawBuildingParts(scene: Phaser.Scene): void {
  const wood = { dark: 0x4d3520, mid: 0x6b4a2b, light: 0x8a6238, top: 0x9c7647 };
  const thatch = { dark: 0x7a6a2e, mid: 0xa08a3d, light: 0xc7b25a, top: 0xdbcb7c };

  // Wood floors use long boards; thatch floors use a cross-woven mat. Their
  // silhouettes match, but their patterns remain distinct without color.
  withGraphics(scene, TextureKeys.FloorWood, (g) => {
    g.fillStyle(wood.mid, 1).fillRect(0, 0, S, S);
    g.fillStyle(wood.light, 1).fillRect(0, 1, S, 2).fillRect(0, 7, S, 2).fillRect(0, 13, S, 2);
    g.fillStyle(wood.dark, 1).fillRect(0, 5, S, 1).fillRect(0, 11, S, 1);
    g.fillRect(5, 1, 1, 4).fillRect(12, 7, 1, 4).fillRect(7, 13, 1, 2);
  });
  withGraphics(scene, TextureKeys.FloorThatch, (g) => {
    g.fillStyle(thatch.mid, 1).fillRect(0, 0, S, S);
    g.fillStyle(thatch.light, 1);
    for (let offset = -12; offset < 16; offset += 5) {
      g.lineStyle(1, thatch.light, 1).lineBetween(offset, 0, offset + 16, 16);
      g.lineStyle(1, thatch.top, 1).lineBetween(offset + 16, 0, offset, 16);
    }
    g.fillStyle(thatch.dark, 1).fillRect(0, 0, S, 1).fillRect(0, 15, S, 1);
  });

  // Prepared ground stays quieter than floor: wood is a chipped deck and
  // thatch is a soft straw pad, both with rounded, clearly outdoor edges.
  withGraphics(scene, TextureKeys.GroundWood, (g) => {
    g.fillStyle(wood.dark, 1).fillRect(0, 0, S, S);
    g.fillStyle(wood.mid, 1).fillRoundedRect(1, 1, 14, 14, 2);
    g.fillStyle(wood.light, 1).fillRect(2, 4, 7, 2).fillRect(8, 9, 6, 2).fillRect(3, 13, 5, 1);
    g.fillStyle(wood.dark, 1).fillRect(5, 3, 1, 4).fillRect(11, 8, 1, 4);
  });
  withGraphics(scene, TextureKeys.GroundThatch, (g) => {
    g.fillStyle(thatch.dark, 1).fillRect(0, 0, S, S);
    g.fillStyle(thatch.mid, 1).fillRoundedRect(1, 1, 14, 14, 3);
    g.fillStyle(thatch.light, 1);
    for (const [x, y] of [[2, 4], [7, 2], [11, 5], [4, 9], [9, 12], [2, 13]] as const) g.fillRect(x, y, 4, 1);
    g.fillStyle(thatch.top, 1).fillRect(3, 3, 1, 2).fillRect(12, 10, 1, 3);
  });

  // Landscaping tiles share the build grid. Bridges are authored at their
  // full two-tile length so rotation stays crisp instead of stretching a
  // single-tile icon; water uses the same rippled palette as world shallows.
  withGraphics(scene, TextureKeys.BridgeWood, (g) => {
    g.fillStyle(0x2f2118, 0.42).fillRect(0, 2, S * 2, 13);
    g.fillStyle(wood.dark, 1).fillRect(0, 1, S * 2, 2).fillRect(0, 13, S * 2, 2);
    for (let x = 1; x < S * 2; x += 5) {
      g.fillStyle(wood.mid, 1).fillRect(x, 3, 4, 10);
      g.fillStyle(wood.light, 1).fillRect(x, 3, 4, 2);
      g.fillStyle(wood.dark, 1).fillRect(x + 3, 5, 1, 8);
    }
  }, S * 2, S);
  withGraphics(scene, TextureKeys.BridgeStone, (g) => {
    g.fillStyle(0x3f4848, 1).fillRoundedRect(0, 1, S * 2, 14, 2);
    g.fillStyle(0x77817f, 1).fillRect(1, 3, S * 2 - 2, 9);
    g.fillStyle(0x929a96, 1).fillRect(1, 3, S * 2 - 2, 2);
    g.lineStyle(1, 0x515b5a, 1);
    g.lineBetween(0, 8, S * 2, 8);
    for (let x = 5; x < S * 2; x += 7) g.lineBetween(x, 3, x, 8);
    for (let x = 2; x < S * 2; x += 7) g.lineBetween(x, 8, x, 13);
  }, S * 2, S);
  withGraphics(scene, TextureKeys.WaterPlaced, (g) => {
    g.fillStyle(0x3d9296, 1).fillRect(0, 0, S, S);
    g.fillStyle(0x86c5bc, 0.72).fillRect(1, 3, 6, 1).fillRect(9, 9, 5, 1).fillRect(3, 13, 8, 1);
    g.fillStyle(0x256b7d, 0.58).fillRect(8, 5, 6, 1).fillRect(1, 10, 5, 1);
  });

  // Thatch wall: the same six-pixel edge contract with bundled straw detail.
  withGraphics(scene, TextureKeys.WallThatch, (g) => {
    const top = (S - WALL_VISUAL_THICKNESS) / 2;
    g.fillStyle(thatch.dark, 1).fillRect(0, top, S, WALL_VISUAL_THICKNESS);
    g.fillStyle(thatch.mid, 1).fillRect(1, top + 1, 14, WALL_VISUAL_THICKNESS - 2);
    g.fillStyle(thatch.light, 1);
    g.fillRect(2, top + 1, 2, 4); g.fillRect(7, top + 1, 2, 4); g.fillRect(12, top + 1, 2, 4);
    g.fillStyle(thatch.top, 1).fillRect(0, top, S, 1);
    g.fillStyle(thatch.dark, 1).fillRect(0, top + 3, S, 1);
  });

  // Doors: a front-facing paneled doorway whose leaf swings inward. Each
  // material gets a closed frame plus four opening frames; the animation loop
  // swaps between them as the player walks up (see BuildModeController).
  for (const [keys, leaf] of [
    [DOOR_WOOD_FRAMES, DOOR_LEAF.wood],
    [DOOR_THATCH_FRAMES, DOOR_LEAF.thatch],
  ] as const) {
    keys.forEach((key, index) => {
      const openness = index / (keys.length - 1);
      withGraphics(scene, key, (g) => drawDoor(g, leaf, openness));
    });
  }

  // Fences: low post-and-rail with gaps so yards read as open-air.
  for (const [key, palette] of [[TextureKeys.FenceWood, wood], [TextureKeys.FenceThatch, thatch]] as const) {
    withGraphics(scene, key, (g) => {
      g.fillStyle(0x000000, 0.2).fillRect(1, 13, 14, 2);
      g.fillStyle(palette.mid, 1);
      g.fillRect(2, 5, 2, 9); g.fillRect(12, 5, 2, 9);
      g.fillStyle(palette.light, 1);
      g.fillRect(0, 6, S, 2); g.fillRect(0, 10, S, 2);
    });
  }

  // Gates use the same five-frame proximity swing as doors.
  for (const [keys, palette] of [[GATE_WOOD_FRAMES, wood], [GATE_THATCH_FRAMES, thatch]] as const) {
    keys.forEach((key, index) => {
      const openness = index / (keys.length - 1);
      withGraphics(scene, key, (g) => drawGate(g, palette, openness));
    });
  }

  // Legacy markers retain state-readable shapes: roof (indoor), rails
  // (paddock), and crossed tools (work yard).
  for (const [key, kind, banner] of [
    [TextureKeys.Marker, 'indoor', 0x3c8657],
    [TextureKeys.MarkerPaddock, 'paddock', 0xd0a466],
    [TextureKeys.MarkerWorkYard, 'workYard', 0x697375],
  ] as const) withGraphics(scene, key, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(8, 14, 9, 3);
    g.fillStyle(0x513a29, 1).fillRect(6, 2, 2, 12);
    g.fillStyle(banner, 1).fillRect(8, 3, 7, 7);
    g.fillStyle(0x17231c, 1);
    if (kind === 'indoor') {
      g.fillTriangle(9, 7, 11, 4, 14, 7).fillRect(10, 7, 4, 2);
    } else if (kind === 'paddock') {
      g.fillRect(9, 5, 1, 4).fillRect(13, 5, 1, 4).fillRect(9, 6, 5, 1).fillRect(9, 8, 5, 1);
    } else {
      g.lineStyle(2, 0x17231c, 1).lineBetween(9, 5, 14, 9).lineBetween(14, 5, 9, 9);
    }
    g.fillStyle(0x697375, 1).fillRect(5, 13, 5, 2);
  });
}

/** Storage Box (small): a strapped storage crate. */
function drawFieldCache(scene: Phaser.Scene): void {
  const base = (g: Phaser.GameObjects.Graphics) => {
    g.fillStyle(0x000000, 0.25).fillEllipse(8, 14, 12, 3);
    g.fillStyle(0x2b2119, 1).fillRoundedRect(1, 4, 14, 10, 2);
    g.fillStyle(0x7a5435, 1).fillRoundedRect(2, 5, 12, 8, 1);
    g.fillStyle(0xa9794a, 1).fillRect(3, 5, 10, 3);
    g.fillStyle(0x4d3520, 1).fillRect(2, 9, 12, 1);
    g.fillStyle(0xd0a466, 1).fillRect(7, 4, 2, 10);
    g.fillStyle(0x24292b, 1).fillRect(7, 8, 2, 2);
  };
  withGraphics(scene, TextureKeys.FieldCache, base);
  withGraphics(scene, TextureKeys.FieldCacheFull, (g) => {
    base(g);
    // Lid sits high and visible bundles protrude, so fullness is not color-only.
    g.fillStyle(0x513a29, 1).fillRect(2, 3, 12, 3);
    g.fillStyle(0xa9794a, 1).fillRect(3, 2, 10, 2);
    g.fillStyle(0xd8cf7a, 1).fillRect(4, 0, 2, 4).fillRect(10, 1, 2, 3);
    g.fillStyle(0x697375, 1).fillTriangle(6, 4, 8, 0, 11, 4);
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
      g.fillRect(5, 11, 22, 2);
      // Tabletop
      g.fillStyle(0x8a6238, 1).fillRoundedRect(1, 3, 30, 6, 1);
      g.fillStyle(0x7d5732, 1).fillRect(1, 6, 30, 3);
      // Vice block + saw line
      g.fillStyle(0x565b63, 1).fillRect(24, 1, 4, 4);
      g.fillStyle(0xcbd0c6, 1).fillRect(6, 4, 10, 1);
      g.fillStyle(0x697375, 1).fillTriangle(8, 3, 12, 0, 16, 3);
      g.fillStyle(0xd0a466, 1).fillRect(18, 2, 2, 5);
    },
    S * 2,
    S,
  );
}

/** War Table: a two-tile map table with pinned markers and a standing banner. */
function drawWarTable(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.WarTable, (g) => {
    g.fillStyle(0x000000, 0.25).fillRect(2, 13, 28, 2);
    // Legs and frame.
    g.fillStyle(0x3f2c1c, 1);
    g.fillRect(3, 9, 2, 5).fillRect(27, 9, 2, 5).fillRect(5, 11, 22, 2);
    // Map surface: parchment with an inked coastline and a marked base.
    g.fillStyle(0x5a4028, 1).fillRoundedRect(1, 3, 30, 7, 1);
    g.fillStyle(0xd9c79a, 1).fillRect(3, 4, 26, 5);
    g.fillStyle(0x8a7146, 1).fillRect(5, 6, 9, 1).fillRect(16, 5, 8, 1).fillRect(20, 7, 6, 1);
    // Standing markers: two red pins for the raid, one green for the homestead.
    g.fillStyle(0xc94a3a, 1).fillRect(8, 3, 1, 3).fillRect(19, 3, 1, 3);
    g.fillStyle(0x6fbf73, 1).fillRect(13, 3, 1, 3);
    // Banner on the right edge.
    g.fillStyle(0x565b63, 1).fillRect(29, 0, 1, 10);
    g.fillStyle(0xa03c34, 1).fillRect(25, 0, 4, 4);
  }, S * 2, S);
}

/**
 * Turret: a single-tile swivel mount. The loaded and empty variants differ only
 * in the magazine light, so a dry turret is legible without a UI panel open.
 */
function drawTurret(scene: Phaser.Scene): void {
  const base = (g: Phaser.GameObjects.Graphics) => {
    g.fillStyle(0x000000, 0.24).fillEllipse(8, 15, 13, 3);
    // Timber platform and stone ballast.
    g.fillStyle(0x4d3520, 1).fillRoundedRect(2, 9, 12, 5, 1);
    g.fillStyle(0x697375, 1).fillRect(3, 12, 10, 2);
    // Swivel head and the bolt channel it fires along.
    g.fillStyle(0x3c4550, 1).fillRoundedRect(4, 4, 8, 6, 2);
    g.fillStyle(0x5c6875, 1).fillRect(5, 5, 6, 3);
    g.fillStyle(0x24282d, 1).fillRect(10, 6, 5, 2);
    g.fillStyle(0xcbd0c6, 1).fillRect(13, 6, 2, 1);
  };
  withGraphics(scene, TextureKeys.Turret, (g) => {
    base(g);
    g.fillStyle(0x7fe3b0, 1).fillRect(6, 2, 4, 2);
  }, S, S);
  withGraphics(scene, TextureKeys.TurretEmpty, (g) => {
    base(g);
    g.fillStyle(0x8a3a34, 1).fillRect(6, 2, 4, 2);
  }, S, S);
}

/**
 * Raiders: three silhouettes that read at a glance during the fog, because the
 * player has to decide what to shoot in a very short minute. Scavengers are
 * small and hunched, Breakers are broad and carry a maul, Stalkers are lean.
 */
function drawRaiders(scene: Phaser.Scene): void {
  withGraphics(scene, TextureKeys.RaiderScavenger, (g) => {
    g.fillStyle(0x000000, 0.22).fillEllipse(16, 27, 16, 4);
    g.fillStyle(0x2a2320, 1).fillEllipse(16, 18, 15, 16);
    g.fillStyle(0x4a3b32, 1).fillEllipse(15, 17, 13, 14);
    g.fillStyle(0x6b5748, 1).fillRect(11, 12, 9, 4);
    g.fillStyle(0xd8604a, 1).fillRect(12, 14, 2, 2).fillRect(18, 14, 2, 2);
    g.fillStyle(0x2a2320, 1).fillRect(11, 24, 4, 4).fillRect(18, 24, 4, 4);
  }, 32, 32);
  withGraphics(scene, TextureKeys.RaiderBreaker, (g) => {
    g.fillStyle(0x000000, 0.26).fillEllipse(16, 28, 22, 5);
    g.fillStyle(0x231d1e, 1).fillEllipse(16, 18, 23, 19);
    g.fillStyle(0x4a3336, 1).fillEllipse(15, 17, 21, 17);
    g.fillStyle(0x6d4b45, 1).fillRect(9, 11, 13, 5);
    g.fillStyle(0xe8703f, 1).fillRect(11, 13, 3, 2).fillRect(19, 13, 3, 2);
    // The maul that makes walls a poor answer on their own.
    g.fillStyle(0x3b3226, 1).fillRect(24, 6, 2, 14);
    g.fillStyle(0x697375, 1).fillRoundedRect(21, 2, 8, 6, 1);
    g.fillStyle(0x231d1e, 1).fillRect(9, 24, 6, 5).fillRect(18, 24, 6, 5);
  }, 32, 32);
  withGraphics(scene, TextureKeys.RaiderStalker, (g) => {
    g.fillStyle(0x000000, 0.2).fillEllipse(16, 27, 13, 4);
    g.fillStyle(0x1e2430, 1).fillEllipse(16, 17, 13, 18);
    g.fillStyle(0x35405a, 1).fillEllipse(15, 16, 11, 16);
    g.fillStyle(0x4d5c80, 1).fillRect(12, 9, 8, 4);
    g.fillStyle(0x9fd8ff, 1).fillRect(13, 11, 2, 2).fillRect(18, 11, 2, 2);
    g.fillStyle(0x1e2430, 1).fillRect(12, 24, 3, 5).fillRect(18, 24, 3, 5);
  }, 32, 32);
}

/** Furnace: a compact two-tile stone kiln with a bright firebox. */
function drawFurnace(scene: Phaser.Scene): void {
  const base = (g: Phaser.GameObjects.Graphics) => {
    g.fillStyle(0x000000, 0.28).fillEllipse(16, 14, 28, 4);
    g.fillStyle(0x24292b, 1).fillRoundedRect(2, 2, 27, 12, 3);
    g.fillStyle(0x697375, 1).fillRoundedRect(4, 3, 23, 10, 2);
    g.fillStyle(0x929b96, 1).fillRect(5, 3, 20, 2);
    g.fillStyle(0x24292b, 1).fillRoundedRect(9, 7, 12, 7, 2);
    g.fillStyle(0x454e50, 1).fillRect(23, 0, 5, 6);
    g.fillStyle(0x929b96, 1).fillRect(24, 0, 3, 1);
  };
  withGraphics(scene, TextureKeys.Furnace, base, S * 2, S);
  withGraphics(scene, TextureKeys.FurnaceActive, (g) => {
    base(g);
    g.fillStyle(0xd66a32, 1).fillRoundedRect(11, 9, 8, 5, 2);
    g.fillStyle(0xfff0a6, 1).fillTriangle(13, 14, 15, 9, 17, 14);
    g.fillStyle(0xb9c7ba, 1).fillRect(25, 0, 2, 2);
  }, S * 2, S);
  withGraphics(scene, TextureKeys.FurnaceReady, (g) => {
    base(g);
    g.fillStyle(0x8f3f25, 1).fillRoundedRect(11, 10, 8, 4, 1);
    // A bright bar sits on the output lip.
    g.fillStyle(0xcbd0c6, 1).fillTriangle(7, 12, 9, 9, 18, 9).fillTriangle(7, 12, 16, 12, 18, 9);
    g.fillStyle(0xfff0a6, 1).fillRect(10, 9, 6, 1);
  }, S * 2, S);
  withGraphics(scene, TextureKeys.FurnaceBlocked, (g) => {
    base(g);
    g.fillStyle(0x53251b, 1).fillRoundedRect(10, 8, 10, 6, 1);
    g.lineStyle(2, 0xe6b85c, 1).lineBetween(11, 9, 19, 14).lineBetween(19, 9, 11, 14);
    g.fillStyle(0x24292b, 1).fillRect(23, 0, 5, 3);
  }, S * 2, S);
}

/**
 * Woodlot Planter: a bordered soil bed with sprouting saplings, 2×2 tiles. The
 * ready variant grows the tree node's own motif so a matured planter looks like
 * the resource it yields.
 */
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
      // Fresh bed: paired planting stakes, no established saplings.
      g.fillStyle(0x8a6238, 1).fillRect(8, 9, 1, 5).fillRect(22, 20, 1, 5);
      g.fillStyle(0xd0a466, 1).fillRect(7, 9, 3, 1).fillRect(21, 20, 3, 1);
    },
    S * 2,
    S * 2,
  );
  withGraphics(
    scene,
    TextureKeys.PlanterGrowing,
    (g) => {
      base(g);
      g.fillStyle(0x2f6b3f, 1);
      g.fillRect(8, 9, 2, 8); g.fillRect(21, 20, 2, 7);
      g.fillStyle(0x4e7955, 1);
      g.fillCircle(8, 9, 4); g.fillCircle(22, 20, 4);
      g.fillStyle(0x78a365, 1).fillRect(6, 7, 4, 2).fillRect(20, 18, 4, 2);
    },
    S * 2,
    S * 2,
  );
  withGraphics(
    scene,
    TextureKeys.PlanterReady,
    (g) => {
      base(g);
      // Matured: the saplings have become the tree node itself, so a ready
      // planter reads as harvestable wood without relying on colour alone.
      treeMotif(motifPen(g, 3, 0, 0.62));
      treeMotif(motifPen(g, 14, 11, 0.62), true);
    },
    S * 2,
    S * 2,
  );
}
