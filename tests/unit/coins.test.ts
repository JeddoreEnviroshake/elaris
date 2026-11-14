import { describe, expect, it } from 'vitest';
import { coinScore, creditCoins, spendCoins } from '../../src/simulation/coins';
import { createInitialState } from '../../src/simulation/state';

describe('coin score transactions', () => {
  it('uses the current spendable balance as the overall score', () => {
    const state = createInitialState(1);
    expect(creditCoins(state, 50, 'Quest reward')).toMatchObject({ ok: true });
    expect(coinScore(state)).toBe(50);
    expect(spendCoins(state, 20, 'Upgrade purchased')).toMatchObject({ ok: true });
    expect(coinScore(state)).toBe(30);
  });

  it('rejects invalid, unaffordable, and overflowing changes atomically', () => {
    const state = createInitialState(2);
    state.coins = 5;
    expect(spendCoins(state, 6, 'Too expensive')).toMatchObject({ ok: false });
    expect(creditCoins(state, 0, 'Invalid')).toMatchObject({ ok: false });
    expect(state.coins).toBe(5);
    state.coins = Number.MAX_SAFE_INTEGER;
    expect(creditCoins(state, 1, 'Overflow')).toMatchObject({ ok: false });
    expect(state.coins).toBe(Number.MAX_SAFE_INTEGER);
  });
});
