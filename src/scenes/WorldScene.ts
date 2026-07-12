import Phaser from 'phaser';
import { generateWorldTextures, TextureKeys } from '../art/proceduralTextures';
import { DEFAULT_WORLD_SEED, FIXED_STEP_MS, WORLD_PX } from '../config/platform';
import { computeLayout } from '../platform/responsiveLayout';
import type { MoveIntent } from '../simulation/commands';
import { NO_MOVE, stepMovement } from '../simulation/commands';
import { FixedStepLoop } from '../simulation/fixedStep';
import { createRng } from '../simulation/rng';
import type { GameState } from '../simulation/state';
import { createInitialState } from '../simulation/state';
import { TouchJoystick } from '../ui/touchControls';

export interface WorldSceneData {
  state?: GameState;
  /** Called when the player moves, so the save layer can debounce a save. */
  onMoved?: () => void;
}

interface MovementKeys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  slow: Phaser.Input.Keyboard.Key;
}

export class WorldScene extends Phaser.Scene {
  state!: GameState;
  private onMoved: () => void = () => {};
  private loop!: FixedStepLoop;
  private player!: Phaser.GameObjects.Image;
  private joystick!: TouchJoystick;
  private keys: MovementKeys | null = null;
  private altKeys: MovementKeys | null = null;
  private intent: MoveIntent = NO_MOVE;

  constructor() {
    super('world');
  }

  init(data: WorldSceneData): void {
    this.state = data.state ?? createInitialState(DEFAULT_WORLD_SEED);
    if (data.onMoved) this.onMoved = data.onMoved;
  }

  create(): void {
    generateWorldTextures(this);
    this.buildGround();
    this.scatterDecorations();

    this.player = this.add
      .image(this.state.player.x, this.state.player.y, TextureKeys.Player)
      .setOrigin(0.5, 0.9);

    this.setupCamera();
    this.setupInput();

    this.loop = new FixedStepLoop(FIXED_STEP_MS, (stepMs) =>
      stepMovement(this.state, this.intent, stepMs),
    );

    this.applyLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
  }

  override update(_time: number, deltaMs: number): void {
    this.intent = this.gatherInput();
    this.loop.advance(deltaMs);
    if (this.intent.x !== 0 || this.intent.y !== 0) this.onMoved();

    const { x, y } = this.state.player;
    this.player.setPosition(Math.round(x), Math.round(y));
    this.player.setDepth(y);
  }

  private buildGround(): void {
    this.add
      .tileSprite(0, 0, WORLD_PX, WORLD_PX, TextureKeys.Ground)
      .setOrigin(0, 0)
      .setDepth(-WORLD_PX);
    this.cameras.main.setBackgroundColor('#1a2c22');
  }

  /** Deterministic decoration scatter for visual reference (real worldgen is M1). */
  private scatterDecorations(): void {
    const rng = createRng(this.state.seed ^ 0x9e3779b9);
    const center = WORLD_PX / 2;
    const clearRadius = 96;
    const place = (key: string, count: number): void => {
      for (let i = 0; i < count; i++) {
        const x = rng.nextInt(16, WORLD_PX - 16);
        const y = rng.nextInt(16, WORLD_PX - 16);
        if (Math.hypot(x - center, y - center) < clearRadius) continue;
        this.add.image(x, y, key).setOrigin(0.5, 0.9).setDepth(y);
      }
    };
    place(TextureKeys.Tree, 320);
    place(TextureKeys.Rock, 180);
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_PX, WORLD_PX);
    cam.setRoundPixels(true);
    cam.startFollow(this.player, true, 0.15, 0.15);
  }

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        up: kb.addKey(K.W),
        down: kb.addKey(K.S),
        left: kb.addKey(K.A),
        right: kb.addKey(K.D),
        slow: kb.addKey(K.SHIFT),
      };
      this.altKeys = {
        up: kb.addKey(K.UP),
        down: kb.addKey(K.DOWN),
        left: kb.addKey(K.LEFT),
        right: kb.addKey(K.RIGHT),
        slow: kb.addKey(K.SHIFT),
      };
    }

    const parent = document.getElementById('app') ?? document.body;
    this.joystick = new TouchJoystick(parent);
  }

  private gatherInput(): MoveIntent {
    const stick = this.joystick.getVector();
    if (stick.magnitude > 0.05) {
      return { x: stick.x, y: stick.y, slow: false };
    }

    let x = 0;
    let y = 0;
    let slow = false;
    for (const set of [this.keys, this.altKeys]) {
      if (!set) continue;
      if (set.left.isDown) x -= 1;
      if (set.right.isDown) x += 1;
      if (set.up.isDown) y -= 1;
      if (set.down.isDown) y += 1;
      if (set.slow.isDown) slow = true;
    }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    return { x, y, slow };
  }

  private applyLayout = (): void => {
    const layout = computeLayout({
      width: this.scale.gameSize.width,
      height: this.scale.gameSize.height,
    });
    this.cameras.main.setZoom(layout.zoom);
  };

  private teardown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.joystick.destroy();
  }
}
