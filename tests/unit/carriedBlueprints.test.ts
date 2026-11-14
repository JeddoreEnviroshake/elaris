import { describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS } from '../../src/config/balance';
import {
  canRegisterHere,
  registerAllCarriedBlueprints,
  registerBlockedReason,
  registerCarriedBlueprint,
  removeCarriedBlueprint,
  tryCarryBlueprint,
} from '../../src/simulation/carriedBlueprints';
import { knowsBlueprint, learnBlueprint } from '../../src/simulation/blueprintKnowledge';
import { TILE_SIZE } from '../../src/config/platform';
import { isWithinTownSafeZoneWorldPosition } from '../../src/content/townDefences';
import {
  ELARIS_PUBLIC_WORKBENCH_ID,
  ELARIS_PUBLIC_WORKBENCH_SIZE,
  ELARIS_PUBLIC_WORKBENCH_TILE,
  elarisPublicWorkbenchCenterPx,
  elarisPublicWorkbenchFacility,
  isElarisPublicWorkbenchServing,
  withinElarisPublicWorkbench,
} from '../../src/simulation/elarisWorkbench';
import { ELARIS_LAST_SAFE_LEVEL } from '../../src/simulation/elarisFall';
import { isSolidTownTile, townBuildingAtPlayerDoor } from '../../src/simulation/town';
import { nearestUsableFacility, toolUnlockReason, usedInventorySlots } from '../../src/simulation/gameplayCommands';
import { createInitialState, type GameState } from '../../src/simulation/state';

/** Stand the player on the town bench, which only Elaris has. */
function atTownWorkbench(level = 1): GameState {
  const state = createInitialState(11);
  state.player.level = level;
  const center = elarisPublicWorkbenchCenterPx();
  state.player.x = center.x;
  state.player.y = center.y;
  return state;
}

describe('carrying blueprints', () => {
  it('takes one bag slot each and refuses when the bag is full', () => {
    const state = createInitialState(1);
    const before = usedInventorySlots(state);
    expect(tryCarryBlueprint(state, 'furnace')).not.toBeNull();
    expect(usedInventorySlots(state)).toBe(before + 1);

    // Duplicates are separate pieces of paper, each costing its own slot.
    expect(tryCarryBlueprint(state, 'furnace')).not.toBeNull();
    expect(state.carriedBlueprints).toHaveLength(2);
    expect(state.carriedBlueprints[0]!.instanceId).not.toBe(state.carriedBlueprints[1]!.instanceId);

    while (usedInventorySlots(state) < INVENTORY_SLOTS) {
      expect(tryCarryBlueprint(state, 'barn')).not.toBeNull();
    }
    // The bag is full, so the caller gets a refusal it can spill to the ground.
    expect(tryCarryBlueprint(state, 'turret')).toBeNull();
  });

  it('refuses an id that is not a blueprint at all', () => {
    const state = createInitialState(1);
    expect(tryCarryBlueprint(state, 'not-a-blueprint')).toBeNull();
    expect(state.carriedBlueprints).toEqual([]);
  });

  it('carries without teaching — paper is not knowledge', () => {
    const state = createInitialState(1);
    tryCarryBlueprint(state, 'furnace');
    expect(knowsBlueprint(state, 'furnace')).toBe(false);
  });

  it('can be taken back out without being learned', () => {
    const state = createInitialState(1);
    const carried = tryCarryBlueprint(state, 'furnace')!;
    expect(removeCarriedBlueprint(state, carried.instanceId)).toMatchObject({ blueprintId: 'furnace' });
    expect(state.carriedBlueprints).toEqual([]);
    expect(knowsBlueprint(state, 'furnace')).toBe(false);
    expect(removeCarriedBlueprint(state, carried.instanceId)).toBeNull();
  });
});

describe('registering at a workbench', () => {
  it('needs a workbench in reach', () => {
    const state = createInitialState(1);
    state.player.x = 10;
    state.player.y = 10;
    const carried = tryCarryBlueprint(state, 'furnace')!;
    expect(canRegisterHere(state)).toBe(false);
    expect(registerBlockedReason(state, carried.instanceId)).toBe('Register at a workbench');
    expect(registerCarriedBlueprint(state, carried.instanceId)).toMatchObject({ ok: false });
    // Still in the bag, still unlearned: a refused registration costs nothing.
    expect(state.carriedBlueprints).toHaveLength(1);
    expect(knowsBlueprint(state, 'furnace')).toBe(false);
  });

  it('turns paper into permanent knowledge and consumes it', () => {
    const state = atTownWorkbench();
    const carried = tryCarryBlueprint(state, 'furnace')!;
    expect(registerCarriedBlueprint(state, carried.instanceId)).toMatchObject({ ok: true });
    expect(knowsBlueprint(state, 'furnace')).toBe(true);
    expect(state.carriedBlueprints).toEqual([]);
  });

  it('consumes a duplicate rather than refusing it', () => {
    const state = atTownWorkbench();
    learnBlueprint(state, 'furnace');
    const carried = tryCarryBlueprint(state, 'furnace')!;
    const result = registerCarriedBlueprint(state, carried.instanceId);
    // Refusing would leave the player holding raider bait they cannot put down.
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain('duplicate');
    expect(state.carriedBlueprints).toEqual([]);
  });

  it('files a whole satchel in one trip', () => {
    const state = atTownWorkbench();
    learnBlueprint(state, 'barn');
    tryCarryBlueprint(state, 'furnace');
    tryCarryBlueprint(state, 'turret');
    tryCarryBlueprint(state, 'barn');

    const result = registerAllCarriedBlueprints(state);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('duplicate');
    expect(state.carriedBlueprints).toEqual([]);
    expect(knowsBlueprint(state, 'furnace')).toBe(true);
    expect(knowsBlueprint(state, 'turret')).toBe(true);

    expect(registerAllCarriedBlueprints(state)).toMatchObject({ ok: false });
  });

  it('accepts the player own workbench anywhere in the world', () => {
    const state = createInitialState(1);
    const tileX = Math.floor(state.player.x / 16);
    const tileY = Math.floor(state.player.y / 16);
    state.buildings.push({ id: 'own-bench', definitionId: 'workbench', tileX, tileY });
    expect(canRegisterHere(state)).toBe(true);
  });
});

