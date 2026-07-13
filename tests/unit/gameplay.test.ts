import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS, WOODEN_PICK, toolDefinition } from '../../src/config/balance';
import {
  collectNearestGroundDrop,
  advanceTuftleWork,
  advanceResourceRenewal,
  assignTuftle,
  craftWoodenPick,
  craftTool,
  equipTool,
  eligibleCreatureWorksites,
  gatherNearest,
  repairTool,
  setCreatureRole,
  tameNearestCreature,
  usedInventorySlots,
  withdrawFromFieldCache,
} from '../../src/simulation/gameplayCommands';
import { createInitialState } from '../../src/simulation/state';

function waitForCooldown(state: ReturnType<typeof createInitialState>): void {
  state.tick = state.actionCooldownUntilTick;
}

function depleteNearest(state: ReturnType<typeof createInitialState>): void {
  for (let i = 0; i < 20; i += 1) {
    const result = gatherNearest(state);
    expect(result.ok).toBe(true);
    if (result.depleted) return;
    waitForCooldown(state);
  }
  throw new Error('node did not deplete');
}

describe('gathering and crafting vertical slice', () => {
  it('generates the same stable resource world for the same seed', () => {
    const first = createInitialState(123).resourceNodes;
    const second = createInitialState(123).resourceNodes;
    expect(second).toEqual(first);
    expect(new Set(first.map((node) => node.id)).size).toBe(first.length);
  });

  it('gathers wood by hand, atomically crafts a pick, then gathers stone', () => {
    const state = createInitialState(123);

    depleteNearest(state);
    waitForCooldown(state);
    depleteNearest(state);
    expect(state.inventory.wood).toBe(8);

    const crafted = craftWoodenPick(state);
    expect(crafted.ok).toBe(true);
    expect(state.inventory.wood).toBe(8 - WOODEN_PICK.woodCost);
    expect(state.tools).toHaveLength(1);
    expect(state.equippedToolId).toBe(state.tools[0]?.instanceId);

    const stone = state.resourceNodes.find((node) => node.kind === 'stone');
    expect(stone).toBeDefined();
    state.player.x = stone!.x;
    state.player.y = stone!.y;
    waitForCooldown(state);
    depleteNearest(state);

    expect(state.inventory.stone).toBe(3);
    expect(state.tools[0]?.durability).toBe(WOODEN_PICK.maxDurability - 4);
  });

  it('rejects stone gathering without a pick and consumes nothing', () => {
    const state = createInitialState(123);
    const stone = state.resourceNodes.find((node) => node.kind === 'stone')!;
    state.player.x = stone.x;
    state.player.y = stone.y;

    const result = gatherNearest(state);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/requires a pick/);
    expect(stone.hp).toBe(stone.maxHp);
    expect(state.actionCooldownUntilTick).toBe(0);
  });

  it('gathers fiber from plants by hand and faster with a sickle', () => {
    const state = createInitialState(123);
    const handPlant = state.resourceNodes.find((node) => node.kind === 'plant')!;
    state.player.x = handPlant.x; state.player.y = handPlant.y;
    depleteNearest(state);
    expect(state.inventory.fiber).toBe(5);
    expect(state.resourcesCollected.fiber).toBe(5);

    state.inventory.wood = 4;
    expect(craftTool(state, 'wooden-sickle')).toMatchObject({ ok: true });
    const sicklePlant = state.resourceNodes.find((node) => node.kind === 'plant' && node.hp > 0)!;
    state.player.x = sicklePlant.x; state.player.y = sicklePlant.y;
    waitForCooldown(state);
    expect(gatherNearest(state)).toMatchObject({ ok: true });
    expect(sicklePlant.hp).toBe(sicklePlant.maxHp - toolDefinition('wooden-sickle').damage);
  });

  it('persists a deterministic renewal timer and restores a depleted node when due', () => {
    const state = createInitialState(123);
    const tree = state.resourceNodes.find((node) => node.kind === 'tree')!;
    state.player.x = tree.x; state.player.y = tree.y;
    depleteNearest(state);
    expect(tree.hp).toBe(0);
    expect(tree.respawnAtTick).toBeGreaterThan(state.tick);

    state.tick = tree.respawnAtTick! - 1;
    expect(advanceResourceRenewal(state)).toBe(false);
    expect(tree.hp).toBe(0);
    state.tick += 1;
    expect(advanceResourceRenewal(state)).toBe(true);
    expect(tree).toMatchObject({ hp: tree.maxHp, respawnAtTick: null });
  });

  it('tames the seed-stable Tuftle with fiber, removing its wild spawn atomically', () => {
    const state = createInitialState(123);
    const tuftle = state.wildCreatures[0]!;
    state.player.x = tuftle.x;
    state.player.y = tuftle.y;
    state.inventory.fiber = 2;
    expect(tameNearestCreature(state)).toMatchObject({ ok: false, message: 'Need 1 fiber to tame Tuftle' });
    expect(state.wildCreatures).toHaveLength(4);

    state.inventory.fiber = 3;
    expect(tameNearestCreature(state)).toMatchObject({ ok: true, message: 'Tuftle tamed!' });
    expect(state.inventory.fiber).toBe(0);
    expect(state.wildCreatures).toHaveLength(3);
    expect(state.wildCreatures.some((creature) => creature.speciesId === 'tuftle')).toBe(false);
    expect(state.ownedCreatures).toEqual([{
      id: 'creature-1', speciesId: 'tuftle', name: 'Tuftle', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0,
    }]);
  });

  it('assigns a Tuftle to a cache and deposits completed harvests deterministically', () => {
    const state = createInitialState(123);
    const tuftle = state.wildCreatures[0]!;
    state.player.x = tuftle.x; state.player.y = tuftle.y; state.inventory.fiber = 3;
    expect(tameNearestCreature(state).ok).toBe(true);
    state.buildings.push({
      id: 'cache-1', definitionId: 'field-cache', tileX: 1, tileY: 1,
      storage: { wood: 0, stone: 0, fiber: 0 },
    });
    const worker = state.ownedCreatures[0]!;
    expect(assignTuftle(state, worker.id, 'wood')).toMatchObject({ ok: true });
    const tree = state.resourceNodes.find((node) => node.kind === 'tree')!;
    tree.hp = 10;
    state.tick = worker.nextWorkTick;
    expect(advanceTuftleWork(state)).toBe(true);
    expect(tree.hp).toBe(0);
    expect(state.buildings[0]!.storage!.wood).toBe(4);
    expect(state.workerResourcesProduced).toBe(4);
    expect(withdrawFromFieldCache(state, 'wood')).toMatchObject({ ok: true });
    expect(state.inventory.wood).toBe(4);
    expect(state.buildings[0]!.storage!.wood).toBe(0);
    expect(state.workerResourcesProduced).toBe(4);
  });

  it('requires a Field Cache before a Tuftle can be assigned work', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push({ id: 'creature-1', speciesId: 'tuftle', name: 'Tuftle', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0 });
    expect(assignTuftle(state, 'creature-1', 'fiber')).toMatchObject({
      ok: false, message: 'Place a Field Cache before assigning Tuftle',
    });
  });

  it('rejects duplicate taming before consuming resources or removing the wild entity', () => {
    const state = createInitialState(123);
    const tuftle = state.wildCreatures[0]!;
    state.player.x = tuftle.x; state.player.y = tuftle.y; state.inventory.fiber = 9;
    state.ownedCreatures.push({ id: 'creature-existing', speciesId: 'tuftle', name: 'Tuftle', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0 });
    expect(tameNearestCreature(state)).toMatchObject({ ok: false, message: 'Tuftle is already in your roster' });
    expect(state.inventory.fiber).toBe(9);
    expect(state.wildCreatures).toHaveLength(4);
  });

  it('never changes wild or owned creatures through the normal gather action', () => {
    const state = createInitialState(123);
    const wildBefore = structuredClone(state.wildCreatures);
    state.ownedCreatures.push({ id: 'creature-owned', speciesId: 'tuftle', name: 'Tuftle', role: 'follow', assignment: null, worksiteId: null, nextWorkTick: 0 });
    const ownedBefore = structuredClone(state.ownedCreatures);
    gatherNearest(state);
    expect(state.wildCreatures).toEqual(wildBefore);
    expect(state.ownedCreatures).toEqual(ownedBefore);
  });

  it('switches atomically between follow, nearest-worksite work, and rest', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push({ id: 'creature-1', speciesId: 'tuftle', name: 'Tuftle', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0 });
    state.buildings.push(
      { id: 'cache-far', definitionId: 'field-cache', tileX: 2, tileY: 2, storage: { wood: 0, stone: 0, fiber: 0 } },
      { id: 'planter-near', definitionId: 'woodlot-planter', tileX: 31, tileY: 31 },
    );
    expect(setCreatureRole(state, 'creature-1', 'follow')).toMatchObject({ ok: true });
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'follow', assignment: null, worksiteId: null });
    expect(eligibleCreatureWorksites(state, 'creature-1')[0]?.id).toBe('planter-near');
    expect(setCreatureRole(state, 'creature-1', 'work')).toMatchObject({ ok: true, message: 'Tuftle assigned to Woodlot Planter' });
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'work', assignment: 'fiber', worksiteId: 'planter-near' });
    expect(setCreatureRole(state, 'creature-1', 'rest')).toMatchObject({ ok: true });
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'rest', assignment: null, worksiteId: null });
  });

  it('keeps the fourth follower at rest until an active follower is replaced', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push(
      { id: 'creature-1', speciesId: 'tuftle', name: 'One', role: 'follow', assignment: null, worksiteId: null, nextWorkTick: 0 },
      { id: 'creature-2', speciesId: 'craghopper', name: 'Two', role: 'follow', assignment: null, worksiteId: null, nextWorkTick: 0 },
      { id: 'creature-3', speciesId: 'glade-stag', name: 'Three', role: 'follow', assignment: null, worksiteId: null, nextWorkTick: 0 },
      { id: 'creature-4', speciesId: 'snarlfox', name: 'Four', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0 },
    );

    expect(setCreatureRole(state, 'creature-4', 'follow')).toMatchObject({
      ok: false,
      message: 'Choose a follower to rest first (3/3 active)',
    });
    expect(state.ownedCreatures[3]).toMatchObject({ role: 'rest', assignment: null, worksiteId: null });

    expect(setCreatureRole(state, 'creature-1', 'rest')).toMatchObject({ ok: true });
    expect(setCreatureRole(state, 'creature-4', 'follow')).toMatchObject({ ok: true });
  });

  it('does not invent a work assignment before a species facility exists', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push({ id: 'creature-1', speciesId: 'glade-stag', name: 'Fern', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0 });
    expect(setCreatureRole(state, 'creature-1', 'work')).toMatchObject({
      ok: false,
      message: "Fern's work role is not unlocked yet",
    });
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'rest', assignment: null, worksiteId: null });
  });

  it('mounts a Glade Stag when it is assigned to follow', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push({ id: 'creature-1', speciesId: 'glade-stag', name: 'Fern', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0 });
    expect(setCreatureRole(state, 'creature-1', 'follow')).toMatchObject({
      ok: true,
      message: 'Fern mounted · 1.7× travel speed',
    });
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'follow', assignment: null, worksiteId: null });
  });

  it('moves a worker safely to rest when its assigned worksite disappears', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push({ id: 'creature-1', speciesId: 'tuftle', name: 'Tuftle', role: 'work', assignment: 'fiber', worksiteId: 'missing', nextWorkTick: 0 });
    state.buildings.push({ id: 'cache-1', definitionId: 'field-cache', tileX: 1, tileY: 1, storage: { wood: 0, stone: 0, fiber: 0 } });
    expect(advanceTuftleWork(state)).toBe(true);
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'rest', assignment: null, worksiteId: null });
  });

  it('does not consume wood when crafting requirements are not met', () => {
    const state = createInitialState(123);
    const result = craftWoodenPick(state);
    expect(result.ok).toBe(false);
    expect(state.inventory.wood).toBe(0);
    expect(state.tools).toHaveLength(0);
  });

  it('keeps a broken pick, repairs it proportionally, then equips it explicitly', () => {
    const state = createInitialState(123);
    state.inventory.wood = 5;
    expect(craftWoodenPick(state).ok).toBe(true);
    const pick = state.tools[0]!;
    pick.durability = 0;
    state.equippedToolId = null;
    state.inventory.wood = 0;

    expect(repairTool(state, pick.instanceId)).toMatchObject({ ok: false, message: 'Need 1 more wood' });
    state.inventory.wood = 1;
    expect(repairTool(state, pick.instanceId)).toMatchObject({ ok: true });
    expect(state.repairsMade).toBe(1);
    expect(pick.durability).toBe(12);
    expect(state.inventory.wood).toBe(0);
    expect(equipTool(state, pick.instanceId)).toMatchObject({ ok: true });
    expect(state.equippedToolId).toBe(pick.instanceId);
  });

  it('keeps a depleted yield on the ground when every inventory slot is occupied', () => {
    const state = createInitialState(123);
    state.inventory.wood = 99 * 20;
    expect(usedInventorySlots(state)).toBe(20);

    depleteNearest(state);
    expect(state.inventory.wood).toBe(99 * 20);
    expect(state.groundDrops).toHaveLength(1);
    expect(state.groundDrops[0]).toMatchObject({ resource: 'wood', amount: 4 });

    state.inventory.wood -= 4;
    const drop = state.groundDrops[0]!;
    state.player.x = drop.x;
    state.player.y = drop.y;
    expect(collectNearestGroundDrop(state)).toMatchObject({ ok: true });
    expect(state.groundDrops).toHaveLength(0);
    expect(state.inventory.wood).toBe(99 * 20);
  });

  it('never consumes inputs when a crafted tool would exceed inventory capacity', () => {
    const state = createInitialState(123);
    state.inventory.wood = 99 * 20;
    expect(craftWoodenPick(state)).toMatchObject({ ok: false, message: 'Inventory full' });
    expect(state.inventory.wood).toBe(99 * 20);
    expect(state.tools).toHaveLength(0);
  });

  it('uses a resource stack freed by crafting before rejecting a full inventory', () => {
    const state = createInitialState(123);
    state.inventory.wood = WOODEN_PICK.woodCost;
    state.inventory.stone = 99 * 19;

    expect(craftWoodenPick(state)).toMatchObject({ ok: true });
    expect(state.inventory.wood).toBe(0);
    expect(state.tools).toHaveLength(1);
    expect(usedInventorySlots(state)).toBe(20);
  });

  it('atomically crafts every Wooden and Stone axe, pick, and sickle definition', () => {
    for (const definition of TOOL_DEFINITIONS) {
      const state = createInitialState(123);
      state.inventory.wood = 20;
      state.inventory.stone = 20;
      const before = { ...state.inventory };
      expect(craftTool(state, definition.definitionId)).toMatchObject({ ok: true });
      expect(state.tools[0]).toMatchObject({
        definitionId: definition.definitionId,
        durability: definition.maxDurability,
      });
      expect(state.inventory.wood).toBe(before.wood - (definition.craftCost.wood ?? 0));
      expect(state.inventory.stone).toBe(before.stone - (definition.craftCost.stone ?? 0));
    }
  });

  it('uses axe tier stats on trees and pick tier stats on stone', () => {
    const state = createInitialState(123);
    state.inventory.wood = 20;
    state.inventory.stone = 20;
    expect(craftTool(state, 'stone-axe').ok).toBe(true);
    const tree = state.resourceNodes.find((node) => node.kind === 'tree')!;
    state.player.x = tree.x; state.player.y = tree.y;
    gatherNearest(state);
    expect(tree.hp).toBe(tree.maxHp - toolDefinition('stone-axe').damage);

    waitForCooldown(state);
    expect(craftTool(state, 'stone-pick').ok).toBe(true);
    const stone = state.resourceNodes.find((node) => node.kind === 'stone')!;
    state.player.x = stone.x; state.player.y = stone.y;
    gatherNearest(state);
    expect(stone.hp).toBe(stone.maxHp - toolDefinition('stone-pick').damage);
  });

  it('repairs Stone tools using their own material basis', () => {
    const state = createInitialState(123);
    state.inventory.wood = 20; state.inventory.stone = 20;
    expect(craftTool(state, 'stone-sickle').ok).toBe(true);
    const sickle = state.tools[0]!;
    sickle.durability = 0;
    state.inventory.wood = 0; state.inventory.stone = 0;
    expect(repairTool(state, sickle.instanceId).message).toMatch(/Need .* (wood|stone)/);
    state.inventory.wood = 2; state.inventory.stone = 5;
    expect(repairTool(state, sickle.instanceId)).toMatchObject({ ok: true });
    expect(sickle.durability).toBeGreaterThan(0);
  });
});
