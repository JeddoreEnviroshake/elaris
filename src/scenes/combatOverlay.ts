import Phaser from 'phaser';
import {
  approachAlpha,
  damageNumberAppearance,
  damageNumberOffsetX,
  healthBarAlpha,
  healthBarColor,
  HIT_STOP_MS,
  type ResolvedCombatTarget,
  type StrikeOutcome,
  type StrikeStyle,
} from './combatPresentation';

/**
 * Phaser half of the combat presentation: the lock ring, floating damage
 * numbers, and the health bar that rides above whatever is currently taking
 * hits. The rules live in `combatPresentation`; this file only draws them.
 *
 * Bars are keyed by entity id rather than owned by sprites, because a raider's
 * sprite is destroyed and recreated as it enters and leaves the active chunk
 * while its health, and the player's memory of hitting it, must persist.
 */

const RING_COLOR = 0xffe08a;
const RING_OUT_OF_RANGE_COLOR = 0x9aa7a0;
const BAR_BACKING = 0x09140e;
const BAR_WIDTH = 22;
const BAR_HEIGHT = 4;
/** Ring pulse period; slow enough to read as "selected", not as an alarm. */
const RING_PULSE_MS = 1_400;

interface TrackedBar {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  lastDamagedAtMs: number;
  alpha: number;
}

export class CombatOverlay {
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly tracked = new Map<string, TrackedBar>();
  private sequence = 0;

  constructor(private readonly scene: Phaser.Scene, depth: number) {
    this.ring = scene.add.graphics().setDepth(depth);
    this.bars = scene.add.graphics().setDepth(depth);
  }

  /**
   * Record a hit. Damage is derived by the caller from before/after health, so
   * nothing in the simulation has to report presentation data back up.
   */
  reportHit(
    id: string,
    x: number,
    y: number,
    hp: number,
    maxHp: number,
    damage: number,
    style: StrikeStyle,
    outcome: StrikeOutcome,
  ): void {
    const now = this.scene.time.now;
    const entry = this.tracked.get(id);
    if (entry) {
      entry.x = x; entry.y = y; entry.hp = hp; entry.maxHp = maxHp;
      entry.lastDamagedAtMs = now;
    } else {
      this.tracked.set(id, { x, y, hp, maxHp, lastDamagedAtMs: now, alpha: 0 });
    }
    this.spawnNumber(x, y, damage, style, outcome);
  }

  /** A hostile hit floats over the character in danger red without a target bar. */
  reportPlayerDamage(x: number, y: number, damage: number): void {
    if (damage <= 0) return;
    this.spawnRawNumber(x, y, String(damage), '#ff5f57', 14, 26, 820);
  }

  /**
   * Ids with a live bar. Only recently-damaged entities are tracked, so the
   * caller can re-look-up every one of them each frame without it mattering.
   */
  trackedIds(): string[] {
    return [...this.tracked.keys()];
  }

  /** Keep a tracked bar's position and health current without counting as a hit. */
  observe(id: string, x: number, y: number, hp: number, maxHp: number): void {
    const entry = this.tracked.get(id);
    if (!entry) return;
    entry.x = x; entry.y = y; entry.hp = hp; entry.maxHp = maxHp;
  }

  /** Drop everything for an entity that left the world. */
  forget(id: string): void {
    this.tracked.delete(id);
  }

  /** Drop every bar, for an area change or a load. */
  clear(): void {
    this.tracked.clear();
    this.ring.clear();
    this.bars.clear();
  }

  /**
   * Brief freeze on a struck sprite. Scale is restored rather than tweened back
   * so a second hit landing mid-effect cannot leave the sprite stretched.
   */
  playHitStop(sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite): void {
    const baseScaleX = sprite.scaleX;
    const baseScaleY = sprite.scaleY;
    sprite.setScale(baseScaleX * 1.08, baseScaleY * 0.94);
    this.scene.time.delayedCall(HIT_STOP_MS, () => {
      if (sprite.active) sprite.setScale(baseScaleX, baseScaleY);
    });
  }

  private spawnNumber(
    x: number,
    y: number,
    damage: number,
    style: StrikeStyle,
    outcome: StrikeOutcome,
  ): void {
    const appearance = damageNumberAppearance(style, outcome, damage);
    this.spawnRawNumber(
      x,
      y,
      appearance.text,
      appearance.color,
      appearance.fontSizePx,
      appearance.riseP,
      outcome === 'crit' ? 900 : 720,
    );
  }

  private spawnRawNumber(
    x: number,
    y: number,
    text: string,
    color: string,
    fontSizePx: number,
    risePx: number,
    durationMs: number,
  ): void {
    const offsetX = damageNumberOffsetX(this.sequence);
    this.sequence += 1;
    const label = this.scene.add
      .text(x + offsetX, y - 20, text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: `${fontSizePx}px`,
        color,
        stroke: '#09140e',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(this.ring.depth + 1);
    this.scene.tweens.add({
      targets: label,
      y: y - 20 - risePx,
      alpha: 0,
      duration: durationMs,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  /** Redraw the ring and every live bar. Called once per rendered frame. */
  draw(target: ResolvedCombatTarget | null, deltaMs: number): void {
    const now = this.scene.time.now;

    this.ring.clear();
    if (target) {
      // A locked target is always ringed, but greys out past reach so "too far"
      // is visible in the world and not only in the button label.
      const pulse = 1 + 0.08 * Math.sin((now / RING_PULSE_MS) * Math.PI * 2);
      this.ring
        .lineStyle(1, target.inRange ? RING_COLOR : RING_OUT_OF_RANGE_COLOR, target.inRange ? 0.9 : 0.5)
        .strokeEllipse(target.x, target.y + 2, 20 * pulse, 10 * pulse);
    }

    this.bars.clear();
    for (const [id, entry] of this.tracked) {
      const wanted = healthBarAlpha(now, entry.lastDamagedAtMs, entry.hp, entry.maxHp);
      entry.alpha = approachAlpha(entry.alpha, wanted, deltaMs);
      if (entry.alpha <= 0.01) {
        // Fully faded and at full health: the entity is healthy and idle, so
        // stop paying for it. A later hit re-adds it.
        if (wanted <= 0) this.tracked.delete(id);
        continue;
      }
      const ratio = Math.max(0, Math.min(1, entry.hp / Math.max(1, entry.maxHp)));
      const left = entry.x - BAR_WIDTH / 2;
      const top = entry.y - 24;
      this.bars
        .fillStyle(BAR_BACKING, 0.85 * entry.alpha)
        .fillRect(left, top, BAR_WIDTH, BAR_HEIGHT)
        .fillStyle(healthBarColor(ratio), entry.alpha)
        .fillRect(left + 1, top + 1, Math.max(1, Math.round((BAR_WIDTH - 2) * ratio)), BAR_HEIGHT - 2);
    }
  }

  destroy(): void {
    this.ring.destroy();
    this.bars.destroy();
    this.tracked.clear();
  }
}
