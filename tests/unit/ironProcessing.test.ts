import { describe, expect, it } from 'vitest';
import {
  IRON_SMELT_WORK_MS,
  OFFLINE_CAP_MS,
  RESOURCE_BALANCE,
  toolDefinition,
} from '../../src/config/balance';
import { effectiveToolActionTicks, effectiveToolDamage } from '../../src/simulation/economy';
import { craftTool, gatherNearest, nearestUsableFacility, repairTool, toolUnlockReason } from '../../src/simulation/gameplayCommands';
import { ELARIS_LAST_SAFE_LEVEL } from '../../src/simulation/elarisFall';
import { settleOfflineTime } from '../../src/simulation/offline';
import {
  advanceFurnaces,
  collectFurnaceOutput,
  createFurnaceState,
  enqueueIronSmelt,
} from '../../src/simulation/processing';
import { generateAreaResourceNodes } from '../../src/simulation/worldGeneration';
import { createInitialState, type BuildingState, type GameState, type ToolDefinitionId } from '../../src/simulation/state';
import { enclosedEnvironment } from './helpers/buildings';

function workingStations(state: GameState): { furnace: BuildingState; workbench: BuildingState } {
  state.buildings = enclosedEnvironment(10, 10, 3, 3, 'indoor');
  const furnace: BuildingState = {
    id: 'furnace-test', definitionId: 'furnace', tileX: 10, tileY: 10,
    furnace: createFurnaceState(),
  };
  const workbench: BuildingState = {
    id: 'workbench-test', definitionId: 'workbench', tileX: 10, tileY: 11,
  };
  state.buildings.push(furnace, workbench);
  state.player.x = 11 * 16;
  state.player.y = 11.5 * 16;
  return { furnace, workbench };
}

function equipCrafted(state: GameState, definitionId: ToolDefinitionId): void {
  const definition = toolDefinition(definitionId);
  state.tools.push({
    instanceId: `test-${definitionId}`, definitionId,
    durability: definition.maxDurability, maxDurability: definition.maxDurability,
    powerRank: 0, speedRank: 0, durabilityRank: 0,
  });
  state.equippedToolId = `test-${definitionId}`;
}

describe('iron ore and Furnace processing', () => {
  it('progresses in queue order and blocks without losing work when output is full', () => {
    const state = createInitialState(101);
    const { furnace } = workingStations(state);
    state.inventory['iron-ore'] = 4;
    state.inventory.wood = 2;

    expect(enqueueIronSmelt(state, furnace.id, 2)).toMatchObject({ ok: true });
    expect(state.inventory).toMatchObject({ 'iron-ore': 0, wood: 0 });
    expect(furnace.furnace!.queue).toHaveLength(2);
    expect(advanceFurnaces(state, IRON_SMELT_WORK_MS - 1)).toEqual({ progressed: true, completed: 0 });
    expect(furnace.furnace!.queue[0]!.remainingWorkMs).toBe(1);
    expect(advanceFurnaces(state, 1)).toEqual({ progressed: true, completed: 1 });
    expect(furnace.furnace!.queue[1]).toMatchObject({
      remainingWorkMs: IRON_SMELT_WORK_MS, completedOutput: 0, blocked: true,
    });

    const blockedSnapshot = structuredClone(furnace.furnace);
    expect(advanceFurnaces(state, IRON_SMELT_WORK_MS * 10)).toEqual({ progressed: false, completed: 0 });
    expect(furnace.furnace).toEqual(blockedSnapshot);
    expect(collectFurnaceOutput(state, furnace.id)).toMatchObject({ ok: true });
    expect(state.inventory['iron-ingot']).toBe(1);
    expect(advanceFurnaces(state, IRON_SMELT_WORK_MS)).toEqual({ progressed: true, completed: 1 });
  });

  it('validates the whole enqueue transaction before consuming reserved inputs', () => {
    const state = createInitialState(102);
    const { furnace } = workingStations(state);
    state.inventory['iron-ore'] = 1;
    state.inventory.wood = 9;
    const before = structuredClone(state.inventory);
    expect(enqueueIronSmelt(state, furnace.id)).toMatchObject({ ok: false });
    expect(state.inventory).toEqual(before);
    expect(furnace.furnace!.queue).toEqual([]);
  });

  it('decrements remaining work by one capped forward window and ignores a backward clock', () => {
    const state = createInitialState(103);
    const { furnace } = workingStations(state);
    furnace.furnace!.queue.push({
      recipe: 'iron-ingot', remainingWorkMs: OFFLINE_CAP_MS + 1_000,
      reservedInputs: { 'iron-ore': 2, wood: 1 }, completedOutput: 0, blocked: false,
    });
    const summary = settleOfflineTime(state, OFFLINE_CAP_MS * 3);
    expect(summary.appliedMs).toBe(OFFLINE_CAP_MS);
    expect(furnace.furnace!.queue[0]!.remainingWorkMs).toBe(1_000);
    const afterForward = structuredClone(state);
    expect(settleOfflineTime(state, -60_000).appliedMs).toBe(0);
    expect(state).toEqual(afterForward);
  });

  it('rolls an iron vein once on atomic depletion and cannot reroll after reload', () => {
    const state = createInitialState(777);
    state.resourceNodes = generateAreaResourceNodes(55, {
      tree: 0, stone: 0, metal: 1, plant: 0, 'berry-bush': 0,
    });
    const vein = state.resourceNodes[0]!;
    state.player.x = vein.x; state.player.y = vein.y;
    equipCrafted(state, 'stone-pick');
    while (vein.hp > 0) {
      const result = gatherNearest(state);
      expect(result.ok).toBe(true);
      state.tick = state.actionCooldownUntilTick;
    }
    const awarded = state.inventory['iron-ore'];
    expect(awarded).toBeGreaterThanOrEqual(RESOURCE_BALANCE.metal.yieldMin);
    expect(awarded).toBeLessThanOrEqual(RESOURCE_BALANCE.metal.yieldMax);
    const reloaded = structuredClone(state);
    expect(gatherNearest(reloaded).ok).toBe(false);
    expect(reloaded.inventory['iron-ore']).toBe(awarded);
    expect(reloaded.rngState).toBe(state.rngState);
  });
});

