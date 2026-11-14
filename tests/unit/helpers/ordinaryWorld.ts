import { createOpeningThreat } from '../../../src/content/onboarding';
import { createInitialState } from '../../../src/simulation/state';

/** Threat-system tests exercise the continuing game, independently of the guided opening. */
export function createOrdinaryState(...args: Parameters<typeof createInitialState>) {
  const state = createInitialState(...args);
  state.onboarding.firstThreat = createOpeningThreat('ordinary');
  return state;
}
