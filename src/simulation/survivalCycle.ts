import {
  CLOTH_MASK_PROTECTION_SECONDS,
  DANGER_PHASE_SECONDS,
  SAFE_PHASE_SECONDS,
  TICKS_PER_SECOND,
  createDefaultGameBalance,
} from '../config/balance';
import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { buildableById } from '../content/buildingParts';
import { dropCarriedBlueprintsOnDefeat } from './carriedBlueprints';
import { stashDeathCache } from './deathCache';
import { DANGER_ONBOARDING_THREATS, DANGER_ROTATION_THREATS } from '../content/dangerThreats';
import { effectiveBuildingDimensions } from './buildingGeometry';
import { cellKey, environments, type EnvironmentInfo } from './environmentProgress';
import { enterVisitedArea, enterWorldArea, isElaris } from './areas';
import { creaturePurifiedCells } from './creatureRoles';
import { hasElarisFallen } from './elarisFall';
import { isElarisTownSafeZone, isPlayerInsideTownBuilding } from './town';
import { isWithinPermanentPurifierWorldPosition } from '../content/townDefences';
import { reconcileResourceStacks } from './inventoryStacks';
import { purifierRadiusTiles } from './facilityLevels';
import type {
  AreaSnapshot,
  BuildingState,
  DangerThreat,
  EditableRaidBalance,
  GameState,
  PlayerDefeatCause,
  ResourceId,
} from './state';

export {
  DANGER_EXPOSURE_DAMAGE_PER_SECOND,
  DANGER_GRACE_SECONDS,
  DANGER_PHASE_SECONDS,
  SAFE_PHASE_SECONDS,
} from '../config/balance';

export const SURVIVAL_CYCLE_SECONDS = SAFE_PHASE_SECONDS + DANGER_PHASE_SECONDS;
export const SURVIVAL_CYCLE_TICKS = SURVIVAL_CYCLE_SECONDS * TICKS_PER_SECOND;
/** An unenclosed purifier protects its own tile and every immediately adjacent tile. */
export const OUTDOOR_PURIFIER_RADIUS_TILES = 1;
export const RESPAWN_PROTECTION_SECONDS = 5;
export const ELARIS_SANCTUARY_TILE = { x: 70, y: 90 } as const;

/**
 * Cycle timing as the shipped defaults describe it. Every function here accepts
 * an optional EditableRaidBalance so the Admin panel can retune the cycle, and
 * falls back to this when a caller has no state in hand (tests, pure views).
 */
const DEFAULT_RAID_BALANCE: EditableRaidBalance = createDefaultGameBalance().raid;

/** How long the danger phase of the given cycle runs, in ticks. */
export function dangerPhaseTicks(raid: EditableRaidBalance, cycleIndex: number): number {
  return raid.dangerPhaseSecondsByThreat[dangerThreatFor(cycleIndex)] * TICKS_PER_SECOND;
}

/**
 * One cycle is a safe phase plus the danger phase of whichever threat that
 * cycle brings, so cycles are no longer all the same length: retuning the fog
 * night alone stretches the odd cycles and leaves the raid ones where they are.
 */
function cycleTicks(raid: EditableRaidBalance, cycleIndex: number): number {
  return raid.safePhaseSeconds * TICKS_PER_SECOND + dangerPhaseTicks(raid, cycleIndex);
}

/** The onboarding cycles, which run once and are never repeated. */
function onboardingTicks(raid: EditableRaidBalance): number {
  let total = 0;
  for (let index = 0; index < DANGER_ONBOARDING_THREATS.length; index += 1) total += cycleTicks(raid, index);
  return total;
}

/** One full pass through the repeating rotation — the smallest repeating stretch. */
function rotationTicks(raid: EditableRaidBalance): number {
  let total = 0;
  for (let index = 0; index < DANGER_ROTATION_THREATS.length; index += 1) {
    total += cycleTicks(raid, DANGER_ONBOARDING_THREATS.length + index);
  }
  return total;
}

interface CyclePosition {
  cycleIndex: number;
  /** Ticks elapsed inside that cycle, safe phase first. */
  cycleTick: number;
}

/**
 * Where a tick sits in the schedule. Cycle lengths vary with the threat, and
 * the pattern only repeats after the one-off onboarding cycles have run, so the
 * position is found by walking the onboarding stretch, then dividing out whole
 * rotations and walking the handful of cycles inside one — cheap, and exact
 * under any mix of per-threat durations.
 */
