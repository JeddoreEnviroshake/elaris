import { describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS, RESOURCE_STACK_SIZE } from '../../src/config/balance';
import { usedInventorySlots } from '../../src/simulation/gameplayCommands';
import { createInitialState } from '../../src/simulation/state';
import { inventorySlotEntries } from '../../src/ui/inventorySlots';

describe('inventory slot model', () => {
  it('gives crafted supplies ordinary Bag stacks alongside resources', () => {
    const state = createInitialState(1);
    Object.assign(state.inventory, { 'taming-snare': 3, berry: 4, arrow: 9, 'cloth-mask': 2 });

    const supplies = inventorySlotEntries(state).filter(
      (entry) => entry.kind === 'resource' && entry.resource !== 'wood',
    );
    expect(supplies).toEqual([
      { kind: 'resource', resource: 'taming-snare', amount: 3, stackIndex: 0 },
      { kind: 'resource', resource: 'berry', amount: 4, stackIndex: 0 },
      { kind: 'resource', resource: 'arrow', amount: 9, stackIndex: 0 },
      { kind: 'resource', resource: 'cloth-mask', amount: 2, stackIndex: 0 },
    ]);
  });

  it('renders a fresh inventory as its two starting supply stacks plus empties', () => {
    const entries = inventorySlotEntries(createInitialState(1));
    expect(entries).toHaveLength(INVENTORY_SLOTS);
    expect(entries.filter((entry) => entry.kind === 'empty')).toHaveLength(INVENTORY_SLOTS - 2);
  });

  it('splits resources into capped stacks and pads with empties', () => {
    const state = createInitialState(1);
    Object.assign(state.inventory, { berry: 0, arrow: 0 });
    state.inventory.wood = RESOURCE_STACK_SIZE + 5;
    state.inventory.stone = 3;

    const entries = inventorySlotEntries(state);
    expect(entries).toHaveLength(INVENTORY_SLOTS);
    expect(entries.slice(0, 3)).toEqual([
      { kind: 'resource', resource: 'wood', amount: RESOURCE_STACK_SIZE, stackIndex: 0 },
      { kind: 'resource', resource: 'wood', amount: 5, stackIndex: 1 },
      { kind: 'resource', resource: 'stone', amount: 3, stackIndex: 0 },
    ]);
    expect(entries[3]).toEqual({ kind: 'empty' });
  });

  it('gives each tool one slot and flags the equipped instance', () => {
    const state = createInitialState(1);
    state.tools = [
      { instanceId: 'tool-1', definitionId: 'wooden-pick', durability: 10, maxDurability: 48, powerRank: 0, speedRank: 0, durabilityRank: 0 },
      { instanceId: 'tool-2', definitionId: 'wooden-pick', durability: 48, maxDurability: 48, powerRank: 0, speedRank: 0, durabilityRank: 0 },
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
      { instanceId: 'tool-1', definitionId: 'wooden-pick', durability: 0, maxDurability: 48, powerRank: 0, speedRank: 0, durabilityRank: 0 },
    ];

    const used = inventorySlotEntries(state).filter((entry) => entry.kind !== 'empty').length;
    expect(used).toBe(usedInventorySlots(state));
  });
});
