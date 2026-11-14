import { BAG_WEIGHT_SCALE } from '../config/balance';
import { effectiveBagCapacityHundredths } from './npcStock';
import type { BagItemId, GameState } from './state';

export { effectiveBagCapacityHundredths };

/** Total carried item weight in exact hundredths. Tools intentionally have no configured weight. */
export function bagWeightHundredths(state: GameState): number {
  const weights = state.gameBalance.bagWeight.itemHundredths;
  return (Object.entries(state.inventory) as Array<[BagItemId, number]>).reduce(
    (total, [item, amount]) => total + amount * weights[item], 0,
  );
}

export function bagItemWeightHundredths(state: GameState, item: BagItemId): number {
  return state.gameBalance.bagWeight.itemHundredths[item];
}

export function isBagOverweight(state: GameState): boolean {
  return bagWeightHundredths(state) > effectiveBagCapacityHundredths(state);
}

/**
 * Twice the capacity or more: carrying 110 against a 40 limit is overburdened,
 * which pins movement to `OVERBURDENED_SPEED_PX_PER_S`.
 */
export function isBagOverburdened(state: GameState): boolean {
  return bagWeightHundredths(state) >= effectiveBagCapacityHundredths(state) * 2;
}

/** Human-readable exact weight without unnecessary trailing zeroes. */
export function formatWeight(hundredths: number): string {
  return (hundredths / BAG_WEIGHT_SCALE).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
