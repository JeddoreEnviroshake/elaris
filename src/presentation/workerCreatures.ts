import { TILE_SIZE } from '../config/platform';
import { buildableById } from '../content/buildingParts';
import { buildingCenterPx, effectiveDimensions } from '../simulation/buildingGeometry';
import type { GameState, SpeciesId } from '../simulation/state';

/**
 * A creature set to Work is otherwise invisible: its output lands in a bin and
 * nothing on the map says the pen is staffed. These placements let both world
 * renderers draw the worker ambling around its worksite. The path is a pure
 * function of the creature id and the clock, so nothing enters the simulation
 * state and the two presentations agree on where the creature is.
 */
export interface WorkerCreaturePlacement {
  readonly id: string;
  readonly speciesId: SpeciesId;
  readonly worksiteId: string;
  /** Worksite midpoint in world pixels; the loop is centred here. */
  readonly centerX: number;
  readonly centerY: number;
  readonly radiusX: number;
  readonly radiusY: number;
  /** Deterministic per-creature offset so two workers never walk in lockstep. */
  readonly phase: number;
  readonly speed: number;
}

export interface WorkerCreaturePose {
  readonly x: number;
  readonly y: number;
  /** Travel direction in world pixels, already normalized; zero while paused. */
  readonly dirX: number;
  readonly dirY: number;
  readonly moving: boolean;
}

/** How far outside the footprint the wander loop sits, in tiles. */
const MARGIN_TILES = 0.85;
const PAUSE_SAMPLE_MS = 90;

function idHash(id: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  // Avalanche the result. Creature ids are allocated in sequence, and plain
  // FNV leaves `creature-1` and `creature-2` a hair apart — two workers in one
  // pen would then walk the same path a few pixels offset.
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2_246_822_507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3_266_489_909);
  hash ^= hash >>> 16;
  // `>>> 0` keeps this unsigned; a signed hash would fold the phase backwards.
  return (hash >>> 0) / 4_294_967_296;
}

/** Working creatures whose worksite stands in the current area, in roster order. */
export function workerCreaturePlacements(state: GameState): WorkerCreaturePlacement[] {
  const placements: WorkerCreaturePlacement[] = [];
  for (const creature of state.ownedCreatures) {
    if (creature.role !== 'work' || !creature.worksiteId) continue;
    const worksite = state.buildings.find((building) => building.id === creature.worksiteId);
    if (!worksite) continue;
    const dimensions = effectiveDimensions(buildableById(worksite.definitionId), worksite.rotated === true);
    const center = buildingCenterPx(worksite);
    const roll = idHash(creature.id);
    placements.push({
      id: creature.id,
      speciesId: creature.speciesId,
      worksiteId: worksite.id,
      centerX: center.x,
      centerY: center.y,
      radiusX: (dimensions.tilesWide / 2 + MARGIN_TILES) * TILE_SIZE,
      radiusY: (dimensions.tilesHigh / 2 + MARGIN_TILES) * TILE_SIZE,
      phase: roll * Math.PI * 2,
      // A modest spread keeps a crowded pen from looking choreographed.
      speed: 0.16 + roll * 0.06,
    });
  }
  return placements;
}

function loopPoint(placement: WorkerCreaturePlacement, timeMs: number): { x: number; y: number } {
  const t = (timeMs / 1000) * placement.speed + placement.phase;
  // Easing the parameter itself makes the creature dawdle at two points of the
  // loop and stride between them, which reads as grazing rather than orbiting.
  const eased = t + Math.sin(t) * 0.62;
  return {
    x: placement.centerX + Math.sin(eased) * placement.radiusX,
    y: placement.centerY + Math.sin(eased * 2 + placement.phase) * placement.radiusY * 0.5,
  };
}

/** Where the worker stands right now, plus the heading that got it there. */
export function workerCreaturePose(placement: WorkerCreaturePlacement, timeMs: number): WorkerCreaturePose {
  const point = loopPoint(placement, timeMs);
  const previous = loopPoint(placement, timeMs - PAUSE_SAMPLE_MS);
  const dx = point.x - previous.x;
  const dy = point.y - previous.y;
  const distance = Math.hypot(dx, dy);
  const moving = distance > 0.35;
  return {
    x: point.x,
    y: point.y,
    dirX: moving ? dx / distance : 0,
    dirY: moving ? dy / distance : 0,
    moving,
  };
}
