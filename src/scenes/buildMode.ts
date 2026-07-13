import Phaser from 'phaser';
import { TextureKeys } from '../art/proceduralTextures';
import { TILE_SIZE } from '../config/platform';
import type { BuildingState, GameState } from '../simulation/state';
import {
  buildableById,
  checkPlacement,
  clampTileToBounds,
  defaultGhostTile,
  placeBuilding,
  tileFromWorld,
  type BuildableDefinition,
  type BuildableId,
  type PlacementCheck,
  type PlaceResult,
} from './buildPlacement';

export interface BuildModeCallbacks {
  /** Fired whenever the ghost's placement validity (or its reason) changes. */
  onValidity: (check: PlacementCheck) => void;
  /** Fired for every confirm attempt, successful or not. */
  onPlaced: (result: PlaceResult) => void;
}

const GHOST_DEPTH = 1_000_000;
const VALID_TINT = 0xa5f0bd;
const INVALID_TINT = 0xff9a9a;

const BUILDABLE_TEXTURES: Readonly<Record<BuildableId, string>> = {
  'palisade-wall': TextureKeys.Wall,
  'field-cache': TextureKeys.FieldCache,
  workbench: TextureKeys.Workbench,
  'garden-bed': TextureKeys.GardenBed,
  'woodlot-planter': TextureKeys.Planter,
};

/** Placed-sprite texture reflects building state (a ready Garden Bed reads at a glance). */
function textureForBuilding(building: BuildingState): string {
  if (building.definitionId === 'garden-bed' && (building.garden?.readyFiber ?? 0) > 0) {
    return TextureKeys.GardenBedReady;
  }
  if (building.definitionId === 'woodlot-planter' && (building.woodlot?.readyWood ?? 0) > 0) {
    return TextureKeys.PlanterReady;
  }
  return BUILDABLE_TEXTURES[building.definitionId];
}

/**
 * Owns the placement ghost and the placed-structure sprites. Placement is now
 * the authoritative simulation's (via buildPlacement.ts → gameplayCommands):
 * commands persist to `state.buildings` and enforce enclosure/area gates, so
 * this class renders from that persisted list rather than a session-local copy.
 * Pure presentation: snap the ghost to tiles, tint it by validity, commit on
 * confirm, and keep sprites reconciled with `state.buildings`.
 */
export class BuildModeController {
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>();
  private ghost: Phaser.GameObjects.Image | null = null;
  private def: BuildableDefinition | null = null;
  private ghostTileX = 0;
  private ghostTileY = 0;
  private lastValidity: PlacementCheck | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly callbacks: BuildModeCallbacks,
  ) {
    this.syncPlaced();
  }

  get placing(): boolean {
    return this.ghost !== null;
  }

  startPlacing(id: BuildableId): void {
    this.cancel();
    this.def = buildableById(id);
    const { tileX, tileY } = defaultGhostTile(this.state, this.def);
    this.ghostTileX = tileX;
    this.ghostTileY = tileY;
    this.ghost = this.scene.add
      .image(tileX * TILE_SIZE, tileY * TILE_SIZE, BUILDABLE_TEXTURES[this.def.id])
      .setOrigin(0, 0)
      .setAlpha(0.65)
      .setDepth(GHOST_DEPTH);
    this.refreshValidity(true);
  }

  /** Snap the ghost to the tile under a world position (pointer move/tap). */
  moveGhostToWorld(worldX: number, worldY: number): void {
    if (!this.ghost || !this.def) return;
    const snapped = clampTileToBounds(
      tileFromWorld(worldX - ((this.def.tilesWide - 1) * TILE_SIZE) / 2),
      tileFromWorld(worldY - ((this.def.tilesHigh - 1) * TILE_SIZE) / 2),
      this.def,
    );
    if (snapped.tileX === this.ghostTileX && snapped.tileY === this.ghostTileY) return;
    this.ghostTileX = snapped.tileX;
    this.ghostTileY = snapped.tileY;
    this.ghost.setPosition(snapped.tileX * TILE_SIZE, snapped.tileY * TILE_SIZE);
    this.refreshValidity();
  }

  /** Touch taps position the ghost; mouse clicks position AND confirm. */
  handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.placing) return;
    this.moveGhostToWorld(pointer.worldX, pointer.worldY);
    if (!pointer.wasTouch) this.confirm();
  }

  handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.placing) return;
    // Mouse hover follows; touch repositions only while dragging on the canvas.
    if (!pointer.wasTouch || pointer.isDown) this.moveGhostToWorld(pointer.worldX, pointer.worldY);
  }

  confirm(): boolean {
    if (!this.ghost || !this.def) return false;
    const keepPlacing = this.def.id === 'palisade-wall';
    const result = placeBuilding(
      this.state,
      this.state.buildings,
      this.def,
      this.ghostTileX,
      this.ghostTileY,
    );
    if (result.ok && result.building) {
      this.addPlacedSprite(result.building);
      if (keepPlacing) this.refreshValidity(true);
      else this.cancel();
    }
    this.callbacks.onPlaced(result);
    return result.ok;
  }

  cancel(): void {
    this.ghost?.destroy();
    this.ghost = null;
    this.def = null;
    this.lastValidity = null;
  }

  /** Cheap per-frame revalidation — walking changes range/overlap validity. */
  refreshValidity(force = false): void {
    if (!this.ghost || !this.def) return;
    const check = checkPlacement(this.state, this.state.buildings, this.def, this.ghostTileX, this.ghostTileY);
    this.ghost.setTint(check.ok ? VALID_TINT : INVALID_TINT);
    if (
      force ||
      this.lastValidity === null ||
      this.lastValidity.ok !== check.ok ||
      this.lastValidity.message !== check.message
    ) {
      this.lastValidity = check;
      this.callbacks.onValidity(check);
    }
  }

  /** Reconcile sprites with `state.buildings` — renders saves on load, drops removed, and swaps state-driven textures. */
  syncPlaced(): void {
    for (const [id, sprite] of this.sprites) {
      if (!this.state.buildings.some((building) => building.id === id)) {
        sprite.destroy();
        this.sprites.delete(id);
      }
    }
    for (const building of this.state.buildings) {
      const sprite = this.sprites.get(building.id);
      if (!sprite) this.addPlacedSprite(building);
      else if (sprite.texture.key !== textureForBuilding(building)) sprite.setTexture(textureForBuilding(building));
    }
  }

  private addPlacedSprite(building: BuildingState): void {
    if (this.sprites.has(building.id)) return;
    const def = buildableById(building.definitionId);
    const sprite = this.scene.add
      .image(building.tileX * TILE_SIZE, building.tileY * TILE_SIZE, textureForBuilding(building))
      .setOrigin(0, 0)
      .setDepth((building.tileY + def.tilesHigh) * TILE_SIZE);
    this.sprites.set(building.id, sprite);
  }

  destroy(): void {
    this.cancel();
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }
}
