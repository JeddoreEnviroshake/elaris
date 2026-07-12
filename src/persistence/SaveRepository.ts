import type { AcquireResult, LoadResult, PersistenceEnvelope, PortableSave, SaveKind } from './types';

/**
 * Storage-agnostic save contract. Milestone 0 ships IndexedDbSaveRepository;
 * cloud sync (Milestone 2) is layered on top, not a second implementation of
 * this interface. localStorage is reserved for small preferences only.
 */
export interface SaveRepository {
  /** Open the backing store. Safe to call once before use. */
  open(): Promise<void>;
  /** Close connections (e.g. on versionchange or teardown). */
  close(): void;

  /**
   * Attempt to become the single writer for this origin/profile/slot. Grants
   * on a free or expired lease (takeover), denies while another client holds a
   * live lease. Issues a fresh monotonic fencing token on success.
   */
  acquireWriter(): Promise<AcquireResult>;
  /** Refresh the lease heartbeat. Returns false if the lease was taken over. */
  renewWriter(): Promise<boolean>;
  /** Release the lease so another client can take over cleanly. */
  releaseWriter(): Promise<void>;
  isWriter(): boolean;

  /** Load current (falling back to last-known-good), migrating if needed. */
  load(): Promise<LoadResult | null>;
  /**
   * Persist a validated save. Requires the writer lease and a matching fence
   * token; rotates the previous current into last-known-good atomically.
   */
  save(save: PortableSave, kind: SaveKind): Promise<void>;

  /** Portable snapshot for download; never includes local envelope metadata. */
  exportSave(): Promise<PortableSave | null>;
  /** Validate/migrate untrusted input, back up current, and rebase locally. */
  importSave(input: unknown): Promise<PortableSave>;
  /** Clear snapshots. Never lowers the monotonic fence counter. */
  reset(): Promise<void>;

  getEnvelope(): PersistenceEnvelope | null;
}

export class StaleWriterError extends Error {
  constructor(message = 'writer lease lost or fenced') {
    super(message);
    this.name = 'StaleWriterError';
  }
}

export class NotWriterError extends Error {
  constructor(message = 'client does not hold the writer lease') {
    super(message);
    this.name = 'NotWriterError';
  }
}
