import { MATERIAL_VALUES, buildableById } from '../content/buildingParts';
import type { BuildingState, GameState } from './state';
import { cellKey } from './environmentProgress';
import { effectiveBoundaryEdge } from './buildingGeometry';

/**
 * Homestead Rating (spec: "Building and Homestead Rating").
 *
 * Scored anchor nodes are player surface cells; their connected components
 * use four-way cell adjacency. Each player boundary part is assigned to the
 * one surface component it touches (first found in deterministic neighbour
 * order) and is counted once; a boundary with no adjacent surface does not
 * score. Markers, facilities, and stored items never score.
 */

export interface StructureScore {
  /** Surface cells in this component. */
  surfaceCells: number;
  /** Boundary parts assigned to this component. */
  boundaryParts: number;
  /** N = surface cells + assigned boundaries. */
  n: number;
  totalMaterialValue: number;
  /** structureScore = totalMaterialValue × N^0.4 (IEEE-754 double). */
  score: number;
}

export interface HomesteadRating {
  total: number;
  structures: StructureScore[];
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1]];

// This curve rewards consolidation and materials: one 48-block wood build
// scores about 2× six separate 8-block wood builds, and upgrading thatch to
// metal is 20× per scored block.
export function homesteadRating(buildings: readonly BuildingState[]): HomesteadRating {
  const surfaces = new Map<string, BuildingState>();
  const boundaries: BuildingState[] = [];
  for (const building of buildings) {
    const definition = buildableById(building.definitionId);
    if (definition.layer === 'surface') surfaces.set(cellKey(building.tileX, building.tileY), building);
    else if (definition.layer === 'boundary') boundaries.push(building);
  }

  // Connected components over surface cells, in stable row-major seed order.
  const componentByCell = new Map<string, number>();
  const components: Array<{ surfaceCells: number; boundaryParts: number; materialValue: number }> = [];
  const seeds = [...surfaces.keys()].sort(compareCellKeys);
  for (const seed of seeds) {
    if (componentByCell.has(seed)) continue;
    const index = components.length;
    const component = { surfaceCells: 0, boundaryParts: 0, materialValue: 0 };
    components.push(component);
    const queue = [seed];
    componentByCell.set(seed, index);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const key = queue[cursor]!;
      const surface = surfaces.get(key)!;
      component.surfaceCells += 1;
      component.materialValue += materialValue(surface);
      const [x, y] = key.split(',').map(Number) as [number, number];
      for (const [dx, dy] of NEIGHBORS) {
        const neighborKey = cellKey(x + dx, y + dy);
        if (!surfaces.has(neighborKey) || componentByCell.has(neighborKey)) continue;
        componentByCell.set(neighborKey, index);
        queue.push(neighborKey);
      }
    }
  }

  // Assign each shared boundary edge once, to the first surface touching either side.
  for (const boundary of boundaries) {
    const edge = effectiveBoundaryEdge(boundary);
    const sides: Array<readonly [number, number]> = edge === 'north'
      ? [[boundary.tileX, boundary.tileY], [boundary.tileX, boundary.tileY - 1]]
      : edge === 'south'
        ? [[boundary.tileX, boundary.tileY], [boundary.tileX, boundary.tileY + 1]]
        : edge === 'west'
          ? [[boundary.tileX, boundary.tileY], [boundary.tileX - 1, boundary.tileY]]
          : [[boundary.tileX, boundary.tileY], [boundary.tileX + 1, boundary.tileY]];
    for (const [x, y] of sides) {
      const index = componentByCell.get(cellKey(x, y));
      if (index === undefined) continue;
      const component = components[index]!;
      component.boundaryParts += 1;
      component.materialValue += materialValue(boundary);
      break;
    }
  }

  const structures = components.map((component): StructureScore => {
    const n = component.surfaceCells + component.boundaryParts;
    return {
      surfaceCells: component.surfaceCells,
      boundaryParts: component.boundaryParts,
      n,
      totalMaterialValue: component.materialValue,
      score: component.materialValue * Math.pow(n, 0.4),
    };
  });
  return {
    total: structures.reduce((sum, structure) => sum + structure.score, 0),
    structures,
  };
}

function materialValue(building: BuildingState): number {
  const material = buildableById(building.definitionId).material;
  return material ? MATERIAL_VALUES[material] : 0;
}

function compareCellKeys(left: string, right: string): number {
  const [lx, ly] = left.split(',').map(Number) as [number, number];
  const [rx, ry] = right.split(',').map(Number) as [number, number];
  return ly - ry || lx - rx;
}

/** Display convention: totals and breakdowns round to one decimal place. */
export function formatRating(total: number): string {
  return (Math.round(total * 10) / 10).toFixed(1);
}

/**
 * Sticky milestone record in fixed-point tenths. Rating is never spent and a
 * temporary demolition never revokes contract ranks unlocked through it.
 */
export function recordHighestRating(state: GameState): number {
  const { total } = homesteadRating(state.buildings);
  const tenths = Math.round(total * 10);
  if (tenths > state.highestRatingEverTenths) state.highestRatingEverTenths = tenths;
  return total;
}
