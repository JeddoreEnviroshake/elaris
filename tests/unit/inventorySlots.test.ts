import { describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS, RESOURCE_STACK_SIZE } from '../../src/config/balance';
import { usedInventorySlots } from '../../src/simulation/gameplayCommands';
import { createInitialState } from '../../src/simulation/state';
import { inventorySlotEntries } from '../../src/ui/inventorySlots';

describe('inventory slot model', () => {
  it('renders a fresh inventory as all-empty slots', () => {
    const entries = inventorySlotEntries(createInitialState(1));
    expect(entries).toHaveLength(INVENTORY_SLOTS);
    expect(entries.every((entry) => entry.kind === 'empty')).toBe(true);
  });

  it('splits resources into capped stacks and pads with empties', () => {
    const state = createInitialState(1);
    state.inventory.wood = RESOURCE_STACK_SIZE + 5;
    state.inventory.stone = 3;

    const entries = inventorySlotEntries(state);
    expect(entries).toHaveLength(INVENTORY_SLOTS);
    expect(entries.slice(0, 3)).toEqual([
      { kind: 'resource', resource: 'wood', amount: RESOURCE_STACK_SIZE },
      { kind: 'resource', resource: 'wood', amount: 5 },
      { kind: 'resource', resource: 'stone', amount: 3 },
    ]);
    expect(entries[3]).toEqual({ kind: 'empty' });
  });

  it('gives each tool one slot and flags the equipped instance', () => {
    const state = createInitialState(1);
    state.tools = [
      { instanceId: 'tool-1', definitionId: 'wooden-pick', durability: 10, maxDurability: 48 },
      { instanceId: 'tool-2', definitionId: 'wooden-pick', durability: 48, maxDurability: 48 },
    ];
    state.equippedToolId = 'tool-2';

    const tools = inventorySlotEntries(state).filter((entry) => entry.kind === 'tool');
    expect(tools).toEqual([
      { kind: 'tool', tool: state.tools[0], equipped: false },
      { kind: 'tool', tool: state.tools[1], equipped: true },
    ]);
  });

  it('always agrees with the simulation slot accounting', () => {
    const state = createInitialState(1);
    state.inventory.wood = RESOURCE_STACK_SIZE * 2 + 1;
    state.inventory.stone = RESOURCE_STACK_SIZE;
    state.tools = [
      { instanceId: 'tool-1', definitionId: 'wooden-pick', durability: 0, maxDurability: 48 },
    ];

    const used = inventorySlotEntries(state).filter((entry) => entry.kind !== 'empty').length;
    expect(used).toBe(usedInventorySlots(state));
  });
});
