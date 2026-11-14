import { INVENTORY_SLOTS } from '../config/balance';
import { resourceStacksForAmount } from '../simulation/inventoryStacks';
import { storageBoxContents, storageContainerSlots } from '../simulation/storageBox';
import type { BuildingState, CarriedBlueprint, GameState, ResourceId, ToolInstance } from '../simulation/state';

/**
 * Pure slot model shared by the inventory panel and hotbar. Mirrors the
 * simulation's slot accounting (`usedInventorySlots`): resources fill
 * ceil(amount / stack size) slots, each tool instance takes one slot.
 */
export type SlotEntry =
  | { kind: 'resource'; resource: ResourceId; amount: number; stackIndex: number }
  | { kind: 'tool'; tool: ToolInstance; equipped: boolean }
  | { kind: 'blueprint'; carried: CarriedBlueprint }
  | { kind: 'empty' };

/** All inventory slots in stable order: resource stacks, tools, then empties. */
export function inventorySlotEntries(state: GameState): SlotEntry[] {
  const entries: SlotEntry[] = [];
  for (const resource of Object.keys(state.inventory) as ResourceId[]) {
    for (const [stackIndex, amount] of resourceStacksForAmount(state, resource, state.inventory[resource]).entries()) {
      entries.push({ kind: 'resource', resource, amount, stackIndex });
    }
  }
  for (const tool of state.tools) {
    entries.push({ kind: 'tool', tool, equipped: tool.instanceId === state.equippedToolId });
  }
  for (const carried of state.carriedBlueprints) entries.push({ kind: 'blueprint', carried });
  while (entries.length < INVENTORY_SLOTS) entries.push({ kind: 'empty' });
  return entries;
}

/** Stable slots for either storage size, including non-stackable tools. */
export function storageBoxSlotEntries(box: BuildingState): SlotEntry[] {
  const contents = storageBoxContents(box);
  const entries: SlotEntry[] = [];
  for (const resource of Object.keys(contents.inventory) as ResourceId[]) {
    for (const [stackIndex, amount] of contents.stacks[resource].entries()) {
      entries.push({ kind: 'resource', resource, amount, stackIndex });
    }
  }
  for (const tool of contents.tools) entries.push({ kind: 'tool', tool, equipped: false });
  for (const carried of contents.blueprints) entries.push({ kind: 'blueprint', carried });
  const capacity = storageContainerSlots(box);
  while (entries.length < capacity) entries.push({ kind: 'empty' });
  return entries.slice(0, capacity);
}

/** Durability bar color matching the world-space HP bar thresholds. */
export function durabilityColor(ratio: number): string {
  return ratio > 0.5 ? '#4cc07f' : ratio > 0.25 ? '#c9a227' : '#d9534f';
}