function cyclePosition(tick: number, raid: EditableRaidBalance): CyclePosition {
  let remaining = Math.max(0, tick);
  const onboarding = onboardingTicks(raid);
  if (remaining < onboarding) {
    for (let index = 0; index < DANGER_ONBOARDING_THREATS.length; index += 1) {
      const length = cycleTicks(raid, index);
      if (remaining < length) return { cycleIndex: index, cycleTick: remaining };
      remaining -= length;
    }
  }

  remaining -= onboarding;
  const rotation = rotationTicks(raid);
  const rotations = Math.floor(remaining / rotation);
  remaining -= rotations * rotation;
  const base = DANGER_ONBOARDING_THREATS.length + rotations * DANGER_ROTATION_THREATS.length;
  for (let offset = 0; offset < DANGER_ROTATION_THREATS.length; offset += 1) {
    const length = cycleTicks(raid, base + offset);
    if (remaining < length) return { cycleIndex: base + offset, cycleTick: remaining };
    remaining -= length;
  }
  // Unreachable: the offsets above sum to exactly one rotation.
  return { cycleIndex: base + DANGER_ROTATION_THREATS.length, cycleTick: 0 };
}

/**
 * Which survival cycle a tick belongs to. The danger minute is the tail of a
 * cycle, so a raid and the cycle that spawned it always share this index, and
 * the danger→safe transition is exactly where this value increments.
 */
export function survivalCycleIndex(tick: number, raid: EditableRaidBalance = DEFAULT_RAID_BALANCE): number {
  return cyclePosition(tick, raid).cycleIndex;
}

/**
 * What a danger phase brings. Poison fog and raiders used to arrive together,
 * which made them contradict each other: the fog demanded the player stand
 * still in a purified room while the raid demanded they go outside and shoot,
 * and the fog always won — exposure ramps to 40 HP/s, so being in range of a
 * raider meant dying to the air. Alternating gives each night one legible
 * demand, and makes the player's bow worth carrying.
 */
export type { DangerThreat };

/**
 * Which threat a cycle brings. Derived from the cycle index alone, so the
 * schedule costs no saved state, survives a reload, and reads identically from
 * the live raid path and the absent-base one.
 *
 * Cycle zero is fog: a new player has a purifier room before they have arrows,
 * a turret, or a wall worth hiding behind, so shelter is the fair first test.
 * Two fog/raid pairs later the storm joins, and from there the three threats
 * rotate forever.
 */
export function dangerThreatFor(cycleIndex: number): DangerThreat {
  const index = Math.max(0, Math.floor(cycleIndex));
  const onboarding = DANGER_ONBOARDING_THREATS[index];
  if (onboarding) return onboarding;
  const offset = (index - DANGER_ONBOARDING_THREATS.length) % DANGER_ROTATION_THREATS.length;
  return DANGER_ROTATION_THREATS[offset] ?? DANGER_ROTATION_THREATS[0];
}

export function dangerThreatAtTick(
  tick: number,
  raid: EditableRaidBalance = DEFAULT_RAID_BALANCE,
): DangerThreat {
  return dangerThreatFor(survivalCycleIndex(tick, raid));
}

/**
 * Which raid a raid night is, counting from zero: the number of raid cycles
 * that ran before this one. Wave composition keys off this rather than the
 * cycle index, so inserting the storm into the rotation does not make every
 * third raid skip a step of growth — raid N stays the raid N it always was, and
 * fog and storm cycles never inflate a wave or settle an absent base.
 */
export function raidNumberFor(cycleIndex: number): number {
  const index = Math.max(0, Math.floor(cycleIndex));
  const onboarding = Math.min(index, DANGER_ONBOARDING_THREATS.length);
  let raids = 0;
  for (let offset = 0; offset < onboarding; offset += 1) {
    if (DANGER_ONBOARDING_THREATS[offset] === 'raid') raids += 1;
  }
  if (index <= DANGER_ONBOARDING_THREATS.length) return raids;

  const after = index - DANGER_ONBOARDING_THREATS.length;
  const rotations = Math.floor(after / DANGER_ROTATION_THREATS.length);
  raids += rotations * DANGER_ROTATION_THREATS.filter((threat) => threat === 'raid').length;
  const remainder = after - rotations * DANGER_ROTATION_THREATS.length;
  for (let offset = 0; offset < remainder; offset += 1) {
    if (DANGER_ROTATION_THREATS[offset] === 'raid') raids += 1;
  }
  return raids;
}

export interface SurvivalTimerView {
  phase: 'safe' | 'danger';
  /** Which threat this cycle's danger phase brings, whether or not it has begun. */
  threat: DangerThreat;
  secondsRemaining: number;
  label: string;
}

export interface PlayerDefeatResult {
  /** What actually killed the player. */
  cause: PlayerDefeatCause;
  lostItemCount: number;
  pendingRespawn: true;
}

export interface DangerGraceTimerView {
  secondsRemaining: number;
  label: string;
}

interface AreaBuildings {
  key: string;
  name: string;
  x: number;
  y: number;
  buildings: BuildingState[];
}

