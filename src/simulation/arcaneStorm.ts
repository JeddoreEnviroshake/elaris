import { TICKS_PER_SECOND } from '../config/balance';
import { TILE_SIZE } from '../config/platform';
import { addGroundDrop } from './gameplayCommands';
import { generateAreaContainers } from './worldGeneration';
import {
  beginPlayerDefeat,
  isPlayerEnclosed,
  isRespawnProtected,
  survivalSchedule,
  type PlayerDefeatResult,
} from './survivalCycle';
import type {
  ArcaneStrikeState,
  EditableArcaneStormBalance,
  GameState,
  GroundDropState,
} from './state';

/**
 * How long a resolved strike is kept after it lands, in ticks.
 *
 * Purely for presentation: the flash and the shard burst need a record to hang
 * off, and half a second is long enough to see what hit you without leaving
 * dead markers on the ground.
 */
export const ARCANE_IMPACT_AFTERMATH_TICKS = 30;

export interface ArcaneStrikeSlot {
  strikeIndex: number;
  /** Ticks from the start of the danger phase to the marker appearing. */
  telegraphOffsetTicks: number;
  /** Ticks from the start of the danger phase to the impact landing. */
  impactOffsetTicks: number;
  /** Iron ore this slot pays where it lands; zero for ordinary slots. */
  rewardIronOre: number;
}

export interface ArcaneStormAdvanceResult {
  /** True when any strike was created, resolved, or pruned this tick. */
  changed: boolean;
  /** Set only when this tick's impact took the player's last health. */
  defeat: PlayerDefeatResult | null;
}

/** The nearest pending impact the player has to answer, for the HUD. */
export interface ArcaneStormImpactView {
  strike: ArcaneStrikeState;
  secondsRemaining: number;
  /** How far through the telegraph the marker is, 0 at first sight and 1 at impact. */
  progress: number;
  /** True while the player stands inside the ring that is about to land. */
  playerInsideRadius: boolean;
}

/**
 * Every strike a storm of this length will schedule.
 *
 * Derived from balance rather than saved, so retuning the cadence reshapes the
 * next storm without migrating anything, and both renderers can describe a
 * storm that has not started yet. The last slot is the last impact that lands
 * strictly inside the phase: a strike that would resolve on or after the
 * boundary belongs to no event and is simply not scheduled.
 */
export function stormStrikeSchedule(
  storm: EditableArcaneStormBalance,
  dangerPhaseSeconds: number,
): ArcaneStrikeSlot[] {
  const slots: ArcaneStrikeSlot[] = [];
  if (storm.intervalSeconds <= 0) return slots;
  for (
    let seconds = storm.firstImpactSeconds, strikeIndex = 0;
    seconds < dangerPhaseSeconds;
    seconds += storm.intervalSeconds, strikeIndex += 1
  ) {
    const rewarded = storm.rewardEveryStrikes > 0 && (strikeIndex + 1) % storm.rewardEveryStrikes === 0;
    slots.push({
      strikeIndex,
      telegraphOffsetTicks: Math.max(0, seconds - storm.telegraphSeconds) * TICKS_PER_SECOND,
      impactOffsetTicks: seconds * TICKS_PER_SECOND,
      rewardIronOre: rewarded ? storm.rewardIronOre : 0,
    });
  }
  return slots;
}

/** Damage radius in whole pixels. */
export function stormImpactRadiusPx(storm: EditableArcaneStormBalance): number {
  return storm.impactRadiusTiles * TILE_SIZE;
}

/**
 * Whether a point is inside a strike. The boundary counts as inside: the ring
 * the renderers draw is the damage area itself, so a player standing exactly on
 * the line is standing in it.
 */
export function isInsideStrike(strike: ArcaneStrikeState, radiusPx: number, x: number, y: number): boolean {
  const dx = x - strike.x;
  const dy = y - strike.y;
  return dx * dx + dy * dy <= radiusPx * radiusPx;
}

/**
 * Markers worth drawing in the area the player is standing in, oldest first —
 * pending ones and the recently resolved ones still playing their aftermath.
 */
export function activeStormStrikes(state: GameState): ArcaneStrikeState[] {
  return state.arcaneStorm.strikes
    .filter((strike) => strike.areaKey === state.currentArea.key)
    .sort((a, b) => a.impactAtTick - b.impactAtTick || a.strikeIndex - b.strikeIndex);
}

