import { MAX_ACTIVE_FOLLOWERS } from '../content/creatures';
import { isOpeningTuftle } from '../content/onboarding';
import { OFFER_RANGE_PX, SNARE_THROW_RANGE_PX, TAMING_RANGE_PX, TAME_EATING_TICKS, TAME_FAVOURITE_OFFER_BPS } from '../config/balance';
import { acquireWildCreature } from './creatureAcquisition';
import { addGroundDrop, setCreatureRole, tryAddResource, type CommandResult } from './gameplayCommands';
import { reconcileResourceStacks } from './inventoryStacks';
import type { GameState } from './state';
import { generateOpeningTuftle } from './worldGeneration';
import { completeOpeningMilestone } from './onboardingProgress';
export { completeOpeningMilestone } from './onboardingProgress';

/** Recover interrupted introductions and credit a Tuftle befriended out of sequence. */
export function reconcileOpeningChapter(state: GameState): boolean {
  const chapter = state.onboarding;
  if (chapter.status !== 'active') return false;
  if (chapter.completedMilestoneIds.includes('befriend-tuftle')) {
    if (state.ownedCreatures.some((creature) => creature.id === chapter.companionId)) return false;
    const replacement = state.ownedCreatures.find((creature) => creature.speciesId === 'tuftle');
    if (!replacement) return false;
    chapter.companionId = replacement.id;
    return true;
  }
  const existing = state.ownedCreatures.find((creature) => creature.speciesId === 'tuftle');
  if (existing) {
    chapter.companionId = existing.id;
    completeOpeningMilestone(state, 'meet-tuftle');
    completeOpeningMilestone(state, 'befriend-tuftle');
    if (!chapter.issuedRewardIds.includes('starter-partner')) chapter.issuedRewardIds.push('starter-partner');
    removeOpeningFixture(state);
    return true;
  }
  const starterArea = state.currentArea.key === '0,0' ? state : state.visitedAreas['0,0'];
  if (starterArea && !starterArea.wildCreatures.some((wild) => wild.id === chapter.starterWildCreatureId)) {
    const wildCreatures = [...starterArea.wildCreatures, generateOpeningTuftle(state.seed)];
    if (state.currentArea.key === '0,0') state.wildCreatures = wildCreatures;
    else state.visitedAreas['0,0'] = { ...state.visitedAreas['0,0']!, wildCreatures };
    return true;
  }
  return false;
}

function removeOpeningFixture(state: GameState): void {
  const id = state.onboarding.starterWildCreatureId;
  state.wildCreatures = state.wildCreatures.filter((wild) => wild.id !== id);
  for (const [key, area] of Object.entries(state.visitedAreas)) {
    if (area.wildCreatures.some((wild) => wild.id === id)) {
      // SaveController caches inactive snapshots by identity; replace changed snapshots.
      state.visitedAreas[key] = { ...area, wildCreatures: area.wildCreatures.filter((wild) => wild.id !== id) };
    }
  }
}

export function nearbyOpeningTuftle(state: GameState, range = TAMING_RANGE_PX) {
  if (state.currentArea.key !== '0,0' || state.pendingRespawn) return null;
  return state.wildCreatures.find((wild) => isOpeningTuftle(state, wild.id)
    && Math.hypot(wild.x - state.player.x, wild.y - state.player.y) <= range) ?? null;
}

/**
 * Hand the player one of `item` from the roadside basket: always on the first
 * meeting, so the lesson never spends the player's own supplies, and again
 * later only when they have run out.
 */
function topUpFromBasket(state: GameState, item: 'berry' | 'taming-snare', firstMeeting: boolean): boolean {
  if (!firstMeeting && state.inventory[item] > 0) return false;
  if (!tryAddResource(state, item, 1)) addGroundDrop(state, item, 1, state.player.x, state.player.y);
  return true;
}

export function beginOpeningTrust(state: GameState): CommandResult {
  const wild = nearbyOpeningTuftle(state);
  if (!wild) return { ok: false, message: 'Move closer to the roadside Tuftle.' };
  if (state.ownedCreatures.some((creature) => creature.speciesId === 'tuftle')) {
    return { ok: false, message: 'Your Tuftle is already in the roster.' };
  }
  const firstMeeting = completeOpeningMilestone(state, 'meet-tuftle');
  // The roadside basket keeps the lesson free: a berry and a snare on the
  // first meeting, and again whenever the player has run out of either.
  const berry = topUpFromBasket(state, 'berry', firstMeeting);
  const snare = topUpFromBasket(state, 'taming-snare', firstMeeting);
  const gift = berry || snare ? 'The roadside basket had a berry and a snare. ' : '';
  return {
    ok: true,
    message: `${gift}Put the Berry and the Taming Snare on your hotbar (Bag → tap the item → Add to Hotbar). Use the Berry beside the Tuftle, then the Snare.`,
  };
}

