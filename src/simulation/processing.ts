import {
  FURNACE_OUTPUT_CAPACITY,
  FURNACE_QUEUE_CAPACITY,
  IRON_SMELT_INPUTS,
  IRON_SMELT_WORK_MS,
} from '../config/balance';
import { PLACEABLES } from '../config/areaGates';
import { buildableById } from '../content/buildingParts';
import { evaluateFacilityGate } from './environmentProgress';
import { inventoryCapacity } from './characterProgression';
import { resourceStacksForAmount } from './inventoryStacks';
import type { CommandResult } from './gameplayCommands';
import type { BuildingState, FurnaceQueueItem, FurnaceState, GameState, ResourceId } from './state';
import { unlockBlockedReason } from './unlocks';
import { recordCraft } from './questTracking';

export const IRON_SMELT_REQUIREMENT = {
  allOf: [
    { kind: 'materialDiscovered' as const, materialId: 'iron' as const },
    { kind: 'workstationAvailable' as const, workstationId: 'furnace' as const },
  ],
};

export function createFurnaceState(): FurnaceState {
  return { queue: [] };
}

export function furnaceOperationGate(state: GameState, furnace: BuildingState): CommandResult {
  if (furnace.definitionId !== 'furnace' || !furnace.furnace) {
    return { ok: false, message: 'Furnace not found' };
  }
  const placeable = PLACEABLES.find((candidate) => candidate.id === 'furnace')!;
  const definition = buildableById('furnace');
  const gate = evaluateFacilityGate(
    state.buildings, placeable, furnace.tileX, furnace.tileY,
    definition.tilesWide, definition.tilesHigh,
  );
  return gate.ok ? { ok: true, message: '' } : { ok: false, message: gate.reason ?? 'Furnace is unavailable' };
}

/**
 * Atomically reserves recipe inputs and one queue/output slot. Every check is
 * repeated against authoritative state before any resource is consumed.
 */
export function enqueueIronSmelt(state: GameState, furnaceId: string, quantity = 1): CommandResult {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return { ok: false, message: 'Choose a positive whole batch' };
  const furnace = state.buildings.find((building) => building.id === furnaceId);
  if (!furnace) return { ok: false, message: 'Furnace not found' };
  const operation = furnaceOperationGate(state, furnace);
  if (!operation.ok) return operation;
  const locked = unlockBlockedReason(state, IRON_SMELT_REQUIREMENT);
  if (locked) return { ok: false, message: locked };
  const queue = furnace.furnace!.queue;
  if (queue.length + quantity > FURNACE_QUEUE_CAPACITY) {
    return { ok: false, message: `Furnace queue full (${queue.length}/${FURNACE_QUEUE_CAPACITY})` };
  }
  for (const [resource, perBatch] of Object.entries(IRON_SMELT_INPUTS) as Array<[ResourceId, number]>) {
    const required = perBatch * quantity;
    if (state.inventory[resource] < required) {
      return { ok: false, message: `Need ${required - state.inventory[resource]} more ${resource}` };
    }
  }

  for (const [resource, perBatch] of Object.entries(IRON_SMELT_INPUTS) as Array<[ResourceId, number]>) {
    state.inventory[resource] -= perBatch * quantity;
  }
  for (let i = 0; i < quantity; i += 1) {
    queue.push({
      recipe: 'iron-ingot',
      remainingWorkMs: IRON_SMELT_WORK_MS,
      reservedInputs: { ...IRON_SMELT_INPUTS },
      completedOutput: 0,
      blocked: false,
    });
  }
  state.questProgress.furnaceQueuePeak = Math.max(state.questProgress.furnaceQueuePeak, queue.length);
  return { ok: true, message: `Queued ${quantity} iron ingot${quantity === 1 ? '' : 's'}` };
}