export interface RespawnDestination {
  id: string;
  kind: 'elaris' | 'bed';
  label: string;
  areaKey: string;
  areaName: string;
  areaX: number;
  areaY: number;
  bedId: string | null;
  x: number;
  y: number;
  sheltered: boolean;
  safe: boolean;
}

export interface RespawnCommandResult {
  ok: boolean;
  message: string;
  destination?: RespawnDestination;
}

/** The timer is derived from the persisted simulation tick, so reloads cannot reset it. */
export function survivalTimerAtTick(
  tick: number,
  raid: EditableRaidBalance = DEFAULT_RAID_BALANCE,
): SurvivalTimerView {
  // During a safe phase the threat named is the one this cycle is counting down
  // to, which is the whole point of showing it: the player is being told what to
  // prepare for, not what is already happening. It also decides how long the
  // danger phase this countdown ends in will run.
  const { cycleIndex, cycleTick } = cyclePosition(tick, raid);
  const threat = dangerThreatFor(cycleIndex);
  const safeTicks = raid.safePhaseSeconds * TICKS_PER_SECOND;
  const phase = cycleTick < safeTicks ? 'safe' : 'danger';
  const phaseTick = phase === 'safe' ? cycleTick : cycleTick - safeTicks;
  const duration = phase === 'safe' ? raid.safePhaseSeconds : raid.dangerPhaseSecondsByThreat[threat];
  const secondsRemaining = Math.max(0, duration - 1 - Math.floor(phaseTick / TICKS_PER_SECOND));
  return {
    phase,
    threat,
    secondsRemaining,
    label: formatCountdown(secondsRemaining),
  };
}

export interface SurvivalSchedule extends SurvivalTimerView {
  cycleIndex: number;
  dangerElapsedTicks: number | null;
  dangerDurationTicks: number;
  safeRemainingTicks: number;
  openingPhase: 'waiting' | 'preparing' | 'fog' | null;
}

/** All live threat consumers use this schedule; the world clock never pauses or resets. */
export function survivalSchedule(state: GameState): SurvivalSchedule {
  const raid = state.gameBalance.raid;
  const opening = state.onboarding.firstThreat;
  let tick = state.tick;
  if (opening?.mode === 'guided') {
    if (opening.releasedAtTick !== null) tick = state.tick - opening.releasedAtTick;
    else if (opening.fogEndsAtTick !== null && state.tick >= opening.fogEndsAtTick) {
      // The lesson replaces cycle zero. Continue with the first raid's safe phase.
      tick = cycleTicks(raid, 0) + state.tick - opening.fogEndsAtTick;
    } else {
      const start = opening.fogStartsAtTick;
      const end = opening.fogEndsAtTick;
      const waiting = start === null || end === null;
      const fog = !waiting && state.tick >= start;
      const remaining = waiting ? 0 : Math.max(0, Math.ceil(((fog ? end : start) - state.tick) / TICKS_PER_SECOND));
      return { phase: fog ? 'danger' : 'safe', threat: 'fog', secondsRemaining: remaining,
        label: waiting ? '—' : formatCountdown(remaining), cycleIndex: 0,
        dangerElapsedTicks: fog ? state.tick - start! : null,
        dangerDurationTicks: waiting ? 0 : end! - start!, safeRemainingTicks: waiting || fog ? 0 : start! - state.tick,
        openingPhase: waiting ? 'waiting' : fog ? 'fog' : 'preparing' };
    }
  }
  const timer = survivalTimerAtTick(tick, raid);
  const cycleIndex = survivalCycleIndex(tick, raid);
  return { ...timer, cycleIndex, dangerElapsedTicks: dangerPhaseElapsedTicks(tick, raid),
    dangerDurationTicks: dangerPhaseTicks(raid, cycleIndex),
    safeRemainingTicks: timer.phase === 'safe' ? raid.safePhaseSeconds * TICKS_PER_SECOND - cyclePosition(tick, raid).cycleTick : 0, openingPhase: null };
}

/**
 * How far into the current danger phase a tick sits, in ticks, or null outside
 * one. The raid spawn delay is measured against this rather than against the
 * cycle, so a retuned safe phase never shifts the warning window.
 */
export function dangerPhaseElapsedTicks(tick: number, raid: EditableRaidBalance = DEFAULT_RAID_BALANCE): number | null {
  const safeTicks = raid.safePhaseSeconds * TICKS_PER_SECOND;
  const { cycleTick } = cyclePosition(tick, raid);
  return cycleTick < safeTicks ? null : cycleTick - safeTicks;
}

export interface DangerPhaseSkipResult {
  ok: boolean;
  message: string;
  /** Ticks the clock jumped forward, so a caller can report the shortcut taken. */
  skippedTicks: number;
}

