import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../../src/simulation/clock';
import { IndexedDbSaveRepository } from '../../src/persistence/IndexedDbSaveRepository';
import { StaleWriterError } from '../../src/persistence/SaveRepository';
import type { PortableSave } from '../../src/persistence/types';

let profileCounter = 0;
function uniqueProfile(): string {
  profileCounter += 1;
  return `test-${profileCounter}-${Math.random().toString(36).slice(2)}`;
}

function makeSave(seed: number, x: number): PortableSave {
  return {
    meta: { saveVersion: 1, worldGenVersion: 1, contentVersion: 1, appVersion: 'test', savedAt: 1 },
    state: { seed, rngState: seed, tick: 0, player: { x, y: 0, facing: 'down' } },
  };
}

let clock: ManualClock;
beforeEach(() => {
  clock = new ManualClock(0);
});

describe('IndexedDbSaveRepository', () => {
  it('round-trips a save and reloads it in a fresh repository (survives reload)', async () => {
    const profileId = uniqueProfile();
    const a = new IndexedDbSaveRepository({ profileId, clock });
    await a.open();
    await a.acquireWriter();
    await a.save(makeSave(7, 123), 'critical');
    a.close();

    const b = new IndexedDbSaveRepository({ profileId, clock });
    await b.open();
    const loaded = await b.load();
    expect(loaded?.source).toBe('current');
    expect(loaded?.save.state.player.x).toBe(123);
    b.close();
  });

  it('denies a second live client the writer lease (read-only)', async () => {
    const profileId = uniqueProfile();
    const a = new IndexedDbSaveRepository({ profileId, clock });
    const b = new IndexedDbSaveRepository({ profileId, clock });
    await a.open();
    await b.open();

    expect((await a.acquireWriter()).granted).toBe(true);
    const denied = await b.acquireWriter();
    expect(denied.granted).toBe(false);
    expect(denied.reason).toMatch(/already open/i);
    a.close();
    b.close();
  });

  it('allows takeover after lease expiry and fences the stale writer', async () => {
    const profileId = uniqueProfile();
    const a = new IndexedDbSaveRepository({ profileId, clock, ttlMs: 15_000 });
    const b = new IndexedDbSaveRepository({ profileId, clock, ttlMs: 15_000 });
    await a.open();
    await b.open();

    await a.acquireWriter();
    clock.advance(20_000); // A's lease has now expired
    expect((await b.acquireWriter()).granted).toBe(true);

    // A's fence token is now stale; its write must be rejected.
    await expect(a.save(makeSave(1, 5), 'ordinary')).rejects.toBeInstanceOf(StaleWriterError);
    expect(a.isWriter()).toBe(false);

    // B can still write.
    await b.save(makeSave(1, 9), 'ordinary');
    a.close();
    b.close();
  });

  it('rotates the previous current into last-known-good', async () => {
    const profileId = uniqueProfile();
    const a = new IndexedDbSaveRepository({ profileId, clock });
    await a.open();
    await a.acquireWriter();
    await a.save(makeSave(1, 100), 'critical'); // becomes LKG after next
    await a.save(makeSave(1, 200), 'critical'); // current
    a.close();

    // Simulate current corruption by deleting it directly.
    const db = await openDB(`elaris:${profileId}`, 1);
    await db.delete('snapshots', 'current');
    db.close();

    const b = new IndexedDbSaveRepository({ profileId, clock });
    await b.open();
    const loaded = await b.load();
    expect(loaded?.source).toBe('lastKnownGood');
    expect(loaded?.save.state.player.x).toBe(100);
    b.close();
  });

  it('migrates a legacy snapshot on load and preserves a pre-migration backup', async () => {
    const profileId = uniqueProfile();
    // Seed a v0 snapshot directly.
    const db = await openDB(`elaris:${profileId}`, 1, {
      upgrade(d) {
        d.createObjectStore('snapshots');
        d.createObjectStore('env');
        d.createObjectStore('lease');
      },
    });
    await db.put(
      'snapshots',
      {
        meta: { saveVersion: 0, worldGenVersion: 1, contentVersion: 1, appVersion: 't', savedAt: 1 },
        state: { seed: 55, tick: 1, player: { x: 3, y: 4, facing: 'up' } },
      },
      'current',
    );
    db.close();

    const repo = new IndexedDbSaveRepository({ profileId, clock });
    await repo.open();
    const loaded = await repo.load();
    expect(loaded?.migrated).toBe(true);
    expect(loaded?.save.state.rngState).toBe(55);

    const db2 = await openDB(`elaris:${profileId}`, 1);
    const backup = await db2.get('snapshots', 'preMigrationBackup');
    expect(backup).toBeTruthy();
    db2.close();
    repo.close();
  });

  it('imports untrusted input, backs up current, and never lowers the fence counter', async () => {
    const profileId = uniqueProfile();
    const repo = new IndexedDbSaveRepository({ profileId, clock });
    await repo.open();
    await repo.acquireWriter();
    await repo.save(makeSave(1, 10), 'critical');
    const fenceBefore = repo.getEnvelope()!.fenceCounter;

    // Untrusted import carrying bogus local metadata that must be ignored.
    const hostileImport = {
      revision: 999999,
      fenceCounter: -5,
      meta: { saveVersion: 1, worldGenVersion: 1, contentVersion: 1, appVersion: 'x', savedAt: 2 },
      state: { seed: 2, rngState: 2, tick: 0, player: { x: 77, y: 0, facing: 'left' } },
    };
    const imported = await repo.importSave(JSON.stringify(hostileImport));
    expect(imported.state.player.x).toBe(77);

    const env = repo.getEnvelope()!;
    expect(env.fenceCounter).toBeGreaterThanOrEqual(fenceBefore); // never lowered
    expect(env.revision).toBeGreaterThan(0);
    repo.close();
  });

  it('rejects invalid imports without touching the current save', async () => {
    const profileId = uniqueProfile();
    const repo = new IndexedDbSaveRepository({ profileId, clock });
    await repo.open();
    await repo.acquireWriter();
    await repo.save(makeSave(9, 42), 'critical');

    await expect(repo.importSave('{"not":"a save"}')).rejects.toThrow();
    const loaded = await repo.load();
    expect(loaded?.save.state.player.x).toBe(42); // untouched
    repo.close();
  });

  it('reset clears snapshots but preserves the monotonic fence counter', async () => {
    const profileId = uniqueProfile();
    const repo = new IndexedDbSaveRepository({ profileId, clock });
    await repo.open();
    await repo.acquireWriter();
    await repo.save(makeSave(1, 10), 'critical');
    const fence = repo.getEnvelope()!.fenceCounter;

    await repo.reset();
    expect(repo.getEnvelope()!.fenceCounter).toBe(fence);
    expect(repo.getEnvelope()!.revision).toBe(0);
    expect(await repo.load()).toBeNull();
    repo.close();
  });

  it('export returns a portable save without local envelope fields', async () => {
    const profileId = uniqueProfile();
    const repo = new IndexedDbSaveRepository({ profileId, clock });
    await repo.open();
    await repo.acquireWriter();
    await repo.save(makeSave(3, 88), 'critical');
    const exported = await repo.exportSave();
    expect(exported).toBeTruthy();
    expect(Object.keys(exported!).sort()).toEqual(['meta', 'state']);
    repo.close();
  });
});
