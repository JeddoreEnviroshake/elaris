import {
  GARDEN_BED_GROW_TICKS,
  GARDEN_BED_GROWTH_STEP_TICKS,
  GARDEN_BED_READY_CAP,
  GARDEN_BED_YIELD_FIBER,
  INTERACTION_RANGE_PX,
} from '../config/balance';
import { PLACEABLES, type PlaceableDefinition } from '../config/areaGates';
import { TILE_SIZE } from '../config/platform';
import { evaluatePlaceableGate, measureEnvironment, type PlaceableGateResult } from './environmentProgress';
import { buildableById, tryAddResource, type CommandResult } from './gameplayCommands';
import { createGardenBedState } from './state';
import type { BuildingState, GameState } from './state';

/**
 * Garden Bed simulation: deterministic, renewable fiber growth inside a
 * qualifying grassland work yard. Growth advances in one-second quanta so the
 * enclosure geometry (the only mutable validity input — biome soil is fixed by
 * the world seed) is re-derived cheaply from `state.buildings` each quantum
 * rather than persisted as a second truth. An invalid environment suspends the
 * bed without touching its progress; a full bed pauses growth with no
 * invisible backlog.
 */

export type GardenBedPhase = 'growing' | 'ready' | 'blocked' | 'suspended';

export interface GardenBedStatus {
  phase: GardenBedPhase;
  /** One concise HUD line: what the bed is doing and why. */
  message: string;
}

export function gardenBedPlaceable(): PlaceableDefinition {
  const placeable = PLACEABLES.find((candidate) => candidate.id === 'garden-bed');
  if (!placeable) throw new Error('garden-bed placeable is not defined');
  return placeable;
}

/** Current-environment validity, always derived from saved wall geometry. */
export function gardenBedEnvironmentGate(state: GameState, bed: BuildingState): PlaceableGateResult {
  return evaluatePlaceableGate(
    gardenBedPlaceable(),
    measureEnvironment(state.buildings, bed.tileX, bed.tileY, 'workYard'),
  );
}

/**
 * Advance every Garden Bed one due quantum. Called once per fixed tick;
 * idempotent at a given tick because `nextGrowthTick` persists with the
 * progress it granted. Returns true only when a batch finished (save-worthy).
 */
export function advanceGardenBeds(state: GameState): boolean {
  let changed = false;
  for (const bed of state.buildings) {
    if (bed.definitionId !== 'garden-bed') continue;
    const garden = (bed.garden ??= createGardenBedState(state.tick));
    if (state.tick < garden.nextGrowthTick) continue;
    // The quantum is spent whether or not it grows: a suspended or blocked
    // interval never back-pays after recovery.
    garden.nextGrowthTick = state.tick + GARDEN_BED_GROWTH_STEP_TICKS;
    const outputFull = garden.readyFiber + GARDEN_BED_YIELD_FIBER > GARDEN_BED_READY_CAP;
    if (garden.progressTicks >= GARDEN_BED_GROW_TICKS && outputFull) continue; // blocked
    if (!gardenBedEnvironmentGate(state, bed).ok) continue; // suspended
    garden.progressTicks = Math.min(GARDEN_BED_GROW_TICKS, garden.progressTicks + GARDEN_BED_GROWTH_STEP_TICKS);
    if (garden.progressTicks >= GARDEN_BED_GROW_TICKS && !outputFull) {
      garden.progressTicks = 0;
      garden.readyFiber += GARDEN_BED_YIELD_FIBER;
      state.resourcesCollected.fiber += GARDEN_BED_YIELD_FIBER;
      changed = true;
    }
  }
  return changed;
}

/** Nearest Garden Bed by footprint center, for the context action. */
export function nearestGardenBed(state: GameState, range = INTERACTION_RANGE_PX): BuildingState | null {
  let nearest: BuildingState | null = null;
  let nearestDistance = range;
  for (const bed of state.buildings) {
    if (bed.definitionId !== 'garden-bed') continue;
    const distance = distanceToBed(state, bed);
    if (distance <= nearestDistance) {
      nearest = bed;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Atomically move all grown fiber into the player's inventory. */
export function harvestGardenBed(state: GameState, buildingId: string, range = INTERACTION_RANGE_PX): CommandResult {
  const bed = state.buildings.find(
    (candidate) => candidate.id === buildingId && candidate.definitionId === 'garden-bed',
  );
  if (!bed) return { ok: false, message: 'Garden Bed not found' };
  if (distanceToBed(state, bed) > range) return { ok: false, message: 'Too far away' };
  const amount = bed.garden?.readyFiber ?? 0;
  if (amount <= 0) return { ok: false, message: 'Nothing to harvest yet', targetId: bed.id };
  if (!tryAddResource(state, 'fiber', amount)) return { ok: false, message: 'Inventory full', targetId: bed.id };
  bed.garden!.readyFiber = 0;
  return { ok: true, message: `+${amount} fiber from Garden Bed`, targetId: bed.id };
}

/** Concise status line explaining growing / ready / blocked / suspended and why. */
export function describeGardenBed(state: GameState, bed: BuildingState): GardenBedStatus {
  const garden = bed.garden ?? createGardenBedState(state.tick);
  const gate = gardenBedEnvironmentGate(state, bed);
  if (!gate.ok) {
    return { phase: 'suspended', message: `Garden Bed suspended — ${gate.reason ?? 'environment no longer qualifies'}` };
  }
  if (garden.readyFiber + GARDEN_BED_YIELD_FIBER > GARDEN_BED_READY_CAP && garden.progressTicks >= GARDEN_BED_GROW_TICKS) {
    return { phase: 'blocked', message: `Garden Bed full — harvest ${garden.readyFiber} fiber to resume growth` };
  }
  if (garden.readyFiber > 0) {
    return { phase: 'ready', message: `Garden Bed ready — ${garden.readyFiber} fiber · E / Space to harvest` };
  }
  const secondsLeft = Math.ceil((GARDEN_BED_GROW_TICKS - garden.progressTicks) / 60);
  return { phase: 'growing', message: `Garden Bed growing — fiber in ${secondsLeft}s` };
}

function distanceToBed(state: GameState, bed: BuildingState): number {
  const definition = buildableById(bed.definitionId);
  const centerX = (bed.tileX + definition.tilesWide / 2) * TILE_SIZE;
  const centerY = (bed.tileY + definition.tilesHigh / 2) * TILE_SIZE;
  return Math.hypot(centerX - state.player.x, centerY - state.player.y);
}