/**
 * Cut the current safe phase short and land on the first tick of the danger
 * phase. The phase is derived from the tick alone, so starting a raid on demand
 * is exactly a jump to that boundary — no raid state needs priming, and the
 * cycle index is untouched because the danger phase is the tail of its own
 * cycle. The spawn delay still runs from there: the warning window is part of
 * the round, not part of the wait for it.
 */
export function startDangerPhaseNow(state: GameState): DangerPhaseSkipResult {
  const opening = survivalSchedule(state);
  if (opening.openingPhase !== null) return { ok: false, message: 'Finish the guided fog lesson before skipping threat phases', skippedTicks: 0 };
  if (opening.phase === 'danger') {
    return { ok: false, message: 'The danger phase is already running', skippedTicks: 0 };
  }

  const skippedTicks = opening.safeRemainingTicks;
  state.tick += skippedTicks;
  // Exposure is only ever armed during a danger phase, but clearing it keeps a
  // stale start tick from billing the player for the seconds just skipped.
  state.dangerExposureStartedAtTick = null;
  const seconds = Math.round(skippedTicks / TICKS_PER_SECOND);
  return {
    ok: true,
    message: `Danger phase started — skipped ${formatCountdown(seconds)} of the safe phase`,
    skippedTicks,
  };
}

export function formatCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

/** The secondary countdown shown only while an exposed player can still recover. */
export function dangerGraceTimer(state: GameState): DangerGraceTimerView | null {
  const startedAtTick = state.dangerExposureStartedAtTick;
  const raid = state.gameBalance.raid;
  const timer = survivalSchedule(state);
  if (
    startedAtTick === null
    || timer.phase !== 'danger'
    || timer.threat !== 'fog'
    || state.player.hp === 0
    || isPlayerSheltered(state)
  ) return null;

  const graceTicks = raid.graceSeconds * TICKS_PER_SECOND;
  const ticksRemaining = Math.max(0, graceTicks - Math.max(0, state.tick - startedAtTick));
  const secondsRemaining = Math.ceil(ticksRemaining / TICKS_PER_SECOND);
  return { secondsRemaining, label: formatCountdown(secondsRemaining) };
}

/**
 * Whole seconds of filter left on the worn Cloth Mask, or 0 when none is worn.
 * Masks are spent automatically, so this is the only way the player sees one
 * being used at all.
 */
export function clothMaskSecondsRemaining(state: GameState): number {
  if (state.clothMaskActiveUntilTick === null) return 0;
  return Math.max(0, Math.ceil((state.clothMaskActiveUntilTick - state.tick) / TICKS_PER_SECOND));
}

/**
 * Exposure drain for the given whole second of exposure, one-indexed. The drain
 * starts gentle and climbs, so losing shelter opens a window to reach another
 * purified room rather than being an unavoidable death two seconds later.
 */
export function exposureDamagePerSecond(raid: EditableRaidBalance, exposedSecond: number): number {
  const ramped = raid.exposureDamagePerSecond + raid.exposureRampPerSecond * Math.max(0, exposedSecond - 1);
  return Math.max(0, Math.min(raid.exposureMaxDamagePerSecond, ramped));
}

/**
 * True in protected Elaris town, in the permanent purifier's air, on any tile
 * reached by a player-built purifier, or inside a working Mistmoth's square. The
 * creature's cells are folded in here rather than left to a separate check so
 * that everything that asks "is the player breathing?" gets one answer.
 */
export function isPlayerSheltered(state: GameState): boolean {
  const cell = worldCellKey(state.player.x, state.player.y);
  return isElarisTownSafeZone(state)
    || isPermanentPurifierShelter(state)
    || airPurifierProtectedCells(state.buildings).has(cell)
    || creaturePurifiedCells(state).has(cell);
}

/**
 * True on the ground the permanent Elaris purifier keeps clean. Unlike every
 * other town protection this one does not ask whether Elaris still stands: the
 * column is the fixed refuge a roaming character can always run to on a fog
 * night, and it would be worth nothing if it switched off at level six.
 *
 * It shelters only — it is not an enclosure, so a raid night still requires
 * walls and standing in its air will not hide anyone from raiders.
 */
export function isPermanentPurifierShelter(state: GameState): boolean {
  return isElaris(state) && isWithinPermanentPurifierWorldPosition(state.player.x, state.player.y);
}

/**
 * The enclosed indoor room at a point, purified or not.
 *
 * This is deliberately a weaker test than shelteredEnvironmentAt, and the
 * difference is what separates the two nights. Fog night is survived behind a
 * filter; raid night is survived behind walls, because the air is clean and
 * only the raiders care about the door. So raider targeting asks this, exposure
 * asks for purification, and a raid-night bunker needs no Air Purifier at all.
 */
