import { describe, expect, it, vi } from 'vitest';
import { BuildModeController } from '../../src/scenes/buildMode';
import { createInitialState } from '../../src/simulation/state';

describe('3D placement controller without a 2D scene', () => {
  it('validates, confirms and refunds a placement using only shared game state', () => {
    const state = createInitialState(42);
    state.unlockedItemIds.push('thatch-floor');
    state.inventory.fiber = 20;
    const callbacks = {onValidity:vi.fn(),onPlaced:vi.fn(),onUndo:vi.fn(),onUndoAvailable:vi.fn(),onBuildingLongPress:vi.fn(),onDeleteTarget:vi.fn()};
    const controller = new BuildModeController(state, callbacks);
    controller.startPlacing('thatch-floor');
    const preview = controller.getPresentationState();
    expect(preview).toMatchObject({definitionId:'thatch-floor',valid:true,layer:'surface'});
    const fiber = state.inventory.fiber;
    expect(controller.confirm()).toBe(true);
    expect(state.buildings).toHaveLength(1);
    expect(state.inventory.fiber).toBeLessThan(fiber);
    expect(controller.undoLastPlacement()).toBe(true);
    expect(state.buildings).toHaveLength(0);
    expect(state.inventory.fiber).toBe(fiber);
    expect(controller.undoLastPlacement()).toBe(false);
    controller.cancel();
    expect(controller.getPresentationState()).toBeNull();
  });
});
