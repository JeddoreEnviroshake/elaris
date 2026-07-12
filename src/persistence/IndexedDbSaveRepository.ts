import type { DBSchema, IDBPDatabase } from 'idb';
import { openDB } from 'idb';
import type { Clock } from '../simulation/clock';
import { systemClock } from '../simulation/clock';
import { migrateToCurrent } from './migrations';
import { NotWriterError, StaleWriterError, type SaveRepository } from './SaveRepository';
import type {
  AcquireResult,
  LeaseRecord,
  LoadResult,
  PersistenceEnvelope,
  PortableSave,
  SaveKind,
  SnapshotKey,
} from './types';

const DEFAULT_TTL_MS = 15_000;
const PROBE_MS = 300; // liveness-probe window before taking over an unexpired lease
const LEASE_KEY = 'writer';
const ENV_KEY = 'envelope';

interface ElarisDb extends DBSchema {
  snapshots: { key: SnapshotKey; value: PortableSave };
  env: { key: string; value: PersistenceEnvelope };
  lease: { key: string; value: LeaseRecord };
}

const EMPTY_ENVELOPE: PersistenceEnvelope = { revision: 0, leaseEpoch: 0, fenceCounter: 0 };

export interface RepositoryOptions {
  profileId?: string;
  clock?: Clock;
  ttlMs?: number;
  /** Called when another client acquires the writer lease we thought we held. */
  onWriterConflict?: () => void;
  /** Called when a schema upgrade in another tab forces us to close/reload. */
  onNeedReload?: () => void;
}

/**
 * IndexedDB-backed save repository with single-writer coordination.
 *
 * The IndexedDB lease record is the source of truth for who may write; a
 * BroadcastChannel provides immediate cross-tab notification on top. Every
 * write re-checks the fencing token inside the same transaction, so a client
 * whose lease was taken over cannot commit even if its own lease only expired
 * after the transaction began.
 */
export class IndexedDbSaveRepository implements SaveRepository {
  private readonly profileId: string;
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly clientId: string;
  private readonly channel: BroadcastChannel | null;
  private readonly onWriterConflict: (() => void) | undefined;
  private readonly onNeedReload: (() => void) | undefined;

  private db: IDBPDatabase<ElarisDb> | null = null;
  private envelope: PersistenceEnvelope = { ...EMPTY_ENVELOPE };
  private myToken: number | null = null;
  private myEpoch = 0;
  private readonly pongWaiters = new Set<(holderId: string) => void>();

  constructor(options: RepositoryOptions = {}) {
    this.profileId = options.profileId ?? 'default';
    this.clock = options.clock ?? systemClock;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.clientId = generateClientId();
    this.onWriterConflict = options.onWriterConflict;
    this.onNeedReload = options.onNeedReload;

    const channelName = `elaris-writer:${this.profileId}`;
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
    if (this.channel) {
      this.channel.onmessage = (e: MessageEvent) => this.onChannelMessage(e.data);
    }
  }

