import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { InventoryPanel } from '../../src/ui/inventoryPanel';

afterEach(() => {
  document.body.replaceChildren();
});

/** A worn pick in the bag, equipped, with the bag emptied of starting supplies. */
function stateWithWornPick(): GameState {
  const state = createInitialState(7);
  Object.assign(state.inventory, { 'taming-snare': 0, berry: 0, arrow: 0, 'cloth-mask': 0 });
  Object.assign(state.inventoryStacks, { 'taming-snare': [], berry: [], arrow: [], 'cloth-mask': [] });
  state.tools.push({
    instanceId: 'tool-1',
    definitionId: 'wooden-pick',
    durability: 10,
    maxDurability: 48,
    powerRank: 0,
    speedRank: 0,
    durabilityRank: 0,
  });
  state.equippedToolId = 'tool-1';
  return state;
}

function openBagWithTool(state: GameState, onHotbar = false) {
  const spies = {
    onEquipTool: vi.fn(), onRepairTool: vi.fn(), onDropTool: vi.fn(),
    onSplitStack: vi.fn(), onDropStack: vi.fn(), onOpened: vi.fn(),
    onAssignHotbar: vi.fn(), isOnHotbar: vi.fn(() => onHotbar),
  };
  const panel = new InventoryPanel(document.body, state, spies);
  panel.openTab('bag');
  const cell = document.querySelector<HTMLButtonElement>('[aria-label^="Wooden Pick"]')!;
  cell.click();
  return { panel, spies };
}

function button(name: RegExp): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button'))
    .find((candidate) => name.test(candidate.textContent ?? ''));
  return match as HTMLButtonElement;
}

describe('bag tool card', () => {
  it('opens on a tool tap and prices Repair carried-over-required', () => {
    const state = stateWithWornPick();
    state.inventory.wood = 9;
    const { spies } = openBagWithTool(state);

    expect(document.querySelector('[aria-label="Wooden Pick actions"]')).not.toBeNull();
    // Half the 5-wood craft cost, rounded up, against the 9 wood carried.
    const repair = button(/^Repair/);
    expect(repair.textContent).toBe('Repair (9/3 wood)');
    expect(repair.disabled).toBe(false);
    repair.click();
    expect(spies.onRepairTool).toHaveBeenCalledWith('tool-1');
    // The card closes behind the command so the grid can rebuild.
    expect(document.querySelector('[aria-label="Wooden Pick actions"]')).toBeNull();
  });

  it('disables Repair when the bag is short and when nothing is worn', () => {
    const broke = stateWithWornPick();
    broke.inventory.wood = 1;
    openBagWithTool(broke);
    expect(button(/^Repair/).textContent).toBe('Repair (1/3 wood)');
    expect(button(/^Repair/).disabled).toBe(true);

    document.body.replaceChildren();
    const whole = stateWithWornPick();
    whole.tools[0]!.durability = whole.tools[0]!.maxDurability;
    whole.inventory.wood = 99;
    openBagWithTool(whole);
    expect(button(/^Repair/).textContent).toBe('Repair');
    expect(button(/^Repair/).disabled).toBe(true);
  });

  it('assigns the tool to the hotbar from the same card', () => {
    const state = stateWithWornPick();
    const { spies } = openBagWithTool(state);

    const assign = button(/^Assign Hotbar$/);
    expect(assign.disabled).toBe(false);
    assign.click();
    expect(spies.onAssignHotbar).toHaveBeenCalledWith('tool-1');
    expect(document.querySelector('[aria-label="Wooden Pick actions"]')).toBeNull();
  });

  it('reads "On Hotbar", disabled, for a tool already on the bar', () => {
    const state = stateWithWornPick();
    const { spies } = openBagWithTool(state, true);

    expect(button(/^On Hotbar$/).disabled).toBe(true);
    expect(spies.onAssignHotbar).not.toHaveBeenCalled();
  });

  it('drops the tool from the same card', () => {
    const state = stateWithWornPick();
    const { spies } = openBagWithTool(state);

    button(/^Drop$/).click();
    expect(spies.onDropTool).toHaveBeenCalledWith('tool-1');
    // Tapping a tool no longer equips it; that lives on the hotbar now.
    expect(spies.onEquipTool).not.toHaveBeenCalled();
  });
});
