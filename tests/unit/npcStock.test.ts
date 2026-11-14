import { describe, expect, it } from 'vitest';
import { tryCarryBlueprint } from '../../src/simulation/carriedBlueprints';
import { BLUEPRINT_ITEM_IDS, knowsBlueprint, unknownBlueprintIds } from '../../src/simulation/blueprintKnowledge';
import { blueprintsGrantedAtLevel } from '../../src/content/blueprintGates';
import { createInitialState, type GameState } from '../../src/simulation/state';
import {
  buyArcaneStudy,
  buyReinforcedPack,
  buyRumour,
  buySafeguardCharm,
  buySupply,
  effectiveBagCapacityHundredths,
  nextArcaneStudyCost,
  nextPackRankCost,
  restockPrice,
  rumourBlockedReason,
} from '../../src/simulation/npcStock';
import {
  PACK_RANK_CAPACITY_HUNDREDTHS,
  RESTOCK_ITEM_IDS,
  RESTOCK_MARKUP,
  RUMOUR_COST,
  SAFEGUARD_CHARM_COST,
  arcaneStudyCost,
  packRankCost,
} from '../../src/content/npcStock';
import { SELL_PRICES, BLACKSMITH_UPGRADE_COSTS, WORLD_BLACKSMITH_MAX_RANK } from '../../src/content/economy';
import { beginPlayerDefeat } from '../../src/simulation/survivalCycle';
import { isBagOverweight } from '../../src/simulation/bagWeight';
import { npcServiceModel } from '../../src/presentation/npcServiceModel';

function rich(coins = 100_000): GameState {
  const state = createInitialState(4321);
  state.coins = coins;
  return state;
}

describe('market restock', () => {
  it('sells back at a markup over what it pays', () => {
    for (const resource of RESTOCK_ITEM_IDS) {
      expect(restockPrice(resource)).toBe(SELL_PRICES[resource] * RESTOCK_MARKUP);
      expect(restockPrice(resource)).toBeGreaterThan(SELL_PRICES[resource]);
    }
  });

  it('cannot be arbitraged: buying then selling always loses coins', () => {
    const state = rich(1_000);
    for (const resource of RESTOCK_ITEM_IDS) {
      expect(restockPrice(resource)).toBeGreaterThan(SELL_PRICES[resource]);
    }
    const before = state.coins;
    buySupply(state, 'arrow', 5);
    expect(state.coins).toBeLessThan(before);
  });

  it('grants the goods and charges exactly', () => {
    const state = rich(1_000);
    const before = state.inventory.arrow;
    const result = buySupply(state, 'arrow', 3);
    expect(result.ok).toBe(true);
    expect(state.inventory.arrow).toBe(before + 3);
    expect(state.coins).toBe(1_000 - restockPrice('arrow') * 3);
  });

  it('refuses without charging when coins are short', () => {
    const state = rich(1);
    const before = { coins: state.coins, arrows: state.inventory.arrow };
    expect(buySupply(state, 'arrow', 1).ok).toBe(false);
    expect(state.coins).toBe(before.coins);
    expect(state.inventory.arrow).toBe(before.arrows);
  });

  it('rejects non-positive amounts', () => {
    const state = rich();
    expect(buySupply(state, 'arrow', 0).ok).toBe(false);
    expect(buySupply(state, 'arrow', -2).ok).toBe(false);
    expect(buySupply(state, 'arrow', 1.5).ok).toBe(false);
  });

  it('is repeatable, so it never stops absorbing coins', () => {
    const state = rich(10_000);
    for (let i = 0; i < 20; i += 1) expect(buySupply(state, 'berry', 1).ok).toBe(true);
    expect(state.inventory.berry).toBeGreaterThanOrEqual(20);
  });
});

/** A bag holding nothing but what a charm test puts in it. */
function emptyBagged(): ReturnType<typeof rich> {
  const state = rich();
  for (const resource of Object.keys(state.inventory) as Array<keyof typeof state.inventory>) {
    state.inventory[resource] = 0;
    state.inventoryStacks[resource] = [];
  }
  return state;
}

