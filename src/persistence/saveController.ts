import { APP_VERSION, CONTENT_VERSION, WORLD_GEN_VERSION } from '../config/versions';
import type { Clock } from '../simulation/clock';
import { systemClock } from '../simulation/clock';
import { settleOfflineTime, type OfflineSummary } from '../simulation/offline';
import { recordHighestRating } from '../simulation/scoring';
import { DurationWindow, type DurationStats } from '../platform/durationWindow';
import { createInitialState, type AreaSnapshot, type GameState } from '../simulation/state';
import { reconcileElarisWaters, reconcileRoadResources } from '../simulation/areas';
import { reconcileAllResourceStacks } from '../simulation/inventoryStacks';
import { IndexedDbSaveRepository, type RepositoryOptions } from './IndexedDbSaveRepository';
import { downloadSave, pickSaveFile } from './saveFile';
import { SAVE_VERSION, type PortableSave, type SaveKind } from './types';

const DIRTY_DEBOUNCE_MS = 2_000; // keeps the ordinary-save rollback window under 5s
const HEARTBEAT_MS = 5_000; // well under the default 15s lease TTL

export type SaveStatus = 'writer' | 'readonly' | 'error';

export interface SavePerformanceSnapshot {
  durations: DurationStats;
  last: { kind: SaveKind; totalMs: number; snapshotMs: number } | null;
}

export interface SaveControllerOptions {
  clock?: Clock;
  repository?: RepositoryOptions;
  onStatus?: (status: SaveStatus, detail?: string) => void;
  onSaved?: () => void;
  /** Fired once per load when capped offline settlement produced anything. */
  onOfflineSettled?: (summary: OfflineSummary) => void;
}

/**
 * Bridges the SaveRepository and live GameState: loads on boot, acquires the
 * single-writer lease, autosaves ordinary changes on a short debounce, keeps
 * the lease alive with a heartbeat, and drops to read-only if the lease is
 * taken over. `state` is mutated in place so the render scene keeps its ref.
 */
export class SaveController {
  readonly repo: IndexedDbSaveRepository;
  private readonly clock: Clock;
  private readonly onStatus: ((status: SaveStatus, detail?: string) => void) | undefined;
  private readonly onSaved: (() => void) | undefined;
  private readonly onOfflineSettled: ((summary: OfflineSummary) => void) | undefined;
  /** Never moves backward, even if the local wall clock does. */
  private lastProcessedAt: number;

  status: SaveStatus = 'readonly';
  loadedExistingSave = false;
  private dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private readonly saveDurations = new DurationWindow(30);
  private lastSavePerformance: SavePerformanceSnapshot['last'] = null;
  private readonly visitedAreaSnapshotCache = new Map<string, {
    source: AreaSnapshot;
    snapshot: AreaSnapshot;
  }>();

  constructor(
    public readonly state: GameState,
    options: SaveControllerOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.onStatus = options.onStatus;
    this.onSaved = options.onSaved;
    this.onOfflineSettled = options.onOfflineSettled;
    this.lastProcessedAt = this.clock.now();
    this.repo = new IndexedDbSaveRepository({
      ...options.repository,
      onWriterConflict: () => this.demoteToReadonly('Another window took over'),
    });
  }

  async start(): Promise<void> {
    await this.repo.open();
    const acquired = await this.repo.acquireWriter();

    const loaded = await this.repo.load();
    this.loadedExistingSave = loaded !== null;
    if (loaded) {
      applyLoadedState(this.state, loaded.save.state);
      reconcileElarisWaters(this.state);
      reconcileRoadResources(this.state);
    }

    if (acquired.granted) {
      this.setStatus('writer');
      this.startHeartbeat();
      let summary: OfflineSummary | null = null;
      if (loaded) {
        // Only the current fenced writer may settle elapsed time. Persist the
        // adjusted timers and new savedAt before play resumes, so a crash or
        // immediate reload cannot apply the same offline window twice.
        const now = this.clock.now();
        summary = settleOfflineTime(this.state, now - loaded.save.meta.savedAt);
        this.lastProcessedAt = now >= loaded.save.meta.savedAt ? now : loaded.save.meta.savedAt;
        recordHighestRating(this.state);
      }
      await this.persist('critical');
      if (summary && (summary.nodesRespawned > 0 || summary.fiberGrown > 0 || summary.woodGrown > 0
        || summary.ingotsSmelted > 0 || summary.workerResourcesProduced > 0 || summary.expeditionsReturned > 0)) {
        this.onOfflineSettled?.(summary);
      }
    } else {
      this.setStatus('readonly', acquired.reason);
    }
  }

  /** Note ordinary (movement/gathering) change; schedules a debounced save. */
  markDirty(): void {
    if (this.status !== 'writer' || this.dirtyTimer) return;
    this.dirtyTimer = setTimeout(() => {
      this.dirtyTimer = null;
      void this.enqueue(() => this.persist('ordinary'));
    }, DIRTY_DEBOUNCE_MS);
  }

