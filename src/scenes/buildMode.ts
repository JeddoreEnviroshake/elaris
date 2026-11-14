import Phaser from 'phaser';
import { TextureKeys } from '../art/proceduralTextures';
import { buildingTextureKey, ENCLOSURE_GUIDE_WIDTH, markerTextureKey } from '../art/buildingTextures';
import { TILE_SIZE } from '../config/platform';
import type { BoundaryEdge, BuildingState, EnvironmentKind, GameState } from '../simulation/state';
import type { CommandResult } from '../simulation/gameplayCommands';
import { boundaryCenterPx, boundarySpan, buildingCenterPx, effectiveBoundaryEdge, effectiveBuildingDimensions, effectiveDimensions, placementDimensions } from '../simulation/buildingGeometry';
import { enclosureGaps } from '../simulation/environmentProgress';
import { EntityChunkIndex, type EntityActivationCounts } from './entityChunks';
import type { BuildPlacementPresentation } from '../three/presentationState';
import {
  buildableById,
  BUILD_RANGE_PX,
  checkPlacement,
  clampTileToBounds,
  defaultGhostTile,
  defaultBoundaryEdgeFromFacing,
  placeBuilding,
  placementTargetFromWorld,
  undoBuildingPlacement,
  type BuildableDefinition,
  type BuildableId,
  type PlacementCheck,
  type PlaceResult,
} from './buildPlacement';
import { nearestBuilding, nextBuildingInDirection } from './deleteSelection';
import { batchCost, checkBuildBatch, placeBuildBatch, shapedBuildRequests, undoBuildGroup, type BuildRequest, type PlacementShape } from '../simulation/batchBuilding';
export interface BatchPreview { mode: PlacementShape; anchored: boolean; count: number; cost: ReturnType<typeof batchCost>; fixed: boolean }

export interface BuildModeCallbacks {
  onBatchPreview?: (preview: BatchPreview | null) => void;
  /** Fired whenever the ghost's placement validity (or its reason) changes. */
  onValidity: (check: PlacementCheck) => void;
  /** Fired for every confirm attempt, successful or not. */
  onPlaced: (result: PlaceResult) => void;
  /** Fired after an immediate placement undo. */
  onUndo: (result: CommandResult) => void;
  /** Keeps the Undo control honest as placement history changes. */
  onUndoAvailable: (available: boolean) => void;
  /**
   * Fired after a stationary press is held on a placed building — a hold on a
   * floor, wall, or utility is how the player asks to take it down.
   */
  onBuildingLongPress: (building: BuildingState, clientX: number, clientY: number) => void;
  /** Fired whenever the Delete-mode cursor lands on a different part (or none). */
  onDeleteTarget: (building: BuildingState | null) => void;
}

const GHOST_DEPTH = 1_000_000;
const VALID_TINT = 0xa5f0bd;
const INVALID_TINT = 0xff9a9a;
const LONG_PRESS_MS = 550;
const LONG_PRESS_DRIFT_PX = 10;

const BUILDABLE_TEXTURES: Readonly<Record<BuildableId, string>> = {
  'thatch-floor': TextureKeys.FloorThatch,
  'wood-floor': TextureKeys.FloorWood,
  'stone-floor': TextureKeys.FloorWood,
  'metal-floor': TextureKeys.FloorWood,
  'thatch-ground': TextureKeys.GroundThatch,
  'wood-ground': TextureKeys.GroundWood,
  'stone-ground': TextureKeys.GroundWood,
  'metal-ground': TextureKeys.GroundWood,
  'thatch-wall': TextureKeys.WallThatch,
  'wood-wall': TextureKeys.Wall,
  'stone-wall': TextureKeys.Wall,
  'metal-wall': TextureKeys.Wall,
  'thatch-door': TextureKeys.DoorThatch,
  'wood-door': TextureKeys.DoorWood,
  'stone-door': TextureKeys.DoorWood,
  'metal-door': TextureKeys.DoorWood,
  'thatch-fence': TextureKeys.FenceThatch,
  'wood-fence': TextureKeys.FenceWood,
  'stone-fence': TextureKeys.FenceWood,
  'metal-fence': TextureKeys.FenceWood,
  'thatch-gate': TextureKeys.GateThatch,
  'wood-gate': TextureKeys.GateWood,
  'stone-gate': TextureKeys.GateWood,
  'metal-gate': TextureKeys.GateWood,
  'wood-bridge': TextureKeys.BridgeWood,
  'stone-bridge': TextureKeys.BridgeStone,
  water: TextureKeys.WaterPlaced,
  'environment-marker': TextureKeys.Marker,
  'field-cache': TextureKeys.FieldCache,
  workbench: TextureKeys.Workbench,
  warehouse: TextureKeys.FieldCache,
  'logistics-hub': TextureKeys.Workbench,
  furnace: TextureKeys.Furnace,
  'farm-counter': TextureKeys.Workbench,
  'small-pen': TextureKeys.FenceWood,
  barn: TextureKeys.WarTable,
  'stone-yard': TextureKeys.Furnace,
  'cart-dock': TextureKeys.FieldCache,
  bed: TextureKeys.Bed,
  'air-purifier': TextureKeys.AirPurifier,
  'garden-bed': TextureKeys.GardenBed,
  'woodlot-planter': TextureKeys.Planter,
  'war-table': TextureKeys.WarTable,
  turret: TextureKeys.Turret,
};

