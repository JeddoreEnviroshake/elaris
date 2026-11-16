import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import { BLACKSMITH_UPGRADE_COSTS } from '../../src/content/economy';
import { buildableById } from '../../src/content/buildingParts';
import {
  facilityLevel, facilityUpgradeBlockedReason, facilityUpgradeCost, furnaceQueueCapacity, furnaceWorkMs,
  purifierRadiusTiles, storageSlotsForLevel, turretStats, upgradeFacility, workbenchMaxTemperRank,
} from '../../src/simulation/facilityLevels';
import { partUpgradeCost, upgradeBuildingBatch, upgradeBuildingMaterial, upgradeTarget } from '../../src/simulation/partUpgrades';
import { scrapTool, temperTool, temperToolBlockedReason, toolScrapValue, upgradeTool } from '../../src/simulation/economy';
import { structureMaxHp } from '../../src/simulation/gameplayCommands';
import { addStorageResource, storageContainerSlots, usedStorageBoxSlots } from '../../src/simulation/storageBox';
import { enqueueIronSmelt } from '../../src/simulation/processing';
import { airPurifierProtectedCells } from '../../src/simulation/survivalCycle';
import { migrateToCurrent, SaveValidationError } from '../../src/persistence/migrations';
import { SAVE_VERSION } from '../../src/persistence/types';
import { CONTENT_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { createInitialState, type BuildingState, type GameState, type ToolInstance } from '../../src/simulation/state';
import { enclosedEnvironment } from './helpers/buildings';

function save(state: GameState) {
  return { meta: { saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION, worldGenVersion: WORLD_GEN_VERSION, appVersion: 'test', savedAt: 1 }, state: structuredClone(state) };
}

/** A usable Workbench in a closed indoor room, with the player beside it. */
function atOwnWorkbench(level?: number): { state: GameState; bench: BuildingState } {
  const state = createInitialState(12);
  state.buildings = enclosedEnvironment(10, 10, 3, 3, 'indoor');
  const bench: BuildingState = { id: 'workbench-test', definitionId: 'workbench', tileX: 10, tileY: 11, ...(level ? { level } : {}) };
  state.buildings.push(bench);
  state.player.x = 11 * TILE_SIZE;
  state.player.y = 11.5 * TILE_SIZE;
  return { state, bench };
}

function tool(state: GameState, definitionId: ToolInstance['definitionId'] = 'stone-pick'): ToolInstance {
  const instance: ToolInstance = { instanceId: `tool-${state.tools.length}`, definitionId, durability: 100, maxDurability: 100, powerRank: 0, speedRank: 0, durabilityRank: 0 };
  state.tools.push(instance);
  return instance;
}

describe('facility level effects', () => {
  it('reads an absent or odd level as level 1', () => {
    expect(facilityLevel({})).toBe(1);
    expect(facilityLevel({ level: 7 })).toBe(3);
    expect(facilityLevel({ level: 1.5 })).toBe(1);
  });

  it('grows storage, furnace, purifier, turret, bench and HP exactly as tabled', () => {
    expect([1, 2, 3].map((level) => storageSlotsForLevel({ definitionId: 'field-cache', level }))).toEqual([6, 9, 12]);
    expect([1, 2, 3].map((level) => storageSlotsForLevel({ definitionId: 'warehouse', level }))).toEqual([24, 32, 40]);
    expect([1, 2, 3].map((level) => furnaceQueueCapacity({ level }))).toEqual([4, 6, 8]);
    expect([1, 2, 3].map((level) => furnaceWorkMs({ level }, 5_000))).toEqual([5_000, 3_750, 2_500]);
    expect([1, 2, 3].map((level) => purifierRadiusTiles({ level }))).toEqual([1, 2, 3]);
    expect([1, 2, 3].map((level) => workbenchMaxTemperRank({ level }))).toEqual([1, 3, 4]);
    const defense = { turretDamage: 9, turretRangeTiles: 6, turretCooldownTicks: 30 };
    expect(turretStats({}, defense)).toEqual({ damage: 9, rangeTiles: 6, cooldownTicks: 30 });
    expect(turretStats({ level: 2 }, defense)).toEqual({ damage: 13, rangeTiles: 6, cooldownTicks: 30 });
    expect(turretStats({ level: 3 }, defense)).toEqual({ damage: 13, rangeTiles: 8, cooldownTicks: 22 });
    const base = structureMaxHp({ id: 'w', definitionId: 'workbench', tileX: 0, tileY: 0 })!;
    expect(structureMaxHp({ id: 'w', definitionId: 'workbench', tileX: 0, tileY: 0, level: 3 })).toBe(base * 2);
  });

  it('widens an outdoor purifier with its level', () => {
    const at = (level?: number) => airPurifierProtectedCells([{ id: 'p', definitionId: 'air-purifier', tileX: 40, tileY: 40, ...(level ? { level } : {}) }]).size;
    expect([at(), at(2), at(3)]).toEqual([9, 25, 49]);
  });

  it('queues more and smelts faster at a levelled furnace', () => {
    const { state } = atOwnWorkbench();
    const furnace: BuildingState = { id: 'furnace-test', definitionId: 'furnace', tileX: 11, tileY: 10, level: 2, furnace: { queue: [] } };
    state.buildings.push(furnace);
    state.inventory['iron-ore'] = 40; state.inventory.wood = 40;
    const result = enqueueIronSmelt(state, furnace.id, 6);
    expect(result).toMatchObject({ ok: true });
    expect(furnace.furnace!.queue).toHaveLength(6);
    expect(furnace.furnace!.queue[0]!.remainingWorkMs).toBe(3_750);
  });
});

describe('upgrading a facility', () => {
  it('charges exactly the tabled cost, raises the level and restores full health', () => {
    const { state, bench } = atOwnWorkbench();
    bench.hp = 10;
    state.inventory['scrap-iron'] = 20; state.inventory.clockwork = 5;
    expect(facilityUpgradeCost(bench)).toEqual({ 'scrap-iron': 12, clockwork: 4 });
    expect(upgradeFacility(state, bench.id).ok).toBe(true);
    expect(state.inventory['scrap-iron']).toBe(8);
    expect(state.inventory.clockwork).toBe(1);
    expect(bench.level).toBe(2);
    expect(bench.hp).toBeUndefined();
  });

  it('refuses when short, out of range, at the top, or for a part without levels', () => {
    const { state, bench } = atOwnWorkbench();
    expect(facilityUpgradeBlockedReason(state, bench)).toBe('Need 12 more Scrap Iron');
    state.inventory['scrap-iron'] = 99; state.inventory.clockwork = 99;
    state.player.x = 120 * TILE_SIZE;
    expect(facilityUpgradeBlockedReason(state, bench)).toBe('Too far away');
    bench.level = 3;
    expect(facilityUpgradeBlockedReason(state, bench)).toBe('Already at the highest level');
    const wall = state.buildings.find((building) => building.definitionId.endsWith('-wall'))!;
    expect(facilityUpgradeBlockedReason(state, wall)).toMatch(/has no levels/);
  });

  it('never loses what an upgraded Storage Box holds, and the save keeps it', () => {
    const { state } = atOwnWorkbench();
    const box: BuildingState = { id: 'box-test', definitionId: 'field-cache', tileX: 11, tileY: 12 };
    state.buildings.push(box);
    state.inventory['scrap-iron'] = 6;
    for (let stack = 0; stack < 6; stack += 1) expect(addStorageResource(box, 'stone', 99)).toBe(true);
    expect(addStorageResource(box, 'stone', 1)).toBe(false);
    expect(upgradeFacility(state, box.id).ok).toBe(true);
    expect(storageContainerSlots(box)).toBe(9);
    for (let stack = 0; stack < 3; stack += 1) expect(addStorageResource(box, 'stone', 99)).toBe(true);
    expect(usedStorageBoxSlots(box)).toBe(9);
    expect(box.storage!.stone).toBe(891);
    const loaded = migrateToCurrent(save(state)).save.state.buildings.find((building) => building.id === box.id)!;
    expect(loaded.storage!.stone).toBe(891);
    expect(loaded.level).toBe(2);
  });

  it('rejects an impossible level in a save', () => {
    const { state, bench } = atOwnWorkbench();
    bench.level = 4;
    expect(() => migrateToCurrent(save(state))).toThrow(SaveValidationError);
    bench.level = 2;
    const wall = state.buildings.find((building) => building.definitionId.endsWith('-wall'))!;
    wall.level = 2;
    expect(() => migrateToCurrent(save(state))).toThrow(SaveValidationError);
  });
});

describe('upgrading building parts in place', () => {
  it('climbs the material ladder within the same kind of part', () => {
    expect(upgradeTarget(buildableById('thatch-wall'))?.id).toBe('wood-wall');
    expect(upgradeTarget(buildableById('wood-door'))?.id).toBe('stone-door');
    expect(upgradeTarget(buildableById('stone-floor'))?.id).toBe('metal-floor');
    expect(upgradeTarget(buildableById('thatch-gate'))?.id).toBe('wood-gate');
    expect(upgradeTarget(buildableById('metal-wall'))).toBeNull();
    expect(upgradeTarget(buildableById('workbench'))).toBeNull();
  });

  it('costs the new part less the old part\'s demolition refund, floored at zero', () => {
    expect(partUpgradeCost(buildableById('thatch-wall'))).toEqual({ wood: 1 });
    expect(partUpgradeCost(buildableById('wood-wall'))).toEqual({ stone: 3 });
    expect(partUpgradeCost(buildableById('stone-wall'))).toEqual({ 'iron-ingot': 3 });
    // Same resource both sides: 4 stone less a 2 stone refund.
    expect(partUpgradeCost(buildableById('stone-door'))).toEqual({ 'iron-ingot': 4 });
  });

  it('keeps id, tile and edge, needs the blueprint, and refuses without paying', () => {
    const { state } = atOwnWorkbench();
    const wall = state.buildings.find((building) => building.definitionId.endsWith('-wall'))!;
    const { id, tileX, tileY, boundaryEdge } = wall;
    wall.definitionId = 'thatch-wall';
    state.unlockedItemIds = state.unlockedItemIds.filter((known) => known !== 'wood-wall');
    state.inventory.wood = 5;
    expect(upgradeBuildingMaterial(state, id).message).toBe('Learn the Wood Wall blueprint first');
    expect(state.inventory.wood).toBe(5);
    state.unlockedItemIds.push('wood-wall');
    wall.hp = 1;
    expect(upgradeBuildingMaterial(state, id).ok).toBe(true);
    expect(wall).toMatchObject({ id, tileX, tileY, boundaryEdge, definitionId: 'wood-wall' });
    expect(wall.hp).toBeUndefined();
    expect(state.inventory.wood).toBe(4);
  });

  it('upgrades a whole group or nothing at all', () => {
    const { state } = atOwnWorkbench();
    const walls = state.buildings.filter((building) => buildableById(building.definitionId).boundaryClass === 'wall');
    for (const wall of walls) wall.definitionId = 'thatch-wall';
    state.unlockedItemIds = [...new Set([...state.unlockedItemIds, 'wood-wall', 'stone-wall'])];
    state.inventory.wood = walls.length - 1;
    expect(upgradeBuildingBatch(state, walls.map((wall) => wall.id)).ok).toBe(false);
    expect(walls.every((wall) => wall.definitionId === 'thatch-wall')).toBe(true);
    expect(state.inventory.wood).toBe(walls.length - 1);
    // One part that cannot climb spoils the batch too.
    state.inventory.wood = 99;
    walls[0]!.definitionId = 'metal-wall';
    expect(upgradeBuildingBatch(state, walls.map((wall) => wall.id)).ok).toBe(false);
    expect(state.inventory.wood).toBe(99);
    walls[0]!.definitionId = 'thatch-wall';
    expect(upgradeBuildingBatch(state, walls.map((wall) => wall.id)).ok).toBe(true);
    expect(walls.every((wall) => wall.definitionId === 'wood-wall')).toBe(true);
    expect(state.inventory.wood).toBe(99 - walls.length);
  });
});

describe('tempering tools at your own bench', () => {
  it('lets a level 1 bench temper to rank 1, level 2 to rank 3 and level 3 to rank 4', () => {
    const { state, bench } = atOwnWorkbench();
    const pick = tool(state);
    Object.assign(state.inventory, { 'scrap-iron': 99, clockwork: 99, lens: 99, 'construct-core': 9, 'ancient-alloy': 9 });
    expect(temperTool(state, pick.instanceId, 'power').ok).toBe(true);
    expect(temperToolBlockedReason(state, pick.instanceId, 'power')).toBe('Rank 2 needs a level 2 Workbench');
    bench.level = 2;
    expect(temperTool(state, pick.instanceId, 'power').ok).toBe(true);
    expect(temperTool(state, pick.instanceId, 'power').ok).toBe(true);
    expect(temperToolBlockedReason(state, pick.instanceId, 'power')).toBe('Rank 4 needs a level 3 Workbench');
    bench.level = 3;
    expect(temperTool(state, pick.instanceId, 'power').ok).toBe(true);
    expect(pick.powerRank).toBe(4);
    expect(temperToolBlockedReason(state, pick.instanceId, 'power')).toBe('power is already rank 4');
    // 4 + (8 scrap, 2 clockwork) + (6 clockwork, 2 lens) + (1 core, 1 alloy).
    expect(state.inventory['scrap-iron']).toBe(99 - 12);
    expect(state.inventory.clockwork).toBe(99 - 8);
    expect(state.inventory.lens).toBe(97);
    expect(state.inventory['construct-core']).toBe(8);
  });

  it('needs your own bench and the salvage, and leaves Mara\'s coin path alone', () => {
    const { state } = atOwnWorkbench();
    const pick = tool(state);
    expect(temperToolBlockedReason(state, pick.instanceId, 'speed')).toBe('Need 4 more Scrap Iron');
    state.player.x = 120 * TILE_SIZE;
    state.inventory['scrap-iron'] = 4;
    expect(temperToolBlockedReason(state, pick.instanceId, 'speed')).toBe('Stand at your own Workbench');
    state.coins = BLACKSMITH_UPGRADE_COSTS[0];
    state.highestRatingEverTenths = 1_000_000;
    expect(upgradeTool(state, pick.instanceId, 'speed').ok).toBe(true);
    expect(state.coins).toBe(0);
    expect(state.inventory['scrap-iron']).toBe(4);
  });

  it('scraps a tool for scrap iron scaled by its wear, and refuses wooden tools', () => {
    const { state } = atOwnWorkbench();
    const stone = tool(state, 'stone-pick');
    const iron = tool(state, 'iron-axe');
    iron.durability = 50;
    const wooden = tool(state, 'wooden-axe');
    expect(toolScrapValue(stone)).toBe(1);
    expect(toolScrapValue(iron)).toBe(1);
    expect(toolScrapValue(wooden)).toBeNull();
    expect(toolScrapValue({ ...iron, definitionId: 'masterwork-sword', durability: 100 })).toBe(6);
    expect(scrapTool(state, wooden.instanceId).message).toBe('Wooden tools cannot be scrapped');
    expect(scrapTool(state, stone.instanceId).ok).toBe(true);
    expect(state.tools.some((candidate) => candidate.instanceId === stone.instanceId)).toBe(false);
    expect(state.inventory['scrap-iron']).toBe(1);
  });
});

describe('the v90 -> v91 migration', () => {
  it('upgrades a v90 save without touching its buildings', () => {
    const { state } = atOwnWorkbench();
    const raw = save(state);
    raw.meta.saveVersion = 90; raw.meta.contentVersion = 68;
    const { save: migrated, migrated: changed } = migrateToCurrent(raw);
    expect(changed).toBe(true);
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_VERSION, contentVersion: CONTENT_VERSION });
    expect(migrated.state.buildings).toEqual(state.buildings);
  });
});

describe('upgrading a whole room', () => {
  it('finds every wall and door around the enclosure the lit part belongs to', async () => {
    const { roomUpgradeIds } = await import('../../src/simulation/partUpgrades');
    const { state } = atOwnWorkbench();
    const boundaries = state.buildings.filter((building) => {
      const def = buildableById(building.definitionId);
      return def.boundaryClass === 'wall' || def.boundaryClass === 'door';
    });
    const ids = roomUpgradeIds(state, boundaries[0]!);
    expect(ids.length).toBe(boundaries.length);
    expect(new Set(ids)).toEqual(new Set(boundaries.map((building) => building.id)));
    // A floor is not a wall or door, so it names no room.
    const floor = state.buildings.find((building) => buildableById(building.definitionId).layer === 'surface')!;
    expect(roomUpgradeIds(state, floor)).toEqual([]);
  });
});
