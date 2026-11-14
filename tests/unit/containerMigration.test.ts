import { describe, expect, it } from 'vitest';
import { migrateToCurrent } from '../../src/persistence/migrations';
import { SAVE_VERSION } from '../../src/persistence/types';

/** A v57 save: everything before trophies, the Reinforced Snare, and containers. */
function v57Save(): Record<string, unknown> {
  const current = migrateToCurrent({
    meta: { saveVersion: 0, worldGenVersion: 1, contentVersion: 1, appVersion: 'test', savedAt: 1 },
    state: { seed: 42, tick: 3, player: { x: 10, y: 20, facing: 'down' } },
  }).save;
  const raw = JSON.parse(JSON.stringify(current)) as Record<string, any>;
  raw.meta.saveVersion = 57;
  raw.meta.contentVersion = 52;
  delete raw.state.containers;
  for (const item of ['reinforced-snare', 'tuftle-down', 'craghopper-shell', 'stag-antler', 'snarlfox-pelt']) {
    delete raw.state.inventory[item];
    delete raw.state.inventoryStacks[item];
  }
  raw.state.visitedAreas = {
    '1,0': {
      key: '1,0', x: 1, y: 0, name: 'Ashen Reach', theme: 'forest', seed: 991,
      resourceNodes: [], wildCreatures: [], groundDrops: [], buildings: [], raiders: [],
    },
  };
  return raw;
}

describe('v57 → v58 migration', () => {
  it('backfills the new bag items at zero', () => {
    const { state } = migrateToCurrent(v57Save()).save;
    for (const item of ['reinforced-snare', 'tuftle-down', 'craghopper-shell', 'stag-antler', 'snarlfox-pelt'] as const) {
      expect(state.inventory[item]).toBe(0);
      expect(state.inventoryStacks[item]).toEqual([]);
    }
  });

  it('generates containers for the current area rather than leaving it empty', () => {
    const { state } = migrateToCurrent(v57Save()).save;
    expect(state.containers.length).toBeGreaterThan(0);
    for (const container of state.containers) expect(container.opened).toBe(false);
  });

  it('generates containers for areas the save had already visited', () => {
    const { state } = migrateToCurrent(v57Save()).save;
    expect(state.visitedAreas['1,0']!.containers.length).toBeGreaterThan(0);
  });

  it('reaches the current save version and revalidates', () => {
    const result = migrateToCurrent(v57Save());
    expect(result.migrated).toBe(true);
    expect(result.save.meta.saveVersion).toBe(SAVE_VERSION);
  });

  it('is idempotent: re-migrating an already-current save changes nothing', () => {
    const once = migrateToCurrent(v57Save()).save;
    const twice = migrateToCurrent(JSON.parse(JSON.stringify(once))).save;
    expect(twice.state.containers).toEqual(once.state.containers);
  });

  it('preserves opened flags rather than regenerating over them', () => {
    const migrated = migrateToCurrent(v57Save()).save;
    migrated.state.containers[0]!.opened = true;
    const again = migrateToCurrent(JSON.parse(JSON.stringify(migrated))).save;
    expect(again.state.containers[0]!.opened).toBe(true);
  });
});

/** A v58 save: after containers, before per-NPC stock. */
function v58Save(): Record<string, unknown> {
  const raw = v57Save();
  const migrated = migrateToCurrent(raw).save;
  const copy = JSON.parse(JSON.stringify(migrated)) as Record<string, any>;
  copy.meta.saveVersion = 58;
  copy.meta.contentVersion = 53;
  delete copy.state.packRanks;
  delete copy.state.arcaneStudyPurchases;
  delete copy.state.inventory['safeguard-charm'];
  delete copy.state.inventoryStacks['safeguard-charm'];
  return copy;
}

describe('v58 → v59 migration', () => {
  it('backfills the Safeguard Charm at zero', () => {
    const { state } = migrateToCurrent(v58Save()).save;
    expect(state.inventory['safeguard-charm']).toBe(0);
    expect(state.inventoryStacks['safeguard-charm']).toEqual([]);
  });

  it('backfills both purchase counters at zero', () => {
    const { state } = migrateToCurrent(v58Save()).save;
    expect(state.packRanks).toBe(0);
    expect(state.arcaneStudyPurchases).toBe(0);
  });

  it('preserves counters a newer save already has', () => {
    const raw = v58Save() as Record<string, any>;
    raw.state.packRanks = 4;
    raw.state.arcaneStudyPurchases = 7;
    raw.meta.saveVersion = 58;
    const { state } = migrateToCurrent(raw).save;
    expect(state.packRanks).toBe(4);
    expect(state.arcaneStudyPurchases).toBe(7);
  });

  it('reaches the current save version', () => {
    expect(migrateToCurrent(v58Save()).save.meta.saveVersion).toBe(SAVE_VERSION);
  });
});

/** A v59 save: after per-NPC stock, before creature expeditions. */
function v59Save(): Record<string, unknown> {
  const migrated = migrateToCurrent(v58Save()).save;
  const copy = JSON.parse(JSON.stringify(migrated)) as Record<string, any>;
  copy.meta.saveVersion = 59;
  copy.meta.contentVersion = 54;
  delete copy.state.expeditions;
  delete copy.state.expeditionsDispatched;
  return copy;
}

describe('v59 → v60 migration', () => {
  it('starts an old save with no party out', () => {
    const { state } = migrateToCurrent(v59Save()).save;
    expect(state.expeditions).toEqual([]);
    expect(state.expeditionsDispatched).toBe(0);
  });

  it('preserves an in-flight expedition across a reload', () => {
    const raw = v59Save() as Record<string, any>;
    raw.state.expeditions = [{
      id: 'expedition-9', creatureId: 'creature-1', routeId: 'deep-survey',
      remainingMs: 1_234_000, rollIndex: 3,
    }];
    raw.state.expeditionsDispatched = 4;
    raw.meta.saveVersion = 59;
    const { state } = migrateToCurrent(raw).save;
    expect(state.expeditions[0]!.remainingMs).toBe(1_234_000);
    expect(state.expeditionsDispatched).toBe(4);
  });

  it('rejects a save carrying an unknown route', () => {
    const raw = v59Save() as Record<string, any>;
    raw.state.expeditions = [{
      id: 'expedition-9', creatureId: 'creature-1', routeId: 'to-the-moon',
      remainingMs: 10, rollIndex: 0,
    }];
    raw.meta.saveVersion = 59;
    expect(() => migrateToCurrent(raw)).toThrow(/expedition route/);
  });

  it('reaches the current save version', () => {
    expect(migrateToCurrent(v59Save()).save.meta.saveVersion).toBe(SAVE_VERSION);
  });
});