/** The next impact the player has to move for, or null when none is pending. */
export function nextStormImpactView(state: GameState): ArcaneStormImpactView | null {
  const radiusPx = stormImpactRadiusPx(state.gameBalance.storm);
  const pending = activeStormStrikes(state)
    .filter((strike) => strike.resolvedAtTick === null && strike.impactAtTick >= state.tick);
  const strike = pending[0];
  if (!strike) return null;

  const window = Math.max(1, strike.impactAtTick - strike.telegraphAtTick);
  const elapsed = Math.min(window, Math.max(0, state.tick - strike.telegraphAtTick));
  return {
    strike,
    secondsRemaining: Math.ceil((strike.impactAtTick - state.tick) / TICKS_PER_SECOND),
    progress: elapsed / window,
    playerInsideRadius: isInsideStrike(strike, radiusPx, state.player.x, state.player.y),
  };
}

/**
 * One fixed step of the storm: retire what the last storm left behind, create
 * the markers that just became due, land the ones whose deadline has passed,
 * and prune the aftermath.
 *
 * The whole event lives here rather than in the renderers because the dodge has
 * to be judged on simulation distance. A marker drawn a frame behind the player
 * would otherwise decide whether they were hit.
 */
export function advanceArcaneStorm(state: GameState): ArcaneStormAdvanceResult {
  const storm = state.arcaneStorm;
  const raid = state.gameBalance.raid;
  const timer = survivalSchedule(state);
  const cycleIndex = survivalSchedule(state).cycleIndex;
  const running = timer.phase === 'danger' && timer.threat === 'storm';
  let changed = false;
  let defeat: PlayerDefeatResult | null = null;

  // A storm that is over — because the phase ended, or because a jumped clock
  // landed us in a different cycle entirely — settles anything that came due
  // while it ran and then leaves nothing behind for the next event to inherit.
  if (!running || storm.cycleIndex !== cycleIndex) {
    for (const strike of storm.strikes) {
      if (strike.resolvedAtTick !== null || strike.impactAtTick > state.tick) continue;
      // Reachable only when the clock jumped over an impact. Any ore it owed is
      // already past its expiry, so it is dropped expired rather than becoming
      // the one piece of storm loot that waits around forever.
      defeat = resolveStrike(state, strike, state.tick) ?? defeat;
      changed = true;
    }
    if (storm.strikes.length > 0) changed = true;
    storm.strikes = [];
    storm.cycleIndex = running ? cycleIndex : null;
    storm.nextStrikeIndex = 0;
    // Caches belong to the storm that scattered them, opened or not. Leaving
    // them would turn a weather event into permanent scenery, and the next
    // storm's caches are a fresh set — that is what makes standing out in one
    // worth doing more than once.
    if (clearStormCaches(state)) changed = true;
    if (!running) return { changed, defeat };
    if (scatterStormCaches(state, cycleIndex)) changed = true;
  }

  const elapsed = survivalSchedule(state).dangerElapsedTicks;
  if (elapsed === null) return { changed, defeat };
  const phaseStartTick = state.tick - elapsed;
  const phaseEndTick = phaseStartTick + survivalSchedule(state).dangerDurationTicks;
  const balance = state.gameBalance.storm;

  for (const slot of stormStrikeSchedule(balance, raid.dangerPhaseSecondsByThreat.storm)) {
    if (slot.strikeIndex < storm.nextStrikeIndex || slot.telegraphOffsetTicks > elapsed) continue;
    // The slot is spent either way. Suppressing a marker must not bank it for
    // later, or leaving sanctuary would be met by every strike the storm owed.
    storm.nextStrikeIndex = slot.strikeIndex + 1;
    changed = true;
    if (strikesSuppressed(state)) continue;

    storm.strikes.push({
      id: `strike-${state.nextEntityId}`,
      cycleIndex,
      strikeIndex: slot.strikeIndex,
      areaKey: state.currentArea.key,
      // Snapped to the tile the player occupies, which keeps the saved
      // coordinates whole pixels and makes the marker read as a place on the
      // map rather than a circle drawn around a moving body.
      ...tileCentre(state.player.x, state.player.y),
      telegraphAtTick: phaseStartTick + slot.telegraphOffsetTicks,
      impactAtTick: phaseStartTick + slot.impactOffsetTicks,
      rewardIronOre: slot.rewardIronOre,
      resolvedAtTick: null,
    });
    state.nextEntityId += 1;
  }

  for (const strike of storm.strikes) {
    if (strike.resolvedAtTick !== null || strike.impactAtTick > state.tick) continue;
    defeat = resolveStrike(state, strike, phaseEndTick) ?? defeat;
    changed = true;
  }

  const kept = storm.strikes.filter((strike) =>
    strike.resolvedAtTick === null || state.tick - strike.resolvedAtTick < ARCANE_IMPACT_AFTERMATH_TICKS);
  if (kept.length !== storm.strikes.length) {
    storm.strikes = kept;
    changed = true;
  }

  return { changed, defeat };
}

