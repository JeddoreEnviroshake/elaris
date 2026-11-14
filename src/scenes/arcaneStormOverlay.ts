import Phaser from 'phaser';
import type { GameState } from '../simulation/state';
import {
  ARCANE_IMPACT_AFTERMATH_TICKS,
  activeStormStrikes,
  stormImpactRadiusPx,
} from '../simulation/arcaneStorm';

/**
 * The strike markers themselves, drawn above the storm's violet wash.
 *
 * Presentation only, and deliberately so: every circle here is read straight
 * off the saved strike records, and nothing on screen decides whether the
 * player was hit. The ring is the exact damage radius, so what the player sees
 * and what the simulation measures are the same shape.
 */

/** Outer ring: the damage area, drawn at full radius the moment it appears. */
const RING_COLOR = 0x9a6bff;
const RING_ALPHA = 0.85;
const RING_WIDTH = 2;
const FILL_COLOR = 0x4a2a9a;
const FILL_ALPHA = 0.22;
/** Reward strikes carry a gold core from the first frame, not on landing. */
const REWARD_COLOR = 0xffcb5c;
const IMPACT_COLOR = 0xf1e6ff;
const SHARD_COUNT = 8;

export class ArcaneStormOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    scene: Phaser.Scene,
    private readonly state: GameState,
    depth: number,
  ) {
    this.graphics = scene.add.graphics().setDepth(depth);
  }

  update(): void {
    this.graphics.clear();
    const strikes = activeStormStrikes(this.state);
    if (strikes.length === 0) return;

    const radius = stormImpactRadiusPx(this.state.gameBalance.storm);
    for (const strike of strikes) {
      if (strike.resolvedAtTick !== null) {
        this.drawAftermath(strike.x, strike.y, radius, (this.state.tick - strike.resolvedAtTick) / ARCANE_IMPACT_AFTERMATH_TICKS);
        continue;
      }
      const window = Math.max(1, strike.impactAtTick - strike.telegraphAtTick);
      const progress = Phaser.Math.Clamp((this.state.tick - strike.telegraphAtTick) / window, 0, 1);
      this.drawTelegraph(strike.x, strike.y, radius, progress, strike.rewardIronOre > 0);
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }

  /**
   * A fixed outer ring showing exactly where the damage will fall, and an inner
   * ring contracting toward the centre as the deadline approaches. Two circles
   * rather than a colour ramp: the countdown has to be readable at a glance,
   * over a violet wash, by someone who is running.
   */
  private drawTelegraph(x: number, y: number, radius: number, progress: number, rewarded: boolean): void {
    const graphics = this.graphics;
    graphics.fillStyle(FILL_COLOR, FILL_ALPHA * (0.5 + 0.5 * progress));
    graphics.fillCircle(x, y, radius);
    graphics.lineStyle(RING_WIDTH, RING_COLOR, RING_ALPHA);
    graphics.strokeCircle(x, y, radius);

    // With reduced motion the inner ring holds still and steps up in opacity
    // instead of sweeping inward, so the countdown never becomes a moving edge.
    if (this.reducedMotion) {
      graphics.lineStyle(RING_WIDTH, RING_COLOR, 0.3 + 0.6 * progress);
      graphics.strokeCircle(x, y, radius * 0.55);
    } else {
      graphics.lineStyle(RING_WIDTH, RING_COLOR, 0.9);
      graphics.strokeCircle(x, y, Math.max(1, radius * (1 - progress)));
    }

    if (!rewarded) return;
    // Gold from the moment it is telegraphed: the decision the reward asks for —
    // stand close, leave late — can only be made while there is still time.
    graphics.fillStyle(REWARD_COLOR, 0.9);
    graphics.fillCircle(x, y, Math.max(2, radius * 0.18));
  }

  /** A brief white-violet flash and a shard burst where a strike landed. */
  private drawAftermath(x: number, y: number, radius: number, progress: number): void {
    const graphics = this.graphics;
    const fade = 1 - Phaser.Math.Clamp(progress, 0, 1);
    graphics.fillStyle(IMPACT_COLOR, 0.55 * fade);
    graphics.fillCircle(x, y, radius * (this.reducedMotion ? 1 : 0.6 + 0.4 * progress));
    if (this.reducedMotion) return;

    graphics.lineStyle(RING_WIDTH, IMPACT_COLOR, 0.8 * fade);
    for (let index = 0; index < SHARD_COUNT; index += 1) {
      const angle = (index / SHARD_COUNT) * Math.PI * 2;
      const inner = radius * (0.3 + 0.5 * progress);
      const outer = inner + radius * 0.35;
      graphics.lineBetween(
        x + Math.cos(angle) * inner,
        y + Math.sin(angle) * inner,
        x + Math.cos(angle) * outer,
        y + Math.sin(angle) * outer,
      );
    }
  }
}
