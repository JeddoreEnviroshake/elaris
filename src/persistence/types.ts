import type { GameState } from '../simulation/state';

/**
 * Bump when the on-disk shape of a PortableSave changes. Every increment needs
 * a migration step (see migrations.ts) and a fixture test.
 */
export const SAVE_VERSION = 1;

/** Versioning metadata travels with the portable save (survives export/import). */
export interface SaveMeta {
  saveVersion: number;
  worldGenVersion: number;
  contentVersion: number;
  appVersion: string;
  savedAt: number;
}

/**
 * The portable, canonical save. This is what export/import moves between
 * devices and what the determinism hash is computed over. It contains NO local
 * revision/lease/fence metadata.
 */
export interface PortableSave {
  meta: SaveMeta;
  state: GameState;
}

/**
 * Local-only persistence envelope, kept OUTSIDE the portable save. Never
 * exported; import ignores any such fields from untrusted input.
 */
export interface PersistenceEnvelope {
  /** Monotonic per-write counter; last-writer-wins reconciliation key (M2). */
  revision: number;
  /** Increments each successful writer-lease acquisition. */
  leaseEpoch: number;
  /**
   * Monotonic fencing counter — the highest fence token ever issued on this
   * origin/profile. Never lowered by reset or import.
   */
  fenceCounter: number;
}

/** Writer-lease record; the single source of truth for who may write. */
export interface LeaseRecord {
  holderId: string;
  epoch: number;
  fenceToken: number;
  heartbeatAt: number;
  expiresAt: number;
}

export type SnapshotKey = 'current' | 'lastKnownGood' | 'preMigrationBackup';

export type SaveKind = 'critical' | 'ordinary';

export interface LoadResult {
  save: PortableSave;
  source: 'current' | 'lastKnownGood';
  migrated: boolean;
}

export interface AcquireResult {
  granted: boolean;
  fenceToken: number;
  epoch: number;
  reason?: string;
}