/** Surfaces render beneath every actor; other parts y-sort like entities. */
const SURFACE_DEPTH = -1_000;
const LANDSCAPE_WATER_DEPTH = -1_200;
const LANDSCAPE_BRIDGE_DEPTH = -1_100;

/** Closed frame + four opening frames per door material (see proceduralTextures). */
const OPENING_SWING_FRAMES: Readonly<Partial<Record<BuildableId, readonly string[]>>> = {
  'wood-door': [
    TextureKeys.DoorWood, TextureKeys.DoorWoodSwing1, TextureKeys.DoorWoodSwing2,
    TextureKeys.DoorWoodSwing3, TextureKeys.DoorWoodSwing4,
  ],
  'thatch-door': [
    TextureKeys.DoorThatch, TextureKeys.DoorThatchSwing1, TextureKeys.DoorThatchSwing2,
    TextureKeys.DoorThatchSwing3, TextureKeys.DoorThatchSwing4,
  ],
  'wood-gate': [
    TextureKeys.GateWood, TextureKeys.GateWoodSwing1, TextureKeys.GateWoodSwing2,
    TextureKeys.GateWoodSwing3, TextureKeys.GateWoodSwing4,
  ],
  'thatch-gate': [
    TextureKeys.GateThatch, TextureKeys.GateThatchSwing1, TextureKeys.GateThatchSwing2,
    TextureKeys.GateThatchSwing3, TextureKeys.GateThatchSwing4,
  ],
};

/** Fallback advance direction before the player has touched the d-pad. */
const FACING_STEPS: Readonly<Record<string, { dx: number; dy: number }>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** A door starts opening once the player is within this radius of its opening. */
const DOOR_OPEN_RADIUS = TILE_SIZE * 1.35;
/** Full open/close swing time; deltaMs drives the eased approach each frame. */
const DOOR_SWING_MS = 180;

function applyBuildingTransform(
  image: Phaser.GameObjects.Image,
  building: Pick<BuildingState, 'tileX' | 'tileY' | 'boundaryEdge' | 'rotated'>,
  def: BuildableDefinition,
): void {
  if (def.layer !== 'boundary') {
    const dimensions = effectiveDimensions(def, building.rotated);
    image
      .setOrigin(0.5, 0.5)
      .setAngle(building.rotated ? 90 : 0)
      .setPosition(
        (building.tileX + dimensions.tilesWide / 2) * TILE_SIZE,
        (building.tileY + dimensions.tilesHigh / 2) * TILE_SIZE,
      );
    return;
  }
  const edge = effectiveBoundaryEdge(building);
  const horizontal = edge === 'north' || edge === 'south';
  const span = boundarySpan(def);
  const { x, y } = boundaryCenterPx(building.tileX, building.tileY, edge, span);
  const angle = horizontal ? 0 : 90;
  image.setOrigin(0.5, 0.5).setScale(span, 1).setAngle(angle).setPosition(x, y);
}

/** Placed-sprite texture reflects building state (a ready Garden Bed reads at a glance). */
function textureForBuilding(building: BuildingState): string {
  return buildingTextureKey(building) ?? BUILDABLE_TEXTURES[building.definitionId];
}

/**
 * Owns the placement ghost and the placed-structure sprites. Placement is now
 * the authoritative simulation's (via buildPlacement.ts → gameplayCommands):
 * commands persist to `state.buildings` and enforce unlock/geometry rules, so
 * this class renders from that persisted list rather than a session-local copy.
 * Pure presentation: snap the ghost to tiles, tint it by validity, commit on
 * confirm, and keep sprites reconciled with `state.buildings`.
 */
