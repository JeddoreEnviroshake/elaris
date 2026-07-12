import { APP_VERSION, CONTENT_VERSION, WORLD_GEN_VERSION } from '../config/versions';
import type { Clock } from '../simulation/clock';
import { systemClock } from '../simulation/clock';
import type { GameState } from '../simulation/state';
import { IndexedDbSaveRepository, type RepositoryOptions } from './IndexedDbSaveRepository';
import { downloadSave, pickSaveFile } from './saveFile';
import { SAVE_VERSION, type PortableSave } from './types';

const DIRTY_DEBOUNCE_MS = 2_000; // keeps the ordinary-save rollback window under 5s
const HEARTBEAT_MS = 5_000; // well under the default 15s lease TTL

export type SaveStatus = 'writer' | 'readonly' | 'error';

export interface SaveControllerOptions {
  clock?: Clock;
  repository?: RepositoryOptions;
  onStatus?: (status: SaveStatus, detail?: string) => void;
  onSaved?: () => void;
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

  status: SaveStatus = 'readonly';
  private dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    public readonly state: GameState,
    options: SaveControllerOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.onStatus = options.onStatus;
    this.onSaved = options.onSaved;
    this.repo = new IndexedDbSaveRepository({
      ...options.repository,
      onWriterConflict: () => this.demoteToReadonly('Another window took over'),
    });
  }

  async start(): Promise<void> {
    await this.repo.open();
    const acquired = await this.repo.acquireWriter();

    const loaded = await this.repo.load();
    if (loaded) applyLoadedState(this.state, loaded.save.state);

    if (acquired.granted) {
      this.setStatus('writer');
      this.startHeartbeat();
      // Establish a current snapshot if this is a brand-new save.
      if (!loaded) await this.repo.save(this.toPortable(), 'critical');
    } else {
      this.setStatus('readonly', acquired.reason);
    }
  }

  /** Note ordinary (movement/gathering) change; schedules a debounced save. */
  markDirty(): void {
    if (this.status !== 'writer' || this.dirtyTimer) return;
    this.dirtyTimer = setTimeout(() => {
      this.dirtyTimer = null;
      void this.enqueue(() => this.repo.save(this.toPortable(), 'ordinary'));
    }, DIRTY_DEBOUNCE_MS);
  }

  /** Durably persist immediately (used for critical, irreversible mutations). */
  async saveCritical(): Promise<void> {
    if (this.status !== 'writer') return;
    this.clearDirtyTimer();
    await this.enqueue(() => this.repo.save(this.toPortable(), 'critical'));
  }

  /** Flush any pending ordinary save now (best-effort, e.g. on pagehide). */
  async flush(): Promise<void> {
    if (this.status !== 'writer' || !this.dirtyTimer) {
      await this.saving;
      return;
    }
    this.clearDirtyTimer();
    await this.enqueue(() => this.repo.save(this.toPortable(), 'ordinary'));
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
    this.onSaved?.();
    return true;
  }

  async reset(): Promise<void> {
    if (this.status !== 'writer') return;
    this.clearDirtyTimer();
    await this.enqueue(() => this.repo.reset());
  }

  dispose(): void {
    this.clearDirtyTimer();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.repo.close();
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

  private toPortable(): PortableSave {
    return {
      meta: {
        saveVersion: SAVE_VERSION,
        worldGenVersion: WORLD_GEN_VERSION,
        contentVersion: CONTENT_VERSION,
        appVersion: APP_VERSION,
        savedAt: this.clock.now(),
      },
      state: structuredClone(this.state),
    };
  }
}

function applyLoadedState(target: GameState, loaded: GameState): void {
  target.seed = loaded.seed;
  target.rngState = loaded.rngState;
  target.tick = loaded.tick;
  target.player.x = loaded.player.x;
  target.player.y = loaded.player.y;
  target.player.facing = loaded.player.facing;
}
