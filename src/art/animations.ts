import Phaser from 'phaser';
import { TextureKeys } from './textureKeys';

export type Facing = 'up' | 'down' | 'left' | 'right';

export const AnimationKeys = {
  PlayerIdleDown: 'anim-player-idle-down',
  PlayerIdleUp: 'anim-player-idle-up',
  PlayerIdleSide: 'anim-player-idle-side',
  PlayerWalkDown: 'anim-player-walk-down',
  PlayerWalkUp: 'anim-player-walk-up',
  PlayerWalkSide: 'anim-player-walk-side',
  PlayerGather: 'anim-player-gather',
  TuftleIdle: 'anim-tuftle-idle',
  TuftleMove: 'anim-tuftle-move',
  TuftleHurt: 'anim-tuftle-hurt',
  CraghopperIdle: 'anim-craghopper-idle',
  CraghopperMove: 'anim-craghopper-move',
  CraghopperHurt: 'anim-craghopper-hurt',
  GladeStagIdle: 'anim-glade-stag-idle',
  GladeStagMove: 'anim-glade-stag-move',
  GladeStagHurt: 'anim-glade-stag-hurt',
} as const;

export function registerWorldAnimations(scene: Phaser.Scene): void {
  const add = (key: string, textureKeys: readonly string[], frameRate: number, repeat: number) => {
    if (scene.anims.exists(key)) return;
    scene.anims.create({ key, frames: textureKeys.map((textureKey) => ({ key: textureKey })), frameRate, repeat });
  };
  add(AnimationKeys.PlayerIdleDown, [TextureKeys.PlayerIdleDown], 1, -1);
  add(AnimationKeys.PlayerIdleUp, [TextureKeys.PlayerIdleUp], 1, -1);
  add(AnimationKeys.PlayerIdleSide, [TextureKeys.PlayerIdleSide], 1, -1);
  add(AnimationKeys.PlayerWalkDown, [TextureKeys.PlayerWalkDownA, TextureKeys.PlayerIdleDown, TextureKeys.PlayerWalkDownB, TextureKeys.PlayerIdleDown], 8, -1);
  add(AnimationKeys.PlayerWalkUp, [TextureKeys.PlayerWalkUpA, TextureKeys.PlayerIdleUp, TextureKeys.PlayerWalkUpB, TextureKeys.PlayerIdleUp], 8, -1);
  add(AnimationKeys.PlayerWalkSide, [TextureKeys.PlayerWalkSideA, TextureKeys.PlayerIdleSide, TextureKeys.PlayerWalkSideB, TextureKeys.PlayerIdleSide], 8, -1);
  add(AnimationKeys.PlayerGather, [TextureKeys.PlayerGather, TextureKeys.PlayerIdleSide], 7, 0);
  add(AnimationKeys.TuftleIdle, [TextureKeys.TuftleIdleA, TextureKeys.TuftleIdleB], 2, -1);
  add(AnimationKeys.TuftleMove, [TextureKeys.TuftleMoveA, TextureKeys.TuftleMoveB], 6, -1);
  add(AnimationKeys.TuftleHurt, [TextureKeys.TuftleHurt, TextureKeys.TuftleIdleA], 8, 0);
  add(AnimationKeys.CraghopperIdle, [TextureKeys.CraghopperIdleA, TextureKeys.CraghopperIdleB], 2, -1);
  add(AnimationKeys.CraghopperMove, [TextureKeys.CraghopperMoveA, TextureKeys.CraghopperMoveB], 7, -1);
  add(AnimationKeys.CraghopperHurt, [TextureKeys.CraghopperHurt, TextureKeys.CraghopperIdleA], 8, 0);
  add(AnimationKeys.GladeStagIdle, [TextureKeys.GladeStagIdleA, TextureKeys.GladeStagIdleB], 2, -1);
  add(AnimationKeys.GladeStagMove, [TextureKeys.GladeStagMoveA, TextureKeys.GladeStagMoveB], 7, -1);
  add(AnimationKeys.GladeStagHurt, [TextureKeys.GladeStagHurt, TextureKeys.GladeStagIdleA], 8, 0);
}

export function playerAnimationKey(facing: Facing, moving: boolean): string {
  if (facing === 'up') return moving ? AnimationKeys.PlayerWalkUp : AnimationKeys.PlayerIdleUp;
  if (facing === 'down') return moving ? AnimationKeys.PlayerWalkDown : AnimationKeys.PlayerIdleDown;
  return moving ? AnimationKeys.PlayerWalkSide : AnimationKeys.PlayerIdleSide;
}
