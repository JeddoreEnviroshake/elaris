import { describe, expect, it } from 'vitest';
import { knowsBlueprint, learnBlueprint, unknownBlueprintIds } from '../../src/simulation/blueprintKnowledge';
import { buildableById, craftTool, placeBuilding } from '../../src/simulation/gameplayCommands';
import { blueprintsGrantedAtLevel } from '../../src/content/blueprintGates';
import { createInitialState } from '../../src/simulation/state';

describe('blueprint knowledge', () => {
  it('starts with bare hands and only the level-1 gate, and spends no currency', () => {
    const state = createInitialState(123);
    expect(state).toMatchObject({
      unlockedItemIds: [...blueprintsGrantedAtLevel(1)],
      pendingBlueprintGrantIds: [],
      tools: [],
    });
    expect(state).not.toHaveProperty('unlockPoints');
  });

  it('learns a blueprint once and stays idempotent', () => {
    const state = createInitialState(123);
    expect(knowsBlueprint(state, 'stone-pick')).toBe(false);
    expect(learnBlueprint(state, 'stone-pick')).toBe(true);
    expect(knowsBlueprint(state, 'stone-pick')).toBe(true);
    // A second grant is a no-op rather than a duplicate entry, so a level gate
    // and a field find can both fire for the same blueprint without corrupting
    // the set.
    expect(learnBlueprint(state, 'stone-pick')).toBe(false);
    expect(state.unlockedItemIds.filter((id) => id === 'stone-pick')).toHaveLength(1);
  });

  it('reports the unknown pool in a stable order and shrinks it as it learns', () => {
    const state = createInitialState(123);
    const before = unknownBlueprintIds(state);
    expect(before).toEqual([...before].sort());
    expect(before).toContain('workbench');
    learnBlueprint(state, 'workbench');
    expect(unknownBlueprintIds(state)).not.toContain('workbench');
    expect(unknownBlueprintIds(state)).toHaveLength(before.length - 1);
  });

  it('rejects locked placement and crafting before checking resource costs', () => {
    const state = createInitialState(123);
    state.resourceNodes = [];
    state.inventory.wood = 50;
    const tileX = Math.floor(state.player.x / 16) + 1;
    const tileY = Math.floor(state.player.y / 16);

    expect(placeBuilding(state, state.buildings, buildableById('wood-wall'), tileX, tileY).message)
      .toBe('Blueprint not yet discovered');
    expect(craftTool(state, 'stone-axe').message)
      .toBe('Blueprint not yet discovered');
    expect(state.inventory.wood).toBe(50);
  });

  it('lets a known blueprint through to the ordinary resource checks', () => {
    const state = createInitialState(123);
    state.resourceNodes = [];
    state.inventory.wood = 0;
    learnBlueprint(state, 'stone-axe');
    // No longer a blueprint problem — the only thing missing is the stone.
    expect(craftTool(state, 'stone-axe').message).not.toBe('Blueprint not yet discovered');
  });
});