/**
 * The one-shot caches an arcane storm scatters where it breaks.
 *
 * Placed in the area the player is standing in when the storm starts, because
 * that is the area the storm is happening to — a cache in a region nobody is
 * in is loot nobody will ever walk past. Positions are seeded from the area and
 * the cycle, so every storm leaves a different set and two clients agree on it.
 *
 * Returns whether anything was added, which the caller folds into `changed`.
 */
function scatterStormCaches(state: GameState, cycleIndex: number): boolean {
  const count = state.gameBalance.blueprints.stormCachesPerStorm;
  if (count <= 0) return false;
  const caches = generateAreaContainers(
    // Salted by the cycle so this storm's caches are not last storm's caches.
    (state.currentArea.seed ^ 0x5354_524d ^ Math.imul(cycleIndex, 0x9e37_79b9)) >>> 0,
    `${state.currentArea.key}-storm-${cycleIndex}`,
    true,
    state.currentArea,
    state.seed,
    state.currentArea.key,
    count,
    'storm-cache',
  );
  if (caches.length === 0) return false;
  state.containers.push(...caches);
  return true;
}

/**
 * Sweep away every storm cache, opened or not. An emptied ordinary container
 * stays in the world as a prop the player can recognise; a storm cache is
 * weather, and weather does not leave furniture behind.
 */
function clearStormCaches(state: GameState): boolean {
  const kept = state.containers.filter((container) => container.kind !== 'storm-cache');
  if (kept.length === state.containers.length) return false;
  state.containers.length = 0;
  state.containers.push(...kept);
  return true;
}

/**
 * When a scheduled slot passes without a marker.
 *
 * Four walls stop a strike: Elaris, any enclosed player-built room, and the
 * inside of an NPC building are all cover, so the storm asks either for room to
 * move or for somewhere to wait it out. A
 * player who is dead, choosing a respawn, or locked in a turn-based battle
 * cannot walk out of a ring — so none of them are given one to walk out of.
 *
 * Suppressing strikes never touches the clock: the phase countdown and every
 * slot in the schedule are derived from the tick, so the storm runs its full
 * length whether it is answered from indoors or on foot.
 */
function strikesSuppressed(state: GameState): boolean {
  return state.pendingRespawn !== null
    || state.player.hp === 0
    || isPlayerEnclosed(state);
}

/**
 * Land one strike. Resolution is recorded before any side effect, so a save
 * written mid-impact reloads as an impact already paid for rather than one
 * about to be applied twice.
 */
function resolveStrike(
  state: GameState,
  strike: ArcaneStrikeState,
  rewardExpiresAtTick: number | null = null,
): PlayerDefeatResult | null {
  strike.resolvedAtTick = state.tick;

  if (strike.areaKey !== state.currentArea.key) {
    // The player walked out of the area. The ore still falls where the strike
    // was aimed — collecting it means going back — and nobody is there to hurt.
    depositAbsentReward(state, strike, rewardExpiresAtTick);
    return null;
  }

  if (strike.rewardIronOre > 0) {
    addGroundDrop(state, 'iron-ore', strike.rewardIronOre, strike.x, strike.y, rewardExpiresAtTick);
  }

  if (!playerTakesStrike(state, strike)) return null;
  state.player.hp = Math.max(0, state.player.hp - state.gameBalance.storm.playerDamage);
  return state.player.hp === 0 ? beginPlayerDefeat(state, 'arcane-storm') : null;
}

function playerTakesStrike(state: GameState, strike: ArcaneStrikeState): boolean {
  if (strikesSuppressed(state)) return false;
  if (isRespawnProtected(state)) return false;
  return isInsideStrike(strike, stormImpactRadiusPx(state.gameBalance.storm), state.player.x, state.player.y);
}

/** Drop a reward into an area the player is no longer standing in. */
function depositAbsentReward(
  state: GameState,
  strike: ArcaneStrikeState,
  expiresAtTick: number | null,
): void {
  if (strike.rewardIronOre <= 0) return;
  const area = state.visitedAreas[strike.areaKey];
  if (!area) return;
  const drop: GroundDropState = {
    id: `drop-${state.nextEntityId}`,
    resource: 'iron-ore',
    amount: strike.rewardIronOre,
    x: strike.x,
    y: strike.y,
    expiresAtTick,
  };
  state.nextEntityId += 1;
  area.groundDrops.push(drop);
}

function tileCentre(worldX: number, worldY: number): { x: number; y: number } {
  return {
    x: Math.floor(worldX / TILE_SIZE) * TILE_SIZE + Math.floor(TILE_SIZE / 2),
    y: Math.floor(worldY / TILE_SIZE) * TILE_SIZE + Math.floor(TILE_SIZE / 2),
  };
}
