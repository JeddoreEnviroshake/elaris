import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildingItemMenu } from '../../src/ui/buildingItemMenu';
import { createInitialState } from '../../src/simulation/state';
import type { BuildingState, GameState } from '../../src/simulation/state';

afterEach(() => {
  document.body.replaceChildren();
});

const workbench: BuildingState = { id: 'building-1', definitionId: 'workbench', tileX: 2, tileY: 2 };
const woodWall: BuildingState = {
  id: 'building-2', definitionId: 'wood-wall', tileX: 2, tileY: 2, boundaryEdge: 'north',
};

const noopActions = { onDelete: () => true, onRepair: () => true, onClosed: () => {} };

/** Repair is priced against the bag, so each menu gets its own funded state. */
function fundedState(wood = 10): GameState {
  const state = createInitialState(1);
  state.inventory.wood = wood;
  return state;
}

// A hold on a placed part opens Delete mode now; this prompt is what a tap on a
// damaged wall raises, so repair stays one press away from the wall itself.
describe('damaged wall prompt', () => {
  it('lists the demolition refund instead of unlock points', () => {
    const menu = new BuildingItemMenu(document.body, fundedState(), noopActions);
    menu.open(workbench, 100, 100);

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Unlock points');
    // A Workbench costs 8 wood, so half comes back.
    expect(text).toContain('+4 x wood');
    menu.destroy();
  });

  it('offers repair at full build cost only for a damaged wall', () => {
    const menu = new BuildingItemMenu(document.body, fundedState(), noopActions);
    const repair = (): HTMLButtonElement => document.querySelector('[data-repair-wall]')!;

    // Nothing to repair on a facility, or on a wall still at full health.
    menu.open(workbench, 100, 100);
    expect(repair().style.display).toBe('none');
    menu.open(woodWall, 100, 100);
    expect(repair().style.display).toBe('none');

    menu.open({ ...woodWall, hp: 40 }, 100, 100);
    expect(repair().style.display).toBe('block');
    // A Wood Wall costs 1 wood to build, so it costs 1 wood to make whole again,
    // shown against the 10 wood in the bag.
    expect(repair().textContent).toBe('Repair (10/1 wood)');
    expect(repair().disabled).toBe(false);
    expect(document.body.textContent).toContain('Wood Wall 40/200');
    menu.destroy();
  });

  it('disables repair when the bag cannot cover the cost', () => {
    const menu = new BuildingItemMenu(document.body, fundedState(0), noopActions);
    menu.open({ ...woodWall, hp: 40 }, 100, 100);

    const repair = document.querySelector<HTMLButtonElement>('[data-repair-wall]')!;
    expect(repair.textContent).toBe('Repair (0/1 wood)');
    expect(repair.disabled).toBe(true);
    menu.destroy();
  });

  it('repairs the selected wall and dismisses the menu', () => {
    const onRepair = vi.fn(() => true);
    const menu = new BuildingItemMenu(document.body, fundedState(), { ...noopActions, onRepair });
    menu.open({ ...woodWall, hp: 40 }, 100, 100);
    document.querySelector<HTMLButtonElement>('[data-repair-wall]')!.click();

    expect(onRepair).toHaveBeenCalledWith('building-2');
    expect(menu.isOpen).toBe(false);
    menu.destroy();
  });

  it('reports closing so the scene can drop the red selection tint', () => {
    const onClosed = vi.fn();
    const menu = new BuildingItemMenu(document.body, fundedState(), { ...noopActions, onClosed });
    menu.open(workbench, 100, 100);
    menu.close();
    expect(onClosed).toHaveBeenCalledTimes(1);

    // Closing an already-closed menu must not fire again.
    menu.close();
    expect(onClosed).toHaveBeenCalledTimes(1);
    menu.destroy();
  });
});
