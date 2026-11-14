import { describe, expect, it } from 'vitest';
import { SELL_PRICES } from '../../src/content/economy';
import {
  BLUEPRINT_SCRAP_PARCHMENT,
  scrapBlockedReason,
  scrapCarriedBlueprint,
  tryCarryBlueprint,
} from '../../src/simulation/carriedBlueprints';
import { BLUEPRINT_SALE_PRICE, sellCarriedBlueprint } from '../../src/simulation/npcStock';
import { knowsBlueprint } from '../../src/simulation/blueprintKnowledge';
import { elarisPublicWorkbenchCenterPx } from '../../src/simulation/elarisWorkbench';
import { npcServiceModel } from '../../src/presentation/npcServiceModel';
import { createInitialState, type GameState } from '../../src/simulation/state';

function atWorkbench(): GameState {
  const state = createInitialState(31);
  const center = elarisPublicWorkbenchCenterPx();
  state.player.x = center.x;
  state.player.y = center.y;
  return state;
}

function awayFromEverything(): GameState {
  const state = createInitialState(31);
  state.player.x = 10;
  state.player.y = 10;
  return state;
}

describe('scrapping a blueprint', () => {
  it('has to be done at a workbench, like registering', () => {
    const state = awayFromEverything();
    const carried = tryCarryBlueprint(state, 'furnace')!;
    expect(scrapBlockedReason(state, carried.instanceId)).toBe('Scrap at a workbench');
    expect(scrapCarriedBlueprint(state, carried.instanceId)).toMatchObject({ ok: false });
    // A refused scrap destroys nothing: the blueprint is still in the bag.
    expect(state.carriedBlueprints).toHaveLength(1);
    expect(state.inventory['draft-parchment']).toBe(0);
  });

  it('consumes the blueprint and yields Draft Parchment', () => {
    const state = atWorkbench();
    const carried = tryCarryBlueprint(state, 'furnace')!;
    expect(scrapCarriedBlueprint(state, carried.instanceId)).toMatchObject({ ok: true });
    expect(state.carriedBlueprints).toEqual([]);
    expect(state.inventory['draft-parchment']).toBe(BLUEPRINT_SCRAP_PARCHMENT);
  });

  it('never teaches the recipe it destroyed', () => {
    const state = atWorkbench();
    const carried = tryCarryBlueprint(state, 'furnace')!;
    scrapCarriedBlueprint(state, carried.instanceId);
    expect(knowsBlueprint(state, 'furnace')).toBe(false);
  });

  it('refuses an instance the player is not carrying', () => {
    const state = atWorkbench();
    expect(scrapCarriedBlueprint(state, 'nope')).toMatchObject({ ok: false });
  });

  it('spills the parchment rather than losing it when the bag is full', () => {
    const state = atWorkbench();
    const carried = tryCarryBlueprint(state, 'furnace')!;
    state.inventory.wood = 99 * 40;
    const dropsBefore = state.groundDrops.length;
    const result = scrapCarriedBlueprint(state, carried.instanceId);
    expect(result.ok).toBe(true);
    expect(state.groundDrops.length).toBeGreaterThan(dropsBefore);
  });
});

describe('selling a blueprint to the market', () => {
  it('pays coins and gives up the recipe', () => {
    const state = awayFromEverything();
    const carried = tryCarryBlueprint(state, 'furnace')!;
    const coins = state.coins;

    expect(sellCarriedBlueprint(state, carried.instanceId)).toMatchObject({ ok: true });
    expect(state.coins).toBe(coins + BLUEPRINT_SALE_PRICE);
    expect(state.carriedBlueprints).toEqual([]);
    expect(knowsBlueprint(state, 'furnace')).toBe(false);
  });

  it('pays more than scrapping, so scrapping stays the floor', () => {
    // Parchment is the consolation for a duplicate nobody wants; a buyer who
    // does want it should always beat breaking it up.
    expect(BLUEPRINT_SALE_PRICE)
      .toBeGreaterThan(BLUEPRINT_SCRAP_PARCHMENT * SELL_PRICES['draft-parchment']);
  });

  it('lists one market row per carried blueprint, and none when carrying nothing', () => {
    const empty = createInitialState(31);
    expect(npcServiceModel(empty, 'market').offers.some((row) => row.id.startsWith('blueprint-sale-')))
      .toBe(false);

    const state = createInitialState(31);
    const first = tryCarryBlueprint(state, 'furnace')!;
    const second = tryCarryBlueprint(state, 'furnace')!;
    const rows = npcServiceModel(state, 'market').offers
      .filter((row) => row.id.startsWith('blueprint-sale-'));
    // Duplicates are separate pieces of paper, so each gets its own row.
    expect(rows.map((row) => row.id)).toEqual([
      `blueprint-sale-${first.instanceId}`,
      `blueprint-sale-${second.instanceId}`,
    ]);
    expect(rows[0]!.actions[0]!.disabledReason).toBeNull();
  });

  it('sells through the market row itself', () => {
    const state = createInitialState(31);
    tryCarryBlueprint(state, 'furnace');
    const coins = state.coins;
    const row = npcServiceModel(state, 'market').offers
      .find((offer) => offer.id.startsWith('blueprint-sale-'))!;

    expect(row.actions[0]!.execute()).toMatchObject({ ok: true });
    expect(state.coins).toBe(coins + BLUEPRINT_SALE_PRICE);
    expect(state.carriedBlueprints).toEqual([]);
  });
});
