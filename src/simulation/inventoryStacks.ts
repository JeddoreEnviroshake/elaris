import { RESOURCE_STACK_SIZE } from '../config/balance';
import type { GameState, ResourceId } from './state';

/**
 * Reconcile persisted stack boundaries with the aggregate inventory total.
 * Existing boundaries are preserved from the front; gains fill the final stack
 * and losses consume from the end, matching inventory-slot order.
 */
export function resourceStacksForAmount(state: GameState, resource: ResourceId, amount: number): number[] {
  const stored = state.inventoryStacks?.[resource] ?? [];
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

/** Return current boundaries and persist any reconciliation with inventory. */
export function reconcileResourceStacks(state: GameState, resource: ResourceId): number[] {
  const stacks = resourceStacksForAmount(state, resource, state.inventory[resource]);
  state.inventoryStacks ??= {
    wood: [], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [],
    'taming-snare': [], 'reinforced-snare': [], berry: [], arrow: [], 'cloth-mask': [],
    'safeguard-charm': [], 'draft-parchment': [],
    'tuftle-down': [], 'craghopper-shell': [], 'stag-antler': [], 'snarlfox-pelt': [],
    'masonmole-claw': [], 'boar-tusk': [], 'quillfinch-quill': [], 'mistmoth-scale': [],
    'slingtail-stone': [],
    'scrap-iron': [], 'clockwork': [], 'lens': [], 'arcane-dust': [], 'construct-core': [], 'ancient-alloy': [], 'sealed-satchel': [], 'vault-key': [], 'recall-flare': [],
  };
  state.inventoryStacks[resource] = stacks;
  return stacks;
}

/** Normalize every resource before hashing or writing a save snapshot. */
export function reconcileAllResourceStacks(state: GameState): void {
  for (const resource of Object.keys(state.inventory) as ResourceId[]) reconcileResourceStacks(state, resource);
}
