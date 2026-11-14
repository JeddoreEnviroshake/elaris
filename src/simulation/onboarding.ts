import { MAX_ACTIVE_FOLLOWERS } from '../content/creatures';
import { isOpeningTuftle } from '../content/onboarding';
import { TAMING_RANGE_PX } from '../config/balance';
import { acquireWildCreature } from './creatureAcquisition';
import { setCreatureRole, type CommandResult } from './gameplayCommands';
import type { GameState } from './state';
import { beginTamingSession, resolveTamingBeat, TAMING_ACTIONS, type TamingAction } from './taming';
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
    chapter.trustSession = null;
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

export function nearbyOpeningTuftle(state: GameState) {
  if (state.currentArea.key !== '0,0' || state.pendingRespawn || state.activeEncounter) return null;
  return state.wildCreatures.find((wild) => isOpeningTuftle(state, wild.id)
    && Math.hypot(wild.x - state.player.x, wild.y - state.player.y) <= TAMING_RANGE_PX) ?? null;
}

export function beginOpeningTrust(state: GameState): CommandResult {
  const wild = nearbyOpeningTuftle(state);
  if (!wild) return { ok: false, message: 'Move closer to the roadside Tuftle.' };
  if (state.ownedCreatures.some((creature) => creature.speciesId === 'tuftle')) {
    return { ok: false, message: 'Your Tuftle is already in the roster.' };
  }
  completeOpeningMilestone(state, 'meet-tuftle');
  if (!state.onboarding.trustSession) resetTrust(state);
  return { ok: true, message: 'The Tuftle watches you. Give it time to feel safe.' };
}

function resetTrust(state: GameState): void {
  const begun = beginTamingSession('passive', 'taming-snare', state.rngState);
  state.rngState = begun.rngState;
  state.onboarding.trustSession = { ...begun.session, mood: 'watching' };
}

export function actOpeningTrust(state: GameState, action: TamingAction): CommandResult {
  if (!TAMING_ACTIONS.includes(action) || !nearbyOpeningTuftle(state) || !state.onboarding.trustSession) {
    return { ok: false, message: 'Approach the Tuftle to continue earning its trust.' };
  }
  // The roadside basket supplies tutorial berries. The player's bag is never charged.
  const result = resolveTamingBeat(state.onboarding.trustSession, action, state.rngState, { berriesAvailable: 1 });
  if (result.blocked) return { ok: false, message: result.blocked };
  state.rngState = result.rngState;
  state.onboarding.trustSession = result.session;
  if (result.session.settled === 'broken') {
    resetTrust(state);
    return { ok: true, message: 'The Tuftle needs a little more time. Take a breath and try again; the basket still has berries.' };
  }
  if (result.session.settled) return finishOpeningPartnership(state);
  // A predictable, readable teaching profile; the normal taming resolver still prices each action.
  result.session.mood = result.session.beatsRemaining % 2 === 1 ? 'settling' : 'watching';
  return { ok: true, message: action === 'back-off' ? 'You give the Tuftle room to breathe.' : 'The Tuftle responds to your patience.' };
}

function finishOpeningPartnership(state: GameState): CommandResult {
  const chapter = state.onboarding;
  if (chapter.issuedRewardIds.includes('starter-partner')) return { ok: false, message: 'Your partner has already joined.' };
  if (state.ownedCreatures.filter((creature) => creature.role === 'follow').length >= MAX_ACTIVE_FOLLOWERS) {
    // Retrying must remain possible after making a follower slot available.
    chapter.trustSession = null;
    return { ok: false, message: 'Rest a follower, then return to the Tuftle.' };
  }
  const wild = nearbyOpeningTuftle(state);
  const creature = wild ? acquireWildCreature(state, wild) : null;
  if (!creature) {
    chapter.trustSession = null;
    return { ok: false, message: 'Make room in your creature roster, then return.' };
  }
  setCreatureRole(state, creature.id, 'follow');
  removeOpeningFixture(state);
  chapter.companionId = creature.id;
  chapter.trustSession = null;
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
