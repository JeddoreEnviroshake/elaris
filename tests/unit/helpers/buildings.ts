import type { BuildingDefinitionId, BuildingState, EnvironmentKind } from '../../../src/simulation/state';

/** Canonical player-created rectangular environment used by simulation tests. */
export function enclosedEnvironment(
  left: number,
  top: number,
  width: number,
  height: number,
  kind: EnvironmentKind = 'indoor',
): BuildingState[] {
  const surface: BuildingDefinitionId = kind === 'indoor' ? 'wood-floor' : 'wood-ground';
  const boundary: BuildingDefinitionId = kind === 'indoor' ? 'wood-wall' : 'wood-fence';
  const buildings: BuildingState[] = [];
  let id = 1;
  for (let y = top; y < top + height; y += 1) for (let x = left; x < left + width; x += 1) {
    buildings.push({ id: `surface-${id++}`, definitionId: surface, tileX: x, tileY: y });
  }
  for (let x = left; x < left + width; x += 1) {
    buildings.push({ id: `boundary-${id++}`, definitionId: boundary, tileX: x, tileY: top, boundaryEdge: 'north' });
    buildings.push({ id: `boundary-${id++}`, definitionId: boundary, tileX: x, tileY: top + height - 1, boundaryEdge: 'south' });
  }
  for (let y = top; y < top + height; y += 1) {
    buildings.push({ id: `boundary-${id++}`, definitionId: boundary, tileX: left, tileY: y, boundaryEdge: 'west' });
    buildings.push({ id: `boundary-${id++}`, definitionId: boundary, tileX: left + width - 1, tileY: y, boundaryEdge: 'east' });
  }
  buildings.push({
    id: `marker-${id++}`, definitionId: 'environment-marker',
    tileX: left + width - 1, tileY: top + height - 1, environmentKind: kind,
  });
  return buildings;
}
