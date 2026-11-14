import { describe, expect, it } from 'vitest';
import { craftTool } from '../../src/simulation/gameplayCommands';
import { effectiveToolActionTicks, effectiveToolDamage, orderTrainedCreature, purchaseMagicStaff, purchaseSkillPoint, sellResource, upgradeTool } from '../../src/simulation/economy';
import { createInitialState } from '../../src/simulation/state';
import { createWorkerHousingState } from '../../src/simulation/state';
import { enclosedEnvironment } from './helpers/buildings';

describe('coin economy', () => {
  it('sells resources atomically at fixed prices', () => {
    const state = createInitialState(1); state.inventory.stone = 5;
    expect(sellResource(state, 'stone', 3)).toMatchObject({ ok: true });
    expect(state.inventory.stone).toBe(2); expect(state.coins).toBe(9); expect(state.resourcesSold).toBe(3);
    expect(sellResource(state, 'stone', 3)).toMatchObject({ ok: false });
    expect(state.inventory.stone).toBe(2); expect(state.coins).toBe(9);
  });

  it('sells handcrafted supplies like any other Bag item', () => {
    const state = createInitialState(1); state.inventory.arrow = 9;
    expect(sellResource(state, 'arrow', 4)).toMatchObject({ ok: true });
    expect(state.inventory.arrow).toBe(5); expect(state.coins).toBe(8);
    expect(sellResource(state, 'cloth-mask', 1)).toMatchObject({ ok: false });
  });

  it('applies independent Weaponsmith ranks and consumes nothing on failure', () => {
    const state = createInitialState(2); state.inventory.wood = 5; state.unlockedItemIds.push('wooden-axe'); craftTool(state, 'wooden-axe');
    const tool = state.tools[0]!; state.coins = 100; state.highestRatingEverTenths = 5_000;
    const baseDamage = effectiveToolDamage(tool); const baseTicks = effectiveToolActionTicks(tool);
    expect(upgradeTool(state, tool.instanceId, 'power').ok).toBe(true);
    expect(upgradeTool(state, tool.instanceId, 'speed').ok).toBe(true);
    expect(effectiveToolDamage(tool)).toBeGreaterThan(baseDamage); expect(effectiveToolActionTicks(tool)).toBeLessThan(baseTicks);
    const snapshot = structuredClone(state); state.coins = 0;
    expect(upgradeTool(state, tool.instanceId, 'durability').ok).toBe(false);
    expect(tool.durabilityRank).toBe(snapshot.tools[0]!.durabilityRank);
  });

  it('purchases an attribute point atomically and applies its derived maximum', () => {
    const state = createInitialState(4); state.coins = 150;
    expect(purchaseSkillPoint(state, 'health')).toEqual({ ok: true, message: 'Health increased to 1' });
    expect(state.coins).toBe(50);
    expect(state.player).toMatchObject({ attributes: { health: 1 }, maxHp: 110, hp: 110, attributePoints: 0 });

    const snapshot = structuredClone(state);
    expect(purchaseSkillPoint(state, 'luck')).toEqual({ ok: false, message: 'Need 50 more coins' });
    expect(state).toEqual(snapshot);
  });

  it('only orders a species after it has been tamed once', () => {
    const state = createInitialState(3); state.coins = 500;
    expect(orderTrainedCreature(state, 'tuftle')).toMatchObject({ ok: false });
    state.firstTamedSpeciesIds.push('tuftle'); state.highestRatingEverTenths = 2_500;
    state.buildings = enclosedEnvironment(10, 10, 4, 4, 'workYard');
    state.buildings.push({ id: 'pen', definitionId: 'small-pen', tileX: 10, tileY: 10, housing: createWorkerHousingState() });
    expect(orderTrainedCreature(state, 'tuftle')).toMatchObject({ ok: true });
    expect(state.coins).toBe(380); expect(state.ownedCreatures[0]).toMatchObject({ speciesId: 'tuftle', housingId: 'pen' });
  });

  it('purchases and equips a Magic Staff for exactly 3,000 coins', () => {
    const state = createInitialState(5); state.coins = 3_000;
    expect(purchaseMagicStaff(state)).toEqual({ ok: true, message: 'Purchased and equipped Magic Staff' });
    expect(state.coins).toBe(0);
    expect(state.tools).toHaveLength(1);
    expect(state.tools[0]).toMatchObject({ definitionId: 'magic-staff', durability: 240, maxDurability: 240 });
    expect(state.equippedToolId).toBe(state.tools[0]!.instanceId);

    const snapshot = structuredClone(state);
    expect(purchaseMagicStaff(state)).toEqual({ ok: false, message: 'Need 3000 more coins' });
    expect(state).toEqual(snapshot);
  });

  it('does not charge for a Magic Staff when the inventory is full', () => {
    const state = createInitialState(6); state.coins = 4_000;
    state.tools = Array.from({ length: 20 }, (_, index) => ({
      instanceId: `full-tool-${index}`,
      definitionId: 'wooden-axe' as const,
      durability: 48,
      maxDurability: 48,
      powerRank: 0,
      speedRank: 0,
      durabilityRank: 0,
    }));
    const snapshot = structuredClone(state);
    expect(purchaseMagicStaff(state)).toEqual({ ok: false, message: 'Inventory full' });
    expect(state).toEqual(snapshot);
  });
});