export function enclosedEnvironmentAt(
  buildings: readonly BuildingState[],
  worldX: number,
  worldY: number,
): EnvironmentInfo | null {
  const cell = cellKey(Math.floor(worldX / TILE_SIZE), Math.floor(worldY / TILE_SIZE));
  return environments(buildings).find((environment) =>
    environment.valid && environment.kind === 'indoor' && environment.cells.has(cell)) ?? null;
}

/**
 * True while the player is in the protected town or under a roof — off the
 * raid's menu, and out of the storm's aim.
 *
 * Four walls are four walls no matter who stacked them, so an authored NPC
 * building counts exactly as much as a room the player enclosed themselves.
 * That matters most after Elaris falls and the municipal fence stops covering
 * the ground: the field copies of the services are still buildings, and
 * stepping into one is still stepping indoors.
 */
export function isPlayerEnclosed(state: GameState): boolean {
  return isElarisTownSafeZone(state)
    || isPlayerInsideTownBuilding(state)
    || enclosedEnvironmentAt(state.buildings, state.player.x, state.player.y) !== null;
}

export function shelteredEnvironmentAt(
  buildings: readonly BuildingState[],
  worldX: number,
  worldY: number,
): EnvironmentInfo | null {
  const playerCell = cellKey(Math.floor(worldX / TILE_SIZE), Math.floor(worldY / TILE_SIZE));
  return shelteredEnvironments(buildings).find((environment) => environment.cells.has(playerCell)) ?? null;
}

/** Every purified player-built room; Elaris town protection is handled separately. */
export function shelteredEnvironments(buildings: readonly BuildingState[]): EnvironmentInfo[] {
  return environments(buildings).filter((environment) =>
    environment.valid
    && environment.kind === 'indoor'
    && roomIsPurified(buildings, environment));
}

/**
 * Every tile protected from poison fog by player-built Air Purifiers.
 *
 * A purifier fully inside a valid enclosed indoor room protects that whole
 * room. Otherwise it protects the 3x3 square centered on its own build tile.
 * This makes an incomplete room useful without leaking that local protection
 * outward once the enclosure is successfully closed.
 */
export function airPurifierProtectedCells(buildings: readonly BuildingState[]): Set<string> {
  const rooms = environments(buildings).filter((environment) =>
    environment.valid && environment.kind === 'indoor');
  const protectedCells = new Set<string>();

  for (const purifier of buildings.filter((building) => building.definitionId === 'air-purifier')) {
    const room = rooms.find((environment) => buildingInside(environment, purifier));
    if (room) {
      for (const cell of room.cells) protectedCells.add(cell);
      continue;
    }

    // Level 1 is OUTDOOR_PURIFIER_RADIUS_TILES; higher levels reach further.
    const radius = Math.max(OUTDOOR_PURIFIER_RADIUS_TILES, purifierRadiusTiles(purifier));
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const tileX = purifier.tileX + dx;
        const tileY = purifier.tileY + dy;
        if (tileX < 0 || tileY < 0 || tileX >= WORLD_TILES || tileY >= WORLD_TILES) continue;
        protectedCells.add(cellKey(tileX, tileY));
      }
    }
  }

  return protectedCells;
}

/** A room is safe only while an Air Purifier sits fully inside it. */
function roomIsPurified(buildings: readonly BuildingState[], environment: EnvironmentInfo): boolean {
  return buildings.some((building) =>
    building.definitionId === 'air-purifier' && buildingInside(environment, building));
}

/**
 * Apply the danger-minute exposure rule once per fixed step. Reaching shelter
 * clears exposure outright rather than pausing it: the drain ramps upward the
 * longer it runs, so resuming a half-spent ramp on the next step outside would
 * reproduce exactly the un-survivable spike the ramp exists to remove.
 *
 * Shelter comes from an Air Purifier's room. Beds remain valid respawn anchors
 * even without one, and the post-respawn grace period prevents an immediate
 * exposure loop while the player gets back to safety.
 */