describe('Iron tool data-driven progression', () => {
  it('requires point ownership and a nearby floored Workbench, but not iron discovery', () => {
    const state = createInitialState(200);
    const { workbench } = workingStations(state);
    state.unlockedItemIds.push('iron-pick');

    expect(state.resourcesCollected['iron-ore']).toBe(0);
    expect(state.resourcesCollected['iron-ingot']).toBe(0);
    expect(nearestUsableFacility(state)?.id).toBe(workbench.id);
    expect(toolUnlockReason(state, 'iron-pick')).toBeNull();

    state.player.x = 0;
    state.player.y = 0;
    expect(toolUnlockReason(state, 'iron-pick')).toBe('Craft at a workbench');

    state.buildings = state.buildings.filter((building) => !(
      building.definitionId.endsWith('-floor') && building.tileX === 10 && building.tileY === 11
    ));
    // Their own bench is off its floor, but Elaris still keeps a public one, so
    // the answer is "walk to a bench" rather than "build one".
    expect(toolUnlockReason(state, 'iron-pick')).toBe('Craft at a workbench');

    // Past the fall the town's bench is rubble and the player has none usable.
    state.player.level = ELARIS_LAST_SAFE_LEVEL + 1;
    expect(toolUnlockReason(state, 'iron-pick')).toBe('Build a workbench on a floor');
  });

  it('enforces eligibility and reuses effective damage, break-time, wear, and life formulas safely', () => {
    const state = createInitialState(201);
    const { workbench } = workingStations(state);
    expect(workbench.definitionId).toBe('workbench');
    state.inventory.wood = 20;
    state.inventory['iron-ingot'] = 20;
    expect(craftTool(state, 'iron-pick').ok).toBe(false);
    state.unlockedItemIds.push('iron-pick');
    expect(craftTool(state, 'iron-pick')).toMatchObject({ ok: true });
    const tool = state.tools[0]!;
    const definition = toolDefinition('iron-pick');
    expect(effectiveToolDamage(tool)).toBe(definition.damage);
    expect(effectiveToolActionTicks(tool)).toBe(definition.actionTicks);
    const hits = Math.max(1, Math.ceil(RESOURCE_BALANCE.metal.maxHp / effectiveToolDamage(tool)));
    const wearPerNode = hits * RESOURCE_BALANCE.metal.hardness * (definition.wearMultiplierByTarget.metal ?? 0);
    expect(hits * effectiveToolActionTicks(tool)).toBeLessThan(
      Math.ceil(RESOURCE_BALANCE.metal.maxHp / toolDefinition('stone-pick').damage)
        * toolDefinition('stone-pick').actionTicks,
    );
    expect(wearPerNode).toBeGreaterThan(0);
    expect(Math.floor(tool.maxDurability / Math.max(1, wearPerNode))).toBeGreaterThan(0);
  });

  it('supports a complete Wooden to Stone to Iron craft and repair path', () => {
    const state = createInitialState(202);
    workingStations(state);
    state.unlockedItemIds.push('wooden-pick', 'stone-pick', 'iron-pick');
    state.inventory.wood = 40;
    state.inventory.stone = 30;
    state.inventory['iron-ingot'] = 20;
    state.resourcesCollected['iron-ingot'] = 1;

    for (const id of ['wooden-pick', 'stone-pick', 'iron-pick'] as const) {
      expect(craftTool(state, id)).toMatchObject({ ok: true });
      const tool = state.tools.at(-1)!;
      tool.durability = Math.max(0, tool.durability - Math.ceil(tool.maxDurability / 4));
      expect(repairTool(state, tool.instanceId)).toMatchObject({ ok: true });
      expect(tool.durability).toBe(tool.maxDurability);
    }
    expect(state.tools.map((tool) => tool.definitionId)).toEqual([
      'wooden-pick', 'stone-pick', 'iron-pick',
    ]);
  });
});
