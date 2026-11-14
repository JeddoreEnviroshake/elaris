import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS, WOODEN_PICK, toolDefinition } from '../../src/config/balance';
import {
  advanceGroundDropExpiry,
  collectNearestGroundDrop,
  advanceTuftleWork,
  advanceResourceRenewal,
  assignTuftle,
  craftWoodenPick,
  craftTool,
  depositResourceStackInFieldCache,
  depositToolInFieldCache,
  dropResourceStack,
  dropTool,
  equipBareHands,
  equipTool,
  expireToolDrops,
  TOOL_DROP_TTL_TICKS,
  gatherNearest,
  repairTool,
  selectCompanionAbility,
  setBattleCompanion,
  setCreatureRole,
  splitResourceStack,
  usedInventorySlots,
  withdrawFromFieldCache,
  withdrawResourceStackFromFieldCache,
  withdrawToolFromFieldCache,
} from '../../src/simulation/gameplayCommands';
import { createInitialState, type BuildingState } from '../../src/simulation/state';
import { starterGroveAnchor } from '../../src/simulation/worldGeneration';
import { enclosedEnvironment } from './helpers/buildings';

/** Clear the starting berries and arrows so slot counts are purely the test's. */
function emptyStartingSupplies(state: ReturnType<typeof createInitialState>): void {
  Object.assign(state.inventory, { 'taming-snare': 0, berry: 0, arrow: 0, 'cloth-mask': 0 });
  Object.assign(state.inventoryStacks, { 'taming-snare': [], berry: [], arrow: [], 'cloth-mask': [] });
}

function waitForCooldown(state: ReturnType<typeof createInitialState>): void {
  state.tick = state.actionCooldownUntilTick;
}

/** Floors a workbench near the player and stands them on it, satisfying the
 *  workbench requirement Stone/Iron recipes now share. Returns the stand point. */
function placeWorkbench(state: ReturnType<typeof createInitialState>): { x: number; y: number } {
  state.buildings = [
    ...state.buildings,
    ...enclosedEnvironment(10, 10, 3, 3, 'indoor'),
    { id: 'workbench-test', definitionId: 'workbench', tileX: 10, tileY: 11 } satisfies BuildingState,
  ];
  const point = { x: 11 * 16, y: 11.5 * 16 };
  state.player.x = point.x;
  state.player.y = point.y;
  return point;
}

function unlockStoneCrafting(state: ReturnType<typeof createInitialState>): { x: number; y: number } {
  state.unlockedItemIds.push(
    'wooden-axe', 'wooden-pick', 'wooden-sickle', 'wooden-sword',
    'stone-axe', 'stone-pick', 'stone-sickle', 'stone-sword', 'bow',
  );
  return placeWorkbench(state);
}

/**
 * Stand on a chosen node so `gatherNearest` can only pick that one. Nothing
 * generates inside the Elaris walls now, so the spawn point is bare ground and
 * these tests walk to the starter grove outside the west gate — where scattered
 * neighbours mean proximity alone no longer names the node the test meant.
 */
function starterNodes(
  state: ReturnType<typeof createInitialState>,
  kind: 'tree' | 'stone' | 'plant',
): { x: number; y: number }[] {
  const grove = starterGroveAnchor(state.seed);
  return state.resourceNodes
    .filter((node) => node.kind === kind
      && Math.hypot(node.x - grove.x, node.y - grove.y) <= 96)
    .map((node) => ({ x: node.x, y: node.y }));
}

