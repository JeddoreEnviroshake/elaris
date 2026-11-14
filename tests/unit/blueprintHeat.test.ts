import { describe, expect, it } from 'vitest';
import { RAIDER_AGGRO_RANGE_TILES } from '../../src/config/balance';
import { TILE_SIZE } from '../../src/config/platform';
import {
  BLUEPRINT_AGGRO_BPS,
  areaHasBlueprintHeat,
  boxHoldsBlueprint,
  blueprintWaveBonus,
  carriesBlueprint,
  effectiveAggroRangePx,
} from '../../src/simulation/blueprintHeat';
import {
  BLUEPRINT_DROP_TTL_TICKS,
  dropCarriedBlueprint,
  dropCarriedBlueprintsOnDefeat,
  expireBlueprintDrops,
  recoverBlueprintDrop,
  stashBlueprintInBox,
  takeBlueprintFromBox,
  tryCarryBlueprint,
} from '../../src/simulation/carriedBlueprints';
import { knowsBlueprint } from '../../src/simulation/blueprintKnowledge';
import { storageBoxContents } from '../../src/simulation/storageBox';
import { beginPlayerDefeat } from '../../src/simulation/survivalCycle';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { InventoryPanel } from '../../src/ui/inventoryPanel';

const BASE_AGGRO_PX = RAIDER_AGGRO_RANGE_TILES * TILE_SIZE;

function withBox(state: GameState): string {
  const tileX = Math.floor(state.player.x / TILE_SIZE) + 1;
  const tileY = Math.floor(state.player.y / TILE_SIZE);
  state.buildings.push({ id: 'box-1', definitionId: 'field-cache', tileX, tileY });
  return 'box-1';
}

describe('raider heat', () => {
  it('is off until something unregistered is in the open', () => {
    const state = createInitialState(5);
    expect(carriesBlueprint(state)).toBe(false);
    expect(areaHasBlueprintHeat(state)).toBe(false);
    expect(effectiveAggroRangePx(state, BASE_AGGRO_PX)).toBe(BASE_AGGRO_PX);
    expect(blueprintWaveBonus(state)).toBe(0);
  });

  it('widens the aggression radius by exactly 1.25x while carrying', () => {
    const state = createInitialState(5);
    tryCarryBlueprint(state, 'furnace');
    expect(BLUEPRINT_AGGRO_BPS).toBe(12_500);
    expect(effectiveAggroRangePx(state, BASE_AGGRO_PX))
      .toBe(Math.floor(BASE_AGGRO_PX * 1.25));
    expect(blueprintWaveBonus(state)).toBe(1);
  });

  it('is flat: five blueprints weigh the same as one', () => {
    const state = createInitialState(5);
    tryCarryBlueprint(state, 'furnace');
    const one = effectiveAggroRangePx(state, BASE_AGGRO_PX);
    const oneWave = blueprintWaveBonus(state);
    for (const id of ['barn', 'turret', 'warehouse', 'small-pen']) tryCarryBlueprint(state, id);
    expect(state.carriedBlueprints).toHaveLength(5);
    // Stacking would push players into single-item round trips, which is
    // tedious rather than tense.
    expect(effectiveAggroRangePx(state, BASE_AGGRO_PX)).toBe(one);
    expect(blueprintWaveBonus(state)).toBe(oneWave);
  });

  it('follows a blueprint into a Storage Box rather than being escaped by it', () => {
    const state = createInitialState(5);
    const boxId = withBox(state);
    const carried = tryCarryBlueprint(state, 'furnace')!;
    expect(stashBlueprintInBox(state, carried.instanceId, boxId)).toMatchObject({ ok: true });

    // Out of the bag, so the player personally is cool again...
    expect(carriesBlueprint(state)).toBe(false);
    expect(effectiveAggroRangePx(state, BASE_AGGRO_PX)).toBe(BASE_AGGRO_PX);
    // ...but the box now draws the wave. Stashing moves the danger home.
    expect(boxHoldsBlueprint(state.buildings[0]!)).toBe(true);
    expect(areaHasBlueprintHeat(state)).toBe(true);
    expect(blueprintWaveBonus(state)).toBe(1);
  });

  it('cools completely once the box is emptied', () => {
    const state = createInitialState(5);
    const boxId = withBox(state);
    const carried = tryCarryBlueprint(state, 'furnace')!;
    stashBlueprintInBox(state, carried.instanceId, boxId);
    const stashed = storageBoxContents(state.buildings[0]!).blueprints[0]!;
    expect(takeBlueprintFromBox(state, stashed.instanceId, boxId)).toMatchObject({ ok: true });
    expect(areaHasBlueprintHeat(state)).toBe(true); // back in the bag
    expect(carriesBlueprint(state)).toBe(true);
  });
});