/** True once the roadside Tuftle has eaten the tutorial berry. */
export function openingTuftleFed(state: GameState): boolean {
  return (nearbyOpeningTuftle(state, SNARE_THROW_RANGE_PX)?.captureBonusBps ?? 0) > 0;
}

/**
 * Step one of the tutorial: a berry from the hotbar, the same Offer the world
 * uses. The Tuftle settles to eat and its Tame % jumps, which is the lesson.
 */
export function offerOpeningTuftle(state: GameState): CommandResult {
  const wild = nearbyOpeningTuftle(state, OFFER_RANGE_PX);
  if (!wild) return { ok: false, message: 'Move closer to the roadside Tuftle.' };
  if (wild.captureBonusBps > 0) return { ok: false, message: 'It is already eating. Now throw the snare.' };
  if (state.inventory.berry <= 0) return { ok: false, message: 'You have no berries. Press Help Tuftle for one from the basket.' };
  state.inventory.berry -= 1;
  reconcileResourceStacks(state, 'berry');
  wild.captureBonusBps = TAME_FAVOURITE_OFFER_BPS;
  wild.eatingUntilTick = state.tick + TAME_EATING_TICKS;
  return { ok: true, message: 'The Tuftle loves berries — it settles in to eat. Its tame chance jumped. Now use the Snare.' };
}

/**
 * Step two: the throw. The first one always holds — out in the world the
 * percentage is a real roll. The snare is spent only once the throw lands.
 */
export function throwOpeningSnare(state: GameState, snareItemId: 'taming-snare' | 'reinforced-snare' = 'taming-snare'): CommandResult {
  const wild = nearbyOpeningTuftle(state, SNARE_THROW_RANGE_PX);
  if (!wild) return { ok: false, message: 'Move closer to the roadside Tuftle.' };
  if (wild.captureBonusBps <= 0) return { ok: false, message: 'It is too wary. Offer it a berry first.' };
  if (state.inventory[snareItemId] <= 0) return { ok: false, message: 'You have no snare. Press Help Tuftle for one from the basket.' };
  const result = finishOpeningPartnership(state, SNARE_THROW_RANGE_PX);
  if (result.ok) {
    state.inventory[snareItemId] -= 1;
    reconcileResourceStacks(state, snareItemId);
  }
  return result;
}

function finishOpeningPartnership(state: GameState, range = TAMING_RANGE_PX): CommandResult {
  const chapter = state.onboarding;
  if (chapter.issuedRewardIds.includes('starter-partner')) return { ok: false, message: 'Your partner has already joined.' };
  if (state.ownedCreatures.filter((creature) => creature.role === 'follow').length >= MAX_ACTIVE_FOLLOWERS) {
    return { ok: false, message: 'Rest a follower, then return to the Tuftle.' };
  }
  const wild = nearbyOpeningTuftle(state, range);
  const creature = wild ? acquireWildCreature(state, wild) : null;
  if (!creature) {
    return { ok: false, message: 'Make room in your creature roster, then return.' };
  }
  setCreatureRole(state, creature.id, 'follow');
  removeOpeningFixture(state);
  chapter.companionId = creature.id;
  chapter.issuedRewardIds.push('starter-partner');
  completeOpeningMilestone(state, 'befriend-tuftle');
  return { ok: true, message: 'The Tuftle trusts you and is now following. Give your new friend a name!' };
}

export function nameOpeningCompanion(state: GameState, name: string): CommandResult {
  const creature = state.ownedCreatures.find((owned) => owned.id === state.onboarding.companionId);
  const cleaned = name.trim();
  if (!creature || !state.onboarding.completedMilestoneIds.includes('befriend-tuftle')) return { ok: false, message: 'Your partner has not joined yet.' };
  if (!cleaned || [...cleaned].length > 24 || /[\p{Cc}\p{Cf}]/u.test(cleaned)) return { ok: false, message: 'Choose a name with 1–24 visible characters.' };
  creature.name = cleaned;
  return { ok: true, message: `${cleaned} is ready to explore with you.` };
}