describe('the Elaris public workbench', () => {
  it('stands on open ground, clear of every town footprint and doorway', () => {
    for (let dx = 0; dx < 2; dx += 1) {
      const tileX = ELARIS_PUBLIC_WORKBENCH_TILE.tileX + dx;
      const tileY = ELARIS_PUBLIC_WORKBENCH_TILE.tileY;
      expect(isSolidTownTile(tileX, tileY, '0,0')).toBe(false);
    }
  });

  it('stands inside the town walls, in the protected ground', () => {
    // Outside the fence it would be scenery a new character has to leave
    // safety to reach, which is the opposite of what it is for.
    for (let dx = 0; dx < ELARIS_PUBLIC_WORKBENCH_SIZE.tilesWide; dx += 1) {
      const worldX = (ELARIS_PUBLIC_WORKBENCH_TILE.tileX + dx + 0.5) * TILE_SIZE;
      const worldY = (ELARIS_PUBLIC_WORKBENCH_TILE.tileY + 0.5) * TILE_SIZE;
      expect(isWithinTownSafeZoneWorldPosition(worldX, worldY)).toBe(true);
    }
  });

  it('serves a new character until the town falls, then stops', () => {
    const standing = atTownWorkbench(ELARIS_LAST_SAFE_LEVEL);
    expect(isElarisPublicWorkbenchServing(standing)).toBe(true);
    expect(withinElarisPublicWorkbench(standing, 64)).toBe(true);
    expect(canRegisterHere(standing)).toBe(true);

    // One level later Elaris is a ruin and its bench takes nothing in.
    const fallen = atTownWorkbench(ELARIS_LAST_SAFE_LEVEL + 1);
    expect(isElarisPublicWorkbenchServing(fallen)).toBe(false);
    expect(canRegisterHere(fallen)).toBe(false);
    const carried = tryCarryBlueprint(fallen, 'furnace')!;
    expect(registerCarriedBlueprint(fallen, carried.instanceId)).toMatchObject({ ok: false });
  });

  it('only exists in Elaris', () => {
    const state = atTownWorkbench();
    state.currentArea = { ...state.currentArea, key: '1,0' };
    expect(isElarisPublicWorkbenchServing(state)).toBe(false);
    expect(canRegisterHere(state)).toBe(false);
  });

  it('is a workbench anyone can walk up to and use, with nothing to earn first', () => {
    const state = atTownWorkbench();
    learnBlueprint(state, 'stone-pick');
    // No buildings, no floor, no level: the town maintains it, so none of the
    // gates that apply to a player's own bench apply here.
    expect(state.buildings).toEqual([]);
    const facility = nearestUsableFacility(state);
    expect(facility?.id).toBe(ELARIS_PUBLIC_WORKBENCH_ID);
    expect(facility?.definitionId).toBe('workbench');
    expect(toolUnlockReason(state, 'stone-pick')).toBeNull();

    // Walk away and it is out of reach like any other bench.
    state.player.x = 0;
    state.player.y = 0;
    expect(nearestUsableFacility(state)).toBeNull();
    expect(toolUnlockReason(state, 'stone-pick')).toBe('Craft at a workbench');
  });

  it('stops being a facility once the town falls', () => {
    const fallen = atTownWorkbench(ELARIS_LAST_SAFE_LEVEL + 1);
    expect(elarisPublicWorkbenchFacility(fallen)).toBeNull();
    expect(nearestUsableFacility(fallen)).toBeNull();
  });

  it('is never a building the player owns', () => {
    // A row in state.buildings would be counted by the Homestead Rating and
    // would quietly complete the quest that asks for a Workbench of your own.
    const state = atTownWorkbench();
    expect(state.buildings).toEqual([]);
    expect(canRegisterHere(state)).toBe(true);
    expect(townBuildingAtPlayerDoor(state)).toBeNull();
  });
});