/** Collect every completed output atomically; a full bag leaves the queue untouched. */
export function collectFurnaceOutput(state: GameState, furnaceId: string): CommandResult {
  const furnace = state.buildings.find((building) => building.id === furnaceId && building.definitionId === 'furnace');
  if (!furnace?.furnace) return { ok: false, message: 'Furnace not found' };
  const completed = furnace.furnace.queue.reduce((sum, item) => sum + item.completedOutput, 0);
  if (completed <= 0) return { ok: false, message: 'No iron ingots ready' };
  if (!tryAddProcessedOutput(state, 'iron-ingot', completed)) return { ok: false, message: 'Inventory full' };
  furnace.furnace.queue = furnace.furnace.queue.filter((item) => item.completedOutput === 0);
  updateBlockedFlags(furnace.furnace);
  return { ok: true, message: `Collected ${completed} iron ingot${completed === 1 ? '' : 's'}` };
}

function tryAddProcessedOutput(state: GameState, resource: ResourceId, amount: number): boolean {
  const used = state.tools.length + (Object.keys(state.inventory) as ResourceId[]).reduce(
    (slots, id) => slots + resourceStacksForAmount(state, id, state.inventory[id]).length, 0,
  );
  const current = state.inventory[resource];
  const currentSlots = resourceStacksForAmount(state, resource, current).length;
  const resulting = resourceStacksForAmount(state, resource, current + amount);
  const nextUsed = used - currentSlots + resulting.length;
  if (nextUsed > inventoryCapacity(state)) return false;
  state.inventory[resource] += amount;
  state.inventoryStacks[resource] = resulting;
  return true;
}

/**
 * Decrement Furnace work by whole milliseconds. Work advances in queue order
 * only while the indoor operation gate passes and output has room.
 */
export interface FurnaceAdvanceResult { progressed: boolean; completed: number }

export function advanceFurnaces(state: GameState, elapsedMs: number): FurnaceAdvanceResult {
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs <= 0) return { progressed: false, completed: 0 };
  let completed = 0;
  let progressed = false;
  for (const building of state.buildings) {
    if (building.definitionId !== 'furnace' || !building.furnace) continue;
    if (!furnaceOperationGate(state, building).ok) continue;
    const before = building.furnace.queue.map((item) => `${item.remainingWorkMs}:${item.completedOutput}:${item.blocked}`).join('|');
    completed += advanceFurnaceQueue(building.furnace, elapsedMs);
    const after = building.furnace.queue.map((item) => `${item.remainingWorkMs}:${item.completedOutput}:${item.blocked}`).join('|');
    if (before !== after) progressed = true;
  }
  if (completed > 0) {
    state.resourcesCollected['iron-ingot'] += completed;
    recordCraft(state, 'iron-ingot', completed);
  }
  return { progressed, completed };
}

export function advanceFurnaceQueue(furnace: FurnaceState, elapsedMs: number): number {
  let availableMs = elapsedMs;
  let completed = 0;
  updateBlockedFlags(furnace);
  while (availableMs > 0) {
    const outputCount = furnace.queue.reduce((sum, item) => sum + item.completedOutput, 0);
    const active = furnace.queue.find((item) => item.completedOutput === 0);
    if (!active) break;
    if (outputCount >= FURNACE_OUTPUT_CAPACITY) {
      active.blocked = true;
      break;
    }
    active.blocked = false;
    const applied = Math.min(active.remainingWorkMs, availableMs);
    active.remainingWorkMs -= applied;
    availableMs -= applied;
    if (active.remainingWorkMs > 0) break;
    active.completedOutput = 1;
    completed += 1;
  }
  updateBlockedFlags(furnace);
  return completed;
}

function updateBlockedFlags(furnace: FurnaceState): void {
  for (const item of furnace.queue) item.blocked = false;
  const outputCount = furnace.queue.reduce((sum, item) => sum + item.completedOutput, 0);
  const active = furnace.queue.find((item) => item.completedOutput === 0);
  if (active && outputCount >= FURNACE_OUTPUT_CAPACITY) active.blocked = true;
}

export function furnaceQueueItemIsValid(item: FurnaceQueueItem): boolean {
  return item.recipe === 'iron-ingot'
    && Number.isSafeInteger(item.remainingWorkMs) && item.remainingWorkMs >= 0
    && Number.isSafeInteger(item.completedOutput) && (item.completedOutput === 0 || item.completedOutput === 1)
    && typeof item.blocked === 'boolean';
}
