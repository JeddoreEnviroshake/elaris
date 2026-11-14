import type { BuildableDefinition } from '../content/buildingParts';
import { buildableById } from '../content/buildingParts';
import { TILE_SIZE } from '../config/platform';
import type { BoundaryEdge, BuildingState } from './state';

export interface BuildingDimensions { tilesWide: number; tilesHigh: number }

export function effectiveDimensions(definition: BuildableDefinition, rotated = false): BuildingDimensions {
  return rotated
    ? { tilesWide: definition.tilesHigh, tilesHigh: definition.tilesWide }
    : { tilesWide: definition.tilesWide, tilesHigh: definition.tilesHigh };
}

export function effectiveBuildingDimensions(building: BuildingState): BuildingDimensions {
  const definition = buildableById(building.definitionId);
  return definition.layer === 'boundary'
    ? boundaryDimensions(definition, effectiveBoundaryEdge(building))
    : effectiveDimensions(definition, building.rotated === true);
}

/** Number of consecutive shared tile edges occupied by a boundary part. */
export function boundarySpan(definition: BuildableDefinition): number {
  return Math.max(definition.tilesWide, definition.tilesHigh);
}

/** Axis-aligned cells alongside a boundary, used for bounds and terrain checks. */
export function boundaryDimensions(definition: BuildableDefinition, edge: BoundaryEdge): BuildingDimensions {
  const span = boundarySpan(definition);
  return edge === 'north' || edge === 'south'
    ? { tilesWide: span, tilesHigh: 1 }
    : { tilesWide: 1, tilesHigh: span };
}

export function placementDimensions(
  definition: BuildableDefinition,
  options: { boundaryEdge?: BoundaryEdge | undefined; rotated?: boolean | undefined } = {},
): BuildingDimensions {
  return definition.layer === 'boundary'
    ? boundaryDimensions(definition, effectiveBoundaryEdge(options))
    : effectiveDimensions(definition, options.rotated === true);
}

/** Rotate a canonical shared edge clockwise while keeping the same anchor cell. */
export function rotatedBoundaryEdge(edge: BoundaryEdge): BoundaryEdge {
  switch (edge) {
    case 'north': return 'east';
    case 'east': return 'south';
    case 'south': return 'west';
    case 'west': return 'north';
  }
}

export function effectiveBoundaryEdge(building: { boundaryEdge?: BoundaryEdge | undefined; rotated?: boolean | undefined }): BoundaryEdge {
  const edge = building.boundaryEdge ?? 'north';
  return building.rotated ? rotatedBoundaryEdge(edge) : edge;
}

/** Canonical anchor cell for every edge segment occupied by a boundary part. */
export function boundarySegmentAnchors(
  tileX: number,
  tileY: number,
  edge: BoundaryEdge,
  span: number,
): Array<{ tileX: number; tileY: number; edge: BoundaryEdge }> {
  const horizontal = edge === 'north' || edge === 'south';
  return Array.from({ length: span }, (_, index) => ({
    tileX: tileX + (horizontal ? index : 0),
    tileY: tileY + (horizontal ? 0 : index),
    edge,
  }));
}

export function boundaryCenterPx(
  tileX: number,
  tileY: number,
  edge: BoundaryEdge,
  span: number,
): { x: number; y: number } {
  const horizontal = edge === 'north' || edge === 'south';
  return {
    x: (tileX + (horizontal ? span / 2 : edge === 'east' ? 1 : 0)) * TILE_SIZE,
    y: (tileY + (horizontal ? edge === 'south' ? 1 : 0 : span / 2)) * TILE_SIZE,
  };
}

/**
 * World-pixel midpoint of a placed part. Boundary parts sit on the named edge
 * of their anchor cell; everything else is centered on its footprint. Mirrors
 * the sprite transform so range checks and world overlays agree.
 */
export function buildingCenterPx(building: BuildingState): { x: number; y: number } {
  const definition = buildableById(building.definitionId);
  if (definition.layer !== 'boundary') {
    const dimensions = effectiveDimensions(definition, building.rotated === true);
    return {
      x: (building.tileX + dimensions.tilesWide / 2) * TILE_SIZE,
      y: (building.tileY + dimensions.tilesHigh / 2) * TILE_SIZE,
    };
  }
  const edge = effectiveBoundaryEdge(building);
  return boundaryCenterPx(building.tileX, building.tileY, edge, boundarySpan(definition));
}