describe('losing and recovering a blueprint', () => {
  it('drops everything unregistered where the player died', () => {
    const state = createInitialState(5);
    tryCarryBlueprint(state, 'furnace');
    tryCarryBlueprint(state, 'barn');
    const x = state.player.x;
    const y = state.player.y;

    expect(dropCarriedBlueprintsOnDefeat(state, x, y)).toBe(2);
    expect(state.carriedBlueprints).toEqual([]);
    expect(state.blueprintDrops).toHaveLength(2);
    for (const drop of state.blueprintDrops) {
      expect(drop.expiresAtTick).toBe(state.tick + BLUEPRINT_DROP_TTL_TICKS);
    }
  });

  it('never touches a blueprint already registered', () => {
    const state = createInitialState(5);
    state.unlockedItemIds.push('furnace');
    tryCarryBlueprint(state, 'barn');
    dropCarriedBlueprintsOnDefeat(state, state.player.x, state.player.y);
    // Filing is permanent; that promise is what makes the trip home worth it.
    expect(knowsBlueprint(state, 'furnace')).toBe(true);
  });

  it('drops on a real defeat, and the Safeguard Charm protects them', () => {
    const lost = createInitialState(5);
    tryCarryBlueprint(lost, 'furnace');
    beginPlayerDefeat(lost, 'raider');
    expect(lost.carriedBlueprints).toEqual([]);
    expect(lost.blueprintDrops).toHaveLength(1);

    const charmed = createInitialState(5);
    charmed.inventory['safeguard-charm'] = 1;
    tryCarryBlueprint(charmed, 'furnace');
    beginPlayerDefeat(charmed, 'raider');
    // The charm was bought to survive a defeat intact; an exception would
    // make it a lie.
    expect(charmed.carriedBlueprints).toHaveLength(1);
    expect(charmed.blueprintDrops).toEqual([]);
  });

  it('can be picked back up on a corpse run', () => {
    const state = createInitialState(5);
    const carried = tryCarryBlueprint(state, 'furnace')!;
    dropCarriedBlueprint(state, carried.instanceId);
    const drop = state.blueprintDrops[0]!;

    expect(recoverBlueprintDrop(state, drop.id)).toMatchObject({ ok: true });
    expect(state.blueprintDrops).toEqual([]);
    expect(state.carriedBlueprints.map((entry) => entry.blueprintId)).toEqual(['furnace']);
  });

  it('cannot be picked up from across the map', () => {
    const state = createInitialState(5);
    const carried = tryCarryBlueprint(state, 'furnace')!;
    dropCarriedBlueprint(state, carried.instanceId);
    const drop = state.blueprintDrops[0]!;
    state.player.x += 2_000;

    expect(recoverBlueprintDrop(state, drop.id)).toMatchObject({ ok: false, message: 'Move closer' });
    expect(state.blueprintDrops).toHaveLength(1);
  });

  it('is gone for good after ten real minutes', () => {
    const state = createInitialState(5);
    const carried = tryCarryBlueprint(state, 'furnace')!;
    dropCarriedBlueprint(state, carried.instanceId);
    const drop = state.blueprintDrops[0]!;

    state.tick = drop.expiresAtTick - 1;
    expect(expireBlueprintDrops(state)).toBe(false);
    expect(state.blueprintDrops).toHaveLength(1);

    state.tick = drop.expiresAtTick;
    expect(expireBlueprintDrops(state)).toBe(true);
    expect(state.blueprintDrops).toEqual([]);
    expect(recoverBlueprintDrop(state, drop.id)).toMatchObject({ ok: false });
  });

  it('sheds its heat the moment it leaves the bag', () => {
    const state = createInitialState(5);
    const carried = tryCarryBlueprint(state, 'furnace')!;
    expect(carriesBlueprint(state)).toBe(true);
    dropCarriedBlueprint(state, carried.instanceId);
    expect(carriesBlueprint(state)).toBe(false);
    expect(effectiveAggroRangePx(state, BASE_AGGRO_PX)).toBe(BASE_AGGRO_PX);
  });
});

describe('the bag panel blueprint cell', () => {
  it('offers Register and Drop, and routes each to its command', () => {
    const state = createInitialState(5);
    const carried = tryCarryBlueprint(state, 'furnace')!;
    const registered: string[] = [];
    const dropped: string[] = [];
    const panel = new InventoryPanel(document.body, state, {
      onEquipTool: () => {}, onRepairTool: () => {}, onDropTool: () => {}, onSplitStack: () => {}, onDropStack: () => {}, onOpened: () => {},
      onRegisterBlueprint: (id) => registered.push(id),
      onDropBlueprint: (id) => dropped.push(id),
    });
    panel.openTab('bag');

    const cell = document.querySelector<HTMLButtonElement>('[aria-label^="Blueprint: furnace"]')!;
    expect(cell).not.toBeNull();
    cell.click();

    document.querySelector<HTMLButtonElement>('[aria-label="Blueprint actions: furnace"] button')!;
    const register = [...document.querySelectorAll('button')]
      .find((button) => button.textContent === 'Register furnace')!;
    register.click();
    expect(registered).toEqual([carried.instanceId]);

    cell.click();
    const drop = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Drop')!;
    drop.click();
    expect(dropped).toEqual([carried.instanceId]);

    panel.destroy();
    document.body.replaceChildren();
  });
});
