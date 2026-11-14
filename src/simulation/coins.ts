import type { GameState } from './state';

export interface CoinTransactionResult {
  ok: boolean;
  message: string;
}

/** Coins are both the spendable currency and the player's overall score. */
export function coinScore(state: Pick<GameState, 'coins'>): number {
  return state.coins;
}

/** Atomically add whole coins without allowing the canonical balance to overflow. */
export function creditCoins(state: GameState, amount: number, message: string): CoinTransactionResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: 'Coin amount must be a positive whole number' };
  if (!Number.isSafeInteger(state.coins + amount)) return { ok: false, message: 'Coin balance is at capacity' };
  state.coins += amount;
  return { ok: true, message };
}

/** Atomically spend whole coins; spending lowers the player's overall score. */
export function spendCoins(state: GameState, amount: number, message: string): CoinTransactionResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: 'Coin amount must be a positive whole number' };
  if (state.coins < amount) return { ok: false, message: `Need ${amount - state.coins} more coins` };
  state.coins -= amount;
  return { ok: true, message };
}
