import { buildingAtWorld } from '../presentation/worldHitTests';

import type { BoundaryEdge, BuildingState, EnvironmentKind, GameState } from '../simulation/state';
import type { CommandResult } from '../simulation/gameplayCommands';
import { effectiveBoundaryEdge, effectiveBuildingDimensions, effectiveDimensions, placementDimensions } from '../simulation/buildingGeometry';

import type { BuildPlacementPresentation } from '../three/presentationState';
import { buildableById, checkPlacement, clampTileToBounds, defaultGhostTile, defaultBoundaryEdgeFromFacing, placeBuilding, placementTargetFromWorld, undoBuildingPlacement, type BuildableDefinition, type BuildableId, type PlacementCheck, type PlaceResult } from './buildPlacement';
import { nearestBuilding, nextBuildingInDirection } from './deleteSelection';
import { upgradeTarget } from '../simulation/partUpgrades';
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

const FACING_STEPS: Readonly<Record<string, { dx: number; dy: number }>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** Renderer-neutral placement, selection, validation and undo for the 3D world. */
export class BuildModeController {

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
  /**
   * What the part cursor is for. Upgrade Mode reuses the Delete cursor whole —
   * the d-pad hop, the world-tap aim, the hidden thumb controls — so every
   * place the scene asks `deleteMode` treats both the same; only the commit
   * and the parts the cursor may land on differ.
   */
  private cursorPurpose: 'delete' | 'upgrade' = 'delete';
  private markerKind: EnvironmentKind = 'indoor';

  constructor(private readonly state: GameState, private readonly callbacks: BuildModeCallbacks) {}

  get placing(): boolean { return this.def !== null; }

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
    if (!this.def) return null;
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

  /** True while the part cursor is choosing what to upgrade rather than remove. */
  get upgradeMode(): boolean {
    return this.deleting && this.cursorPurpose === 'upgrade';
  }

  /** Parts the cursor may land on: everything, or in Upgrade Mode only parts with a next material. */
  private cursorCandidates(): BuildingState[] {
    return this.cursorPurpose === 'upgrade'
      ? this.state.buildings.filter((building) => upgradeTarget(buildableById(building.definitionId)) !== null)
      : this.state.buildings;
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
  startDeleting(purpose: 'delete' | 'upgrade' = 'delete'): void {
    this.cancel();
    this.deleting = true;
    this.cursorPurpose = purpose;
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
    const next = nextBuildingInDirection(this.cursorCandidates(), current, dx, dy);
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
    const nearest = nearestBuilding(this.cursorCandidates(), this.state.player.x, this.state.player.y);
    this.setSelectedBuilding(nearest?.id ?? null);
    this.callbacks.onDeleteTarget(nearest);
  }

  setSelectedBuilding(buildingId: string | null): void { this.selectedBuildingId = buildingId; }

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

    this.refreshValidity(true);
  }

  setMarkerKind(kind: EnvironmentKind): void {
    this.markerKind = kind;
    this.refreshValidity(true);
  }

  /** Snap the ghost to the tile under a world position (pointer move/tap). */
  moveGhostToWorld(worldX: number, worldY: number): void {
    if (!this.def) return;
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

      this.refreshValidity();
      return;
    }
    if (placement.tileX === this.ghostTileX && placement.tileY === this.ghostTileY) return;
    this.ghostTileX = placement.tileX;
    this.ghostTileY = placement.tileY;

    this.refreshValidity();
  }

  /** Aim the placement ghost at the 3D raycast ground position. */
  handleWorldPointerDown(worldX: number, worldY: number, _pointerId = 0): void {
    if (!this.def) return;
    this.moveGhostToWorld(worldX, worldY);
  }

  handleWorldPointerMove(worldX: number, worldY: number, _pointerId: number | null = null): void {
    if (!this.def) return;
    this.moveGhostToWorld(worldX, worldY);
  }

  /**
   * Nudge the ghost one tile. The d-pad's whole reason for existing: a tile is
   * a few screen pixels wide on a phone, so the ghost is steered rather than
   * poked at.
   */
  stepGhost(dx: number, dy: number): void {
    if (!this.def) return;
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

    this.refreshValidity();
  }

  /** Topmost placed building whose footprint contains a world point, or null. */
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

  toggleRotation(): void {
    if (this.fixedBatch || this.batchAnchor) return;
    if (!this.def) return;
    this.ghostRotated = !this.ghostRotated;
    const clamped = clampTileToBounds(
      this.ghostTileX, this.ghostTileY, this.def, this.ghostRotated,
      this.ghostBoundaryEdge ?? undefined,
    );
    this.ghostTileX = clamped.tileX;
    this.ghostTileY = clamped.tileY;

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
      this.refreshValidity(true);
    }
    this.callbacks.onUndoAvailable(this.placementHistory.length > 0);
    this.callbacks.onUndo(result);
    return result.ok;
  }

  confirm(): boolean {
    if (!this.def) return false;
    if (this.shape !== 'single' && !this.fixedBatch && !this.batchAnchor) {
      this.batchAnchor = { tileX: this.ghostTileX, tileY: this.ghostTileY, edge: this.ghostBoundaryEdge ?? 'north' };
      this.refreshValidity(true);
      return true;
    }
    if (this.fixedBatch || this.shape !== 'single') {
      const result = placeBuildBatch(this.state, this.batchRequests());
      if (result.ok && result.buildings) {
        this.placementHistory.push(result.buildings.map((building) => building.id));
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

    this.def = null;
    this.lastValidity = null;
    this.ghostRotated = false;
    this.ghostBoundaryEdge = null;
    this.lastStep = null;
    this.placementHistory.length = 0;
    this.callbacks.onUndoAvailable(false);
  }

  /** Cheap per-frame revalidation — walking changes range/overlap validity. */
  refreshValidity(force = false): void {
    if (!this.def) return;
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

  syncPlaced(): void {
    if (this.selectedBuildingId && !this.state.buildings.some(building => building.id === this.selectedBuildingId)) this.selectedBuildingId = null;
  }

  /** Reset area-owned selection without rebuilding the controller. */
  resetForArea(): void {
    this.clearPlacementState();
    this.syncPlaced();
  }

  /** Clear placement and selection before an area swap. */
  clearForAreaSwap(): void {
    this.clearPlacementState();
  }

  private buildingAt(worldX: number, worldY: number): BuildingState | null {
    return buildingAtWorld(this.state.buildings, worldX, worldY);
  }

  private placementOptions() {
    return {
      rotated: this.ghostRotated,
      ...(this.ghostBoundaryEdge ? { boundaryEdge: this.ghostBoundaryEdge } : {}),
      ...(this.def?.footprintKind === 'marker' ? { environmentKind: this.markerKind } : {}),
    };
  }

  destroy(): void { this.clearPlacementState(); }

  private clearPlacementState(): void { this.stopDeleting(); this.cancel(); this.selectedBuildingId = null; }
}
