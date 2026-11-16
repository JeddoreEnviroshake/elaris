import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildMenu } from '../../src/ui/buildMenu';
import { createInitialState } from '../../src/simulation/state';
import type { BuildingState } from '../../src/simulation/state';

afterEach(() => {
  document.body.replaceChildren();
});

const workbench: BuildingState = { id: 'building-1', definitionId: 'workbench', tileX: 2, tileY: 2 };

function noopActions() {
  return {
    onStartPlacing: vi.fn(),
    onConfirm: vi.fn(),
    onRotate: vi.fn(),
    onUndo: vi.fn(),
    onMarkerKindChanged: vi.fn(),
    onPlacingCancelled: vi.fn(),
    onStartDeleting: vi.fn(),
    onDeleteConfirm: vi.fn(),
    onDeletingCancelled: vi.fn(),
    onOpened: vi.fn(),
  };
}

const deleteMode = (): HTMLButtonElement => document.querySelector('[data-delete-mode]')!;
const deleteButton = (): HTMLButtonElement => document.querySelector('[data-delete-structure]')!;

describe('build palette delete mode', () => {
  it('keeps related-part controls stable across HUD refreshes and reprices after spending', () => {
    const state = createInitialState(1);
    state.inventory.wood = 20;
    state.inventory.fiber = 20;
    const actions = noopActions();
    const menu = new BuildMenu(document.body, state, actions);
    menu.beginPlacement('thatch-wall');
    const row = document.querySelector('[aria-label="Related parts"]')!;
    const floor = Array.from(row.querySelectorAll('button')).find((button) => button.textContent === 'Floor')!;
    expect(floor).toBeDefined();
    floor.focus();
    for (let index = 0; index < 10; index += 1) menu.refreshAffordability();
    expect(floor.isConnected).toBe(true);
    expect(document.activeElement).toBe(floor);
    floor.click();
    expect(actions.onStartPlacing).toHaveBeenLastCalledWith('thatch-floor');
    state.inventory.fiber = 0;
    menu.refreshAffordability();
    expect(row.textContent).toContain('Wall');
    expect(Array.from(row.querySelectorAll('button')).find((button) => button.textContent === 'Wall')!.disabled).toBe(true);
    menu.destroy();
  });

  it('swaps Place for Delete and asks the scene to light a target', () => {
    const actions = noopActions();
    const menu = new BuildMenu(document.body, createInitialState(1), actions);
    deleteMode().click();

    expect(actions.onStartDeleting).toHaveBeenCalledTimes(1);
    expect(menu.mode).toBe('deleting');
    expect(deleteButton().style.display).toBe('block');
    menu.destroy();
  });

  it('opens the same mode for a hold in the world, with no palette press', () => {
    const actions = noopActions();
    const menu = new BuildMenu(document.body, createInitialState(1), actions);
    menu.enterDeleteMode();

    expect(actions.onStartDeleting).toHaveBeenCalledTimes(1);
    expect(menu.mode).toBe('deleting');
    expect(deleteButton().style.display).toBe('block');
    menu.destroy();
  });

  it('names the lit part and what demolishing it hands back', () => {
    const menu = new BuildMenu(document.body, createInitialState(1), noopActions());
    deleteMode().click();
    menu.setDeleteTarget(workbench);

    // A Workbench costs 8 wood, so half comes back on demolition.
    expect(document.querySelector('[data-placing-title]')!.textContent).toBe('Workbench · +4 wood');
    expect(deleteButton().disabled).toBe(false);
    menu.destroy();
  });

  it('disables Delete when the cursor has nothing to sit on', () => {
    const menu = new BuildMenu(document.body, createInitialState(1), noopActions());
    deleteMode().click();
    menu.setDeleteTarget(null);

    expect(deleteButton().disabled).toBe(true);
    expect(document.body.textContent).toContain('Nothing placed nearby');
    menu.destroy();
  });

  it('drops the cursor when the palette or build mode closes', () => {
    const actions = noopActions();
    const menu = new BuildMenu(document.body, createInitialState(1), actions);
    deleteMode().click();
    menu.close();

    expect(actions.onDeletingCancelled).toHaveBeenCalledTimes(1);
    expect(menu.mode).toBe('closed');
    // Closing again must not fire a second cancel.
    menu.close();
    expect(actions.onDeletingCancelled).toHaveBeenCalledTimes(1);
    menu.destroy();
  });

  it('routes the Delete press to the scene', () => {
    const actions = noopActions();
    const menu = new BuildMenu(document.body, createInitialState(1), actions);
    deleteMode().click();
    menu.setDeleteTarget(workbench);
    deleteButton().click();

    expect(actions.onDeleteConfirm).toHaveBeenCalledTimes(1);
    menu.destroy();
  });
});