function standOn(
  state: ReturnType<typeof createInitialState>,
  node: { x: number; y: number } | undefined,
): void {
  expect(node).toBeDefined();
  state.player.x = node!.x;
  state.player.y = node!.y;
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

    const [firstTree, secondTree] = starterNodes(state, 'tree');
    standOn(state, firstTree);
    depleteNearest(state);
    waitForCooldown(state);
    standOn(state, secondTree);
    depleteNearest(state);
    expect(state.inventory.wood).toBe(8);
    state.unlockedItemIds.push('wooden-pick');

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
    expect(state.tools[0]?.durability).toBe(WOODEN_PICK.maxDurability - 8);
  });

  it('rejects stone gathering without a pick and consumes nothing', () => {
    const state = createInitialState(123);
    const stone = state.resourceNodes.find((node) => node.kind === 'stone')!;
    state.player.x = stone.x;
    state.player.y = stone.y;

    const result = gatherNearest(state);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/needs a pick/);
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
    state.unlockedItemIds.push('wooden-sickle');
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

  it('requires operational housing before a Tuftle can be assigned work', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push({ id: 'creature-1', speciesId: 'tuftle', name: 'Tuftle', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'tuftle-guard' });
    expect(assignTuftle(state, 'creature-1', 'fiber')).toMatchObject({
      ok: false, message: 'Build an operational Small Pen or Barn with a free housing slot',
    });
  });

  it('withdraws from the selected Storage Box (small)', () => {
    const state = createInitialState(123);
    state.buildings.push(
      {
        id: 'cache-first', definitionId: 'field-cache', tileX: 1, tileY: 1,
        storage: { wood: 9, stone: 0, fiber: 0 },
      },
      {
        id: 'cache-selected', definitionId: 'field-cache', tileX: 2, tileY: 2,
        storage: { wood: 3, stone: 0, fiber: 0 },
      },
    );

    expect(withdrawFromFieldCache(state, 'wood', 'cache-selected')).toMatchObject({
      ok: true,
      message: 'Collected 3 wood from Storage Box (small)',
    });
    expect(state.inventory.wood).toBe(3);
    expect(state.buildings[0]!.storage!.wood).toBe(9);
    expect(state.buildings[1]!.storage!.wood).toBe(0);
  });

  it('transfers individual stacks both ways and enforces six storage spaces', () => {
    const state = createInitialState(123);
    const box: BuildingState = {
      id: 'cache-1', definitionId: 'field-cache' as const, tileX: 1, tileY: 1,
      storage: { wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 },
      storageStacks: { wood: [], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [] },
      storedTools: [],
    };
    state.buildings.push(box);
    state.inventory.wood = 9;
    state.inventoryStacks.wood = [4, 5];

    expect(depositResourceStackInFieldCache(state, 'wood', 0, box.id)).toMatchObject({ ok: true });
    expect(state.inventoryStacks.wood).toEqual([5]);
    expect(box.storageStacks!.wood).toEqual([4]);
    expect(withdrawResourceStackFromFieldCache(state, 'wood', 0, box.id)).toMatchObject({ ok: true });
    expect(state.inventory.wood).toBe(9);
    expect(box.storage!.wood).toBe(0);

    box.storage!.wood = 6;
    box.storageStacks!.wood = [1, 1, 1, 1, 1, 1];
    state.inventory.stone = 1;
    state.inventoryStacks.stone = [1];
    expect(depositResourceStackInFieldCache(state, 'stone', 0, box.id)).toEqual({
      ok: false, message: 'Storage Box (small) is full',
    });
    expect(state.inventory.stone).toBe(1);
  });

  it('stores tools as one space and returns them to the Bag', () => {
    const state = createInitialState(123);
    const box: BuildingState = {
      id: 'cache-1', definitionId: 'field-cache' as const, tileX: 1, tileY: 1,
      storage: { wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 },
      storageStacks: { wood: [], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [] },
      storedTools: [],
    };
    state.buildings.push(box);
    state.inventory.wood = 5;
    state.unlockedItemIds.push('wooden-pick');
    craftTool(state, 'wooden-pick');
    const toolId = state.tools[0]!.instanceId;

    expect(depositToolInFieldCache(state, toolId, box.id)).toMatchObject({ ok: true });
    expect(state.tools).toHaveLength(0);
    expect(state.equippedToolId).toBeNull();
    expect(box.storedTools).toHaveLength(1);
    expect(withdrawToolFromFieldCache(state, toolId, box.id)).toMatchObject({ ok: true });
    expect(state.tools[0]?.instanceId).toBe(toolId);
  });

  it('never changes wild or owned creatures through the normal gather action', () => {
    const state = createInitialState(123);
    const wildBefore = structuredClone(state.wildCreatures);
    state.ownedCreatures.push({ id: 'creature-owned', speciesId: 'tuftle', name: 'Tuftle', role: 'follow', assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'tuftle-guard' });
    const ownedBefore = structuredClone(state.ownedCreatures);
    gatherNearest(state);
    expect(state.wildCreatures).toEqual(wildBefore);
    expect(state.ownedCreatures).toEqual(ownedBefore);
  });

  it('keeps the fourth follower at rest until an active follower is replaced', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push(
      { id: 'creature-1', speciesId: 'tuftle', name: 'One', role: 'follow', assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'tuftle-guard' },
      { id: 'creature-2', speciesId: 'craghopper', name: 'Two', role: 'follow', assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'craghopper-guard' },
      { id: 'creature-3', speciesId: 'glade-stag', name: 'Three', role: 'follow', assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'glade-stag-forward' },
      { id: 'creature-4', speciesId: 'snarlfox', name: 'Four', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'snarlfox-flank' },
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
    state.ownedCreatures.push({ id: 'creature-1', speciesId: 'glade-stag', name: 'Fern', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'glade-stag-forward' });
    expect(setCreatureRole(state, 'creature-1', 'work')).toMatchObject({
      ok: false,
      message: 'Build an operational Small Pen or Barn with a free housing slot',
    });
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'rest', assignment: null, worksiteId: null });
  });

  it('mounts a Glade Stag when it is assigned to follow', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push({ id: 'creature-1', speciesId: 'glade-stag', name: 'Fern', role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'glade-stag-forward' });
    expect(setCreatureRole(state, 'creature-1', 'follow')).toMatchObject({
      ok: true,
      message: 'Fern mounted · 1.7× travel speed',
    });
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'follow', assignment: null, worksiteId: null });
  });

  it('selects one following Battle Companion and changes unlocked abilities without RNG', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push({
      id: 'creature-1', speciesId: 'tuftle', name: 'Moss', role: 'rest', assignment: null,
      worksiteId: null, nextWorkTick: 0, bondXp: 3, selectedBattleAbilityId: 'tuftle-guard',
    });
    const rng = state.rngState;
    expect(setBattleCompanion(state, 'creature-1')).toMatchObject({ ok: false });
    setCreatureRole(state, 'creature-1', 'follow');
    expect(setBattleCompanion(state, 'creature-1')).toMatchObject({ ok: true });
    expect(selectCompanionAbility(state, 'tuftle-heal')).toMatchObject({ ok: true });
    expect(state.battleCompanionId).toBe('creature-1');
    expect(state.ownedCreatures[0]!.selectedBattleAbilityId).toBe('tuftle-heal');
    expect(state.rngState).toBe(rng);
    setCreatureRole(state, 'creature-1', 'rest');
    expect(state.battleCompanionId).toBeNull();
  });

  it('moves a worker safely to rest when its assigned housing disappears', () => {
    const state = createInitialState(123);
    state.ownedCreatures.push({ id: 'creature-1', speciesId: 'tuftle', name: 'Tuftle', role: 'work', assignment: 'fiber', worksiteId: 'missing', housingId: 'missing', workRemainderMs: 0, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'tuftle-guard' });
    expect(advanceTuftleWork(state)).toBe(true);
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'rest', assignment: null, worksiteId: null, housingId: null });
  });

  it('does not consume wood when crafting requirements are not met', () => {
    const state = createInitialState(123);
    const result = craftWoodenPick(state);
    expect(result.ok).toBe(false);
    expect(state.inventory.wood).toBe(0);
    expect(state.tools).toHaveLength(0);
  });

  it('keeps a broken pick, repairs it to full for half its craft cost, then equips it explicitly', () => {
    const state = createInitialState(123);
    state.inventory.wood = 5;
    state.unlockedItemIds.push('wooden-pick');
    expect(craftWoodenPick(state).ok).toBe(true);
    const pick = state.tools[0]!;
    pick.durability = 0;
    state.equippedToolId = null;
    state.inventory.wood = 0;

    expect(repairTool(state, pick.instanceId)).toMatchObject({ ok: false, message: 'Need 3 more wood' });
    state.inventory.wood = 3;
    expect(repairTool(state, pick.instanceId)).toMatchObject({ ok: true });
    expect(state.repairsMade).toBe(1);
    expect(pick.durability).toBe(pick.maxDurability);
    expect(state.inventory.wood).toBe(0);
    expect(equipTool(state, pick.instanceId)).toMatchObject({ ok: true });
    expect(state.equippedToolId).toBe(pick.instanceId);
  });

  it('drops the equipped tool whole, unequips it, and picks the same instance back up', () => {
    const state = createInitialState(123);
    state.inventory.wood = 5;
    state.unlockedItemIds.push('wooden-pick');
    expect(craftWoodenPick(state).ok).toBe(true);
    const pick = state.tools[0]!;
    pick.durability = 7;
    pick.powerRank = 2;

    expect(dropTool(state, pick.instanceId)).toMatchObject({ ok: true, message: 'Dropped Wooden Pick' });
    expect(state.tools).toHaveLength(0);
    expect(state.equippedToolId).toBeNull();
    expect(state.toolDrops).toHaveLength(1);
    expect(state.toolDrops[0]).toMatchObject({ x: state.player.x, y: state.player.y });

    // The pickup is the same tool, not a fresh one: wear and ranks survive.
    expect(collectNearestGroundDrop(state)).toMatchObject({ ok: true, message: 'Picked up Wooden Pick' });
    expect(state.toolDrops).toHaveLength(0);
    expect(state.tools[0]).toMatchObject({ instanceId: pick.instanceId, durability: 7, powerRank: 2 });
    // Picking it up is not equipping it; the loadout stays where the player left it.
    expect(state.equippedToolId).toBeNull();
  });

  it('leaves a dropped tool no room in a full bag, then loses it to the ten-minute expiry', () => {
    const state = createInitialState(123);
    state.inventory.wood = 5;
    state.unlockedItemIds.push('wooden-pick');
    expect(craftWoodenPick(state).ok).toBe(true);
    const pick = state.tools[0]!;
    expect(dropTool(state, pick.instanceId).ok).toBe(true);

    emptyStartingSupplies(state);
    state.inventory.wood = 99 * 20;
    expect(usedInventorySlots(state)).toBe(20);
    expect(collectNearestGroundDrop(state)).toMatchObject({ ok: false, message: 'Bag is full' });
    expect(state.toolDrops).toHaveLength(1);

    state.tick += TOOL_DROP_TTL_TICKS;
    expect(expireToolDrops(state)).toBe(true);
    expect(state.toolDrops).toHaveLength(0);
  });

  it('switches from an equipped tool to bare hands', () => {
    const state = createInitialState(123);
    state.inventory.wood = 5;
    state.unlockedItemIds.push('wooden-pick');
    expect(craftWoodenPick(state).ok).toBe(true);

    expect(equipBareHands(state)).toEqual({ ok: true, message: 'Switched to bare hands' });
    expect(state.equippedToolId).toBeNull();
  });

  it('keeps a depleted yield on the ground when every inventory slot is occupied', () => {
    const state = createInitialState(123);
    standOn(state, starterNodes(state, 'tree')[0]);
    emptyStartingSupplies(state);
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
    emptyStartingSupplies(state);
    state.inventory.wood = 99 * 20;
    state.unlockedItemIds.push('wooden-pick');
    expect(craftWoodenPick(state)).toMatchObject({ ok: false, message: 'Inventory full' });
    expect(state.inventory.wood).toBe(99 * 20);
    expect(state.tools).toHaveLength(0);
  });

  it('uses a resource stack freed by crafting before rejecting a full inventory', () => {
    const state = createInitialState(123);
    emptyStartingSupplies(state);
    state.inventory.wood = WOODEN_PICK.woodCost;
    state.inventory.stone = 99 * 19;
    state.unlockedItemIds.push('wooden-pick');

    expect(craftWoodenPick(state)).toMatchObject({ ok: true });
    expect(state.inventory.wood).toBe(0);
    expect(state.tools).toHaveLength(1);
    expect(usedInventorySlots(state)).toBe(20);
  });

  it('atomically crafts every Wooden and Stone tool definition', () => {
    for (const definition of TOOL_DEFINITIONS.filter((candidate) => candidate.tier !== 'iron')) {
      const state = createInitialState(123);
      state.inventory.wood = 20;
      state.inventory.stone = 20;
      state.inventory.fiber = 20;
      unlockStoneCrafting(state);
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
    const workbench = unlockStoneCrafting(state);
    expect(craftTool(state, 'stone-axe').ok).toBe(true);
    const tree = state.resourceNodes.find((node) => node.kind === 'tree')!;
    state.player.x = tree.x; state.player.y = tree.y;
    gatherNearest(state);
    expect(tree.hp).toBe(tree.maxHp - toolDefinition('stone-axe').damage);

    waitForCooldown(state);
    // Return to the workbench to craft the next tier-gated Stone tool.
    state.player.x = workbench.x; state.player.y = workbench.y;
    expect(craftTool(state, 'stone-pick').ok).toBe(true);
    const stone = state.resourceNodes.find((node) => node.kind === 'stone')!;
    state.player.x = stone.x; state.player.y = stone.y;
    gatherNearest(state);
    expect(stone.hp).toBe(stone.maxHp - toolDefinition('stone-pick').damage);
  });

  it('repairs Stone tools using their own material basis', () => {
    const state = createInitialState(123);
    state.inventory.wood = 20; state.inventory.stone = 20;
    unlockStoneCrafting(state);
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

describe('Bag stack actions', () => {
  it('splits a selected stack into two occupied Bag slots', () => {
    const state = createInitialState(7);
    emptyStartingSupplies(state);
    state.inventory.wood = 9;

    expect(splitResourceStack(state, 'wood', 0, 4)).toEqual({
      ok: true, message: 'Split 4 wood into a new stack',
    });
    expect(state.inventory.wood).toBe(9);
    expect(state.inventoryStacks.wood).toEqual([4, 5]);
    expect(usedInventorySlots(state)).toBe(2);
  });

  it('requires an empty slot to split', () => {
    const state = createInitialState(7);
    emptyStartingSupplies(state);
    state.inventory.wood = 99 * 20;

    expect(splitResourceStack(state, 'wood', 0, 40)).toMatchObject({ ok: false });
    expect(state.inventory.wood).toBe(99 * 20);
    expect(usedInventorySlots(state)).toBe(20);
  });

  it('drops the full selected stack at the player and expires it after five minutes', () => {
    const state = createInitialState(7);
    state.tick = 25;
    state.inventory.wood = 9;
    splitResourceStack(state, 'wood', 0, 4);

    expect(dropResourceStack(state, 'wood', 0)).toEqual({ ok: true, message: 'Dropped 4 wood' });
    expect(state.inventory.wood).toBe(5);
    expect(state.inventoryStacks.wood).toEqual([5]);
    expect(state.groundDrops[0]).toMatchObject({
      resource: 'wood', amount: 4, x: state.player.x, y: state.player.y,
      expiresAtTick: 25 + 5 * 60 * 60,
    });

    state.tick = 25 + 5 * 60 * 60 - 1;
    expect(advanceGroundDropExpiry(state)).toBe(false);
    state.tick += 1;
    expect(advanceGroundDropExpiry(state)).toBe(true);
    expect(state.groundDrops).toEqual([]);
  });
});