describe('safeguard charm', () => {
  it('costs a flat price and lands in the bag', () => {
    const state = rich();
    expect(buySafeguardCharm(state).ok).toBe(true);
    expect(state.inventory['safeguard-charm']).toBe(1);
    expect(state.coins).toBe(100_000 - SAFEGUARD_CHARM_COST);
  });

  it('refuses without charging when coins are short', () => {
    const state = rich(10);
    expect(buySafeguardCharm(state).ok).toBe(false);
    expect(state.coins).toBe(10);
    expect(state.inventory['safeguard-charm']).toBe(0);
  });

  it('saves one item per charm, taking the tool before the resource stack', () => {
    const state = emptyBagged();
    buySafeguardCharm(state);
    state.inventory.wood = 40;
    state.tools.push({
      instanceId: 'tool-1', definitionId: 'stone-axe', durability: 90,
      maxDurability: 96, powerRank: 0, speedRank: 0, durabilityRank: 0,
    });
    const result = beginPlayerDefeat(state, 'exposure');
    // One charm, so one thing survives — and it is the tool, not the wood.
    expect(state.tools.length).toBe(1);
    expect(state.inventory.wood).toBe(0);
    expect(result.lostItemCount).toBe(40);
    expect(state.inventory['safeguard-charm']).toBe(0);
    expect(state.pendingRespawn).not.toBeNull();
  });

  it('spends a second charm to cover a second item', () => {
    const state = emptyBagged();
    buySafeguardCharm(state);
    buySafeguardCharm(state);
    state.inventory.wood = 40;
    state.tools.push({
      instanceId: 'tool-1', definitionId: 'stone-axe', durability: 90,
      maxDurability: 96, powerRank: 0, speedRank: 0, durabilityRank: 0,
    });
    const result = beginPlayerDefeat(state, 'raider');
    expect(state.tools.length).toBe(1);
    expect(state.inventory.wood).toBe(40);
    expect(result.lostItemCount).toBe(0);
    expect(state.inventory['safeguard-charm']).toBe(0);
  });

  it('spends no more charms than it has items to save', () => {
    const state = emptyBagged();
    buySafeguardCharm(state);
    buySafeguardCharm(state);
    buySafeguardCharm(state);
    state.inventory.wood = 40;
    beginPlayerDefeat(state, 'raider');
    // One stack to protect, so one charm spent and the rest survive with it.
    expect(state.inventory.wood).toBe(40);
    expect(state.inventory['safeguard-charm']).toBe(2);
  });

  it('spends charms on unregistered blueprints before anything else', () => {
    const state = emptyBagged();
    buySafeguardCharm(state);
    state.inventory.wood = 40;
    state.tools.push({
      instanceId: 'tool-1', definitionId: 'stone-axe', durability: 90,
      maxDurability: 96, powerRank: 0, speedRank: 0, durabilityRank: 0,
    });
    tryCarryBlueprint(state, 'furnace');

    beginPlayerDefeat(state, 'raider');
    // A blueprint is the only carried thing that cannot be bought or
    // re-gathered, so the single charm goes to it.
    expect(state.carriedBlueprints).toHaveLength(1);
    expect(state.blueprintDrops).toEqual([]);
    expect(state.tools).toEqual([]);
    expect(state.inventory.wood).toBe(0);
  });

  it('still loses everything when no charm is carried', () => {
    const state = rich();
    state.inventory.wood = 40;
    const result = beginPlayerDefeat(state, 'exposure');
    expect(result.lostItemCount).toBeGreaterThan(0);
    expect(state.inventory.wood).toBe(0);
  });
});

describe('reinforced pack', () => {
  it('escalates in price with every rank', () => {
    expect(packRankCost(0)).toBeLessThan(packRankCost(1));
    expect(packRankCost(1)).toBeLessThan(packRankCost(2));
  });

  it('raises the effective carry limit permanently', () => {
    const state = rich();
    const before = effectiveBagCapacityHundredths(state);
    expect(buyReinforcedPack(state).ok).toBe(true);
    expect(state.packRanks).toBe(1);
    expect(effectiveBagCapacityHundredths(state)).toBe(before + PACK_RANK_CAPACITY_HUNDREDTHS);
  });

  it('actually relieves an overweight bag', () => {
    const state = rich();
    state.inventory.stone = 40;
    expect(isBagOverweight(state)).toBe(true);
    for (let i = 0; i < 10 && isBagOverweight(state); i += 1) buyReinforcedPack(state);
    expect(isBagOverweight(state)).toBe(false);
  });

  it('leaves the Admin-tunable base capacity untouched', () => {
    const state = rich();
    const base = state.gameBalance.bagWeight.capacityHundredths;
    buyReinforcedPack(state);
    expect(state.gameBalance.bagWeight.capacityHundredths).toBe(base);
  });

  it('charges the quoted price and refuses when short', () => {
    const state = rich(nextPackRankCost(createInitialState(1)) - 1);
    expect(buyReinforcedPack(state).ok).toBe(false);
    expect(state.packRanks).toBe(0);
  });

  it('never runs out of ranks to sell', () => {
    const state = rich(1_000_000);
    for (let i = 0; i < 15; i += 1) expect(buyReinforcedPack(state).ok).toBe(true);
    expect(state.packRanks).toBe(15);
  });
});

