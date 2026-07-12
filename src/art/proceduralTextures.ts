import Phaser from 'phaser';
import { TILE_SIZE } from '../config/platform';

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
} as const;

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
}

function withGraphics(scene: Phaser.Scene, key: string, draw: (g: Phaser.GameObjects.Graphics) => void): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, S, S);
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
