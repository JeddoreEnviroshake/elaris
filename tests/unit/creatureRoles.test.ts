import { describe, expect, it } from 'vitest';
import { advanceCartDockTransfers, linkCartDockStorage } from '../../src/simulation/cartDocks';
import { activeFollowerActionSpeedBps, snarlfoxDetectionMultiplierBps } from '../../src/simulation/creatureRoles';
import { setCreatureRole } from '../../src/simulation/gameplayCommands';
import { createCartDockState, createInitialState, createWorkerHousingState, createWorkerProducerState, type GameState, type OwnedCreatureState } from '../../src/simulation/state';
import { storageBoxContents } from '../../src/simulation/storageBox';
import { strikeProfile } from '../../src/simulation/strike';
import { collectWorkerFacilityBin, settleWorkerProduction } from '../../src/simulation/workerHousing';
import { enclosedEnvironment } from './helpers/buildings';

function worker(speciesId: OwnedCreatureState['speciesId'], id: string = speciesId): OwnedCreatureState {
  const ability = speciesId === 'tuftle' ? 'tuftle-guard'
    : speciesId === 'craghopper' ? 'craghopper-guard'
      : speciesId === 'glade-stag' ? 'glade-stag-forward' : 'snarlfox-flank';
  return {
    id, speciesId, name: id, role: 'rest', assignment: null, worksiteId: null,
    nextWorkTick: 0, housingId: 'pen', workRemainderMs: 0, bondXp: 0,
    selectedBattleAbilityId: ability,
  };
}

function roleState(): GameState {
  const state = createInitialState(7_777);
  state.buildings = enclosedEnvironment(10, 10, 6, 4, 'workYard');
  state.buildings.push(
    { id: 'pen', definitionId: 'small-pen', tileX: 10, tileY: 10, housing: createWorkerHousingState() },
    { id: 'stone-yard', definitionId: 'stone-yard', tileX: 12, tileY: 10, producer: createWorkerProducerState() },
    { id: 'cart-dock', definitionId: 'cart-dock', tileX: 14, tileY: 10, cartDock: createCartDockState() },
    {
      id: 'box', definitionId: 'field-cache', tileX: 10, tileY: 12,
      storage: { wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 },
      storageStacks: { wood: [], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [] }, storedTools: [],
    },
  );
  return state;
}

describe('species-specific overworld roles', () => {
  it('stations a Craghopper at a Stone Yard and settles its finite stone bin', () => {
    const state = roleState();
    state.ownedCreatures.push(worker('craghopper'));
    expect(setCreatureRole(state, 'craghopper', 'work')).toMatchObject({ ok: true });
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'work', assignment: 'stone', worksiteId: 'stone-yard' });
    expect(settleWorkerProduction(state, 60_000)).toEqual({ completedCycles: 1, produced: 2 });
    const yard = state.buildings.find((building) => building.id === 'stone-yard')!;
    expect(yard.producer?.bin.stone).toBe(2);
    yard.producer!.bin.stone = 18;
    expect(settleWorkerProduction(state, 600_000)).toEqual({ completedCycles: 0, produced: 0 });
    expect(collectWorkerFacilityBin(state, yard.id, 'stone')).toMatchObject({ ok: true });
    expect(state.inventory.stone).toBe(18);
  });

  it('keeps only the strongest Craghopper mining-speed modifier in its group', () => {
    const state = roleState();
    state.ownedCreatures.push(worker('craghopper', 'one'));
    state.ownedCreatures[0]!.role = 'follow';
    expect(activeFollowerActionSpeedBps(state, 'stone')).toBe(5_000);
    state.tools.push({ instanceId: 'pick', definitionId: 'stone-pick', durability: 96, maxDurability: 96, powerRank: 0, speedRank: 0, durabilityRank: 0 });
    state.equippedToolId = 'pick';
    const oneFollowerTicks = strikeProfile(state, 'stone').cooldownTicks;
    const second = worker('craghopper', 'two'); second.role = 'follow'; state.ownedCreatures.push(second);
    expect(activeFollowerActionSpeedBps(state, 'stone')).toBe(5_000);
    expect(strikeProfile(state, 'stone').cooldownTicks).toBe(oneFollowerTicks);
    expect(activeFollowerActionSpeedBps(state, 'tree')).toBe(0);
  });

  it('links a Cart Dock and unloads raw stacks once per yard entry in slot order', () => {
    const state = roleState();
    state.ownedCreatures.push(worker('glade-stag'));
    expect(setCreatureRole(state, 'glade-stag', 'work')).toMatchObject({ ok: true });
    expect(state.ownedCreatures[0]?.worksiteId).toBe('cart-dock');
    expect(linkCartDockStorage(state, 'cart-dock', 'missing')).toMatchObject({ ok: false });
    expect(linkCartDockStorage(state, 'cart-dock', 'box')).toMatchObject({ ok: true });
    state.inventory.wood = 5; state.inventory.stone = 3;
    state.inventoryStacks.wood = [5]; state.inventoryStacks.stone = [3];
    state.player.x = 10.5 * 16; state.player.y = 10.5 * 16;
    expect(advanceCartDockTransfers(state)).toMatchObject({ changed: true, transferred: 8 });
    expect(storageBoxContents(state.buildings.find((building) => building.id === 'box')!).inventory).toMatchObject({ wood: 5, stone: 3 });
    state.inventory.wood = 4; state.inventoryStacks.wood = [4];
    expect(advanceCartDockTransfers(state).transferred).toBe(0);
    state.player.x = 2 * 16; state.player.y = 2 * 16; advanceCartDockTransfers(state);
    state.player.x = 10.5 * 16; state.player.y = 10.5 * 16;
    expect(advanceCartDockTransfers(state).transferred).toBe(4);
  });

  it('leaves all remaining stacks in the Bag when the linked destination is full', () => {
    const state = roleState();
    state.ownedCreatures.push(worker('glade-stag'));
    setCreatureRole(state, 'glade-stag', 'work'); linkCartDockStorage(state, 'cart-dock', 'box');
    const box = state.buildings.find((building) => building.id === 'box')!;
    box.storage = { wood: 99, stone: 99, fiber: 99, 'iron-ore': 99, 'iron-ingot': 198 };
    box.storageStacks = { wood: [99], stone: [99], fiber: [99], 'iron-ore': [99], 'iron-ingot': [99, 99] };
    state.inventory.wood = 5; state.inventoryStacks.wood = [5];
    state.player.x = 10.5 * 16; state.player.y = 10.5 * 16;
    expect(advanceCartDockTransfers(state).transferred).toBe(0);
    expect(state.inventory.wood).toBe(5);
    expect(state.buildings.find((building) => building.id === 'cart-dock')?.cartDock?.lastTransferMessage).toMatch(/remainder stayed/);
  });

  it('reduces hostile detection only inside a working Snarlfox yard and six-tile perimeter', () => {
    const state = roleState();
    state.ownedCreatures.push(worker('snarlfox'));
    expect(setCreatureRole(state, 'snarlfox', 'work')).toMatchObject({ ok: true });
    expect(snarlfoxDetectionMultiplierBps(state, 11 * 16, 11 * 16)).toBe(7_500);
    expect(snarlfoxDetectionMultiplierBps(state, 11 * 16, 30 * 16)).toBe(10_000);
    state.activeEncounter = {} as GameState['activeEncounter'];
    expect(snarlfoxDetectionMultiplierBps(state, 11 * 16, 11 * 16)).toBe(10_000);
  });
});
