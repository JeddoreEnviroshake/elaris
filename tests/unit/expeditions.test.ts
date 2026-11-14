import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState, type SpeciesId } from '../../src/simulation/state';
import {
  EXHAUSTED_SURVEY_COINS,
  advanceExpeditions,
  collectBlockedReason,
  collectExpedition,
  dispatchBlockedReason,
  dispatchExpedition,
  expeditionRewards,
  formatRemaining,
  isCreatureAway,
  isExpeditionHome,
} from '../../src/simulation/expeditions';
import { EXPEDITION_ROUTES, EXPEDITION_SPECIALTY, expeditionRoute } from '../../src/content/expeditions';
import { settleOfflineTime } from '../../src/simulation/offline';
import { setBattleCompanion, setCreatureRole } from '../../src/simulation/gameplayCommands';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { BLUEPRINT_ITEM_IDS } from '../../src/simulation/blueprintKnowledge';
import { OFFLINE_CAP_MS } from '../../src/config/balance';
import { bagItemWeightHundredths } from '../../src/simulation/bagWeight';
import { signatureCompanionAbility } from '../../src/content/companionAbilities';
import { npcServiceModel } from '../../src/presentation/npcServiceModel';

function withCreature(speciesId: SpeciesId = 'tuftle', id = 'creature-1'): GameState {
  const state = createInitialState(9182);
  state.ownedCreatures.push({
    id, speciesId, name: 'Moss', role: 'rest', assignment: null, worksiteId: null,
    nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: signatureCompanionAbility(speciesId),
    housingId: null, workRemainderMs: 0,
  });
  return state;
}

describe('dispatching', () => {
  it('sends a resting creature out and marks it away', () => {
    const state = withCreature();
    const result = dispatchExpedition(state, 'creature-1', 'short-forage');
    expect(result.ok).toBe(true);
    expect(state.expeditions.length).toBe(1);
    expect(isCreatureAway(state, 'creature-1')).toBe(true);
    expect(state.expeditionsDispatched).toBe(1);
  });

  it('starts with the route’s full duration remaining', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'deep-survey');
    expect(state.expeditions[0]!.remainingMs).toBe(expeditionRoute('deep-survey').durationMs);
    expect(isExpeditionHome(state.expeditions[0]!)).toBe(false);
  });

  it('refuses a creature that is not resting', () => {
    const state = withCreature();
    state.ownedCreatures[0]!.role = 'follow';
    expect(dispatchBlockedReason(state, 'creature-1', 'short-forage')).toMatch(/Rest/);
    expect(dispatchExpedition(state, 'creature-1', 'short-forage').ok).toBe(false);
  });

  it('refuses to send the same creature twice', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'short-forage');
    expect(dispatchExpedition(state, 'creature-1', 'long-haul').ok).toBe(false);
    expect(state.expeditions.length).toBe(1);
  });

  it('refuses an unknown creature or route', () => {
    const state = withCreature();
    expect(dispatchExpedition(state, 'nobody', 'short-forage').ok).toBe(false);
    expect(dispatchBlockedReason(state, 'creature-1', 'nowhere' as never)).toBe('Unknown route');
  });

  it('stands the creature down as battle companion when it leaves', () => {
    const state = withCreature();
    setCreatureRole(state, 'creature-1', 'follow');
    setBattleCompanion(state, 'creature-1');
    expect(state.battleCompanionId).toBe('creature-1');
    state.ownedCreatures[0]!.role = 'rest';
    dispatchExpedition(state, 'creature-1', 'short-forage');
    expect(state.battleCompanionId).toBeNull();
  });
});

describe('away creatures are unavailable', () => {
  it('cannot be reassigned to another role', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'short-forage');
    const result = setCreatureRole(state, 'creature-1', 'follow');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/away/);
    expect(state.ownedCreatures[0]!.role).toBe('rest');
  });

  it('cannot be chosen as a battle companion', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'short-forage');
    expect(setBattleCompanion(state, 'creature-1').ok).toBe(false);
  });
});