export function advanceSurvivalCycle(state: GameState): PlayerDefeatResult | null {
  if (state.pendingRespawn) return null;
  const raid = state.gameBalance.raid;
  const timer = survivalSchedule(state);
  // Raid nights have clean air. Draining health outside on one would recreate
  // exactly the contradiction alternating exists to remove: the player cannot
  // be asked to go out and fight a wave while the atmosphere kills them for it.
  if (
    timer.phase !== 'danger'
    || timer.threat !== 'fog'
    || state.player.hp === 0
    || isPlayerSheltered(state)
  ) {
    state.dangerExposureStartedAtTick = null;
    return null;
  }

  if (state.dangerExposureStartedAtTick === null || state.dangerExposureStartedAtTick > state.tick) {
    state.dangerExposureStartedAtTick = state.tick;
    return null;
  }

  const graceTicks = raid.graceSeconds * TICKS_PER_SECOND;
  const exposedSince = state.dangerExposureStartedAtTick;
  const exposedTicks = state.tick - exposedSince;
  if (exposedTicks <= graceTicks) return null;

  // Masks are drawn only once the fog would actually bite, so the free grace
  // period never burns one, and each mask covers damaging seconds only.
  if (state.clothMaskActiveUntilTick !== null && state.tick < state.clothMaskActiveUntilTick) {
    // Holding the exposure clock with the mask keeps the ramp paused: resuming
    // a half-spent ramp is exactly the un-survivable spike the ramp avoids.
    state.dangerExposureStartedAtTick = exposedSince + 1;
    return null;
  }
  state.clothMaskActiveUntilTick = null;
  if (state.inventory['cloth-mask'] > 0) {
    state.inventory['cloth-mask'] -= 1;
    state.clothMaskActiveUntilTick = state.tick + CLOTH_MASK_PROTECTION_SECONDS * TICKS_PER_SECOND;
    state.dangerExposureStartedAtTick = exposedSince + 1;
    return null;
  }

  // The fog bites once per whole exposed second rather than shaving a sliver
  // off every tick: a single readable hit per second is what the HUD promises,
  // and it keeps the ramp in whole numbers with no rounding drift.
  const damagingTicks = exposedTicks - graceTicks;
  if (damagingTicks % TICKS_PER_SECOND !== 0) return null;
  const damage = exposureDamagePerSecond(raid, damagingTicks / TICKS_PER_SECOND);
  state.player.hp = Math.max(0, state.player.hp - damage);
  if (state.player.hp > 0) return null;

  state.dangerExposureStartedAtTick = null;
  return beginPlayerDefeat(state);
}

/**
 * Begin a durable defeat decision. Carried items are charged exactly once;
 * changing area and restoring health happen only after chooseRespawn.
 */
export function beginPlayerDefeat(
  state: GameState,
  cause: PlayerDefeatResult['cause'] = 'exposure',
): PlayerDefeatResult {
  if (state.pendingRespawn) {
    return {
      cause: state.pendingRespawn.cause,
      lostItemCount: state.pendingRespawn.lostItemCount,
      pendingRespawn: true,
    };
  }
  // Safeguard Charms are spent for the player, exactly as a Cloth Mask is:
  // being defeated is already the punishment, and someone who paid Elowen in
  // advance should not also have to remember to use what they bought.
  //
  // One charm saves one thing. Carrying a single charm into a fight is a
  // choice about *what* matters most rather than a blanket immunity, and a
  // full satchel of blueprints now needs a full purse of charms.
  //
  // Whatever the charms do not cover is stacked where the player fell and
  // beaconed on the map. `lostItemCount` is what left the bag, which is still
  // exactly what the respawn screen reports — it is now a countdown rather
  // than an obituary.
  const lostItemCount = applySafeguardCharms(state);
  state.clothMaskActiveUntilTick = null;
  state.player.hp = 0;
  state.pendingRespawn = {
    cause,
    lostItemCount,
    defeatedAreaKey: state.currentArea.key,
    defeatedAreaName: state.currentArea.name,
    defeatedAreaX: state.currentArea.x,
    defeatedAreaY: state.currentArea.y,
    defeatedX: state.player.x,
    defeatedY: state.player.y,
    defeatedAtTick: state.tick,
  };
  if (state.onboarding.firstThreat && !state.onboarding.completedMilestoneIds.includes('weather-fog')) {
    state.onboarding.firstThreat.shelteredTicks = 0;
    state.onboarding.firstThreat.observedCycleIndex = null;
    state.onboarding.firstThreat.lastObservedTick = null;
  }
  state.respawnProtectionUntilTick = null;
  return { cause, lostItemCount, pendingRespawn: true };
}

/**
 * Spend charms one-for-one over what the player is carrying, most precious
 * first, and destroy the rest.
 *
 * Priority is fixed rather than prompted: a defeat is not a moment to open a
 * menu, and the order below is what a player would pick anyway. Unregistered
 * blueprints come first because they are the only carried thing that cannot be
 * bought or re-gathered; tools next, since each is one saved slot and hours of
 * durability; resource stacks last.
 *
 * Returns how many items were still lost, which is what the respawn screen
 * reports.
 */
