import { describe, expect, it } from 'vitest';
import { migrateToCurrent, SaveValidationError } from '../../src/persistence/migrations';
import { SAVE_VERSION } from '../../src/persistence/types';

function v0Save() {
  return {
    meta: { saveVersion: 0, worldGenVersion: 1, contentVersion: 1, appVersion: 'test', savedAt: 1 },
    // v0 had no rngState
    state: { seed: 42, tick: 3, player: { x: 10, y: 20, facing: 'down' } },
  };
}

describe('migrateToCurrent', () => {
  it('upgrades a v0 save to current and adds rngState from the seed', () => {
    const { save, migrated } = migrateToCurrent(v0Save());
    expect(migrated).toBe(true);
    expect(save.meta.saveVersion).toBe(SAVE_VERSION);
    expect(save.state.rngState).toBe(42);
    expect(save.state.player.facing).toBe('down');
  });

  it('leaves an already-current save unmigrated', () => {
    const current = migrateToCurrent(v0Save()).save;
    const again = migrateToCurrent(current);
    expect(again.migrated).toBe(false);
  });

  it('rejects a save newer than the supported version', () => {
    const future = { meta: { saveVersion: SAVE_VERSION + 1, savedAt: 1 }, state: {} };
    expect(() => migrateToCurrent(future)).toThrow(SaveValidationError);
  });

  it('rejects structurally invalid saves', () => {
    expect(() => migrateToCurrent({ meta: { saveVersion: 1, savedAt: 1 }, state: {} })).toThrow(
      SaveValidationError,
    );
    expect(() => migrateToCurrent(null)).toThrow(SaveValidationError);
    expect(() =>
      migrateToCurrent({
        meta: { saveVersion: 1, savedAt: 1 },
        state: { seed: 1, rngState: 1, tick: 0, player: { x: 0, y: 0, facing: 'sideways' } },
      }),
    ).toThrow(SaveValidationError);
  });
});