describe('settlement', () => {
  it('counts down and reports the return', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'short-forage');
    const duration = expeditionRoute('short-forage').durationMs;

    const partway = advanceExpeditions(state, duration - 1_000);
    expect(partway.changed).toBe(true);
    expect(partway.returned).toBe(0);
    expect(state.expeditions[0]!.remainingMs).toBe(1_000);

    const finish = advanceExpeditions(state, 1_000);
    expect(finish.returned).toBe(1);
    expect(isExpeditionHome(state.expeditions[0]!)).toBe(true);
  });

  it('never counts a finished expedition as returning twice', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'short-forage');
    advanceExpeditions(state, OFFLINE_CAP_MS);
    expect(advanceExpeditions(state, OFFLINE_CAP_MS).returned).toBe(0);
  });

  it('ignores zero, negative, and non-finite windows', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'short-forage');
    const before = state.expeditions[0]!.remainingMs;
    for (const ms of [0, -5_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(advanceExpeditions(state, ms).changed).toBe(false);
    }
    expect(state.expeditions[0]!.remainingMs).toBe(before);
  });

  it('settles offline through the same path and reports it', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'short-forage');
    const summary = settleOfflineTime(state, OFFLINE_CAP_MS);
    expect(summary.expeditionsReturned).toBe(1);
    expect(isExpeditionHome(state.expeditions[0]!)).toBe(true);
  });

  it('caps an absence, so a Deep Survey needs the full window', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'deep-survey');
    settleOfflineTime(state, OFFLINE_CAP_MS / 2);
    expect(isExpeditionHome(state.expeditions[0]!)).toBe(false);
    settleOfflineTime(state, OFFLINE_CAP_MS);
    expect(isExpeditionHome(state.expeditions[0]!)).toBe(true);
  });

  it('keeps remainingMs a whole integer so the state hash stays valid', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'long-haul');
    advanceExpeditions(state, 1_234.567);
    expect(Number.isSafeInteger(state.expeditions[0]!.remainingMs)).toBe(true);
    expect(() => canonicalizeGameState(state)).not.toThrow();
  });
});

describe('rewards', () => {
  it('are deterministic for a given dispatch', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'long-haul');
    const first = expeditionRewards(state, state.expeditions[0]!);
    const second = expeditionRewards(state, state.expeditions[0]!);
    expect(first).toEqual(second);
  });

  it('bring back the species specialty', () => {
    for (const speciesId of Object.keys(EXPEDITION_SPECIALTY) as SpeciesId[]) {
      const state = withCreature(speciesId);
      dispatchExpedition(state, 'creature-1', 'short-forage');
      const rewards = expeditionRewards(state, state.expeditions[0]!);
      expect(rewards.resources.map(([r]) => r)).toContain(EXPEDITION_SPECIALTY[speciesId]);
    }
  });

  /**
   * Regression: a flat unit count made a Snarlfox Deep Survey land the player
   * at ~2.7× their carry limit while a Tuftle's was under half of it.
   */
  it('bring home a comparable weight whatever the species fetches', () => {
    const loads = (Object.keys(EXPEDITION_SPECIALTY) as SpeciesId[]).map((speciesId) => {
      const state = withCreature(speciesId);
      dispatchExpedition(state, 'creature-1', 'deep-survey');
      const rewards = expeditionRewards(state, state.expeditions[0]!);
      return rewards.resources.reduce(
        (sum, [resource, amount]) => sum + amount * bagItemWeightHundredths(state, resource), 0,
      );
    });
    const lightest = Math.min(...loads);
    const heaviest = Math.max(...loads);
    expect(heaviest / lightest).toBeLessThan(1.8);
  });

  it('pay more for longer routes', () => {
    const yields = EXPEDITION_ROUTES.map((route) => {
      const state = withCreature();
      dispatchExpedition(state, 'creature-1', route.id);
      const rewards = expeditionRewards(state, state.expeditions[0]!);
      return rewards.resources.reduce((sum, [, amount]) => sum + amount, 0) + rewards.coins;
    });
    for (let i = 1; i < yields.length; i += 1) expect(yields[i]!).toBeGreaterThan(yields[i - 1]!);
  });

  it('only the Deep Survey carries a blueprint', () => {
    for (const route of EXPEDITION_ROUTES) {
      const state = withCreature();
      dispatchExpedition(state, 'creature-1', route.id);
      const rewards = expeditionRewards(state, state.expeditions[0]!);
      expect(rewards.carriesBlueprint).toBe(route.blueprint);
    }
  });

  it('always yield whole positive amounts', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const state = withCreature();
      state.seed = seed;
      state.expeditionsDispatched = seed;
      dispatchExpedition(state, 'creature-1', 'long-haul');
      const rewards = expeditionRewards(state, state.expeditions[0]!);
      for (const [, amount] of rewards.resources) {
        expect(Number.isSafeInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThan(0);
      }
      expect(Number.isSafeInteger(rewards.coins)).toBe(true);
    }
  });
});

