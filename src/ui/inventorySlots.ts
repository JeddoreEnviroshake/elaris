import { INVENTORY_SLOTS, RESOURCE_STACK_SIZE } from '../config/balance';
import type { GameState, ResourceId, ToolInstance } from '../simulation/state';

/**
 * Pure slot model shared by the inventory panel and hotbar. Mirrors the
 * simulation's slot accounting (`usedInventorySlots`): resources fill
 * ceil(amount / stack size) slots, each tool instance takes one slot.
 */
export type SlotEntry =
  | { kind: 'resource'; resource: ResourceId; amount: number }
  | { kind: 'tool'; tool: ToolInstance; equipped: boolean }
  | { kind: 'empty' };

/** All inventory slots in stable order: resource stacks, tools, then empties. */
export function inventorySlotEntries(state: GameState): SlotEntry[] {
  const entries: SlotEntry[] = [];
  for (const [resource, amount] of Object.entries(state.inventory) as Array<[ResourceId, number]>) {
    let remaining = amount;
    while (remaining > 0) {
      const stack = Math.min(remaining, RESOURCE_STACK_SIZE);
      entries.push({ kind: 'resource', resource, amount: stack });
      remaining -= stack;
    }
  }
  for (const tool of state.tools) {
    entries.push({ kind: 'tool', tool, equipped: tool.instanceId === state.equippedToolId });
  }
  while (entries.length < INVENTORY_SLOTS) entries.push({ kind: 'empty' });
  return entries;
}

/** Durability bar color matching the world-space HP bar thresholds. */
export function durabilityColor(ratio: number): string {
  return ratio > 0.5 ? '#4cc07f' : ratio > 0.25 ? '#c9a227' : '#d9534f';
}
