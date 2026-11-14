import { OPENING_FOG_PREPARATION_SECONDS, OPENING_FOG_SECONDS } from '../content/onboarding';
import { TICKS_PER_SECOND } from '../config/balance';
import { TILE_SIZE, WORLD_PX } from '../config/platform';
import { completeOpeningMilestone } from './onboardingProgress';
import { shelterChecklist } from './openingShelter';
import { isPlayerSheltered, survivalSchedule } from './survivalCycle';
import type { GameState } from './state';

/** Called by simulation, never by animations. Tick sampling cannot be advanced by opening a menu. */
export function advanceOpeningFog(state: GameState): boolean {
  const chapter = state.onboarding;
  const lesson = chapter.firstThreat;
  if (!lesson || chapter.status !== 'active' || chapter.completedMilestoneIds.includes('weather-fog') || state.pendingRespawn) return false;
  let changed = false;
  if (lesson.mode === 'guided' && lesson.releasedAtTick === null && state.currentArea.key !== '0,0'
    && (lesson.fogEndsAtTick === null || state.tick < lesson.fogEndsAtTick)) {
    releaseOpeningProtection(state, state.currentArea.key);
    changed = true;
  }
  if (!chapter.completedMilestoneIds.includes('build-shelter')) return changed;
  if (lesson.mode === 'guided' && lesson.releasedAtTick === null && lesson.preparationStartedAtTick === null && shelterChecklist(state).ready) {
    lesson.preparationStartedAtTick = state.tick;
    lesson.fogStartsAtTick = state.tick + OPENING_FOG_PREPARATION_SECONDS * TICKS_PER_SECOND;
    lesson.fogEndsAtTick = lesson.fogStartsAtTick + OPENING_FOG_SECONDS * TICKS_PER_SECOND;
    changed = true;
  }
  const schedule = survivalSchedule(state);
  if (lesson.observedCycleIndex !== null && lesson.observedCycleIndex !== schedule.cycleIndex) {
    if (lesson.shelteredTicks >= TICKS_PER_SECOND && state.player.hp > 0) {
      completeOpeningMilestone(state, 'weather-fog');
      lesson.aftermathAcknowledged = false;
      return true;
    }
    lesson.observedCycleIndex = null; lesson.shelteredTicks = 0; lesson.lastObservedTick = null;
    changed = true;
  }
  if (schedule.phase === 'danger' && schedule.threat === 'fog' && lesson.lastObservedTick !== state.tick) {
    if (lesson.observedCycleIndex === null) { lesson.observedCycleIndex = schedule.cycleIndex; changed = true; }
    // At most one real simulation tick per call, even after an admin clock jump.
    if (isPlayerSheltered(state) && lesson.shelteredTicks < TICKS_PER_SECOND) {
      lesson.shelteredTicks++;
      if (lesson.shelteredTicks === TICKS_PER_SECOND) changed = true;
    }
    lesson.lastObservedTick = state.tick;
  }
  return changed;
}

/** Area activation owns this so walking, waystones, and scripted travel agree. */
export function releaseOpeningProtection(state: GameState, destinationKey: string): void {
  const lesson = state.onboarding.firstThreat;
  if (destinationKey === '0,0' || lesson?.mode !== 'guided' || lesson.releasedAtTick !== null
    || lesson.fogEndsAtTick !== null && state.tick >= lesson.fogEndsAtTick) return;
  lesson.releasedAtTick = state.tick;
  lesson.observedCycleIndex = null; lesson.shelteredTicks = 0; lesson.lastObservedTick = null;
  state.dangerExposureStartedAtTick = null;
}

export function acknowledgeOpeningFog(state: GameState) {
  const lesson = state.onboarding.firstThreat;
  if (!lesson || lesson.aftermathAcknowledged || !state.onboarding.completedMilestoneIds.includes('weather-fog') && lesson.releasedAtTick === null) return { ok: false, message: 'No fog lesson notice to dismiss' };
  lesson.aftermathAcknowledged = true;
  return { ok: true, message: 'Your progress is saved. The ordinary threat cycle continues.' };
}

/** Concise guidance shared by the quest tracker and Shelter tab. */
export function openingFogGuidance(state: GameState): { title: string; detail: string; notice: boolean; departureWarning?: boolean } | null {
  const chapter = state.onboarding; const lesson = chapter.firstThreat;
  if (!lesson) return null;
  if (chapter.completedMilestoneIds.includes('weather-fog')) return lesson.aftermathAcknowledged ? null : {
    title: 'The air is clear', detail: 'You and your Tuftle weathered the fog. Purified air keeps you safe; storage and building remain usable during fog. Your home is ready for the next adventure.', notice: true };
  if (lesson.releasedAtTick !== null && !lesson.aftermathAcknowledged) return {
    title: 'Guided protection ended', detail: 'Leaving Elaris started the ordinary threat cycle. Returning will not restart the lesson. Build a shelter and weather a fog in purified air to finish this objective.', notice: true };
  const schedule = survivalSchedule(state);
  if (lesson.mode === 'guided' && lesson.releasedAtTick === null && schedule.openingPhase !== null
    && Math.min(state.player.x, state.player.y, WORLD_PX - state.player.x, WORLD_PX - state.player.y) <= 4 * TILE_SIZE) return {
      title: 'Leaving Elaris ends guided protection', detail: 'Crossing into another region starts the ordinary threat cycle. Returning will not restart introductory protection. Stay in Elaris to finish the guided fog lesson.', notice: false, departureWarning: true };
  if (schedule.openingPhase === 'waiting') return {
    title: 'First fog waits for your shelter', detail: 'Finish a working home before the preparation countdown begins. Leaving Elaris ends guided protection and starts the ordinary threat cycle.', notice: false };
  if (!chapter.completedMilestoneIds.includes('build-shelter')) return null;
  if (schedule.phase === 'danger' && schedule.threat === 'fog') {
    return { title: `Fog clears in ${schedule.label}`, detail: isPlayerSheltered(state)
      ? 'You are protected here. Organize your Storage Box or finish safe construction while the fog passes. Keep the purifier inside an enclosed room.'
      : 'You are exposed. Enter purified air now. A broken enclosure reduces the purifier to its nearby tiles. Repair the missing edge or reach Elaris sanctuary at X 70, Y 90.', notice: false };
  }
  if (schedule.openingPhase === 'preparing') return {
    title: `First fog in ${schedule.label}`, detail: `Get inside purified air before the countdown ends. The blue floor marks purifier coverage. Prepare storage and keep your entrance clear. Elaris sanctuary at X 70, Y 90 is a fallback. Leaving Elaris ends guided protection.`, notice: false };
  const home = chapter.shelterHome;
  return { title: 'Weather the next fog', detail: `The ordinary threat cycle is running. Spend time in purified air during a fog and survive until it clears.${home ? ` Your home is in ${home.areaKey} at X ${home.tileX}, Y ${home.tileY}.` : ''} Elaris sanctuary at X 70, Y 90 is a fallback.`, notice: false };
}
