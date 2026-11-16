import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { APP_VERSION, CONTENT_VERSION, WORLD_GEN_VERSION } from '../config/versions';
import { createInitialState } from '../simulation/state';
import { IndexedDbSaveRepository, worldDatabaseName } from './IndexedDbSaveRepository';
import { migrateToCurrent } from './migrations';
import { SAVE_VERSION, type PortableSave } from './types';

export interface LocalWorld {
  id: string;
  name: string;
  ownership: 'owned';
  shared: false;
  memberCount: 1;
  code: null;
  seed: number;
  createdAt: number;
  lastPlayedAt: number;
}

interface WorldCatalog extends DBSchema {
  worlds: { key: string; value: LocalWorld };
  settings: { key: string; value: boolean };
}

/** Device-local world directory. Gameplay snapshots keep the existing save contract. */
export class LocalWorlds {
  private db: IDBPDatabase<WorldCatalog> | null = null;

  constructor(private readonly profileId = 'default', private readonly now = Date.now) {}

  async open(): Promise<void> {
    if (!this.db) this.db = await openDB<WorldCatalog>(`elaris-worlds:${this.profileId}`, 1, {
      upgrade(db) { db.createObjectStore('worlds', { keyPath: 'id' }); db.createObjectStore('settings'); },
      blocking: () => this.close(),
    });
    await this.adoptLegacySave();
  }

  close(): void { this.db?.close(); this.db = null; }

  async list(): Promise<LocalWorld[]> {
    const worlds = await this.requireDb().getAll('worlds');
    return worlds.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt || a.id.localeCompare(b.id));
  }

  async create(name: string, seed: number): Promise<LocalWorld> {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 64) throw new Error('Give your world a name of 1–64 characters.');
    if (!Number.isSafeInteger(seed)) throw new Error('Invalid world seed.');
    const now = this.now();
    const world = this.record(crypto.randomUUID(), cleanName, seed, now);
    const repo = new IndexedDbSaveRepository({ profileId: this.profileId, worldId: world.id });
    try {
      await repo.open();
      if (!(await repo.acquireWriter()).granted) throw new Error('Could not create the world. Please try again.');
      await repo.save({
        meta: { saveVersion: SAVE_VERSION, worldGenVersion: WORLD_GEN_VERSION, contentVersion: CONTENT_VERSION, appVersion: APP_VERSION, savedAt: now },
        state: createInitialState(seed),
      }, 'critical');
      await this.requireDb().add('worlds', world);
    } finally {
      if (repo.isWriter()) await repo.releaseWriter();
      repo.close();
    }
    return world;
  }

  async markPlayed(id: string): Promise<void> {
    const tx = this.requireDb().transaction('worlds', 'readwrite');
    const world = await tx.store.get(id);
    if (!world) throw new Error('This world is no longer in the local world list.');
    world.lastPlayedAt = Math.max(world.lastPlayedAt, this.now());
    await tx.store.put(world);
    await tx.done;
  }

  /** Idempotent across reloads and competing tabs; never removes legacy data. */
  private async adoptLegacySave(): Promise<void> {
    const catalog = this.requireDb();
    if (await catalog.get('settings', 'legacyAdopted')) return;
    const legacy = new IndexedDbSaveRepository({ profileId: this.profileId });
    const rawDb = await openDB(worldDatabaseName(this.profileId), 1, {
      upgrade(db) { db.createObjectStore('snapshots'); db.createObjectStore('env'); db.createObjectStore('lease'); },
    });
    try {
      const current = await rawDb.get('snapshots', 'current') as PortableSave | undefined;
      const backup = await rawDb.get('snapshots', 'lastKnownGood') as PortableSave | undefined;
      if (!current && !backup) {
        await catalog.put('settings', true, 'legacyAdopted');
        return;
      }
      await legacy.open();
      if (!(await legacy.acquireWriter()).granted) throw new Error('Your existing game is open in another window. Close it, then try again.');
      // Read again under the lease, in case an older tab saved during boot.
      const candidates = [await rawDb.get('snapshots', 'current'), await rawDb.get('snapshots', 'lastKnownGood')];
      let adopted: { raw: PortableSave; save: PortableSave } | undefined;
      for (const raw of candidates) {
        if (!raw) continue;
        try { adopted = { raw, save: migrateToCurrent(raw).save }; break; } catch { /* try the recovery snapshot */ }
      }
      if (!adopted) throw new Error('Your existing save could not be read. It has been kept unchanged for recovery.');
      const backupTx = rawDb.transaction('snapshots', 'readwrite');
      if (!await backupTx.store.get('preMigrationBackup')) await backupTx.store.put(adopted.raw, 'preMigrationBackup');
      await backupTx.done;
      const { save } = adopted;
      const world = this.record('legacy', `${save.state.currentArea.name} · Level ${save.state.player.level}`, save.state.seed, save.meta.savedAt);
      const target = new IndexedDbSaveRepository({ profileId: this.profileId, worldId: world.id });
      await target.open(); target.close();
      const worldDb = await openDB(worldDatabaseName(this.profileId, world.id), 1);
      try {
        const tx = worldDb.transaction('snapshots', 'readwrite');
        // A second adopting tab must never overwrite progress already played.
        if (!await tx.store.get('current')) await tx.store.put(save, 'current');
        await tx.done;
      } finally { worldDb.close(); }
      const tx = catalog.transaction(['worlds', 'settings'], 'readwrite');
      if (!await tx.objectStore('worlds').get(world.id)) await tx.objectStore('worlds').add(world);
      await tx.objectStore('settings').put(true, 'legacyAdopted');
      await tx.done;
    } finally {
      if (legacy.isWriter()) await legacy.releaseWriter();
      legacy.close(); rawDb.close();
    }
  }

  private record(id: string, name: string, seed: number, timestamp: number): LocalWorld {
    return { id, name, seed, ownership: 'owned', shared: false, memberCount: 1, code: null, createdAt: timestamp, lastPlayedAt: timestamp };
  }

  private requireDb(): IDBPDatabase<WorldCatalog> {
    if (!this.db) throw new Error('Local world directory is not open.');
    return this.db;
  }
}