describe('collection', () => {
  it('refuses while the party is still away, without consuming it', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'short-forage');
    const id = state.expeditions[0]!.id;
    expect(collectBlockedReason(state, id)).toMatch(/Still away/);
    expect(collectExpedition(state, id).ok).toBe(false);
    expect(state.expeditions.length).toBe(1);
  });

  it('grants goods, coins, and frees the creature', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'short-forage');
    advanceExpeditions(state, OFFLINE_CAP_MS);
    const before = { fiber: state.inventory.fiber, coins: state.coins };
    expect(collectExpedition(state, state.expeditions[0]!.id).ok).toBe(true);
    expect(state.inventory.fiber).toBeGreaterThan(before.fiber);
    expect(state.coins).toBeGreaterThan(before.coins);
    expect(state.expeditions.length).toBe(0);
    expect(isCreatureAway(state, 'creature-1')).toBe(false);
  });

  it('unlocks a blueprint from a Deep Survey', () => {
    const state = withCreature();
    state.unlockedItemIds = [];
    dispatchExpedition(state, 'creature-1', 'deep-survey');
    advanceExpeditions(state, OFFLINE_CAP_MS);
    collectExpedition(state, state.expeditions[0]!.id);
    expect(state.unlockedItemIds.length).toBe(1);
  });

  it('pays coins when every blueprint is already known', () => {
    const state = withCreature();
    state.unlockedItemIds = [...BLUEPRINT_ITEM_IDS];
    dispatchExpedition(state, 'creature-1', 'deep-survey');
    advanceExpeditions(state, OFFLINE_CAP_MS);
    // The survey still pays its ordinary purse on top; the bonus is what it
    // hands over *instead of* a blueprint it can no longer teach.
    const routeCoins = expeditionRewards(state, state.expeditions[0]!).coins;
    const coins = state.coins;
    collectExpedition(state, state.expeditions[0]!.id);
    expect(state.coins).toBe(coins + routeCoins + EXHAUSTED_SURVEY_COINS);
  });

  it('spills to the ground rather than losing goods when the bag is full', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'deep-survey');
    advanceExpeditions(state, OFFLINE_CAP_MS);
    state.inventory.wood = 99 * 40;
    state.inventoryStacks.wood = Array.from({ length: 40 }, () => 99);
    expect(collectExpedition(state, state.expeditions[0]!.id).ok).toBe(true);
    expect(state.groundDrops.length).toBeGreaterThan(0);
  });

  it('does not disturb the shared RNG stream', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'long-haul');
    advanceExpeditions(state, OFFLINE_CAP_MS);
    const rng = state.rngState;
    collectExpedition(state, state.expeditions[0]!.id);
    expect(state.rngState).toBe(rng);
  });
});

describe('time formatting', () => {
  it('reads naturally at every scale', () => {
    expect(formatRemaining(0)).toBe('0 min');
    expect(formatRemaining(30 * 60_000)).toBe('30 min');
    expect(formatRemaining(60 * 60_000)).toBe('1 h');
    expect(formatRemaining(90 * 60_000)).toBe('1 h 30 min');
  });
});

describe('Orin exposes expeditions', () => {
  it('offers a route per resting creature', () => {
    const state = withCreature();
    const offers = npcServiceModel(state, 'farm').offers;
    const dispatch = offers.find((o) => o.id === 'expedition-dispatch-creature-1');
    expect(dispatch).toBeDefined();
    expect(dispatch!.actions.length).toBe(EXPEDITION_ROUTES.length);
  });

  it('explains itself when nothing is free to send', () => {
    const state = createInitialState(1);
    const offers = npcServiceModel(state, 'farm').offers;
    expect(offers.some((o) => o.id === 'expedition-none-available')).toBe(true);
  });

  it('shows an away party with its collect action disabled', () => {
    const state = withCreature();
    dispatchExpedition(state, 'creature-1', 'long-haul');
    const offers = npcServiceModel(state, 'farm').offers;
    const row = offers.find((o) => o.id.startsWith('expedition-expedition-'))!;
    expect(row.actions[0]!.disabledReason).toMatch(/Still away/);
  });

  it('dispatches and collects end to end through the model', () => {
    const state = withCreature();
    const dispatch = npcServiceModel(state, 'farm').offers
      .find((o) => o.id === 'expedition-dispatch-creature-1')!.actions[0]!;
    expect(dispatch.execute().ok).toBe(true);
    advanceExpeditions(state, OFFLINE_CAP_MS);
    const collect = npcServiceModel(state, 'farm').offers
      .find((o) => o.id.startsWith('expedition-expedition-'))!.actions[0]!;
    expect(collect.execute().ok).toBe(true);
    expect(state.expeditions.length).toBe(0);
  });
});