function applySafeguardCharms(state: GameState): number {
  let charms = state.inventory['safeguard-charm'];
  let spent = 0;
  let lost = 0;
  const cachedResources: Partial<Record<ResourceId, number>> = {};

  // Blueprints first. A saved one stays in the bag; the rest fall where the
  // player did, so an uncharmed loss is still a race back rather than a wipe.
  const savedBlueprints = state.carriedBlueprints.slice(0, Math.min(charms, state.carriedBlueprints.length));
  const droppedBlueprints = state.carriedBlueprints.slice(savedBlueprints.length);
  charms -= savedBlueprints.length;
  spent += savedBlueprints.length;
  state.carriedBlueprints = droppedBlueprints;
  lost += dropCarriedBlueprintsOnDefeat(state, state.player.x, state.player.y);
  state.carriedBlueprints = savedBlueprints;

  // Tools next, in the order they sit in the bag so the result is stable.
  const savedTools = state.tools.slice(0, Math.min(charms, state.tools.length));
  const cachedTools = state.tools.slice(savedTools.length);
  charms -= savedTools.length;
  spent += savedTools.length;
  lost += cachedTools.length;
  state.tools = savedTools;
  if (!savedTools.some((tool) => tool.instanceId === state.equippedToolId)) {
    state.equippedToolId = null;
  }

  // Resource stacks last, cheapest thing a charm can be spent on. A charm
  // saves a whole stack, never a single unit — spending one to keep one wood
  // would make the item worthless.
  for (const resource of Object.keys(state.inventory) as ResourceId[]) {
    // A charm can never be spent protecting the charms themselves; the ones
    // that were not spent survive on their own below.
    if (resource === 'safeguard-charm') continue;
    const amount = state.inventory[resource];
    if (amount <= 0) continue;
    // At least one, always. A bag whose stack boundaries have not been
    // reconciled yet reports zero stacks, and a stack that costs no charms
    // would be protected for free.
    const stacks = Math.max(1, state.inventoryStacks[resource]?.length ?? 0);
    if (charms >= stacks) {
      charms -= stacks;
      spent += stacks;
      continue;
    }
    lost += amount;
    cachedResources[resource] = (cachedResources[resource] ?? 0) + amount;
    state.inventory[resource] = 0;
    state.inventoryStacks[resource] = [];
  }

  state.inventory['safeguard-charm'] = Math.max(0, state.inventory['safeguard-charm'] - spent);
  reconcileResourceStacks(state, 'safeguard-charm');
  // Nothing here is destroyed: what the charms did not cover is stacked at the
  // player's feet under a ten-minute deadline, and the map lights a beacon on
  // it. The bag is still empty walking away — the cost of a defeat is the run
  // back through whatever killed you, made on the clock.
  stashDeathCache(state, cachedResources, cachedTools);
  return lost;
}

function areaBuildingSets(state: GameState): AreaBuildings[] {
  const areas: AreaBuildings[] = [{
    key: state.currentArea.key,
    name: state.currentArea.name,
    x: state.currentArea.x,
    y: state.currentArea.y,
    buildings: state.buildings,
  }];
  for (const [key, area] of Object.entries(state.visitedAreas) as Array<[string, AreaSnapshot]>) {
    if (key !== state.currentArea.key) {
      areas.push({ key, name: area.name, x: area.x, y: area.y, buildings: area.buildings });
    }
  }
  return areas;
}

/** Elaris is permanent; every surviving player-built Bed is also offered. */
export function respawnDestinations(state: GameState): RespawnDestination[] {
  const candidates: Array<Omit<RespawnDestination, 'label'>> = [];
  for (const area of areaBuildingSets(state)) {
    const rooms = environments(area.buildings).filter((environment) => environment.valid && environment.kind === 'indoor');
    const protectedCells = airPurifierProtectedCells(area.buildings);
    for (const bed of area.buildings.filter((building) => building.definitionId === 'bed')) {
      const room = rooms.find((environment) => buildingInside(environment, bed)) ?? null;
      const point = room ? respawnPointBesideBed(area.buildings, room, bed) : buildingCenter(bed);
      const safe = protectedCells.has(worldCellKey(point.x, point.y));
      candidates.push({
        id: `bed:${bed.id}`,
        kind: 'bed',
        areaKey: area.key,
        areaName: area.name,
        areaX: area.x,
        areaY: area.y,
        bedId: bed.id,
        x: point.x,
        y: point.y,
        sheltered: room !== null,
        safe,
      });
    }
  }
  candidates.sort((a, b) =>
    a.areaY - b.areaY || a.areaX - b.areaX
    || entityOrder(a.bedId ?? '') - entityOrder(b.bedId ?? '')
    || (a.bedId ?? '').localeCompare(b.bedId ?? ''));

  // The waystone still stands in the ruins, so it remains the last-resort
  // respawn for a player with no bed. It stops advertising the enclosure it can
  // no longer give — the ruins are open ground during a raid — but the
  // permanent purifier beside it still cleans the air it lands you in, so a fog
  // night never spawns anyone straight back into exposure.
  const fallen = hasElarisFallen(state);
  const sanctuaryX = (ELARIS_SANCTUARY_TILE.x + 0.5) * TILE_SIZE;
  const sanctuaryY = (ELARIS_SANCTUARY_TILE.y + 0.5) * TILE_SIZE;
  const sanctuary: RespawnDestination = {
    id: 'elaris-sanctuary',
    kind: 'elaris',
    label: fallen ? 'Elaris Ruins' : 'Elaris Sanctuary',
    areaKey: '0,0',
    areaName: fallen ? 'Ruins of Elaris' : 'Elaris',
    areaX: 0,
    areaY: 0,
    bedId: null,
    x: sanctuaryX,
    y: sanctuaryY,
    sheltered: !fallen,
    safe: !fallen || isWithinPermanentPurifierWorldPosition(sanctuaryX, sanctuaryY),
  };
  return [
    sanctuary,
    ...candidates.map((candidate, index) => ({
      ...candidate,
      label: `Bed ${index + 1} — ${candidate.areaName}`,
    })),
  ];
}