describe('arcane study', () => {
  it('escalates and teaches exactly one blueprint', () => {
    const state = rich();
    const lesson = unknownBlueprintIds(state)[0]!;
    const firstCost = nextArcaneStudyCost(state);
    expect(buyArcaneStudy(state).ok).toBe(true);
    expect(knowsBlueprint(state, lesson)).toBe(true);
    expect(state.unlockedItemIds).toHaveLength(blueprintsGrantedAtLevel(1).length + 1);
    expect(nextArcaneStudyCost(state)).toBeGreaterThan(firstCost);
    expect(arcaneStudyCost(0)).toBe(firstCost);
  });

  it('refuses without charging when coins are short', () => {
    const state = rich(1);
    expect(buyArcaneStudy(state).ok).toBe(false);
    expect(state.unlockedItemIds).toEqual([...blueprintsGrantedAtLevel(1)]);
    expect(state.arcaneStudyPurchases).toBe(0);
  });

  it('has nothing left to sell once every blueprint is known', () => {
    const state = rich();
    state.unlockedItemIds = [...BLUEPRINT_ITEM_IDS];
    const coins = state.coins;
    expect(buyArcaneStudy(state)).toEqual({ ok: false, message: 'Selene has nothing left to teach you' });
    expect(state.coins).toBe(coins);
  });
});

describe('tavern rumour', () => {
  it('names a bearing to an unopened container', () => {
    const state = rich();
    const result = buyRumour(state);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/north|south|east|west|close by/);
    expect(state.coins).toBe(100_000 - RUMOUR_COST);
  });

  it('refuses without charging once every container here is opened', () => {
    const state = rich();
    for (const container of state.containers) container.opened = true;
    expect(rumourBlockedReason(state)).not.toBeNull();
    expect(buyRumour(state).ok).toBe(false);
    expect(state.coins).toBe(100_000);
  });
});

describe('master tempering', () => {
  it('extends the blacksmith to four ranks with escalating costs', () => {
    expect(WORLD_BLACKSMITH_MAX_RANK).toBe(4);
    expect(BLACKSMITH_UPGRADE_COSTS.length).toBe(WORLD_BLACKSMITH_MAX_RANK);
    for (let i = 1; i < BLACKSMITH_UPGRADE_COSTS.length; i += 1) {
      expect(BLACKSMITH_UPGRADE_COSTS[i]!).toBeGreaterThan(BLACKSMITH_UPGRADE_COSTS[i - 1]!);
    }
  });
});

describe('service model exposure', () => {
  const servicesWithNewStock = [
    ['market', 'restock-arrow'],
    ['church', 'safeguard-charm'],
    ['armoury', 'reinforced-pack'],
    ['magic-shop', 'arcane-study'],
    ['tavern', 'tavern-rumour'],
  ] as const;

  it('offers the new stock at the right NPC', () => {
    const state = rich();
    for (const [service, offerId] of servicesWithNewStock) {
      const model = npcServiceModel(state, service);
      expect(model.offers.map((o) => o.id)).toContain(offerId);
    }
  });

  it('keeps every offer id unique within a service', () => {
    const state = rich();
    for (const service of ['market', 'weaponsmith', 'farm', 'church', 'armoury', 'magic-shop', 'tavern', 'arena'] as const) {
      const ids = npcServiceModel(state, service).offers.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('gives every NPC at least one offer, so none is a dead stop', () => {
    const state = rich();
    for (const service of ['market', 'weaponsmith', 'farm', 'church', 'armoury', 'magic-shop', 'tavern', 'arena'] as const) {
      expect(npcServiceModel(state, service).offers.length).toBeGreaterThan(0);
    }
  });

  it('disables rather than hides new actions a broke player cannot afford', () => {
    const state = createInitialState(4321);
    state.coins = 0;
    const church = npcServiceModel(state, 'church');
    const charm = church.offers.find((o) => o.id === 'safeguard-charm')!;
    expect(charm.actions[0]!.disabledReason).toMatch(/more coins/);
  });

  it('executes a purchase through the model exactly as the command would', () => {
    const state = rich();
    const armoury = npcServiceModel(state, 'armoury');
    const pack = armoury.offers.find((o) => o.id === 'reinforced-pack')!;
    expect(pack.actions[0]!.execute().ok).toBe(true);
    expect(state.packRanks).toBe(1);
  });
});
