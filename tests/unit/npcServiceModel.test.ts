import { describe, expect, it } from 'vitest';
import { NPC_DEFINITIONS } from '../../src/content/npcs';
import { npcServiceModel } from '../../src/presentation/npcServiceModel';
import { createInitialState } from '../../src/simulation/state';

describe('NPC service presentation model', () => {
  it('exposes stable, unique offers and actions for every NPC service', () => {
    const state = createInitialState(810);
    for (const npc of NPC_DEFINITIONS) {
      const model = npcServiceModel(state, npc.service);
      expect(model.service).toBe(npc.service);
      expect(model.offers.length).toBeGreaterThan(0);
      expect(new Set(model.offers.map((offer) => offer.id)).size).toBe(model.offers.length);
      const actions = model.offers.flatMap((offer) => offer.actions);
      expect(actions.length).toBeGreaterThan(0);
      expect(new Set(actions.map((action) => action.id)).size).toBe(actions.length);
      expect(actions.every((action) => action.accessibilityLabel.length > 0)).toBe(true);
    }
  });

  it('binds market actions to the existing atomic economy commands', () => {
    const state = createInitialState(811);
    state.inventory.wood = 3;
    const model = npcServiceModel(state, 'market');
    expect(model.balance).toContain('Coin purse: 0');
    const wood = model.offers.find((offer) => offer.id === 'market-wood')!;
    expect(wood.detail).toBe('Owned 3');
    const sellAll = wood.actions.find((action) => action.id === 'sell-all-wood')!;
    expect(sellAll.disabledReason).toBeNull();
    expect(sellAll.execute()).toEqual({ ok: true, message: 'Sold 3 wood for 6 coins' });
    expect(state.inventory.wood).toBe(0);
    expect(state.coins).toBe(6);
  });

  it('describes unavailable actions without mutating state', () => {
    const state = createInitialState(812);
    const before = structuredClone(state);
    const market = npcServiceModel(state, 'market');
    expect(market.offers.find((offer) => offer.id === 'market-stone')?.actions[0]?.disabledReason).toBe('No stone to sell');
    const magicShop = npcServiceModel(state, 'magic-shop');
    expect(magicShop.offers.find((offer) => offer.id === 'magic-staff')?.actions[0]?.disabledReason).toBe('Need 3000 more coins');
    expect(state).toEqual(before);
  });
});
