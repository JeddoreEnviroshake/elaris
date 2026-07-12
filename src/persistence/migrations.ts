import type { Facing } from '../simulation/state';
import type { PortableSave } from './types';
import { SAVE_VERSION } from './types';

/**
 * Save migrations. Each entry upgrades a save from version N to N+1. The chain
 * runs until the save reaches SAVE_VERSION. A save newer than SAVE_VERSION, or
 * one missing a migration step, is rejected rather than silently loaded.
 *
 * v0 → v1: `state.rngState` was introduced in v1; seed it from the world seed.
 * (Kept as a concrete, tested migration path even though v1 is current.)
 */
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Readonly<Record<number, Migration>> = {
  0: (raw) => {
    const meta = asRecord(raw['meta']);
    const state = asRecord(raw['state']);
    return {
      ...raw,
      meta: { ...meta, saveVersion: 1 },
      state: { ...state, rngState: typeof state['seed'] === 'number' ? state['seed'] : 0 },
    };
  },
};

export interface MigrationResult {
  save: PortableSave;
  migrated: boolean;
}

export function migrateToCurrent(raw: unknown): MigrationResult {
  if (!isRecord(raw)) throw new SaveValidationError('save is not an object');
  const meta = asRecord(raw['meta']);
  let version = typeof meta['saveVersion'] === 'number' ? meta['saveVersion'] : 0;

  if (version > SAVE_VERSION) {
    throw new SaveValidationError(`save version ${version} is newer than supported ${SAVE_VERSION}`);
  }

  let current: Record<string, unknown> = raw;
  let migrated = false;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new SaveValidationError(`no migration from save version ${version}`);
    current = step(current);
    version += 1;
    migrated = true;
  }

  return { save: assertValidPortableSave(current), migrated };
}

const FACINGS: ReadonlySet<string> = new Set<Facing>(['up', 'down', 'left', 'right']);

/** Structural validation — the gate that keeps corrupt/foreign data out. */
export function assertValidPortableSave(raw: unknown): PortableSave {
  if (!isRecord(raw)) throw new SaveValidationError('save is not an object');
  const meta = raw['meta'];
  const state = raw['state'];
  if (!isRecord(meta)) throw new SaveValidationError('missing meta');
  if (!isRecord(state)) throw new SaveValidationError('missing state');

  requireNumber(meta, 'saveVersion');
  requireNumber(meta, 'savedAt');
  requireNumber(state, 'seed');
  requireNumber(state, 'rngState');
  requireNumber(state, 'tick');

  const player = state['player'];
  if (!isRecord(player)) throw new SaveValidationError('missing player');
  requireNumber(player, 'x');
  requireNumber(player, 'y');
  if (typeof player['facing'] !== 'string' || !FACINGS.has(player['facing'])) {
    throw new SaveValidationError('invalid player.facing');
  }

  return raw as unknown as PortableSave;
}

export class SaveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function requireNumber(obj: Record<string, unknown>, key: string): void {
  const v = obj[key];
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new SaveValidationError(`expected numeric ${key}`);
  }
}
