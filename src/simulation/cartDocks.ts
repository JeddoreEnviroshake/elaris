import { buildableById } from '../content/buildingParts';
import { TILE_SIZE } from '../config/platform';
import type { CommandResult } from './gameplayCommands';
import { creatureWorksiteEnvironment, creatureWorksiteOperationGate } from './creatureRoles';
import { environmentAt } from './environmentProgress';
import { addStorageResource, canAddStorageResource, isStorageContainer } from './storageBox';
import { reconcileResourceStacks, resourceStacksForAmount } from './inventoryStacks';
import type { BuildingState, GameState, ResourceId } from './state';

export const CART_DOCK_RAW_RESOURCES: readonly ResourceId[] = ['wood', 'stone', 'fiber', 'iron-ore'];

export interface CartDockAdvanceResult {
  changed: boolean;
  transferred: number;
}

export function cartDockStorageCandidates(state: GameState): BuildingState[] {
  return state.buildings
    .filter(isStorageContainer)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function linkCartDockStorage(state: GameState, cartDockId: string, storageId: string | null): CommandResult {
  const dock = state.buildings.find((building) => building.id === cartDockId && building.definitionId === 'cart-dock');
  if (!dock?.cartDock) return { ok: false, message: 'Cart Dock not found' };
  if (!creatureWorksiteOperationGate(state, dock)) return { ok: false, message: 'Restore the Cart Dock work yard first' };
  if (storageId !== null && !cartDockStorageCandidates(state).some((building) => building.id === storageId)) {
    return { ok: false, message: 'Choose a valid storage container' };
  }
  dock.cartDock.linkedStorageId = storageId;
  dock.cartDock.lastTransferMessage = storageId
    ? `Linked to ${buildableById(state.buildings.find((building) => building.id === storageId)!.definitionId).displayName} ${storageId}`
    : 'Storage link cleared';
  return { ok: true, message: dock.cartDock.lastTransferMessage };
}

function workingStagForDock(state: GameState, dockId: string): boolean {
  return state.ownedCreatures.some((creature) => creature.speciesId === 'glade-stag'
    && creature.role === 'work'
    && creature.worksiteId === dockId
    && typeof creature.housingId === 'string');
}

function transferRawStacks(state: GameState, storage: BuildingState): { transferred: number; blocked: boolean } {
  let transferred = 0;
  let blocked = false;
  for (const resource of CART_DOCK_RAW_RESOURCES) {
    const stacks = resourceStacksForAmount(state, resource, state.inventory[resource]);
    for (const amount of stacks) {
      if (!canAddStorageResource(storage, resource, amount)) {
        blocked = true;
        break;
      }
      addStorageResource(storage, resource, amount);
      state.inventory[resource] -= amount;
      transferred += amount;
    }
    reconcileResourceStacks(state, resource);
    if (blocked) break;
  }
  return { transferred, blocked };
}

/** Edge-triggered entry automation; reloads inside a yard cannot transfer twice. */
export function advanceCartDockTransfers(state: GameState): CartDockAdvanceResult {
  let changed = false;
  let transferred = 0;
  const playerEnvironment = environmentAt(
    state.buildings,
    Math.floor(state.player.x / TILE_SIZE),
    Math.floor(state.player.y / TILE_SIZE),
  );
  for (const dock of state.buildings.filter((building) => building.definitionId === 'cart-dock')) {
    if (!dock.cartDock) continue;
    const environment = creatureWorksiteEnvironment(state, dock);
    const inside = environment !== null && playerEnvironment?.id === environment.id;
    const entered = inside && !dock.cartDock.playerInside;
    if (dock.cartDock.playerInside !== inside) {
      dock.cartDock.playerInside = inside;
      changed = true;
    }
    if (!entered) continue;
    if (!workingStagForDock(state, dock.id)) {
      dock.cartDock.lastTransferMessage = 'Assign a housed Glade Stag to this Cart Dock';
      changed = true;
      continue;
    }
    const storage = state.buildings.find((building) => building.id === dock.cartDock!.linkedStorageId && isStorageContainer(building));
    if (!storage) {
      dock.cartDock.lastTransferMessage = 'Link a valid storage container before entering';
      changed = true;
      continue;
    }
    const result = transferRawStacks(state, storage);
    transferred += result.transferred;
    dock.cartDock.lastTransferMessage = result.blocked
      ? `Storage full after unloading ${result.transferred}; the remainder stayed in the Bag`
      : result.transferred > 0
        ? `Unloaded ${result.transferred} raw resources`
        : 'No raw resources to unload';
    changed = true;
  }
  return { changed, transferred };
}