  /** Durably persist immediately (used for critical, irreversible mutations). */
  async saveCritical(): Promise<void> {
    if (this.status !== 'writer') return;
    this.clearDirtyTimer();
    await this.enqueue(() => this.persist('critical'));
  }

  /** Cancel an obsolete ordinary-save timer before a critical save is deferred. */
  prepareCriticalSave(): void {
    if (this.status === 'writer') this.clearDirtyTimer();
  }

  /** Flush any pending ordinary save now (best-effort, e.g. on pagehide). */
  async flush(): Promise<void> {
    if (this.status !== 'writer' || !this.dirtyTimer) {
      await this.saving;
      return;
    }
    this.clearDirtyTimer();
    await this.enqueue(() => this.persist('ordinary'));
  }

  /** Flush then release the lease — used before an update reload. */
  async flushAndRelease(): Promise<void> {
    await this.flush();
    await this.repo.releaseWriter();
  }

  async exportToFile(): Promise<void> {
    const save = (await this.repo.exportSave()) ?? this.toPortable();
    downloadSave(save);
  }

  async importFromFile(): Promise<boolean> {
    if (this.status !== 'writer') return false;
    const input = await pickSaveFile();
    if (input == null) return false;
    const imported = await this.repo.importSave(input);
    applyLoadedState(this.state, imported.state);
    reconcileElarisWaters(this.state);
    reconcileRoadResources(this.state);
    this.lastProcessedAt = Math.max(this.lastProcessedAt, imported.meta.savedAt);
    this.onSaved?.();
    return true;
  }

  async reset(): Promise<void> {
    if (this.status !== 'writer') return;
    this.clearDirtyTimer();
    await this.enqueue(async () => {
      await this.repo.reset();
      applyLoadedState(this.state, createInitialState(this.state.seed, this.state.gameBalance));
      await this.persist('critical');
    });
  }

  dispose(): void {
    this.clearDirtyTimer();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.repo.close();
  }

  getPerformanceSnapshot(): SavePerformanceSnapshot {
    return {
      durations: this.saveDurations.snapshot(),
      last: this.lastSavePerformance ? { ...this.lastSavePerformance } : null,
    };
  }

  // --- internals ---

  private clearDirtyTimer(): void {
    if (this.dirtyTimer) {
      clearTimeout(this.dirtyTimer);
      this.dirtyTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      void this.repo.renewWriter().then((ok) => {
        if (!ok) this.demoteToReadonly('Lease lost');
      });
    }, HEARTBEAT_MS);
  }

  private demoteToReadonly(detail: string): void {
    if (this.status === 'readonly') return;
    this.clearDirtyTimer();
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.setStatus('readonly', detail);
  }

  private setStatus(status: SaveStatus, detail?: string): void {
    this.status = status;
    this.onStatus?.(status, detail);
  }

  /** Serialize save operations so rotations never interleave. */
  private enqueue(op: () => Promise<void>): Promise<void> {
    this.saving = this.saving.then(op, op).then(
      () => this.onSaved?.(),
      (err) => {
        this.setStatus('error', String(err));
        throw err;
      },
    );
    return this.saving;
  }

  private async persist(kind: SaveKind): Promise<void> {
    const startedAt = monotonicNow();
    const portable = this.toPortable();
    const snapshotMs = monotonicNow() - startedAt;
    try {
      await this.repo.save(portable, kind);
    } finally {
      const totalMs = monotonicNow() - startedAt;
      this.saveDurations.record(totalMs);
      this.lastSavePerformance = { kind, totalMs, snapshotMs };
    }
  }

  private toPortable(): PortableSave {
    const now = this.clock.now();
    if (now >= this.lastProcessedAt) this.lastProcessedAt = now;
    // Inactive area snapshots are immutable until that area is entered and
    // exited again, at which point saveCurrentArea replaces the object. Reuse
    // clones whose source identity is unchanged so synchronous snapshot cost
    // stays bounded as exploration grows.
    const state = structuredClone({ ...this.state, visitedAreas: {} }) as GameState;
    reconcileAllResourceStacks(state);
    for (const [key, source] of Object.entries(this.state.visitedAreas)) {
      const cached = this.visitedAreaSnapshotCache.get(key);
      if (cached?.source === source) {
        state.visitedAreas[key] = cached.snapshot;
        continue;
      }
      const snapshot = structuredClone(source);
      this.visitedAreaSnapshotCache.set(key, { source, snapshot });
      state.visitedAreas[key] = snapshot;
    }
    for (const key of this.visitedAreaSnapshotCache.keys()) {
      if (!(key in this.state.visitedAreas)) this.visitedAreaSnapshotCache.delete(key);
    }
    return {
      meta: {
        saveVersion: SAVE_VERSION,
        worldGenVersion: WORLD_GEN_VERSION,
        contentVersion: CONTENT_VERSION,
        appVersion: APP_VERSION,
        savedAt: this.lastProcessedAt,
      },
      state,
    };
  }
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function applyLoadedState(target: GameState, loaded: GameState): void {
  Object.assign(target, structuredClone(loaded));
}
