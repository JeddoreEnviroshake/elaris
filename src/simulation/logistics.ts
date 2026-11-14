import { buildableById } from '../content/buildingParts';
import type { BuildingState, GameState, LogisticsRouteState, OwnedCreatureState, ResourceId } from './state';
import type { CommandResult } from './gameplayCommands';
import { addStorageResource, canAddStorageResource, isStorageContainer } from './storageBox';

type RoutableBin = Partial<Record<ResourceId, number>>;

export interface LogisticsAdvanceResult {
  changed: boolean;
  transferred: number;
}

export function logisticsWorkerCandidates(state: GameState): OwnedCreatureState[] {
  return state.ownedCreatures
    .filter((creature) => creature.role === 'work' && typeof creature.worksiteId === 'string')
    .filter((creature) => workerOutputBin(state, creature) !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function logisticsStorageCandidates(state: GameState): BuildingState[] {
  return state.buildings.filter(isStorageContainer).sort((left, right) => left.id.localeCompare(right.id));
}

function logisticsHub(state: GameState, hubId: string): BuildingState | null {
  return state.buildings.find((building) => building.id === hubId
    && building.definitionId === 'logistics-hub' && building.logistics) ?? null;
}

function workerOutputBin(state: GameState, worker: OwnedCreatureState): RoutableBin | null {
  const source = state.buildings.find((building) => building.id === worker.worksiteId);
  if (!source) return null;
  if ((source.definitionId === 'small-pen' || source.definitionId === 'barn') && source.housing) {
    return source.housing.bin;
  }
  if (source.definitionId === 'stone-yard' && source.producer) return source.producer.bin;
  return null;
}

/**
 * Replace one worker route as a single transaction. Invalid inputs leave the
 * previous persisted route untouched, so a mistyped ID can never sever a
 * working automation chain.
 */
export function setLogisticsRoute(
  state: GameState,
  hubId: string,
  sourceWorkerId: string,
  destinationContainerIds: readonly string[],
): CommandResult {
  const hub = logisticsHub(state, hubId);
  if (!hub) return { ok: false, message: 'Logistics Hub not found' };
  if (!logisticsWorkerCandidates(state).some((worker) => worker.id === sourceWorkerId)) {
    return { ok: false, message: 'Choose a valid working creature' };
  }
  const uniqueDestinations = [...new Set(destinationContainerIds)];
  if (uniqueDestinations.length === 0) return { ok: false, message: 'Choose at least one destination' };
  const validIds = new Set(logisticsStorageCandidates(state).map((building) => building.id));
  if (uniqueDestinations.some((id) => !validIds.has(id))) {
    return { ok: false, message: 'Choose only valid storage destinations' };
  }

  const route: LogisticsRouteState = { sourceWorkerId, destinationContainerIds: uniqueDestinations };
  const index = hub.logistics!.routes.findIndex((candidate) => candidate.sourceWorkerId === sourceWorkerId);
  if (index < 0) hub.logistics!.routes.push(route);
  else hub.logistics!.routes[index] = route;
  hub.logistics!.lastRoutingMessage = `Linked ${sourceWorkerId} to ${uniqueDestinations.length} destination${uniqueDestinations.length === 1 ? '' : 's'}`;
  return { ok: true, message: hub.logistics!.lastRoutingMessage };
}

export function clearLogisticsRoute(state: GameState, hubId: string, sourceWorkerId: string): CommandResult {
  const hub = logisticsHub(state, hubId);
  if (!hub) return { ok: false, message: 'Logistics Hub not found' };
  const index = hub.logistics!.routes.findIndex((route) => route.sourceWorkerId === sourceWorkerId);
  if (index < 0) return { ok: false, message: 'Route not found' };
  hub.logistics!.routes.splice(index, 1);
  hub.logistics!.lastRoutingMessage = `Cleared route for ${sourceWorkerId}`;
  return { ok: true, message: hub.logistics!.lastRoutingMessage };
}

/** Route retained output to the first listed destination that can accept it. */
export function advanceLogisticsRouting(state: GameState): LogisticsAdvanceResult {
  let transferred = 0;
  let changed = false;
  const hubs = state.buildings
    .filter((building) => building.definitionId === 'logistics-hub' && building.logistics)
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const hub of hubs) {
    let hubTransferred = 0;
    let blocked = false;
    for (const route of hub.logistics!.routes) {
      const worker = state.ownedCreatures.find((candidate) => candidate.id === route.sourceWorkerId);
      const bin = worker ? workerOutputBin(state, worker) : null;
      if (!worker || !bin) { blocked = true; continue; }
      for (const [resource, amount] of Object.entries(bin) as Array<[ResourceId, number]>) {
        if (!Number.isInteger(amount) || amount <= 0) continue;
        const destination = route.destinationContainerIds
          .map((id) => state.buildings.find((building) => building.id === id))
          .find((building): building is BuildingState => Boolean(building && isStorageContainer(building)
            && canAddStorageResource(building, resource, amount)));
        if (!destination) { blocked = true; continue; }
        if (!addStorageResource(destination, resource, amount)) { blocked = true; continue; }
        bin[resource] = 0;
        transferred += amount;
        hubTransferred += amount;
        changed = true;
      }
    }
    const message = hubTransferred > 0
      ? `Routed ${hubTransferred} resources`
      : blocked ? 'Routing paused: source or destinations unavailable/full' : 'Routes ready';
    if (hub.logistics!.lastRoutingMessage !== message) {
      hub.logistics!.lastRoutingMessage = message;
      changed = true;
    }
  }
  return { changed, transferred };
}

export function logisticsRouteLabel(state: GameState, route: LogisticsRouteState): string {
  const worker = state.ownedCreatures.find((candidate) => candidate.id === route.sourceWorkerId);
  const source = worker?.worksiteId ? state.buildings.find((building) => building.id === worker.worksiteId) : null;
  const sourceLabel = source ? buildableById(source.definitionId).displayName : 'Invalid source';
  return `${worker?.name ?? route.sourceWorkerId} (${sourceLabel}) → ${route.destinationContainerIds.length} destination${route.destinationContainerIds.length === 1 ? '' : 's'}`;
}
