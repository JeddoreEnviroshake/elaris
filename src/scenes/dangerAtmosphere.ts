import Phaser from 'phaser';
import { TILE_SIZE, WORLD_PX } from '../config/platform';
import type { GameState } from '../simulation/state';
import { survivalSchedule, type DangerThreat } from '../simulation/survivalCycle';
import { DANGER_PRESENTATION, dangerSafeCells, purifierProtectedCells } from './dangerPresentation';

/**
 * Presentation-only cue for the danger minute: every unsafe tile receives a
 * threat-specific wash. Poison fog is dark green, raids are moonless blue-
 * black, and an arcane storm is violet. Whatever the threat treats as safe is
 * punched back out so the player can see both protected and affected ground at
 * once, even while standing in safety — which for a storm means Elaris and
 * nothing else.
 *
 * Named for the atmosphere rather than the fog because it renders all three
 * threats; the strike markers drawn on top of it are a separate overlay, in
 * arcaneStormOverlay.ts.
 */

const WISP_TEXTURE_KEY = 'danger-fog-wisp';
const WISP_TEXTURE_SIZE = 128;
const WISP_COUNT = 10;
const WISP_RENDER_SIZE = 260;

const FADE_IN_MS = 900;
const FADE_OUT_MS = 700;
/** Rooms only change when the player builds, so a coarse refresh is plenty. */
const MASK_REFRESH_MS = 400;
const PROTECTION_HIGHLIGHT_COLOR = 0x5daee8;
const PROTECTION_HIGHLIGHT_ALPHA = 0.16;
/** One step above player-built floor sprites, but below every actor and facility. */
const PROTECTION_HIGHLIGHT_DEPTH = -999;

/** Fixed per-wisp drift so the fog looks alive without a per-frame RNG. */
const WISP_DRIFT: ReadonlyArray<{ x: number; y: number; phase: number }> = [
  { x: 9, y: -4, phase: 0.00 },
  { x: -7, y: 5, phase: 0.61 },
  { x: 12, y: 3, phase: 1.27 },
  { x: -11, y: -6, phase: 2.04 },
  { x: 6, y: 8, phase: 2.71 },
  { x: -5, y: -9, phase: 3.38 },
  { x: 14, y: 2, phase: 4.05 },
  { x: -13, y: 6, phase: 4.72 },
  { x: 8, y: -7, phase: 5.39 },
  { x: -9, y: 4, phase: 6.06 },
];