export class BuildModeController {
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly chunks = new EntityChunkIndex();
  private activeSpriteIds = new Set<string>();
  /** Placed door ids and their current openness (0 closed → 1 open) for the swing. */
  private readonly openingIds = new Set<string>();
  private readonly openingOpenness = new Map<string, number>();
  private ghost: Phaser.GameObjects.Image | null = null;
  private def: BuildableDefinition | null = null;
  private ghostTileX = 0;
  private ghostTileY = 0;
  private ghostRotated = false;
  private ghostBoundaryEdge: BoundaryEdge | null = null;
  private lastValidity: PlacementCheck | null = null;
  private readonly placementHistory: string[][] = [];
  private shape: PlacementShape = 'single';
  private batchAnchor: { tileX: number; tileY: number; edge: BoundaryEdge } | null = null;
  private fixedBatch: BuildRequest[] | null = null;
  private batchCacheKey = '';
  private batchCheck: PlacementCheck | null = null;
  /** Last d-pad nudge, so a confirmed placement advances the way the player was going. */
  private lastStep: { dx: number; dy: number } | null = null;
  /** Placed building the item menu (or the Delete cursor) is targeting; drawn in the blocked-placement red. */
  private selectedBuildingId: string | null = null;
  /** Delete mode: the d-pad steers the red cursor and Delete is the only commit. */
  private deleting = false;
  private markerKind: EnvironmentKind = 'indoor';
  private buildingPress: {
    pointerId: number;
    buildingId: string;
    screenX: number;
    screenY: number;
    clientX: number;
    clientY: number;
    opened: boolean;
    timer: Phaser.Time.TimerEvent;
  } | null = null;
  private gapOverlay: Phaser.GameObjects.Graphics | null = null;
  private readonly placementGuide: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: GameState,
    private readonly callbacks: BuildModeCallbacks,
  ) {
    this.placementGuide = this.scene.add.graphics().setDepth(GHOST_DEPTH - 1).setVisible(false);
    this.syncPlaced();
  }

  get placing(): boolean {
    return this.ghost !== null;
  }

  setShape(shape: PlacementShape): void {
    this.shape = shape; this.batchAnchor = null; this.fixedBatch = null;
    this.refreshValidity(true);
  }

  setBatchRequests(requests: BuildRequest[]): void {
    if (!this.def || !requests.length) return;
    this.fixedBatch = requests;
    this.ghostTileX = requests[0]!.tileX; this.ghostTileY = requests[0]!.tileY;
    this.ghostBoundaryEdge = requests[0]!.boundaryEdge ?? null;
    this.ghostRotated = false;
    if (this.ghost) applyBuildingTransform(this.ghost, {
      tileX: this.ghostTileX, tileY: this.ghostTileY, rotated: false,
      ...(this.ghostBoundaryEdge ? { boundaryEdge: this.ghostBoundaryEdge } : {}),
    }, this.def);
    this.refreshValidity(true);
  }

  private batchRequests(): BuildRequest[] {
    if (!this.def) return [];
    if (this.fixedBatch) {
      const first = this.fixedBatch[0]!;
      return this.fixedBatch.map((request) => ({ ...request, tileX: request.tileX + this.ghostTileX - first.tileX, tileY: request.tileY + this.ghostTileY - first.tileY }));
    }
    if (this.shape === 'single' || !this.batchAnchor) return [];
    return shapedBuildRequests(this.def.id, this.shape, this.batchAnchor, { tileX: this.ghostTileX, tileY: this.ghostTileY }, this.batchAnchor.edge);
  }

  getBatchPresentationStates(): BuildPlacementPresentation[] {
    const requests = this.batchRequests();
    const check = this.lastValidity ?? { ok: true, message: '' };
    return requests.map((request) => {
      const definition = buildableById(request.definitionId);
      return { definitionId: request.definitionId, tileX: request.tileX, tileY: request.tileY,
        ...placementDimensions(definition, request), rotated: request.rotated ?? false,
        boundaryEdge: request.boundaryEdge ?? null, environmentKind: null, layer: definition.layer,
        valid: check.ok, message: check.message, blockedCells: check.blockedCells ?? [] };
    });
  }

  /** Alternate renderers consume this snapshot; placement rules stay authoritative here. */
  getPresentationState(): BuildPlacementPresentation | null {
    if (!this.ghost || !this.def) return null;
    const check = this.lastValidity ?? checkPlacement(
      this.state, this.state.buildings, this.def, this.ghostTileX, this.ghostTileY,
      this.placementOptions(),
    );
    const dimensions = this.def.layer === 'boundary'
      ? placementDimensions(this.def, {
        rotated: this.ghostRotated,
        ...(this.ghostBoundaryEdge ? { boundaryEdge: this.ghostBoundaryEdge } : {}),
      })
      : effectiveDimensions(this.def, this.ghostRotated);
    return {
      definitionId: this.def.id,
      tileX: this.ghostTileX,
      tileY: this.ghostTileY,
      tilesWide: dimensions.tilesWide,
      tilesHigh: dimensions.tilesHigh,
      rotated: this.ghostRotated,
      boundaryEdge: this.def.layer === 'boundary'
        ? effectiveBoundaryEdge({
          rotated: this.ghostRotated,
          ...(this.ghostBoundaryEdge ? { boundaryEdge: this.ghostBoundaryEdge } : {}),
        })
        : null,
      environmentKind: this.def.footprintKind === 'marker' ? this.markerKind : null,
      layer: this.def.layer,
      valid: check.ok,
      message: check.message,
      blockedCells: check.blockedCells ?? [],
    };
  }

  /** Red silhouette for the selected building, mirroring the blocked-ghost read in 3D. */
  getSelectionPresentationState(): BuildPlacementPresentation | null {
    const building = this.selectedBuildingId
      ? this.state.buildings.find((candidate) => candidate.id === this.selectedBuildingId)
      : undefined;
    if (!building) return null;
    const def = buildableById(building.definitionId);
    const dimensions = def.layer === 'boundary'
      ? placementDimensions(def, {
        rotated: building.rotated === true,
        ...(building.boundaryEdge ? { boundaryEdge: building.boundaryEdge } : {}),
      })
      : effectiveBuildingDimensions(building);
    return {
      definitionId: def.id,
      tileX: building.tileX,
      tileY: building.tileY,
      tilesWide: dimensions.tilesWide,
      tilesHigh: dimensions.tilesHigh,
      rotated: building.rotated === true,
      boundaryEdge: def.layer === 'boundary' ? effectiveBoundaryEdge(building) : null,
      environmentKind: building.environmentKind ?? null,
      layer: def.layer,
      valid: false,
      message: '',
      blockedCells: [],
    };
  }

  get deleteMode(): boolean {
    return this.deleting;
  }

  /** The part the Delete cursor is currently lighting up, if any. */
  get deleteTarget(): BuildingState | null {
    if (!this.deleting || !this.selectedBuildingId) return null;
    return this.state.buildings.find((candidate) => candidate.id === this.selectedBuildingId) ?? null;
  }

  /**
   * Enter Delete mode with the cursor on the part nearest the player. Removal
   * mirrors placement: the d-pad only moves the red cursor, and Delete is the
   * single control that actually takes a structure down.
   */
  startDeleting(): void {
    this.cancel();
    this.deleting = true;
    this.selectNearestForDelete();
  }

  stopDeleting(): void {
    if (!this.deleting) return;
    this.deleting = false;
    this.setSelectedBuilding(null);
    this.callbacks.onDeleteTarget(null);
  }

  /** Nudge the delete cursor one part along the d-pad direction. */
  stepDeleteSelection(dx: number, dy: number): void {
    if (!this.deleting) return;
    const current = this.deleteTarget;
    if (!current) {
      this.selectNearestForDelete();
      return;
    }
    const next = nextBuildingInDirection(this.state.buildings, current, dx, dy);
    if (!next || next.id === current.id) return;
    this.setSelectedBuilding(next.id);
    this.callbacks.onDeleteTarget(next);
  }

  /**
   * Aim the cursor at one specific part — what a hold in the world does, since
   * the player has already pointed at the thing they want gone.
   */
  focusDeleteTarget(building: BuildingState): void {
    if (!this.deleting || this.selectedBuildingId === building.id) return;
    this.setSelectedBuilding(building.id);
    this.callbacks.onDeleteTarget(building);
  }

  /** A world press in Delete mode aims the cursor, the way it aims the ghost. */
  aimDeleteAtWorld(worldX: number, worldY: number): boolean {
    if (!this.deleting) return false;
    const building = this.buildingAt(worldX, worldY);
    if (building && building.id !== this.selectedBuildingId) {
      this.setSelectedBuilding(building.id);
      this.callbacks.onDeleteTarget(building);
    }
    // The tap is consumed either way: Delete mode never gathers or swings.
    return true;
  }

  /** Re-anchor the cursor after the world changed under it (a demolition, a load). */
  refreshDeleteSelection(): void {
    if (!this.deleting) return;
    const current = this.deleteTarget;
    if (current) {
      this.callbacks.onDeleteTarget(current);
      return;
    }
    this.selectNearestForDelete();
  }

  private selectNearestForDelete(): void {
    const nearest = nearestBuilding(this.state.buildings, this.state.player.x, this.state.player.y);
    this.setSelectedBuilding(nearest?.id ?? null);
    this.callbacks.onDeleteTarget(nearest);
  }

  /** Mark (or unmark) a placed building as the delete-prompt target. */
  setSelectedBuilding(buildingId: string | null): void {
    if (this.selectedBuildingId === buildingId) return;
    if (this.selectedBuildingId) this.sprites.get(this.selectedBuildingId)?.clearTint();
    this.selectedBuildingId = buildingId;
    if (buildingId) this.sprites.get(buildingId)?.setTint(INVALID_TINT);
  }

  /** White impact flash and shudder for a placed part the player just struck. */
  flashBuildingHit(buildingId: string): void {
    const sprite = this.sprites.get(buildingId);
    if (!sprite) return;
    const restX = sprite.x;
    sprite.setTintFill(0xffffff);
    this.scene.tweens.add({ targets: sprite, x: restX + 1, duration: 40, yoyo: true, repeat: 2 });
    this.scene.time.delayedCall(90, () => {
      if (!sprite.active) return;
      sprite.x = restX;
      if (buildingId === this.selectedBuildingId) sprite.setTint(INVALID_TINT);
      else sprite.clearTint();
    });
  }

  startPlacing(id: BuildableId): void {
    const history = this.placing ? [...this.placementHistory] : [];
    this.stopDeleting();
    this.cancel();
    this.placementHistory.push(...history);
    this.callbacks.onUndoAvailable(history.length > 0);
    this.def = buildableById(id);
    const { tileX, tileY } = defaultGhostTile(this.state, this.def);
    this.ghostTileX = tileX;
    this.ghostTileY = tileY;
    this.ghostRotated = false;
    this.lastStep = null;
    this.ghostBoundaryEdge = this.def.layer === 'boundary'
      ? defaultBoundaryEdgeFromFacing(this.state.player.facing)
      : null;
    this.ghost = this.scene.add
      .image(tileX * TILE_SIZE, tileY * TILE_SIZE, BUILDABLE_TEXTURES[this.def.id])
      .setAlpha(0.65)
      .setDepth(GHOST_DEPTH);
    applyBuildingTransform(this.ghost, {
      tileX, tileY,
      rotated: this.ghostRotated,
      ...(this.ghostBoundaryEdge ? { boundaryEdge: this.ghostBoundaryEdge } : {}),
    }, this.def);
    this.refreshEnclosureOverlay();
    this.refreshValidity(true);
  }

  setMarkerKind(kind: EnvironmentKind): void {
    this.markerKind = kind;
    if (this.def?.id === 'environment-marker') this.ghost?.setTexture(markerTextureKey(kind));
    this.refreshValidity(true);
  }

  /** Snap the ghost to the tile under a world position (pointer move/tap). */
  moveGhostToWorld(worldX: number, worldY: number): void {
    if (!this.ghost || !this.def) return;
    const placement = placementTargetFromWorld(
      this.state,
      this.def,
      worldX,
      worldY,
      this.placementOptions(),
    );
    if (this.def.layer === 'boundary' && placement.boundaryEdge) {
      if (
        placement.tileX === this.ghostTileX &&
        placement.tileY === this.ghostTileY &&
        placement.boundaryEdge === this.ghostBoundaryEdge &&
        !this.ghostRotated
      ) return;
      this.ghostTileX = placement.tileX;
      this.ghostTileY = placement.tileY;
      this.ghostBoundaryEdge = placement.boundaryEdge;
      this.ghostRotated = false;
      applyBuildingTransform(this.ghost, {
        tileX: placement.tileX,
        tileY: placement.tileY,
        boundaryEdge: placement.boundaryEdge,
        rotated: false,
      }, this.def);
      this.refreshValidity();
      return;
    }
    if (placement.tileX === this.ghostTileX && placement.tileY === this.ghostTileY) return;
    this.ghostTileX = placement.tileX;
    this.ghostTileY = placement.tileY;
    applyBuildingTransform(this.ghost, {
      tileX: placement.tileX, tileY: placement.tileY,
      rotated: this.ghostRotated,
    }, this.def);
    this.refreshValidity();
  }

  /**
   * A world press AIMS the ghost; it never commits. Tapping used to place
   * outright, which put a structure on the wrong tile more often than the
   * right one — the tap now only proposes, and Place (or the d-pad plus
   * Place) is what spends the materials.
   */
  handlePointerDown(pointer: Phaser.Input.Pointer): void {
    this.handleWorldPointerDown(pointer.worldX, pointer.worldY, pointer.id);
  }

  /** 3D raycasts aim the ghost exactly like Phaser pointers do. */
  handleWorldPointerDown(worldX: number, worldY: number, _pointerId = 0): void {
    if (!this.ghost || !this.def) return;
    this.moveGhostToWorld(worldX, worldY);
  }

  handleWorldPointerMove(worldX: number, worldY: number, _pointerId: number | null = null): void {
    if (!this.ghost || !this.def) return;
    this.moveGhostToWorld(worldX, worldY);
  }

  /**
   * Nudge the ghost one tile. The d-pad's whole reason for existing: a tile is
   * a few screen pixels wide on a phone, so the ghost is steered rather than
   * poked at.
   */
  stepGhost(dx: number, dy: number): void {
    if (!this.ghost || !this.def) return;
    this.lastStep = { dx, dy };
    const clamped = clampTileToBounds(
      this.ghostTileX + dx,
      this.ghostTileY + dy,
      this.def,
      this.ghostRotated,
      this.ghostBoundaryEdge ?? undefined,
    );
    if (clamped.tileX === this.ghostTileX && clamped.tileY === this.ghostTileY) return;
    this.ghostTileX = clamped.tileX;
    this.ghostTileY = clamped.tileY;
    applyBuildingTransform(this.ghost, {
      tileX: clamped.tileX,
      tileY: clamped.tileY,
      rotated: this.ghostRotated,
      ...(this.ghostBoundaryEdge ? { boundaryEdge: this.ghostBoundaryEdge } : {}),
    }, this.def);
    this.refreshValidity();
  }

  /** Topmost placed building whose sprite is under a world point, or null. */
  buildingAtWorld(worldX: number, worldY: number): BuildingState | null {
    return this.buildingAt(worldX, worldY);
  }

  /** Long-press editing remains available when the visible world is raycast in 3D. */
  openBuildingAtWorld(worldX: number, worldY: number, clientX: number, clientY: number): boolean {
    if (this.placing || this.deleting) return false;
    const building = this.buildingAt(worldX, worldY);
    if (!building) return false;
    this.callbacks.onBuildingLongPress(building, clientX, clientY);
    return true;
  }

  handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.placing) {
      this.handleWorldPointerMove(
        pointer.worldX,
        pointer.worldY,
        pointer.isDown ? pointer.id : null,
      );
      return;
    }
    if (this.buildingPress?.pointerId === pointer.id) {
      const drift = Math.hypot(pointer.x - this.buildingPress.screenX, pointer.y - this.buildingPress.screenY);
      if (drift > LONG_PRESS_DRIFT_PX) this.cancelBuildingPress();
    }
  }

  toggleRotation(): void {
    if (this.fixedBatch || this.batchAnchor) return;
    if (!this.ghost || !this.def) return;
    this.ghostRotated = !this.ghostRotated;
    const clamped = clampTileToBounds(
      this.ghostTileX, this.ghostTileY, this.def, this.ghostRotated,
      this.ghostBoundaryEdge ?? undefined,
    );
    this.ghostTileX = clamped.tileX;
    this.ghostTileY = clamped.tileY;
    applyBuildingTransform(this.ghost, {
      tileX: clamped.tileX,
      tileY: clamped.tileY,
      rotated: this.ghostRotated,
      ...(this.ghostBoundaryEdge ? { boundaryEdge: this.ghostBoundaryEdge } : {}),
    }, this.def);
    this.refreshValidity(true);
  }

  undoLastPlacement(): boolean {
    let group = this.placementHistory.pop();
    while (group && !group.some((id) => this.state.buildings.some((building) => building.id === id))) {
      group = this.placementHistory.pop();
    }
    if (!group) {
      this.callbacks.onUndoAvailable(false);
      return false;
    }
    const result = group.length === 1 ? undoBuildingPlacement(this.state, group[0]!) : undoBuildGroup(this.state, group);
    if (result.ok) {
      this.syncPlaced();
      this.refreshEnclosureOverlay();
      this.refreshValidity(true);
    }
    this.callbacks.onUndoAvailable(this.placementHistory.length > 0);
    this.callbacks.onUndo(result);
    return result.ok;
  }

  /** Begin tracking a possible hold. Returns false when no building was hit. */
  beginBuildingPress(pointer: Phaser.Input.Pointer): boolean {
    if (this.placing || this.deleting) return false;
    this.cancelBuildingPress();
    const building = this.buildingAt(pointer.worldX, pointer.worldY);
    if (!building) return false;

    const event = pointer.event as PointerEvent | undefined;
    const press = {
      pointerId: pointer.id,
      buildingId: building.id,
      screenX: pointer.x,
      screenY: pointer.y,
      clientX: event?.clientX ?? pointer.x,
      clientY: event?.clientY ?? pointer.y,
      opened: false,
      timer: null as unknown as Phaser.Time.TimerEvent,
    };
    press.timer = this.scene.time.delayedCall(LONG_PRESS_MS, () => {
      if (this.buildingPress !== press) return;
      const selected = this.state.buildings.find((candidate) => candidate.id === press.buildingId);
      if (!selected) return;
      press.opened = true;
      this.callbacks.onBuildingLongPress(selected, press.clientX, press.clientY);
    });
    this.buildingPress = press;
    return true;
  }

  /** End a tracked press. True means it was a short click, not a long press. */
  finishBuildingPress(pointer: Phaser.Input.Pointer): boolean {
    const press = this.buildingPress;
    if (!press || press.pointerId !== pointer.id) return false;
    const shortClick = !press.opened;
    this.cancelBuildingPress();
    return shortClick;
  }

  confirm(): boolean {
    if (!this.ghost || !this.def) return false;
    if (this.shape !== 'single' && !this.fixedBatch && !this.batchAnchor) {
      this.batchAnchor = { tileX: this.ghostTileX, tileY: this.ghostTileY, edge: this.ghostBoundaryEdge ?? 'north' };
      this.refreshValidity(true);
      return true;
    }
    if (this.fixedBatch || this.shape !== 'single') {
      const result = placeBuildBatch(this.state, this.batchRequests());
      if (result.ok && result.buildings) {
        this.placementHistory.push(result.buildings.map((building) => building.id));
        for (const building of result.buildings) this.addPlacedSprite(building);
        this.refreshEnclosureOverlay();
        this.batchAnchor = null;
        this.callbacks.onUndoAvailable(true);
        this.refreshValidity(true);
      }
      this.callbacks.onPlaced(result);
      return result.ok;
    }
    const result = placeBuilding(
      this.state,
      this.state.buildings,
      this.def,
      this.ghostTileX,
      this.ghostTileY,
      this.placementOptions(),
    );
    if (result.ok && result.building) {
      this.placementHistory.push([result.building.id]);
      this.addPlacedSprite(result.building);
      this.refreshEnclosureOverlay();
      this.advanceAfterPlacement();
      this.refreshValidity(true);
      this.callbacks.onUndoAvailable(true);
    }
    this.callbacks.onPlaced(result);
    return result.ok;
  }

  /**
   * Slide the ghost clear of the tile it just filled, along the last d-pad
   * direction (or the way the player faces). Laying a wall is then Place,
   * Place, Place instead of re-aiming after every single tile.
   */
  private advanceAfterPlacement(): void {
    const step = this.lastStep ?? FACING_STEPS[this.state.player.facing];
    if (!step || (step.dx === 0 && step.dy === 0)) return;
    const dimensions = this.def
      ? placementDimensions(this.def, {
        rotated: this.ghostRotated,
        ...(this.ghostBoundaryEdge ? { boundaryEdge: this.ghostBoundaryEdge } : {}),
      })
      : { tilesWide: 1, tilesHigh: 1 };
    const span = step.dx !== 0 ? dimensions.tilesWide : dimensions.tilesHigh;
    this.stepGhost(step.dx * span, step.dy * span);
    this.lastStep = step;
  }

  cancel(): void {
    this.shape = 'single'; this.batchAnchor = null; this.fixedBatch = null; this.batchCacheKey = ''; this.batchCheck = null;
    this.callbacks.onBatchPreview?.(null);
    this.ghost?.destroy();
    this.ghost = null;
    this.def = null;
    this.lastValidity = null;
    this.ghostRotated = false;
    this.ghostBoundaryEdge = null;
    this.lastStep = null;
    this.placementHistory.length = 0;
    this.callbacks.onUndoAvailable(false);
    this.placementGuide.clear().setVisible(false);
    this.gapOverlay?.clear().setVisible(false);
  }

  /** Cheap per-frame revalidation — walking changes range/overlap validity. */
  refreshValidity(force = false): void {
    if (!this.ghost || !this.def) return;
    let check = checkPlacement(
      this.state, this.state.buildings, this.def, this.ghostTileX, this.ghostTileY,
      this.placementOptions(),
    );
    if (this.fixedBatch || this.shape !== 'single') {
      const requests = this.batchRequests();
      const key = `${this.state.player.x},${this.state.player.y},${this.state.buildings.length},${this.state.tick >> 5},${JSON.stringify(this.state.inventory)},${JSON.stringify(requests)}`;
      if (force || key !== this.batchCacheKey || !this.batchCheck) {
        this.batchCacheKey = key;
        this.batchCheck = !this.fixedBatch && !this.batchAnchor ? { ok: true, message: 'Aim the first corner, then Set start' } : checkBuildBatch(this.state, requests);
      }
      check = this.batchCheck;
      this.callbacks.onBatchPreview?.({ mode: this.shape, anchored: !!this.fixedBatch || !!this.batchAnchor, count: requests.length, cost: batchCost(requests), fixed: !!this.fixedBatch });
    } else this.callbacks.onBatchPreview?.(null);
    this.ghost.setTint(check.ok ? VALID_TINT : INVALID_TINT);
    this.drawPlacementGuide(check);
    for (const request of this.batchRequests()) {
      const definition = buildableById(request.definitionId);
      const color = check.ok ? VALID_TINT : INVALID_TINT;
      if (definition.layer === 'surface') this.placementGuide.lineStyle(1, color, .8).strokeRect(request.tileX * TILE_SIZE, request.tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      else {
        const center = buildingCenterPx({ id: '', ...request });
        const horizontal = request.boundaryEdge === 'north' || request.boundaryEdge === 'south';
        this.placementGuide.lineStyle(3, color, .9).lineBetween(center.x - (horizontal ? 8 : 0), center.y - (horizontal ? 0 : 8), center.x + (horizontal ? 8 : 0), center.y + (horizontal ? 0 : 8));
      }
    }
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

  private drawPlacementGuide(check: PlacementCheck): void {
    if (!this.def || !this.ghost) return;
    const graphics = this.placementGuide.clear().setVisible(true);
    graphics.lineStyle(1, 0xffe7a0, 0.42).strokeCircle(
      this.state.player.x,
      this.state.player.y,
      BUILD_RANGE_PX,
    );
    if (this.def.layer === 'boundary') {
      const edge = effectiveBoundaryEdge(this.placementOptions());
      const span = boundarySpan(this.def);
      const center = boundaryCenterPx(this.ghostTileX, this.ghostTileY, edge, span);
      const horizontal = edge === 'north' || edge === 'south';
      const half = span * TILE_SIZE / 2;
      graphics.lineStyle(3, check.ok ? VALID_TINT : INVALID_TINT, 0.9).beginPath();
      graphics.moveTo(center.x - (horizontal ? half : 0), center.y - (horizontal ? 0 : half));
      graphics.lineTo(center.x + (horizontal ? half : 0), center.y + (horizontal ? 0 : half));
      graphics.strokePath();
      return;
    }
    const dimensions = effectiveDimensions(this.def, this.ghostRotated);
    const blocked = new Map((check.blockedCells ?? []).map((cell) => [`${cell.tileX},${cell.tileY}`, cell]));
    for (let y = this.ghostTileY; y < this.ghostTileY + dimensions.tilesHigh; y += 1) {
      for (let x = this.ghostTileX; x < this.ghostTileX + dimensions.tilesWide; x += 1) {
        const isBlocked = blocked.has(`${x},${y}`);
        const color = isBlocked ? INVALID_TINT : check.ok ? VALID_TINT : 0xffd27a;
        graphics.fillStyle(color, isBlocked ? 0.34 : 0.15).fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        graphics.lineStyle(isBlocked ? 2 : 1, color, 0.95).strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  /** Reconcile sprites with `state.buildings` — renders saves on load, drops removed, and swaps state-driven textures. */
  syncPlaced(): void {
    for (const [id, sprite] of this.sprites) {
      if (!this.state.buildings.some((building) => building.id === id)) {
        sprite.destroy();
        this.sprites.delete(id);
        this.chunks.delete(id);
        this.activeSpriteIds.delete(id);
        this.openingIds.delete(id);
        this.openingOpenness.delete(id);
        if (this.selectedBuildingId === id) this.selectedBuildingId = null;
      }
    }
    for (const building of this.state.buildings) {
      const sprite = this.sprites.get(building.id);
      if (!sprite) this.addPlacedSprite(building);
      // Doors and gates own their texture via the swing updater.
      else if (!this.openingIds.has(building.id) && sprite.texture.key !== textureForBuilding(building)) {
        sprite.setTexture(textureForBuilding(building));
      }
    }
    if (this.placing) this.refreshEnclosureOverlay();
  }

  /** Replace area-owned structure sprites without rebuilding the controller. */
  resetForArea(): void {
    this.clearAreaSprites();
    this.syncPlaced();
  }

  /** Clear old-area sprites before the scene destroys its remaining children. */
  clearForAreaSwap(): void {
    this.clearAreaSprites();
  }

  /** Activate only placed structures in camera-adjacent chunks. */
  updateChunkActivation(activeChunks: ReadonlySet<string>): EntityActivationCounts {
    const nextActiveIds = this.chunks.idsInChunks(activeChunks);
    for (const id of this.activeSpriteIds) {
      if (!nextActiveIds.has(id)) this.sprites.get(id)?.setActive(false).setVisible(false);
    }
    for (const id of nextActiveIds) {
      if (!this.activeSpriteIds.has(id)) this.sprites.get(id)?.setActive(true).setVisible(true);
    }
    this.activeSpriteIds = nextActiveIds;
    return { active: nextActiveIds.size, total: this.chunks.size };
  }

  private addPlacedSprite(building: BuildingState): void {
    if (this.sprites.has(building.id)) return;
    const def = buildableById(building.definitionId);
    const sprite = this.scene.add
      .image(building.tileX * TILE_SIZE, building.tileY * TILE_SIZE, textureForBuilding(building))
      .setDepth(def.landscapeKind === 'water' ? LANDSCAPE_WATER_DEPTH
        : def.landscapeKind === 'bridge' ? LANDSCAPE_BRIDGE_DEPTH
          : def.layer === 'surface' ? SURFACE_DEPTH
            : (building.tileY + effectiveBuildingDimensions(building).tilesHigh) * TILE_SIZE)
      .setActive(false)
      .setVisible(false);
    applyBuildingTransform(sprite, building, def);
    if (building.id === this.selectedBuildingId) sprite.setTint(INVALID_TINT);
    this.sprites.set(building.id, sprite);
    if (def.boundaryClass === 'door' || def.boundaryClass === 'gate') this.openingIds.add(building.id);
    this.chunks.upsert(building.id, sprite.x, sprite.y);
  }

  /**
   * Swing placed doors and gates open as the player approaches and shut again as they
   * leave. Openness eases toward its target each frame and maps to the nearest
   * procedural swing frame; culled doors snap shut so they never reappear ajar.
   */
  updateOpeningAnimations(playerX: number, playerY: number, deltaMs: number): void {
    if (this.openingIds.size === 0) return;
    const step = deltaMs / DOOR_SWING_MS;
    for (const id of this.openingIds) {
      const sprite = this.sprites.get(id);
      const building = this.state.buildings.find((candidate) => candidate.id === id);
      if (!sprite || !building) continue;
      if (!sprite.visible) {
        this.openingOpenness.set(id, 0);
        continue;
      }
      const { x: centerX, y: centerY } = buildingCenterPx(building);
      const target = Math.hypot(playerX - centerX, playerY - centerY) <= DOOR_OPEN_RADIUS ? 1 : 0;
      const current = this.openingOpenness.get(id) ?? 0;
      const next = target > current
        ? Math.min(target, current + step)
        : Math.max(target, current - step);
      this.openingOpenness.set(id, next);

      const frames = OPENING_SWING_FRAMES[building.definitionId as BuildableId];
      if (!frames) continue;
      const frame = frames[Math.round(next * (frames.length - 1))] ?? frames[0]!;
      if (sprite.texture.key !== frame) sprite.setTexture(frame);
    }
  }

  private buildingAt(worldX: number, worldY: number): BuildingState | null {
    // Newer/topmost parts win when layers overlap (for example, a facility on a floor).
    for (let index = this.state.buildings.length - 1; index >= 0; index -= 1) {
      const building = this.state.buildings[index]!;
      const sprite = this.sprites.get(building.id);
      if (!sprite?.visible) continue;
      const bounds = sprite.getBounds();
      if (
        worldX >= bounds.x - 4 && worldX <= bounds.right + 4 &&
        worldY >= bounds.y - 4 && worldY <= bounds.bottom + 4
      ) return building;
    }
    return null;
  }

  private cancelBuildingPress(): void {
    this.buildingPress?.timer.remove(false);
    this.buildingPress = null;
  }

  /**
   * Red marks on every unclosed perimeter edge, drawn in the world where the
   * hole actually is. The HUD used to also count them in a banner, which was
   * noise stacked on top of the same information.
   */
  private refreshEnclosureOverlay(): void {
    if (!this.placing) return;
    const gaps = enclosureGaps(this.state.buildings);
    if (!this.gapOverlay) this.gapOverlay = this.scene.add.graphics().setDepth(GHOST_DEPTH - 1);
    const graphics = this.gapOverlay.clear().setVisible(true);
    graphics.lineStyle(ENCLOSURE_GUIDE_WIDTH, 0xff4d4d, 1).fillStyle(0xffd166, 1);
    for (const gap of gaps) {
      const left = gap.tileX * TILE_SIZE;
      const top = gap.tileY * TILE_SIZE;
      const x1 = gap.edge === 'east' ? left + TILE_SIZE : left;
      const y1 = gap.edge === 'south' ? top + TILE_SIZE : top;
      const x2 = gap.edge === 'north' || gap.edge === 'south' ? left + TILE_SIZE : x1;
      const y2 = gap.edge === 'west' || gap.edge === 'east' ? top + TILE_SIZE : y1;
      graphics.lineBetween(x1, y1, x2, y2);
      graphics.fillCircle((x1 + x2) / 2, (y1 + y2) / 2, 1.75);
    }
  }

  private placementOptions() {
    return {
      rotated: this.ghostRotated,
      ...(this.ghostBoundaryEdge ? { boundaryEdge: this.ghostBoundaryEdge } : {}),
      ...(this.def?.footprintKind === 'marker' ? { environmentKind: this.markerKind } : {}),
    };
  }

  destroy(): void {
    this.clearAreaSprites();
    this.placementGuide.destroy();
  }

  private clearAreaSprites(): void {
    this.stopDeleting();
    this.cancelBuildingPress();
    this.cancel();
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.chunks.clear();
    this.activeSpriteIds.clear();
    this.openingIds.clear();
    this.openingOpenness.clear();
    this.selectedBuildingId = null;
    this.gapOverlay?.destroy();
    this.gapOverlay = null;
  }
}