  async open(): Promise<void> {
    if (this.db) return;
    const dbName = `elaris:${this.profileId}`;
    const onNeedReload = this.onNeedReload;
    this.db = await openDB<ElarisDb>(dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots');
        if (!db.objectStoreNames.contains('env')) db.createObjectStore('env');
        if (!db.objectStoreNames.contains('lease')) db.createObjectStore('lease');
      },
      blocking() {
        // Another connection wants to upgrade the schema — get out of the way.
        onNeedReload?.();
      },
    });
    const stored = await this.db.get('env', ENV_KEY);
    this.envelope = stored ?? { ...EMPTY_ENVELOPE };
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.channel?.close();
  }

  isWriter(): boolean {
    return this.myToken !== null;
  }

  getEnvelope(): PersistenceEnvelope | null {
    return this.db ? { ...this.envelope } : null;
  }

  async acquireWriter(): Promise<AcquireResult> {
    const db = this.requireDb();
    const now = this.clock.now();

    // If an unexpired lease is held by another client, probe whether that
    // client is actually alive. A live tab replies; a dead predecessor (e.g. a
    // reloaded page whose async pagehide-release never committed) does not, so
    // we safely take over without waiting out the whole TTL.
    const existing = await db.get('lease', LEASE_KEY);
    if (existing && existing.holderId !== this.clientId && now < existing.expiresAt) {
      if (await this.probeHolderAlive(existing.holderId)) {
        return {
          granted: false,
          fenceToken: existing.fenceToken,
          epoch: existing.epoch,
          reason: 'Game already open in another window',
        };
      }
    }

    const tx = db.transaction(['lease', 'env'], 'readwrite');
    const leaseStore = tx.objectStore('lease');
    const envStore = tx.objectStore('env');
    const env = (await envStore.get(ENV_KEY)) ?? { ...EMPTY_ENVELOPE };
    env.fenceCounter += 1;
    env.leaseEpoch += 1;
    const lease: LeaseRecord = {
      holderId: this.clientId,
      epoch: env.leaseEpoch,
      fenceToken: env.fenceCounter,
      heartbeatAt: now,
      expiresAt: now + this.ttlMs,
    };
    await leaseStore.put(lease, LEASE_KEY);
    await envStore.put(env, ENV_KEY);
    await tx.done;

    this.envelope = env;
    this.myToken = lease.fenceToken;
    this.myEpoch = lease.epoch;
    this.channel?.postMessage({ type: 'acquired', holderId: this.clientId, epoch: lease.epoch });
    return { granted: true, fenceToken: lease.fenceToken, epoch: lease.epoch };
  }

  async renewWriter(): Promise<boolean> {
    const db = this.requireDb();
    if (this.myToken === null) return false;
    const now = this.clock.now();
    const tx = db.transaction('lease', 'readwrite');
    const lease = await tx.store.get(LEASE_KEY);
    if (!lease || lease.holderId !== this.clientId || lease.fenceToken !== this.myToken) {
      await tx.done;
      this.loseWriter();
      return false;
    }
    lease.heartbeatAt = now;
    lease.expiresAt = now + this.ttlMs;
    await tx.store.put(lease, LEASE_KEY);
    await tx.done;
    return true;
  }

  async releaseWriter(): Promise<void> {
    const db = this.requireDb();
    if (this.myToken === null) return;
    const tx = db.transaction('lease', 'readwrite');
    const lease = await tx.store.get(LEASE_KEY);
    if (lease && lease.holderId === this.clientId && lease.fenceToken === this.myToken) {
      await tx.store.delete(LEASE_KEY);
    }
    await tx.done;
    this.myToken = null;
    this.channel?.postMessage({ type: 'released', holderId: this.clientId });
  }

  async load(): Promise<LoadResult | null> {
    const db = this.requireDb();
    const current = await db.get('snapshots', 'current');
    if (current) {
      const migrated = this.tryMigrate(current);
      if (migrated) {
        if (migrated.migrated) await this.stashPreMigrationBackup(current);
        return { save: migrated.save, source: 'current', migrated: migrated.migrated };
      }
    }
    // Current is missing or unreadable — fall back to last-known-good.
    const lkg = await db.get('snapshots', 'lastKnownGood');
    if (lkg) {
      const migrated = this.tryMigrate(lkg);
      if (migrated) {
        if (migrated.migrated) await this.stashPreMigrationBackup(lkg);
        return { save: migrated.save, source: 'lastKnownGood', migrated: migrated.migrated };
      }
    }
    return null;
  }

  async save(save: PortableSave, _kind: SaveKind): Promise<void> {
    const db = this.requireDb();
    if (this.myToken === null) throw new NotWriterError();
    // Validate before opening the write transaction; never persist junk.
    migrateToCurrent(save);

    const tx = db.transaction(['snapshots', 'lease', 'env'], 'readwrite');
    const snapshots = tx.objectStore('snapshots');
    const leaseStore = tx.objectStore('lease');
    const envStore = tx.objectStore('env');

    // Fence check inside the write transaction: reject a taken-over writer.
    const lease = await leaseStore.get(LEASE_KEY);
    if (!lease || lease.holderId !== this.clientId || lease.fenceToken !== this.myToken) {
      await tx.done.catch(() => undefined);
      this.loseWriter();
      throw new StaleWriterError();
    }

    // Rotate: previous current becomes last-known-good, then write new current.
    const prevCurrent = await snapshots.get('current');
    if (prevCurrent) await snapshots.put(prevCurrent, 'lastKnownGood');
    await snapshots.put(save, 'current');
    // A successful write means any pending migrated snapshot loaded fine.
    await snapshots.delete('preMigrationBackup');

    const env = (await envStore.get(ENV_KEY)) ?? { ...this.envelope };
    env.revision += 1;
    await envStore.put(env, ENV_KEY);
    await tx.done;
    this.envelope = env;
  }

  async exportSave(): Promise<PortableSave | null> {
    const db = this.requireDb();
    const current = await db.get('snapshots', 'current');
    if (!current) return null;
    // Return a validated, migrated snapshot; contains no local envelope fields.
    return migrateToCurrent(current).save;
  }

  async importSave(input: unknown): Promise<PortableSave> {
    const db = this.requireDb();
    if (this.myToken === null) throw new NotWriterError();
    const parsed = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
    // Validate/migrate untrusted input up front; throws on invalid.
    const { save } = migrateToCurrent(parsed);

    const tx = db.transaction(['snapshots', 'lease', 'env'], 'readwrite');
    const snapshots = tx.objectStore('snapshots');
    const leaseStore = tx.objectStore('lease');
    const envStore = tx.objectStore('env');

    const lease = await leaseStore.get(LEASE_KEY);
    if (!lease || lease.holderId !== this.clientId || lease.fenceToken !== this.myToken) {
      await tx.done.catch(() => undefined);
      this.loseWriter();
      throw new StaleWriterError();
    }

    // Back up the current save before overwrite.
    const prevCurrent = await snapshots.get('current');
    if (prevCurrent) await snapshots.put(prevCurrent, 'lastKnownGood');
    await snapshots.put(save, 'current');

    // Rebase onto a new local revision; the fence counter is never lowered and
    // untrusted envelope fields from the import are ignored entirely.
    const env = (await envStore.get(ENV_KEY)) ?? { ...this.envelope };
    env.revision += 1;
    await envStore.put(env, ENV_KEY);
    await tx.done;
    this.envelope = env;
    return save;
  }

  async reset(): Promise<void> {
    const db = this.requireDb();
    if (this.myToken === null) throw new NotWriterError();
    const tx = db.transaction(['snapshots', 'env'], 'readwrite');
    const snapshots = tx.objectStore('snapshots');
    await snapshots.delete('current');
    await snapshots.delete('lastKnownGood');
    await snapshots.delete('preMigrationBackup');
    // Keep the monotonic fence counter; only reset the revision.
    const env = (await tx.objectStore('env').get(ENV_KEY)) ?? { ...this.envelope };
    env.revision = 0;
    await tx.objectStore('env').put(env, ENV_KEY);
    await tx.done;
    this.envelope = env;
  }

  // --- internals ---

  private tryMigrate(raw: PortableSave): { save: PortableSave; migrated: boolean } | null {
    try {
      return migrateToCurrent(raw);
    } catch {
      return null;
    }
  }

  private async stashPreMigrationBackup(raw: PortableSave): Promise<void> {
    const db = this.requireDb();
    // Preserve the raw pre-migration snapshot until a migrated save commits.
    const existing = await db.get('snapshots', 'preMigrationBackup');
    if (!existing) await db.put('snapshots', raw, 'preMigrationBackup');
  }

  /** Ask the current lease holder to confirm it is alive within PROBE_MS. */
  private probeHolderAlive(holderId: string): Promise<boolean> {
    if (!this.channel) return Promise.resolve(false);
    const channel = this.channel;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const waiter = (id: string): void => {
        if (settled || id !== holderId) return;
        settled = true;
        cleanup();
        resolve(true);
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        this.pongWaiters.delete(waiter);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(false);
      }, PROBE_MS);
      this.pongWaiters.add(waiter);
      channel.postMessage({ type: 'ping', holderId: this.clientId });
    });
  }

  private onChannelMessage(data: unknown): void {
    if (!isChannelMessage(data)) return;
    if (data.type === 'ping') {
      // Reply only if we actually hold the lease.
      if (this.myToken !== null) {
        this.channel?.postMessage({ type: 'pong', holderId: this.clientId });
      }
      return;
    }
    if (data.type === 'pong') {
      for (const waiter of [...this.pongWaiters]) waiter(data.holderId);
      return;
    }
    if (data.type === 'acquired' && data.holderId !== this.clientId) {
      // Someone else grabbed the writer lease; if we thought we held it, we're
      // now stale. Verify on next renew, but signal immediately.
      if (this.myToken !== null && data.epoch !== undefined && data.epoch > this.myEpoch) {
        this.loseWriter();
        this.onWriterConflict?.();
      }
    }
  }

  private loseWriter(): void {
    this.myToken = null;
  }

  private requireDb(): IDBPDatabase<ElarisDb> {
    if (!this.db) throw new Error('SaveRepository not open()ed');
    return this.db;
  }
}

interface ChannelMessage {
  type: 'acquired' | 'released' | 'ping' | 'pong';
  holderId: string;
  epoch?: number;
}

function isChannelMessage(data: unknown): data is ChannelMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    'holderId' in data &&
    typeof (data as { holderId: unknown }).holderId === 'string'
  );
}

function generateClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}
