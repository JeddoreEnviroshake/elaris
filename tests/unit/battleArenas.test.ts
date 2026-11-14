import { describe, expect, it } from 'vitest';
import { battleArenaPath, BATTLE_ARENA_PATHS } from '../../src/art/battleArenas';

describe('battle arena selection', () => {
  it('uses the rocky arena for hills creatures', () => {
    expect(battleArenaPath('hills')).toBe(BATTLE_ARENA_PATHS.hills);
  });

  it('uses a habitat-specific clearing for forest creatures', () => {
    expect(battleArenaPath('grassland')).toBe(BATTLE_ARENA_PATHS.grassland);
    expect(battleArenaPath('forest')).toBe(BATTLE_ARENA_PATHS.forest);
  });
});
