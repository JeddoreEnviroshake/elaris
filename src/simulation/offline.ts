import {
  GARDEN_BED_GROW_TICKS,
  GARDEN_BED_GROWTH_STEP_TICKS,
  GARDEN_BED_READY_CAP,
  GARDEN_BED_YIELD_FIBER,
  OFFLINE_CAP_MS,
  WOODLOT_GROW_TICKS,
  WOODLOT_GROWTH_STEP_TICKS,
  WOODLOT_READY_CAP,
  WOODLOT_YIELD_WOOD,
} from '../config/balance';
import { gardenBedEnvironmentGate } from './gardenBeds';
import { woodlotEnvironmentGate } from './woodlotPlanters';
import type { GameState } from './state';
import { advanceFurnaces } from './processing';
import { settleWorkerProduction } from './workerHousing';
import { advanceLogisticsRouting } from './logistics';
import { advanceExpeditions } from './expeditions';

/**
 * Capped, forward-only offline settlement (spec: "Capped offline work").
 * Called once on load with the wall-clock time since the save was written.
 * Node respawn timers and grower progress advance by at most OFFLINE_CAP_MS;
 * a backward clock advances nothing (and cannot create a later duplicate
 * window, because the next save rewrites `savedAt` with the current clock).
 * Player movement, battles, and encounter AI never advance while closed, and
 * a full output bin never releases historical production.
 */

export interface OfflineSummary {
  /** Milliseconds actually applied after the cap and backward-clock guard. */
  appliedMs: number;
  nodesRespawned: number;
  fiberGrown: number;
  woodGrown: number;
  ingotsSmelted: number;
  workerResourcesProduced: number;
  /** Expeditions that finished while the game was closed and are awaiting collection. */
  expeditionsReturned: number;
}

export function settleOfflineTime(state: GameState, elapsedMs: number): OfflineSummary {
  if (state.pendingRespawn) {
    return {
      appliedMs: 0, nodesRespawned: 0, fiberGrown: 0, woodGrown: 0,
      ingotsSmelted: 0, workerResourcesProduced: 0, expeditionsReturned: 0,
    };
  }
  const appliedMs = Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.min(elapsedMs, OFFLINE_CAP_MS) : 0;
  const offlineTicks = Math.floor((appliedMs * 60) / 1000);
  const furnace = advanceFurnaces(state, Math.floor(appliedMs));
  const workers = settleWorkerProduction(state, Math.floor(appliedMs));
  // Expeditions settle through the same call the online tick uses, so an
  // overnight Deep Survey lands exactly as it would have with the game open.
  const expeditions = advanceExpeditions(state, Math.floor(appliedMs));
  advanceLogisticsRouting(state);
  const summary: OfflineSummary = {
    appliedMs, nodesRespawned: 0, fiberGrown: 0, woodGrown: 0, ingotsSmelted: furnace.completed,
    workerResourcesProduced: workers.produced,
    expeditionsReturned: expeditions.returned,
  };
  if (offlineTicks <= 0) return summary;

  for (const node of state.resourceNodes) {
    if (node.hp > 0 || node.respawnAtTick === null) continue;
    const remaining = node.respawnAtTick - state.tick - offlineTicks;
    if (remaining <= 0) {
      node.hp = node.maxHp;
      node.respawnAtTick = null;
      summary.nodesRespawned += 1;
    } else {
      node.respawnAtTick = state.tick + remaining;
    }
  }

  for (const building of state.buildings) {
    if (building.definitionId === 'garden-bed' && building.garden) {
      // Suspended growers accrue nothing offline, matching the online rule.
      if (!gardenBedEnvironmentGate(state, building).ok) continue;
      const garden = building.garden;
      const grown = settleGrower(
        garden, offlineTicks, GARDEN_BED_GROW_TICKS, GARDEN_BED_YIELD_FIBER, GARDEN_BED_READY_CAP,
      );
      garden.readyFiber += grown;
      state.resourcesCollected.fiber += grown;
      summary.fiberGrown += grown;
      garden.nextGrowthTick = state.tick + GARDEN_BED_GROWTH_STEP_TICKS;
    } else if (building.definitionId === 'woodlot-planter' && building.woodlot) {
      if (!woodlotEnvironmentGate(state, building).ok) continue;
      const woodlot = building.woodlot;
      const grown = settleGrower(
        woodlot, offlineTicks, WOODLOT_GROW_TICKS, WOODLOT_YIELD_WOOD, WOODLOT_READY_CAP,
      );
      woodlot.readyWood += grown;
      state.resourcesCollected.wood += grown;
      summary.woodGrown += grown;
      woodlot.nextGrowthTick = state.tick + WOODLOT_GROWTH_STEP_TICKS;
    }
  }
  return summary;
}

/**
 * Batch-advance one grower exactly as the online quantum loop would: complete
 * cycles pay out while output space remains, progress then holds at most one
 * ripe batch, and blocked time is discarded rather than banked.
 */
function settleGrower(
  grower: { progressTicks: number; readyFiber?: number; readyWood?: number },
  offlineTicks: number,
  growTicks: number,
  yieldAmount: number,
  readyCap: number,
): number {
  let ready = grower.readyFiber ?? grower.readyWood ?? 0;
  let available = grower.progressTicks + offlineTicks;
  let grown = 0;
  while (available >= growTicks && ready + yieldAmount <= readyCap) {
    available -= growTicks;
    ready += yieldAmount;
    grown += yieldAmount;
  }
  grower.progressTicks = Math.min(available, growTicks);
  return grown;
}
