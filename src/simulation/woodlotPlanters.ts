import {
  INTERACTION_RANGE_PX,
  WOODLOT_GROW_TICKS,
  WOODLOT_GROWTH_STEP_TICKS,
  WOODLOT_READY_CAP,
  WOODLOT_YIELD_WOOD,
} from '../config/balance';
import { PLACEABLES, type PlaceableDefinition } from '../config/areaGates';
import { TILE_SIZE } from '../config/platform';
import { starterBiomeAt } from './biomes';
import { evaluatePlaceableGate, measureEnvironment, type PlaceableGateResult } from './environmentProgress';
import { buildableById, tryAddResource, type CommandResult } from './gameplayCommands';
import { createWoodlotPlanterState, type BuildingState, type GameState } from './state';

export type WoodlotPhase = 'growing' | 'ready' | 'blocked' | 'suspended';

export interface WoodlotStatus {
  phase: WoodlotPhase;
  message: string;
}

export function woodlotPlaceable(): PlaceableDefinition {
  const placeable = PLACEABLES.find((candidate) => candidate.id === 'woodlot-planter');
  if (!placeable) throw new Error('woodlot-planter placeable is not defined');
  return placeable;
}

export function woodlotEnvironmentGate(state: GameState, planter: BuildingState): PlaceableGateResult {
  const gate = evaluatePlaceableGate(
    woodlotPlaceable(),
    measureEnvironment(state.buildings, planter.tileX, planter.tileY, 'workYard'),
  );
  if (!gate.ok) return gate;
  for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
    const x = (planter.tileX + dx) * TILE_SIZE + TILE_SIZE / 2;
    const y = (planter.tileY + dy) * TILE_SIZE + TILE_SIZE / 2;
    if (starterBiomeAt(state.seed, x, y) !== 'forest') {
      return { ok: false, reason: 'Requires open forest soil' };
    }
  }
  return gate;
}

export function advanceWoodlotPlanters(state: GameState): boolean {
  let changed = false;
  for (const planter of state.buildings) {
    if (planter.definitionId !== 'woodlot-planter') continue;
    const woodlot = (planter.woodlot ??= createWoodlotPlanterState(state.tick));
    if (state.tick < woodlot.nextGrowthTick) continue;
    woodlot.nextGrowthTick = state.tick + WOODLOT_GROWTH_STEP_TICKS;
    const outputFull = woodlot.readyWood + WOODLOT_YIELD_WOOD > WOODLOT_READY_CAP;
    if (woodlot.progressTicks >= WOODLOT_GROW_TICKS && outputFull) continue;
    if (!woodlotEnvironmentGate(state, planter).ok) continue;
    woodlot.progressTicks = Math.min(WOODLOT_GROW_TICKS, woodlot.progressTicks + WOODLOT_GROWTH_STEP_TICKS);
    if (woodlot.progressTicks >= WOODLOT_GROW_TICKS && !outputFull) {
      woodlot.progressTicks = 0;
      woodlot.readyWood += WOODLOT_YIELD_WOOD;
      state.resourcesCollected.wood += WOODLOT_YIELD_WOOD;
      changed = true;
    }
  }
  return changed;
}

export function nearestWoodlotPlanter(state: GameState, range = INTERACTION_RANGE_PX): BuildingState | null {
  let nearest: BuildingState | null = null;
  let nearestDistance = range;
  for (const planter of state.buildings) {
    if (planter.definitionId !== 'woodlot-planter') continue;
    const distance = distanceToPlanter(state, planter);
    if (distance <= nearestDistance) {
      nearest = planter;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function harvestWoodlotPlanter(state: GameState, buildingId: string, range = INTERACTION_RANGE_PX): CommandResult {
  const planter = state.buildings.find(
    (candidate) => candidate.id === buildingId && candidate.definitionId === 'woodlot-planter',
  );
  if (!planter) return { ok: false, message: 'Woodlot Planter not found' };
  if (distanceToPlanter(state, planter) > range) return { ok: false, message: 'Too far away' };
  const amount = planter.woodlot?.readyWood ?? 0;
  if (amount <= 0) return { ok: false, message: 'Nothing to harvest yet', targetId: planter.id };
  if (!tryAddResource(state, 'wood', amount)) return { ok: false, message: 'Inventory full', targetId: planter.id };
  planter.woodlot!.readyWood = 0;
  return { ok: true, message: `+${amount} wood from Woodlot Planter`, targetId: planter.id };
}

export function describeWoodlotPlanter(state: GameState, planter: BuildingState): WoodlotStatus {
  const woodlot = planter.woodlot ?? createWoodlotPlanterState(state.tick);
  const gate = woodlotEnvironmentGate(state, planter);
  if (!gate.ok) return { phase: 'suspended', message: `Woodlot suspended — ${gate.reason ?? 'environment no longer qualifies'}` };
  if (woodlot.readyWood + WOODLOT_YIELD_WOOD > WOODLOT_READY_CAP && woodlot.progressTicks >= WOODLOT_GROW_TICKS) {
    return { phase: 'blocked', message: `Woodlot full — harvest ${woodlot.readyWood} wood to resume growth` };
  }
  if (woodlot.readyWood > 0) return { phase: 'ready', message: `Woodlot ready — ${woodlot.readyWood} wood · E / Space to harvest` };
  const secondsLeft = Math.ceil((WOODLOT_GROW_TICKS - woodlot.progressTicks) / 60);
  return { phase: 'growing', message: `Woodlot growing — wood in ${secondsLeft}s` };
}

function distanceToPlanter(state: GameState, planter: BuildingState): number {
  const definition = buildableById(planter.definitionId);
  const centerX = (planter.tileX + definition.tilesWide / 2) * TILE_SIZE;
  const centerY = (planter.tileY + definition.tilesHigh / 2) * TILE_SIZE;
  return Math.hypot(centerX - state.player.x, centerY - state.player.y);
}
