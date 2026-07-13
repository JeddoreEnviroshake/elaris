import { describe, expect, it } from 'vitest';
import { migrateToCurrent, SaveValidationError } from '../../src/persistence/migrations';
import { SAVE_VERSION } from '../../src/persistence/types';

function v0Save() {
  return {
    meta: { saveVersion: 0, worldGenVersion: 1, contentVersion: 1, appVersion: 'test', savedAt: 1 },
    // v0 had no rngState
    state: { seed: 42, tick: 3, player: { x: 10, y: 20, facing: 'down' } },
  };
}

describe('migrateToCurrent', () => {
  it('upgrades a v0 save to current and adds rngState from the seed', () => {
    const { save, migrated } = migrateToCurrent(v0Save());
    expect(migrated).toBe(true);
    expect(save.meta.saveVersion).toBe(SAVE_VERSION);
    expect(save.state.rngState).toBe(42);
    expect(save.state.player.facing).toBe('down');
    expect(save.state.resourceNodes.length).toBeGreaterThan(0);
    expect(save.state.inventory).toEqual({ wood: 0, stone: 0, fiber: 0 });
    expect(save.state.groundDrops).toEqual([]);
    expect(save.state.highestAreaTierEver).toBe(0);
    expect(save.state.buildings).toEqual([]);
    expect(save.state.resourcesCollected).toEqual({ wood: 0, stone: 0, fiber: 0 });
  });

  it('adds gameplay state to a v1 save while preserving progress', () => {
    const v1 = {
      meta: { saveVersion: 1, worldGenVersion: 1, contentVersion: 1, appVersion: 'test', savedAt: 1 },
      state: { seed: 42, rngState: 99, tick: 12, player: { x: 50, y: 60, facing: 'left' } },
    };
    const { save, migrated } = migrateToCurrent(v1);
    expect(migrated).toBe(true);
    expect(save.state.player.x).toBe(50);
    expect(save.state.rngState).toBe(99);
    expect(save.state.resourceNodes.length).toBeGreaterThan(0);
  });

  it('leaves an already-current save unmigrated', () => {
    const current = migrateToCurrent(v0Save()).save;
    const again = migrateToCurrent(current);
    expect(again.migrated).toBe(false);
  });

  it('adds an empty ground-drop collection to a v2 save', () => {
    const v2 = migrateToCurrent(v0Save()).save;
    v2.meta.saveVersion = 2;
    delete (v2.state as Partial<typeof v2.state>).groundDrops;
    const { save, migrated } = migrateToCurrent(v2);
    expect(migrated).toBe(true);
    expect(save.state.groundDrops).toEqual([]);
  });

  it('adds sticky area progression to a v3 save', () => {
    const v3 = migrateToCurrent(v0Save()).save;
    v3.meta.saveVersion = 3;
    delete (v3.state as Partial<typeof v3.state>).highestAreaTierEver;
    const { save, migrated } = migrateToCurrent(v3);
    expect(migrated).toBe(true);
    expect(save.state.highestAreaTierEver).toBe(0);
  });

  it('adds an empty persisted building collection to a v4 save', () => {
    const v4 = migrateToCurrent(v0Save()).save;
    v4.meta.saveVersion = 4;
    delete (v4.state as Partial<typeof v4.state>).buildings;
    const { save, migrated } = migrateToCurrent(v4);
    expect(migrated).toBe(true);
    expect(save.state.buildings).toEqual([]);
  });

  it('adds fiber inventory and plant nodes to a v5 save', () => {
    const v5 = migrateToCurrent(v0Save()).save;
    v5.meta.saveVersion = 5;
    delete (v5.state.inventory as Partial<typeof v5.state.inventory>).fiber;
    v5.state.resourceNodes = v5.state.resourceNodes.filter((node) => node.kind !== 'plant');
    const { save, migrated } = migrateToCurrent(v5);
    expect(migrated).toBe(true);
    expect(save.state.inventory.fiber).toBe(0);
    expect(save.state.resourceNodes.some((node) => node.kind === 'plant')).toBe(true);
  });

  it('adds durable quest progress to a v6 save', () => {
    const v6 = migrateToCurrent(v0Save()).save;
    v6.meta.saveVersion = 6;
    delete (v6.state as Partial<typeof v6.state>).resourcesCollected;
    delete (v6.state as Partial<typeof v6.state>).repairsMade;
    v6.state.inventory.wood = 4;
    const { save, migrated } = migrateToCurrent(v6);
    expect(migrated).toBe(true);
    expect(save.state.resourcesCollected).toEqual({ wood: 4, stone: 0, fiber: 0 });
    expect(save.state.repairsMade).toBe(0);
  });

  it('adds the starter Tuftle and an empty owned roster to a v7 save', () => {
    const v7 = migrateToCurrent(v0Save()).save;
    v7.meta.saveVersion = 7;
    delete (v7.state as Partial<typeof v7.state>).wildCreatures;
    delete (v7.state as Partial<typeof v7.state>).ownedCreatures;
    const { save, migrated } = migrateToCurrent(v7);
    expect(migrated).toBe(true);
    expect(save.state.wildCreatures.map((creature) => creature.speciesId)).toEqual([
      'tuftle', 'craghopper', 'glade-stag', 'snarlfox',
    ]);
    expect(save.state.wildCreatures.every((creature) => Number.isFinite(creature.x) && Number.isFinite(creature.y))).toBe(true);
    expect(save.state.ownedCreatures).toEqual([]);
  });

  it('adds Tuftle work state and persistent Field Cache storage to a v8 save', () => {
    const v8 = migrateToCurrent(v0Save()).save;
    v8.meta.saveVersion = 8;
    v8.state.ownedCreatures = [{ id: 'creature-1', speciesId: 'tuftle', name: 'Tuftle' } as never];
    v8.state.buildings = [{ id: 'cache-1', definitionId: 'field-cache', tileX: 1, tileY: 1 }];
    const { save, migrated } = migrateToCurrent(v8);
    expect(migrated).toBe(true);
    expect(save.state.ownedCreatures[0]).toMatchObject({ role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 0 });
    expect(save.state.buildings[0]).toMatchObject({ storage: { wood: 0, stone: 0, fiber: 0 } });
  });

  it('moves legacy v9 Tuftle assignments to safe rest state', () => {
    const v9 = migrateToCurrent(v0Save()).save;
    v9.meta.saveVersion = 9;
    v9.state.ownedCreatures = [{ id: 'creature-1', speciesId: 'tuftle', name: 'Tuftle', role: 'work', assignment: 'fiber', worksiteId: 'old-cache', nextWorkTick: 20 }];
    const { save } = migrateToCurrent(v9);
    expect(save.state.ownedCreatures[0]).toMatchObject({ role: 'rest', assignment: null, worksiteId: null, nextWorkTick: 20 });
  });

  it('adds durable quest records and worker production to a v10 save', () => {
    const v10 = migrateToCurrent(v0Save()).save;
    v10.meta.saveVersion = 10;
    delete (v10.state as Partial<typeof v10.state>).completedQuestIds;
    delete (v10.state as Partial<typeof v10.state>).claimedQuestRewardIds;
    delete (v10.state as Partial<typeof v10.state>).workerResourcesProduced;
    const { save, migrated } = migrateToCurrent(v10);
    expect(migrated).toBe(true);
    expect(save.state.completedQuestIds).toEqual([]);
    expect(save.state.claimedQuestRewardIds).toEqual([]);
    expect(save.state.workerResourcesProduced).toBe(0);
  });

  it('adds renewal deadlines to depleted nodes in a v11 save', () => {
    const v11 = migrateToCurrent(v0Save()).save;
    v11.meta.saveVersion = 11;
    v11.state.tick = 500;
    const depleted = v11.state.resourceNodes[0]!;
    depleted.hp = 0;
    for (const node of v11.state.resourceNodes) delete (node as Partial<typeof node>).respawnAtTick;
    const { save, migrated } = migrateToCurrent(v11);
    expect(migrated).toBe(true);
    expect(save.state.resourceNodes[0]!.respawnAtTick).toBeGreaterThan(500);
    expect(save.state.resourceNodes[1]!.respawnAtTick).toBeNull();
    expect(save.meta).toMatchObject({ saveVersion: SAVE_VERSION, worldGenVersion: 6, contentVersion: 16 });
  });

  it('adds missing species to a v15 world without duplicating represented species', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 15;
    current.meta.worldGenVersion = 5;
    current.meta.contentVersion = 14;
    current.state.wildCreatures = current.state.wildCreatures.filter((creature) => creature.speciesId === 'tuftle');
    current.state.ownedCreatures.push({
      id: 'creature-owned-stag', speciesId: 'glade-stag', name: 'Fern', role: 'rest',
      assignment: null, worksiteId: null, nextWorkTick: 0,
    });

    const { save, migrated } = migrateToCurrent(current);
    expect(migrated).toBe(true);
    expect(save.state.wildCreatures.map((creature) => creature.speciesId)).toEqual([
      'tuftle', 'craghopper', 'snarlfox',
    ]);
    expect(save.state.ownedCreatures.map((creature) => creature.speciesId)).toEqual(['glade-stag']);
  });

  it('adds deterministic growth state to existing v16 Woodlot Planters', () => {
    const current = migrateToCurrent(v0Save()).save;
    current.meta.saveVersion = 16;
    current.meta.contentVersion = 15;
    current.state.tick = 240;
    current.state.buildings = [{ id: 'planter-1', definitionId: 'woodlot-planter', tileX: 15, tileY: 15 }];
    const { save, migrated } = migrateToCurrent(current);
    expect(migrated).toBe(true);
    expect(save.state.buildings[0]!.woodlot).toEqual({ progressTicks: 0, readyWood: 0, nextGrowthTick: 300 });
  });

  it('rejects a save newer than the supported version', () => {
    const future = { meta: { saveVersion: SAVE_VERSION + 1, savedAt: 1 }, state: {} };
    expect(() => migrateToCurrent(future)).toThrow(SaveValidationError);
  });

  it('rejects structurally invalid saves', () => {
    expect(() => migrateToCurrent({ meta: { saveVersion: 1, savedAt: 1 }, state: {} })).toThrow(
      SaveValidationError,
    );
    expect(() => migrateToCurrent(null)).toThrow(SaveValidationError);
    expect(() =>
      migrateToCurrent({
        meta: { saveVersion: 1, savedAt: 1 },
        state: { seed: 1, rngState: 1, tick: 0, player: { x: 0, y: 0, facing: 'sideways' } },
      }),
    ).toThrow(SaveValidationError);
  });
});
