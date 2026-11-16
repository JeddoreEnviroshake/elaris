import { RESOURCE_STACK_SIZE, STORAGE_BOX_SLOTS, WAREHOUSE_SLOTS } from '../config/balance';
import type {
  BuildingState, CarriedBlueprint, InventoryStackState, InventoryState, ResourceId, ToolInstance,
} from './state';

export const STORAGE_RESOURCE_IDS: readonly ResourceId[] = [
  'wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot', 'taming-snare', 'berry', 'arrow', 'cloth-mask',
  // Salvage is hauled home to be stored and spent, so every box takes it.
  'scrap-iron', 'clockwork', 'lens', 'arcane-dust', 'construct-core', 'ancient-alloy', 'sealed-satchel', 'vault-key', 'recall-flare',
];

const SALVAGE_STORAGE_IDS = ['scrap-iron', 'clockwork', 'lens', 'arcane-dust', 'construct-core', 'ancient-alloy', 'sealed-satchel', 'vault-key', 'recall-flare'] as const;

export interface StorageBoxContents {
  inventory: InventoryState;
  stacks: InventoryStackState;
  tools: ToolInstance[];
  /**
   * Unregistered blueprints left in the box. They take a space like anything
   * else, and while they sit here the box radiates raider heat from its own
   * position — a stash moves the danger, it does not remove it.
   */
  blueprints: CarriedBlueprint[];
}

export function isStorageContainer(box: BuildingState): boolean {
  return box.definitionId === 'field-cache' || box.definitionId === 'warehouse';
}

export function storageContainerSlots(box: BuildingState): number {
  return box.definitionId === 'warehouse' ? WAREHOUSE_SLOTS : STORAGE_BOX_SLOTS;
}

/** Normalize legacy cache data in place and return its complete inventory model. */
export function storageBoxContents(box: BuildingState): StorageBoxContents {
  box.storage ??= { wood: 0, stone: 0, fiber: 0 };
  box.storage['iron-ore'] ??= 0;
  box.storage['iron-ingot'] ??= 0;
  box.storage['taming-snare'] ??= 0;
  box.storage.berry ??= 0;
  box.storage.arrow ??= 0;
  box.storage['cloth-mask'] ??= 0;
  for (const salvage of SALVAGE_STORAGE_IDS) box.storage[salvage] ??= 0;
  box.storageStacks ??= {};
  box.storedTools ??= [];
  box.storedBlueprints ??= [];
  const inventory = box.storage as InventoryState;
  const stacks = box.storageStacks as InventoryStackState;
  for (const resource of STORAGE_RESOURCE_IDS) {
    const existing = stacks[resource] ?? [];
    stacks[resource] = stacksForAmount(existing, inventory[resource]);
  }
  return { inventory, stacks, tools: box.storedTools, blueprints: box.storedBlueprints };
}

export function storageResourceStacks(box: BuildingState, resource: ResourceId): number[] {
  return storageBoxContents(box).stacks[resource];
}

export function usedStorageBoxSlots(box: BuildingState): number {
  const contents = storageBoxContents(box);
  return contents.tools.length + STORAGE_RESOURCE_IDS.reduce((total, resource) => total + contents.stacks[resource].length, 0);
}

export function canAddStorageResource(box: BuildingState, resource: ResourceId, amount: number): boolean {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  const contents = storageBoxContents(box);
  const current = contents.stacks[resource];
  const resulting = stacksForAmount(current, contents.inventory[resource] + amount);
  return usedStorageBoxSlots(box) - current.length + resulting.length <= storageContainerSlots(box);
}

export function addStorageResource(box: BuildingState, resource: ResourceId, amount: number): boolean {
  if (!canAddStorageResource(box, resource, amount)) return false;
  const contents = storageBoxContents(box);
  contents.inventory[resource] += amount;
  contents.stacks[resource] = stacksForAmount(contents.stacks[resource], contents.inventory[resource]);
  return true;
}

/** Remove exactly one visible resource stack, retaining all other boundaries. */
export function removeStorageResourceStack(box: BuildingState, resource: ResourceId, stackIndex: number): number | null {
  const contents = storageBoxContents(box);
  const amount = contents.stacks[resource][stackIndex];
  if (amount === undefined) return null;
  contents.stacks[resource].splice(stackIndex, 1);
  contents.inventory[resource] -= amount;
  return amount;
}

export function clearStorageResource(box: BuildingState, resource: ResourceId): void {
  const contents = storageBoxContents(box);
  contents.inventory[resource] = 0;
  contents.stacks[resource] = [];
}

function stacksForAmount(stored: readonly number[], amount: number): number[] {
  const stacks = stored.filter((value) => Number.isInteger(value) && value > 0 && value <= RESOURCE_STACK_SIZE);
  let total = stacks.reduce((sum, value) => sum + value, 0);
  while (total > amount && stacks.length > 0) {
    const last = stacks.length - 1;
    const removed = Math.min(stacks[last]!, total - amount);
    stacks[last] = stacks[last]! - removed;
    total -= removed;
    if (stacks[last] === 0) stacks.pop();
  }
  let remaining = amount - total;
  if (remaining > 0 && stacks.length > 0) {
    const last = stacks.length - 1;
    const added = Math.min(remaining, RESOURCE_STACK_SIZE - stacks[last]!);
    stacks[last] = stacks[last]! + added;
    remaining -= added;
  }
  while (remaining > 0) {
    const stack = Math.min(remaining, RESOURCE_STACK_SIZE);
    stacks.push(stack);
    remaining -= stack;
  }
  return stacks;
}
