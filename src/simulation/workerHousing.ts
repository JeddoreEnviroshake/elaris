import { PLACEABLES } from '../config/areaGates';
import { buildableById } from '../content/buildingParts';
import { producerForSpecies, type ProducerDefinition } from '../content/producers';
import { FARM_ORDER_COSTS } from '../content/economy';
import { evaluateFacilityGate, environmentAt, type EnvironmentInfo } from './environmentProgress';
import type { CommandResult } from './gameplayCommands';
import type { BuildingState, GameState, OwnedCreatureState, ResourceId } from './state';
import { inventoryCapacity } from './characterProgression';
import { resourceStacksForAmount } from './inventoryStacks';
import { creatureWorksiteOperationGate, reconcileCreatureWorksites } from './creatureRoles';
import { recordOpeningProduction, recordOpeningProductionCollection } from './onboardingProgress';

export const HOUSING_SLOTS = { 'small-pen': 1, barn: 3 } as const;
export const HOUSING_BIN_CAPACITY = { 'small-pen': 12, barn: 36 } as const;
export const STONE_YARD_BIN_CAPACITY = 18;
export type HousingDefinitionId = keyof typeof HOUSING_SLOTS;

export interface HousingCapacityView {
  environmentId: string;
  area: number;
  buildingSlots: number;
  capacity: number;
  assigned: number;
  available: number;
}

export interface WorkerSettlement {
  completedCycles: number;
  produced: number;
}

export function isHousingBuilding(building: BuildingState): building is BuildingState & { definitionId: HousingDefinitionId } {
  return building.definitionId === 'small-pen' || building.definitionId === 'barn';
}

export function housingBinCapacity(building: BuildingState): number {
  return isHousingBuilding(building) ? HOUSING_BIN_CAPACITY[building.definitionId] : 0;
}

export function housingBinCount(building: BuildingState): number {
  return (building.housing?.bin.fiber ?? 0) + (building.housing?.bin.berry ?? 0);
}

export function housingOperationGate(state: GameState, building: BuildingState): CommandResult {
  if (!isHousingBuilding(building) || !building.housing) return { ok: false, message: 'Housing not found' };
  const placeable = PLACEABLES.find((candidate) => candidate.id === building.definitionId)!;
  const definition = buildableById(building.definitionId);
  const gate = evaluateFacilityGate(
    state.buildings, placeable, building.tileX, building.tileY, definition.tilesWide, definition.tilesHigh,
  );
  return gate.ok ? { ok: true, message: '' } : { ok: false, message: gate.reason ?? 'Housing is not operational' };
}

function operationalEnvironment(state: GameState, building: BuildingState): EnvironmentInfo | null {
  if (!housingOperationGate(state, building).ok) return null;
  return environmentAt(state.buildings, building.tileX, building.tileY);
}

