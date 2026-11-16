import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';
import { LocalWorlds } from '../../src/persistence/localWorlds';
import { IndexedDbSaveRepository, worldDatabaseName } from '../../src/persistence/IndexedDbSaveRepository';
import { SaveController } from '../../src/persistence/saveController';
import { SAVE_VERSION } from '../../src/persistence/types';
import { createInitialState } from '../../src/simulation/state';
import { APP_VERSION, CONTENT_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';

function profile(): string { return `worlds-${crypto.randomUUID()}`; }

describe('local worlds', () => {
  it('creates durable independent worlds, ordered by most recent play', async () => {
    const id = profile(); let now = 100;
    const worlds = new LocalWorlds(id, () => now); await worlds.open();
    expect(await worlds.list()).toEqual([]);
    const a = await worlds.create('  Moss cottage  ', 5);
    now = 200;
    const b = await worlds.create('Hill camp', 9);
    expect(a.name).toBe('Moss cottage');
    expect(a).toMatchObject({ ownership: 'owned', shared: false, code: null, memberCount: 1 });
    const controller = new SaveController(createInitialState(5), { repository: { profileId: id, worldId: a.id } });
    await controller.start();
    controller.state.inventory.wood = 37;
    await controller.saveCritical(); await controller.flushAndRelease(); controller.dispose();
    now = 300; await worlds.markPlayed(a.id); worlds.close();
    const reopened = new LocalWorlds(id); await reopened.open();
    expect((await reopened.list()).map(world => world.id)).toEqual([a.id, b.id]);
    for (const [world, wood] of [[a, 37], [b, 0]] as const) {
      const repo = new IndexedDbSaveRepository({ profileId: id, worldId: world.id });
      await repo.open();
      expect((await repo.load())?.save.state.inventory.wood).toBe(wood);
      repo.close();
    }
    reopened.close();
  });

  it('isolates writer leases and reset/backup operations by world', async () => {
    const id = profile(); const worlds = new LocalWorlds(id); await worlds.open();
    const a = await worlds.create('One', 1); const b = await worlds.create('Two', 2);
    const repos = [a, a, b].map(world => new IndexedDbSaveRepository({ profileId: id, worldId: world.id }));
    for (const repo of repos) await repo.open();
    try {
      expect((await repos[0]!.acquireWriter()).granted).toBe(true);
      expect((await repos[1]!.acquireWriter()).granted).toBe(false);
      expect((await repos[2]!.acquireWriter()).granted).toBe(true);
      await repos[0]!.reset();
      expect(await repos[0]!.load()).toBeNull();
      expect((await repos[2]!.load())?.save.state.seed).toBe(2);
    } finally { for (const repo of repos) { if (repo.isWriter()) await repo.releaseWriter(); repo.close(); } worlds.close(); }
  });

  it('adopts a legacy save once and retains the raw backup after the adopted world is saved', async () => {
    const id = profile();
    const legacy = new IndexedDbSaveRepository({ profileId: id }); await legacy.open(); await legacy.acquireWriter();
    const db = await openDB(worldDatabaseName(id), 1);
    const raw = { meta: { saveVersion: 0, worldGenVersion: 1, contentVersion: 1, appVersion: 'old', savedAt: 12 }, state: { seed: 55, tick: 1, player: { x: 3, y: 4, facing: 'up' } } };
    await db.put('snapshots', raw, 'current');
    await legacy.releaseWriter(); legacy.close();
    const worlds = new LocalWorlds(id); await worlds.open();
    const [world] = await worlds.list();
    expect(world).toMatchObject({ id: 'legacy', seed: 55, ownership: 'owned', shared: false });
    expect(world!.name).toMatch(/Level 1$/);
    const target = new IndexedDbSaveRepository({ profileId: id, worldId: world!.id }); await target.open(); await target.acquireWriter();
    const save = (await target.load())!.save; expect(save.state.player.x).toBe(3);
    save.state.inventory.wood = 91; await target.save(save, 'critical'); await target.releaseWriter(); target.close();
    expect(await db.get('snapshots', 'preMigrationBackup')).toEqual(raw);
    expect(await db.get('snapshots', 'current')).toEqual(raw);
    worlds.close(); await worlds.open();
    expect(await worlds.list()).toHaveLength(1);
    const reload = new IndexedDbSaveRepository({ profileId: id, worldId: 'legacy' }); await reload.open();
    expect((await reload.load())?.save.state.inventory.wood).toBe(91);
    reload.close(); db.close(); worlds.close();
  });

  it('recovers a valid legacy backup and leaves corrupt saves unchanged', async () => {
    const id = profile(); const legacy = new IndexedDbSaveRepository({ profileId: id }); await legacy.open(); await legacy.acquireWriter();
    const valid = { meta: { saveVersion: SAVE_VERSION, worldGenVersion: WORLD_GEN_VERSION, contentVersion: CONTENT_VERSION, appVersion: APP_VERSION, savedAt: 1 }, state: createInitialState(18) };
    await legacy.save(valid, 'critical'); await legacy.releaseWriter(); legacy.close();
    const db = await openDB(worldDatabaseName(id), 1); await db.put('snapshots', valid, 'lastKnownGood'); await db.put('snapshots', { broken: true }, 'current');
    const worlds = new LocalWorlds(id); await worlds.open(); expect(await worlds.list()).toHaveLength(1);
    expect(await db.get('snapshots', 'current')).toEqual({ broken: true }); worlds.close(); db.close();
    const badId = profile(); const badRepo = new IndexedDbSaveRepository({ profileId: badId }); await badRepo.open(); badRepo.close();
    const badDb = await openDB(worldDatabaseName(badId), 1); await badDb.put('snapshots', { broken: true }, 'current');
    const badWorlds = new LocalWorlds(badId); await expect(badWorlds.open()).rejects.toThrow(/kept unchanged/);
    expect(await badDb.get('snapshots', 'current')).toEqual({ broken: true });
    expect(await badWorlds.list()).toEqual([]); badWorlds.close(); badDb.close();
  });

  it('refuses to adopt a legacy save that another live window is writing', async () => {
    const id = profile(); const legacy = new SaveController(createInitialState(2), { repository: { profileId: id } }); await legacy.start();
    const worlds = new LocalWorlds(id);
    await expect(worlds.open()).rejects.toThrow(/another window/);
    await legacy.flushAndRelease(); legacy.dispose();
    await worlds.open(); expect(await worlds.list()).toHaveLength(1); worlds.close();
  });

  it('rejects invalid names without adding worlds', async () => {
    const worlds = new LocalWorlds(profile()); await worlds.open();
    await expect(worlds.create('  ', 1)).rejects.toThrow(/name/);
    await expect(worlds.create('a'.repeat(65), 1)).rejects.toThrow(/name/);
    expect(await worlds.list()).toEqual([]); worlds.close();
  });

  it('keeps an unreadable world unchanged when Continue requires an existing save', async () => {
    const id = profile(); const worlds = new LocalWorlds(id); await worlds.open(); const world = await worlds.create('Recovery', 3);
    const db = await openDB(worldDatabaseName(id, world.id), 1);
    await db.put('snapshots', { damaged: true }, 'current');
    const controller = new SaveController(createInitialState(3), { repository: { profileId: id, worldId: world.id }, requireExistingSave: true });
    try {
      await expect(controller.start()).rejects.toThrow(/kept unchanged/);
      expect(await db.get('snapshots', 'current')).toEqual({ damaged: true });
    } finally { await controller.repo.releaseWriter(); controller.dispose(); db.close(); worlds.close(); }
  });

  it('can retry a failed final save without giving up the writer lease', async () => {
    const id = profile(); const controller = new SaveController(createInitialState(4), { repository: { profileId: id, worldId: 'retry' } });
    await controller.start(); controller.state.inventory.wood = 23;
    const save = vi.spyOn(controller.repo, 'save').mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(controller.saveCritical()).rejects.toThrow('Storage unavailable');
    expect(controller.repo.isWriter()).toBe(true); expect(controller.status).toBe('error');
    await controller.saveCritical(); expect(controller.status).toBe('writer');
    expect((await controller.repo.load())?.save.state.inventory.wood).toBe(23);
    save.mockRestore(); await controller.flushAndRelease(); controller.dispose();
  });

  it('grants only one writer when two windows open the same world simultaneously', async () => {
    const id = profile();
    const a = new IndexedDbSaveRepository({ profileId: id, worldId: 'race' });
    const b = new IndexedDbSaveRepository({ profileId: id, worldId: 'race' });
    await Promise.all([a.open(), b.open()]);
    const results = await Promise.all([a.acquireWriter(), b.acquireWriter()]);
    expect(results.filter(result => result.granted)).toHaveLength(1);
    for (const repo of [a, b]) { if (repo.isWriter()) await repo.releaseWriter(); repo.close(); }
  });
});