/** Resolve the persisted choice and awaken with a short anti-spawn-kill grace. */
export function chooseRespawn(state: GameState, destinationId: string): RespawnCommandResult {
  if (!state.pendingRespawn) return { ok: false, message: 'You are not awaiting respawn' };
  const destination = respawnDestinations(state).find((candidate) => candidate.id === destinationId);
  if (!destination) return { ok: false, message: 'That respawn point is no longer available' };

  const entered = destination.kind === 'elaris'
    ? enterWorldArea(state, 0, 0)
    : enterVisitedArea(state, destination.areaKey);
  if (!entered) return { ok: false, message: 'That respawn area could not be restored' };

  state.player.x = destination.x;
  state.player.y = destination.y;
  state.player.facing = 'down';
  state.player.traversalMode = 'foot';
  state.player.hp = state.player.maxHp;
  state.dangerExposureStartedAtTick = null;
  state.clothMaskActiveUntilTick = null;
  state.pendingRespawn = null;
  state.respawnProtectionUntilTick = state.tick + RESPAWN_PROTECTION_SECONDS * TICKS_PER_SECOND;
  return {
    ok: true,
    message: destination.kind === 'elaris'
      ? 'Awakened safely in Elaris'
      : `Awakened at ${destination.label}`,
    destination,
  };
}

export function isRespawnProtected(state: GameState): boolean {
  return state.respawnProtectionUntilTick !== null && state.tick < state.respawnProtectionUntilTick;
}

function buildingInside(environment: EnvironmentInfo, building: BuildingState): boolean {
  const dimensions = effectiveBuildingDimensions(building);
  for (let dy = 0; dy < dimensions.tilesHigh; dy += 1) {
    for (let dx = 0; dx < dimensions.tilesWide; dx += 1) {
      if (!environment.cells.has(cellKey(building.tileX + dx, building.tileY + dy))) return false;
    }
  }
  return true;
}

function respawnPointBesideBed(
  buildings: readonly BuildingState[],
  room: EnvironmentInfo,
  bed: BuildingState,
): { x: number; y: number } {
  const dimensions = effectiveBuildingDimensions(bed);
  const bedCenterX = bed.tileX + dimensions.tilesWide / 2;
  const bedCenterY = bed.tileY + dimensions.tilesHigh / 2;
  const blocked = new Set<string>();
  for (const building of buildings) {
    if (buildableById(building.definitionId).layer !== 'footprint') continue;
    const footprint = effectiveBuildingDimensions(building);
    for (let dy = 0; dy < footprint.tilesHigh; dy += 1) for (let dx = 0; dx < footprint.tilesWide; dx += 1) {
      blocked.add(cellKey(building.tileX + dx, building.tileY + dy));
    }
  }
  const cells = [...room.cells]
    .map((key) => key.split(',').map(Number) as [number, number])
    .sort((a, b) => ((a[0] + 0.5 - bedCenterX) ** 2 + (a[1] + 0.5 - bedCenterY) ** 2)
      - ((b[0] + 0.5 - bedCenterX) ** 2 + (b[1] + 0.5 - bedCenterY) ** 2));
  const [tileX, tileY] = cells.find(([x, y]) => !blocked.has(cellKey(x, y))) ?? cells[0] ?? [bed.tileX, bed.tileY];
  return { x: (tileX + 0.5) * TILE_SIZE, y: (tileY + 0.5) * TILE_SIZE };
}

function buildingCenter(building: BuildingState): { x: number; y: number } {
  const dimensions = effectiveBuildingDimensions(building);
  return {
    x: (building.tileX + dimensions.tilesWide / 2) * TILE_SIZE,
    y: (building.tileY + dimensions.tilesHigh / 2) * TILE_SIZE,
  };
}

function worldCellKey(worldX: number, worldY: number): string {
  return cellKey(Math.floor(worldX / TILE_SIZE), Math.floor(worldY / TILE_SIZE));
}

function entityOrder(id: string): number {
  const value = Number(id.match(/(\d+)$/)?.[1]);
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}