function operationalHousingInEnvironment(state: GameState, environment: EnvironmentInfo): Array<BuildingState & { definitionId: HousingDefinitionId }> {
  return state.buildings
    .filter(isHousingBuilding)
    .filter((building) => operationalEnvironment(state, building)?.id === environment.id)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function housingCapacityForBuilding(state: GameState, building: BuildingState): HousingCapacityView | null {
  const environment = operationalEnvironment(state, building);
  if (!environment) return null;
  const buildings = operationalHousingInEnvironment(state, environment);
  const buildingSlots = buildings.reduce((sum, candidate) => sum + HOUSING_SLOTS[candidate.definitionId], 0);
  const capacity = Math.min(buildingSlots, Math.floor(environment.area / 8));
  const ids = new Set(buildings.map((candidate) => candidate.id));
  const assigned = state.ownedCreatures.filter((creature) => typeof creature.housingId === 'string' && ids.has(creature.housingId)).length;
  return {
    environmentId: environment.id,
    area: environment.area,
    buildingSlots,
    capacity,
    assigned,
    available: Math.max(0, capacity - assigned),
  };
}

function assignedToBuilding(state: GameState, buildingId: string): number {
  return state.ownedCreatures.filter((creature) => creature.housingId === buildingId).length;
}

export function availableHousing(state: GameState): (BuildingState & { definitionId: HousingDefinitionId }) | null {
  for (const building of state.buildings.filter(isHousingBuilding).sort((a, b) => a.id.localeCompare(b.id))) {
    const view = housingCapacityForBuilding(state, building);
    if (!view || view.available <= 0) continue;
    if (assignedToBuilding(state, building.id) >= HOUSING_SLOTS[building.definitionId]) continue;
    return building;
  }
  return null;
}

/** Reserve one stable Pen/Barn slot without changing follow/rest/work state. */
export function assignCreatureHousing(state: GameState, creatureId: string, housingId?: string): CommandResult {
  const creature = state.ownedCreatures.find((candidate) => candidate.id === creatureId);
  if (!creature) return { ok: false, message: 'Creature not found' };
  const housing = housingId
    ? state.buildings.find((building): building is BuildingState & { definitionId: HousingDefinitionId } => building.id === housingId && isHousingBuilding(building)) ?? null
    : availableHousing(state);
  if (!housing) return { ok: false, message: 'Build an operational Small Pen or Barn with a free housing slot' };
  if (creature.housingId !== housing.id) {
    const view = housingCapacityForBuilding(state, housing);
    if (!view || view.available <= 0 || assignedToBuilding(state, housing.id) >= HOUSING_SLOTS[housing.definitionId]) {
      return { ok: false, message: 'That paddock has no free housing slot' };
    }
  }
  creature.housingId = housing.id;
  return { ok: true, message: `${creature.name} housed in ${buildableById(housing.definitionId).displayName}` };
}

/** Invalid or demolished housing never deletes a creature or accumulated output. */
export function reconcileCreatureHousing(state: GameState): boolean {
  const allowedCreatureIds = new Set<string>();
  const remainingByEnvironment = new Map<string, number>();
  for (const housing of state.buildings.filter(isHousingBuilding).sort((left, right) => left.id.localeCompare(right.id))) {
    const view = housingCapacityForBuilding(state, housing);
    if (!view) continue;
    const remaining = remainingByEnvironment.get(view.environmentId) ?? view.capacity;
    const occupants = state.ownedCreatures
      .filter((creature) => creature.housingId === housing.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    const keep = Math.min(remaining, HOUSING_SLOTS[housing.definitionId], occupants.length);
    for (const creature of occupants.slice(0, keep)) allowedCreatureIds.add(creature.id);
    remainingByEnvironment.set(view.environmentId, remaining - keep);
  }

  let changed = false;
  for (const creature of state.ownedCreatures) {
    if (!creature.housingId) continue;
    const housing = state.buildings.find((building) => building.id === creature.housingId);
    const missing = !housing || !isHousingBuilding(housing);
    const invalid = !missing && !housingOperationGate(state, housing).ok;
    const overCapacity = !missing && !invalid && !allowedCreatureIds.has(creature.id);
    if (!missing && !invalid && !overCapacity) continue;
    if (creature.role !== 'rest' || creature.assignment !== null || creature.worksiteId !== null || (creature.workRemainderMs ?? 0) !== 0) {
      creature.role = 'rest';
      creature.assignment = null;
      creature.worksiteId = null;
      creature.workRemainderMs = 0;
      changed = true;
    }
    if ((missing || overCapacity) && creature.housingId !== null) {
      creature.housingId = null;
      changed = true;
    }
    if (state.battleCompanionId === creature.id) {
      state.battleCompanionId = null;
      changed = true;
    }
  }
  return changed;
}

function outputAmount(producer: ProducerDefinition): number {
  return Object.values(producer.outputPerCycle).reduce((sum, amount) => sum + (amount ?? 0), 0);
}

export function workerFacilityBinCapacity(building: BuildingState): number {
  if (isHousingBuilding(building)) return housingBinCapacity(building);
  return building.definitionId === 'stone-yard' ? STONE_YARD_BIN_CAPACITY : 0;
}

export function workerFacilityBinCount(building: BuildingState): number {
  if (isHousingBuilding(building)) return housingBinCount(building);
  return building.producer?.bin.stone ?? 0;
}

function freeCycles(building: BuildingState, producer: ProducerDefinition): number {
  const perCycle = outputAmount(producer);
  return perCycle <= 0 ? 0 : Math.floor((workerFacilityBinCapacity(building) - workerFacilityBinCount(building)) / perCycle);
}

function applyProducerOutput(building: BuildingState, producer: ProducerDefinition, cycles: number): number {
  if (cycles <= 0) return 0;
  let produced = 0;
  for (const [resource, amount] of Object.entries(producer.outputPerCycle) as Array<[ResourceId, number]>) {
    const total = amount * cycles;
    if (resource === 'fiber' && building.housing) building.housing.bin.fiber += total;
    else if (resource === 'berry' && building.housing) building.housing.bin.berry += total;
    else if (resource === 'stone' && building.producer) building.producer.bin.stone += total;
    produced += total;
  }
  return produced;
}

function settleCreature(state: GameState, creature: OwnedCreatureState, elapsedMs: number): WorkerSettlement {
  if (creature.role !== 'work' || !creature.housingId) return { completedCycles: 0, produced: 0 };
  const producer = producerForSpecies(creature.speciesId);
  const housing = state.buildings.find((building) => building.id === creature.housingId);
  if (!producer) return { completedCycles: 0, produced: 0 };
  const worksite = creature.worksiteId ? state.buildings.find((building) => building.id === creature.worksiteId) : null;
  if (!housing || !isHousingBuilding(housing) || !housingOperationGate(state, housing).ok || !worksite
    || !producer.requiredFacilities.includes(worksite.definitionId)
    || !creatureWorksiteOperationGate(state, worksite)) {
    creature.role = 'rest'; creature.assignment = null; creature.worksiteId = null; creature.workRemainderMs = 0;
    return { completedCycles: 0, produced: 0 };
  }
  const availableMs = Math.max(0, creature.workRemainderMs ?? 0) + Math.max(0, Math.floor(elapsedMs));
  const completedCycles = Math.floor(availableMs / producer.cycleMs);
  const actualCycles = Math.min(completedCycles, freeCycles(worksite, producer));
  const produced = applyProducerOutput(worksite, producer, actualCycles);
  if (creature.speciesId === 'tuftle' && actualCycles > 0) recordOpeningProduction(state, creature.id, worksite.id, (producer.outputPerCycle.fiber ?? 0) * actualCycles);
  const remainsUnblocked = freeCycles(worksite, producer) > 0;
  creature.workRemainderMs = remainsUnblocked ? availableMs % producer.cycleMs : 0;
  creature.nextWorkTick = state.tick + Math.ceil((producer.cycleMs - creature.workRemainderMs) * 60 / 1000);
  state.workerResourcesProduced += produced;
  for (const [resource, amount] of Object.entries(producer.outputPerCycle) as Array<[ResourceId, number]>) {
    if (resource === 'wood' || resource === 'stone' || resource === 'fiber' || resource === 'iron-ore' || resource === 'iron-ingot') {
      state.resourcesCollected[resource] += amount * actualCycles;
    }
  }
  return { completedCycles: actualCycles, produced };
}

/** One-second online quantum; command ticks call this at 60 Hz. */
export function advanceWorkerProduction(state: GameState): boolean {
  const housingReconciled = reconcileCreatureHousing(state);
  const worksiteReconciled = reconcileCreatureWorksites(state);
  const reconciled = housingReconciled || worksiteReconciled;
  if (state.tick % 60 !== 0) return reconciled;
  let changed = reconciled;
  for (const creature of state.ownedCreatures) {
    const before = creature.workRemainderMs ?? 0;
    const result = settleCreature(state, creature, 1_000);
    if (result.produced > 0 || (creature.workRemainderMs ?? 0) !== before) changed = true;
  }
  return changed;
}

export function settleWorkerProduction(state: GameState, elapsedMs: number): WorkerSettlement {
  reconcileCreatureHousing(state);
  reconcileCreatureWorksites(state);
  const total = { completedCycles: 0, produced: 0 };
  for (const creature of state.ownedCreatures) {
    const settled = settleCreature(state, creature, elapsedMs);
    total.completedCycles += settled.completedCycles;
    total.produced += settled.produced;
  }
  return total;
}

export function collectHousingBin(state: GameState, housingId: string, resource: 'fiber' | 'berry'): CommandResult {
  return collectWorkerFacilityBin(state, housingId, resource);
}

export function collectWorkerFacilityBin(state: GameState, buildingId: string, resource: 'fiber' | 'berry' | 'stone'): CommandResult {
  const building = state.buildings.find((candidate) => candidate.id === buildingId);
  const amount = resource === 'stone' ? building?.producer?.bin.stone ?? 0 : building?.housing?.bin[resource] ?? 0;
  if (!building || amount <= 0) return { ok: false, message: `No ${resource} ready to collect` };
  const currentStacks = resourceStacksForAmount(state, resource, state.inventory[resource]);
  const resultingStacks = resourceStacksForAmount(state, resource, state.inventory[resource] + amount);
  const usedSlots = state.tools.length + (Object.keys(state.inventory) as ResourceId[]).reduce(
    (sum, id) => sum + resourceStacksForAmount(state, id, state.inventory[id]).length, 0,
  );
  if (usedSlots - currentStacks.length + resultingStacks.length > inventoryCapacity(state)) {
    return { ok: false, message: 'Inventory full' };
  }
  state.inventory[resource] += amount;
  state.inventoryStacks[resource] = resultingStacks;
  if (resource === 'stone') building.producer!.bin.stone = 0;
  else building.housing!.bin[resource] = 0;
  if (resource === 'fiber') recordOpeningProductionCollection(state, buildingId, amount);
  return { ok: true, message: `Collected ${amount} ${resource} from ${buildableById(building.definitionId).displayName}` };
}

export function releaseCreature(state: GameState, creatureId: string, confirmed = false): CommandResult {
  const index = state.ownedCreatures.findIndex((creature) => creature.id === creatureId);
  if (index < 0) return { ok: false, message: 'Creature not found' };
  if (!confirmed) return { ok: false, message: 'Confirm release before continuing' };
  const creature = state.ownedCreatures[index]!;
  const refund = Math.floor(FARM_ORDER_COSTS[creature.speciesId] / 4);
  if (!Number.isSafeInteger(state.coins + refund)) return { ok: false, message: 'Coin balance is at capacity' };
  state.ownedCreatures.splice(index, 1);
  if (state.battleCompanionId === creature.id) state.battleCompanionId = null;
  state.coins += refund;
  return { ok: true, message: `${creature.name} released · ${refund} coins refunded` };
}