export class DangerAtmosphereOverlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly base: Phaser.GameObjects.Rectangle;
  private readonly wisps: Phaser.GameObjects.Image[] = [];
  private readonly maskGraphics: Phaser.GameObjects.Graphics;
  private readonly protectionGraphics: Phaser.GameObjects.Graphics;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private strength = 0;
  private maskRefreshedAt = Number.NEGATIVE_INFINITY;
  private protectionRefreshedAt = Number.NEGATIVE_INFINITY;
  private maskSignature: string | null = null;
  private protectionSignature: string | null = null;
  private elapsedMs = 0;
  private threat: DangerThreat | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    depth: number,
  ) {
    ensureWispTexture(scene);
    const initial = DANGER_PRESENTATION.fog;
    this.base = scene.add.rectangle(0, 0, WORLD_PX, WORLD_PX, initial.baseColor, initial.baseAlpha).setOrigin(0, 0);
    for (let index = 0; index < WISP_COUNT; index += 1) {
      this.wisps.push(scene.add
        .image(0, 0, WISP_TEXTURE_KEY)
        .setDisplaySize(WISP_RENDER_SIZE, WISP_RENDER_SIZE)
        .setTint(initial.wispColors[index % initial.wispColors.length]!));
    }
    this.container = scene.add.container(0, 0, [this.base, ...this.wisps]).setDepth(depth).setVisible(false);

    this.protectionGraphics = scene.add.graphics().setDepth(PROTECTION_HIGHLIGHT_DEPTH);

    this.maskGraphics = scene.make.graphics({ x: 0, y: 0 }, false);
    const mask = this.maskGraphics.createGeometryMask();
    mask.setInvertAlpha(true); // show the fog everywhere the safe rooms are not
    this.container.setMask(mask);
  }

  update(deltaMs: number): void {
    this.refreshProtectionHighlight();
    const timer = survivalSchedule(this.state);
    const danger = timer.phase === 'danger';
    if (timer.threat !== this.threat) this.applyThreat(timer.threat);
    const fadeMs = danger ? FADE_IN_MS : FADE_OUT_MS;
    this.strength = Phaser.Math.Clamp(this.strength + (danger ? deltaMs : -deltaMs) / fadeMs, 0, 1);
    if (this.strength === 0) {
      if (this.container.visible) this.container.setVisible(false);
      return;
    }

    if (!this.reducedMotion) this.elapsedMs += deltaMs;
    this.container.setVisible(true).setAlpha(this.strength);
    this.refreshSafeRoomMask();
    this.layoutWisps();
  }

  private applyThreat(threat: DangerThreat): void {
    this.threat = threat;
    this.maskSignature = null;
    const style = DANGER_PRESENTATION[threat];
    this.base.setFillStyle(style.baseColor, style.baseAlpha);
    this.wisps.forEach((wisp, index) => {
      wisp.setTint(style.wispColors[index % style.wispColors.length]!);
    });
  }

  destroy(): void {
    this.container.clearMask(true);
    this.container.destroy(true);
    this.maskGraphics.destroy();
    this.protectionGraphics.destroy();
  }

  /** Keep the fog covering the viewport wherever the camera has wandered. */
  private layoutWisps(): void {
    const view = this.scene.cameras.main.worldView;
    const spanX = view.width + WISP_RENDER_SIZE;
    const spanY = view.height + WISP_RENDER_SIZE;
    const seconds = this.elapsedMs / 1000;

    this.wisps.forEach((wisp, index) => {
      const drift = WISP_DRIFT[index]!;
      const spread = (index + 0.5) / WISP_COUNT;
      const stagger = ((index * 7) % WISP_COUNT + 0.5) / WISP_COUNT;
      wisp.setPosition(
        view.left - WISP_RENDER_SIZE / 2 + wrap(spread * spanX + drift.x * seconds, spanX),
        view.top - WISP_RENDER_SIZE / 2 + wrap(stagger * spanY + drift.y * seconds, spanY),
      );
      wisp.setAlpha(0.34 + 0.14 * Math.sin(seconds * 0.55 + drift.phase));
    });
  }

  /** Rebuild the punched-out safe rooms only when the room layout actually moved. */
  private refreshSafeRoomMask(): void {
    const now = this.scene.time.now;
    if (now - this.maskRefreshedAt < MASK_REFRESH_MS) return;
    this.maskRefreshedAt = now;

    const cells = dangerSafeCells(this.state, this.threat ?? 'fog');
    const signature = cells.join('|');
    if (signature === this.maskSignature) return;
    this.maskSignature = signature;

    this.maskGraphics.clear().fillStyle(0xffffff, 1);
    for (const cell of cells) {
      const [tileX, tileY] = cell.split(',').map(Number) as [number, number];
      this.maskGraphics.fillRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  /** Keep purifier coverage legible before the fog arrives, without overpowering the floor art. */
  private refreshProtectionHighlight(): void {
    const now = this.scene.time.now;
    if (now - this.protectionRefreshedAt < MASK_REFRESH_MS) return;
    this.protectionRefreshedAt = now;

    const cells = purifierProtectedCells(this.state);
    const signature = cells.join('|');
    if (signature === this.protectionSignature) return;
    this.protectionSignature = signature;

    this.protectionGraphics.clear().fillStyle(PROTECTION_HIGHLIGHT_COLOR, PROTECTION_HIGHLIGHT_ALPHA);
    for (const cell of cells) {
      const [tileX, tileY] = cell.split(',').map(Number) as [number, number];
      this.protectionGraphics.fillRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
}

function wrap(value: number, span: number): number {
  return ((value % span) + span) % span;
}

/** A soft radial puff, tinted per wisp so one texture covers the whole fog. */
function ensureWispTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(WISP_TEXTURE_KEY)) return;
  const canvas = scene.textures.createCanvas(WISP_TEXTURE_KEY, WISP_TEXTURE_SIZE, WISP_TEXTURE_SIZE);
  const context = canvas?.getContext();
  if (!canvas || !context) return;

  const center = WISP_TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.32)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, WISP_TEXTURE_SIZE, WISP_TEXTURE_SIZE);
  canvas.refresh();
}
