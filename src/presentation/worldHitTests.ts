import { TILE_SIZE } from '../config/platform';
import { boundaryCenterPx, boundarySpan, effectiveBoundaryEdge, effectiveBuildingDimensions } from '../simulation/buildingGeometry';
import { buildableById } from '../simulation/gameplayCommands';
import type { BuildingState } from '../simulation/state';

/** Ground-plane picking uses authoritative positions, never invisible sprites. */
export function entityAtWorld<T extends { x: number; y: number }>(
  entities: Iterable<T>, x: number, y: number, radius = TILE_SIZE * 0.8,
): T | null {
  let nearest: T | null = null;
  let nearestDistance = radius;
  for (const entity of entities) {
    const distance = Math.hypot(entity.x - x, entity.y - y);
    if (distance <= nearestDistance) { nearest = entity; nearestDistance = distance; }
  }
  return nearest;
}

/** Newer parts win at overlapping footprints; boundaries use their real edge. */
export function buildingAtWorld(buildings: readonly BuildingState[], x: number, y: number): BuildingState | null {
  for (let index = buildings.length - 1; index >= 0; index--) {
    const building = buildings[index]!;
    const definition = buildableById(building.definitionId);
    if (definition.layer === 'boundary') {
      const center = boundaryCenterPx(building.tileX, building.tileY, effectiveBoundaryEdge(building), boundarySpan(definition));
      const edge = effectiveBoundaryEdge(building);
      const horizontal = edge === 'north' || edge === 'south';
      const along = horizontal ? Math.abs(x - center.x) : Math.abs(y - center.y);
      const across = horizontal ? Math.abs(y - center.y) : Math.abs(x - center.x);
      if (along <= boundarySpan(definition) * TILE_SIZE / 2 + 2 && across <= 4) return building;
    } else {
      const dimensions = effectiveBuildingDimensions(building);
      if (x >= building.tileX * TILE_SIZE && x <= (building.tileX + dimensions.tilesWide) * TILE_SIZE
        && y >= building.tileY * TILE_SIZE && y <= (building.tileY + dimensions.tilesHigh) * TILE_SIZE) return building;
    }
  }
  return null;
}
