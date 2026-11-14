import { INTERACTION_RANGE_PX, TICKS_PER_SECOND, gameRaiderDefinition, gameToolDefinition, leveledRaiderDefinition } from '../config/balance';
import { scaleByLevel, spawnLevel } from './enemyLevels';
import { TILE_SIZE, WORLD_PX } from '../config/platform';
import { buildableById } from '../content/buildingParts';
import { RAIDER_KIND_IDS, raiderBounty, raiderDefinition, type RaiderDefinition } from '../content/raiders';
import { addGroundDrop, damageStructure, equippedBow, structureMaxHp, tryAddResource, type CommandResult } from './gameplayCommands';
import { boundaryEdgeKey, buildOccupancy, cellKey } from './environmentProgress';
import { effectiveBuildingDimensions } from './buildingGeometry';
import { solidBoundaryBetween } from './buildingCollision';
import { homesteadRating } from './scoring';
import { creditCoins } from './coins';
import { rollRaiderBlueprint } from './blueprintFinds';
import { blueprintWaveBonus, effectiveAggroRangePx } from './blueprintHeat';
import { createRng } from './rng';
import { snarlfoxDetectionMultiplierBps } from './creatureRoles';
import { rangedDamageBonus } from './characterProgression';
import {
  payStrikeCost,
  payUseCost,
  strikeBlockedReason,
  strikeProfile,
  strikeReachPx,
  useCostShortfall,
} from './strike';
import { hasElarisFallen, isElarisSanctuary } from './elarisFall';
import { isWithinTownSafeZoneWorldPosition } from '../content/townDefences';
import {
  beginPlayerDefeat, dangerThreatFor, isPlayerEnclosed,
  isRespawnProtected, raidNumberFor, shelteredEnvironments, survivalSchedule,
  type PlayerDefeatResult,
} from './survivalCycle';
import type {
  AreaSnapshot, BuildingState, EditableRaidBalance, GameBalanceState, GameState,
  RaiderKindId, RaiderState, ResourceId,
} from './state';

/**
 * Raid night as a tower-defence round.
 *
 * Raids fall on every other danger phase; the cycles in between bring poison
 * fog instead, and the two never overlap. That separation is what makes this
 * module's job coherent: on a raid night the air is clean, so the player is
 * free to leave the house and fight, and raiders are free to come looking for
 * them. See dangerThreatFor.
 *
 * Every exposed base is raided on a raid night. Elaris construction inside the
 * municipal perimeter is protected; the area the player is standing in plays
 * out live, tick by tick, while every other exposed base settles abstractly.
 *
 * Determinism rules this module obeys throughout:
 *   - Raider positions are whole pixels and speeds are whole pixels per tick.
 *     canonicalizeGameState rejects non-integer numbers, so a fractional
 *     coordinate would break the state hash mid-raid.
 *   - Wave composition comes from a hash of (world seed, area key, raid), not
 *     from state.rngState. The live path and the absent path must agree on the
 *     same wave without either consuming shared RNG state.
 *   - Iteration follows stable array order, never a distance sort over floats.
 */

/** Reach at which a raider stops walking and starts hitting, squared. */
const ATTACK_REACH_SQ = (TILE_SIZE * 3 / 2) ** 2;

/**
 * Personal space between two hostiles, in pixels. Without it a pack converging
 * on the same target stacks onto identical coordinates and reads as one raider.
 */
const SEPARATION_PX = 20;
const SEPARATION_SQ = SEPARATION_PX ** 2;
/** Relaxation passes the crowd resolver runs per tick. */
const SEPARATION_PASSES = 2;

export interface AbsentBaseRaidReport {
  areaKey: string;
  areaName: string;
  raidersDefeated: number;
  raidersTotal: number;
  /** Display names of everything reduced to rubble, in destruction order. */
  destroyed: string[];
}

export interface RaidAdvanceResult {
  changed: boolean;
  /** Present only on the tick a round ended with off-screen bases to settle. */
  absentReports?: AbsentBaseRaidReport[];
  /** Present only on the tick a raider's hit dropped the player to zero HP. */
  defeat?: PlayerDefeatResult;
  /** Coins paid for kills on this tick, for a "+N" flourish in the HUD. */
  bounty?: number;
}

/* -------------------------------------------------------------------------- */
/* Wave composition                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The wave one base faces in one raid. Pure: the same inputs always produce the
 * same roster, so a base can be simulated live or settled abstractly and both
 * paths see an identical enemy.
 *
 * Scaling keys off `raidNumber` — how many raids have happened — rather than
 * the survival cycle, because raids now fall on only half the cycles. Counting
 * cycles here would have silently halved the difficulty curve.
 */
export function raidWaveFor(
  worldSeed: number,
  areaKey: string,
  raidNumber: number,
  ratingTenths: number,
  balance: GameBalanceState,
  /** Extra raiders drawn by unregistered blueprints in the area. */
  blueprintBonus = 0,
): RaiderKindId[] {
  const raid = balance.raid;
  const rng = createRng(waveSeed(worldSeed, areaKey, raidNumber));
  // The bonus is added after the cap so blueprint heat is felt even by a
  // late-game base whose waves already sit at the ceiling.
  const size = Math.min(
    raid.waveMaxSize,
    raid.waveBaseSize
      + Math.floor((raidNumber * raid.waveGrowthTenths) / 10)
      + Math.floor((ratingTenths * raid.waveRatingTenths) / 100),
  ) + Math.max(0, blueprintBonus);

  // Breakers and Stalkers only start appearing once a base has survived a few
  // raids, so an early homestead faces a wave it can actually answer. Order
  // follows RAIDER_KIND_IDS, never the balance record, so the roster a wave
  // draws from stays identical across the live and absent paths.
  // Roaming kinds are overworld wildlife, never part of a wave. Without this
  // filter they join every raid roster — they carry unlockCycle 0 — and a raid
  // fills up with hostiles that ignore buildings entirely.
  const unlocked = RAIDER_KIND_IDS.filter((kindId) => raiderDefinition(kindId).roaming !== true
    && raidNumber >= balance.raiders[kindId].unlockCycle);
  if (unlocked.length === 0) return [];

  const wave: RaiderKindId[] = [];
  for (let index = 0; index < size; index += 1) wave.push(unlocked[rng.nextInt(0, unlocked.length)]!);
  return wave;
}

function waveSeed(worldSeed: number, areaKey: string, raidNumber: number): number {
  let hash = Math.imul(worldSeed >>> 0, 0x9e3779b1) >>> 0;
  for (let index = 0; index < areaKey.length; index += 1) {
    hash = (Math.imul(hash ^ areaKey.charCodeAt(index), 0x85ebca6b) >>> 0);
  }
  return (Math.imul(hash ^ (raidNumber + 1), 0xc2b2ae35) >>> 0);
}

/** Fixed-point Homestead Rating in tenths, so wave scaling stays integer-only. */
function ratingTenths(buildings: readonly BuildingState[]): number {
  return Math.max(0, Math.round(homesteadRating(buildings).total * 10));
}

/* -------------------------------------------------------------------------- */
/* Targets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a raid is trying to destroy, in priority order. Everything eligible sits
 * inside a purified room, which is what makes a raid feel aimed at the base
 * rather than at scenery; where the Air Purifier falls in that order is the
 * single most consequential raid dial there is.
 *
 * `purifier-last` is the default. Destroying the purifier ends shelter, and
 * ending shelter is what kills the player — so leading with it turns every
 * breach into an immediate death rather than a fight over the base.
 */
export function raidTargetGroups(
  buildings: readonly BuildingState[],
  priority: EditableRaidBalance['targetPriority'] = 'purifier-last',
  balance?: GameBalanceState,
): BuildingState[][] {
  const rooms = shelteredEnvironments(buildings);
  if (rooms.length === 0) return [];
  const inside = new Set<string>();
  for (const room of rooms) for (const cell of room.cells) inside.add(cell);

  const purifiers: BuildingState[] = [];
  const others: BuildingState[] = [];
  for (const building of buildings) {
    const definition = buildableById(building.definitionId);
    if (definition.footprintKind !== 'facility' || structureMaxHp(building, balance) === null) continue;
    if (!inside.has(cellKey(building.tileX, building.tileY))) continue;
    if (building.definitionId === 'air-purifier') purifiers.push(building);
    else others.push(building);
  }
  // A group is exhausted before the next one is touched at all, which is what
  // makes the priority a real behaviour rather than a tiebreak between equally
  // distant candidates. 'nearest' declines to rank and hands over one group.
  // 'player-first' ranks the player above buildings, not buildings against each
  // other, so the fallback order it leaves behind is the default one.
  if (priority === 'nearest') return [[...others, ...purifiers]].filter((group) => group.length > 0);
  if (priority === 'player-first') return [others, purifiers].filter((group) => group.length > 0);
  const ordered = priority === 'purifier-first' ? [purifiers, others] : [others, purifiers];
  return ordered.filter((group) => group.length > 0);
}

/** The same targets flattened, for anchoring a spawn edge and emptiness checks. */
export function raidTargets(
  buildings: readonly BuildingState[],
  priority: EditableRaidBalance['targetPriority'] = 'purifier-last',
  balance?: GameBalanceState,
): BuildingState[] {
  return raidTargetGroups(buildings, priority, balance).flat();
}

export function buildingCenter(building: BuildingState): { x: number; y: number } {
  const dimensions = effectiveBuildingDimensions(building);
  return {
    x: Math.round((building.tileX + dimensions.tilesWide / 2) * TILE_SIZE),
    y: Math.round((building.tileY + dimensions.tilesHigh / 2) * TILE_SIZE),
  };
}

/** Player construction inside Elaris is covered by the town's raid protection. */
function raidableBuildings(buildings: readonly BuildingState[], elaris: boolean): BuildingState[] {
  if (!elaris) return [...buildings];
  return buildings.filter((building) => {
    const center = buildingCenter(building);
    return !isWithinTownSafeZoneWorldPosition(center.x, center.y);
  });
}

function squaredDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx; const dy = ay - by;
  return dx * dx + dy * dy;
}

/* -------------------------------------------------------------------------- */
/* Spawning                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Put this cycle's wave on the edge of the current area, spread along the side
 * nearest the base so a raid arrives as a front rather than a single file.
 */
export function spawnRaidersForCurrentArea(state: GameState): boolean {
  const balance = state.gameBalance;
  const exposedBuildings = raidableBuildings(state.buildings, isElarisSanctuary(state));
  const targets = raidTargets(exposedBuildings, balance.raid.targetPriority, balance);
  // Under 'player-first' the wave is coming for the player, so a base-less
  // player is still raided; every other priority needs something to break.
  const huntsPlayer = balance.raid.targetPriority === 'player-first';
  if (targets.length === 0 && !huntsPlayer) return false;

  const wave = raidWaveFor(
    state.seed,
    state.currentArea.key,
    raidNumberFor(survivalSchedule(state).cycleIndex),
    ratingTenths(exposedBuildings),
    balance,
    // Blueprints left in the open — carried or stashed in a box — bring extra
    // raiders. The wave itself is what grows, so the pressure is felt as more
    // of them coming rather than as the same wave behaving oddly.
    blueprintWaveBonus(state),
  );
  if (wave.length === 0) return false;

  const anchor = targets[0]
    ? buildingCenter(targets[0])
    : { x: Math.round(state.player.x), y: Math.round(state.player.y) };
  // Approach from whichever edge the base is closest to; a base tucked into a
  // corner is genuinely easier to wall off, and that should be a real reward.
  const distances = [
    { edge: 'west' as const, distance: anchor.x },
    { edge: 'east' as const, distance: WORLD_PX - anchor.x },
    { edge: 'north' as const, distance: anchor.y },
    { edge: 'south' as const, distance: WORLD_PX - anchor.y },
  ];
  const closest = distances.reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best));

  const spread = TILE_SIZE * 2;
  wave.forEach((kindId, index) => {
    // Wave raiders take the level of the base they are walking at, so a camp
    // built out on the map's edge is raided by the same rank of enemy that
    // roams around it rather than by the level 1s the home area gets.
    const level = spawnLevel(state.currentArea.key, anchor.x, anchor.y, state.gameBalance.world);
    const definition = leveledRaiderDefinition(state, { kindId, level });
    // Alternate either side of the anchor so the wave straddles the base line.
    const offset = (index % 2 === 0 ? 1 : -1) * Math.ceil(index / 2) * spread;
    const along = clampToWorld((closest.edge === 'west' || closest.edge === 'east' ? anchor.y : anchor.x) + offset);
    const spawn = closest.edge === 'west' ? { x: TILE_SIZE / 2, y: along }
      : closest.edge === 'east' ? { x: WORLD_PX - TILE_SIZE / 2, y: along }
        : closest.edge === 'north' ? { x: along, y: TILE_SIZE / 2 }
          : { x: along, y: WORLD_PX - TILE_SIZE / 2 };

    state.raiders.push({
      id: `raider-${state.nextEntityId}`,
      kindId,
      x: Math.round(spawn.x),
      y: Math.round(spawn.y),
      hp: definition.maxHp,
      maxHp: definition.maxHp,
      level,
      targetBuildingId: null,
      nextAttackTick: state.tick + definition.attackCooldownTicks,
    });
    state.nextEntityId += 1;
  });
  return true;
}

function clampToWorld(value: number): number {
  return Math.min(WORLD_PX - TILE_SIZE / 2, Math.max(TILE_SIZE / 2, value));
}

/* -------------------------------------------------------------------------- */
/* Per-tick advance                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One fixed step of the raid. Called from stepMovement alongside the other
 * durable-automation advances, and responsible for the whole cycle lifecycle:
 * settle the previous round, spawn this one, then walk and shoot.
 */
export function advanceRaid(state: GameState): RaidAdvanceResult {
  if (state.pendingRespawn) return { changed: false };
  const raid = state.gameBalance.raid;
  const cycleIndex = survivalSchedule(state).cycleIndex;
  let changed = false;
  let absentReports: AbsentBaseRaidReport[] | undefined;

  if (state.raidCycleIndex !== cycleIndex) {
    // The danger→safe boundary is exactly where the cycle index increments, so
    // this is the one place a finished round is settled. A fog cycle has nothing
    // to settle: no base anywhere was raided during it.
    if (state.raidCycleIndex !== null && dangerThreatFor(state.raidCycleIndex) === 'raid') {
      const reports = resolveAbsentBaseRaids(state, state.raidCycleIndex);
      if (reports.length > 0) absentReports = reports;
    }
    state.raidCycleIndex = cycleIndex;
    state.raidSettledAreaKeys = [];
    // Only the finished wave is swept. Roamers live in the world, not in the
    // raid, and clearing them here would delete the overworld's only enemies
    // every time a cycle ticked over.
    if (state.raiders.some((raider) => !raider.roaming)) {
      state.raiders = state.raiders.filter((raider) => raider.roaming);
      changed = true;
    }
    changed = true;
  }

  const timer = survivalSchedule(state);
  if (timer.phase !== 'danger' || timer.threat !== 'raid') {
    if (state.raiders.some((raider) => !raider.roaming)) {
      state.raiders = state.raiders.filter((raider) => raider.roaming);
      changed = true;
    }
    return absentReports ? { changed: true, absentReports } : { changed };
  }

  // The warning window: raiders are still approaching from off-map, so the
  // player has time to load turrets and decide whether to fight or seal the door
  // before the wave lands.
  const elapsed = survivalSchedule(state).dangerElapsedTicks ?? 0;
  if (elapsed >= raid.spawnDelaySeconds * TICKS_PER_SECOND
    && !state.raidSettledAreaKeys.includes(state.currentArea.key)) {
    // Recorded whether or not a wave actually spawns: a base with no purified
    // room owes nothing this raid, and a base defended in person must never be
    // billed a second time by the absent-base pass.
    state.raidSettledAreaKeys.push(state.currentArea.key);
    if (spawnRaidersForCurrentArea(state)) changed = true;
  }

  if (state.raiders.length === 0) return absentReports ? { changed: true, absentReports } : { changed };

  const advance = advanceRaiders(state);
  if (advance.changed) changed = true;
  const turret = advanceTurrets(state);
  if (turret.changed) changed = true;

  const result: RaidAdvanceResult = { changed: changed || absentReports !== undefined };
  if (absentReports) result.absentReports = absentReports;
  if (advance.defeat) result.defeat = advance.defeat;
  if (turret.bounty > 0) result.bounty = turret.bounty;
  return result;
}

interface RaiderAdvance {
  changed: boolean;
  defeat?: PlayerDefeatResult;
}

/**
 * Whether the player is on the menu at all.
 *
 * Sealed inside any enclosed room the player is invisible to a raid, and this
 * is the rule that keeps "wait it out" a real option: raiders go back to
 * chewing the base, which costs some structure health but never the run. Note
 * it asks for enclosure, not purification — raid night is survived behind
 * walls, and the Air Purifier is a fog-night concern.
 */
/**
 * Whether anything hostile is allowed to come for the player right now.
 * Shared with wild creatures so a respawning or walled-in player is off limits
 * to every hostile in the world, not just to raiders.
 */
export function playerIsHuntable(state: GameState): boolean {
  return state.pendingRespawn === null
    && state.player.hp > 0
    && !isRespawnProtected(state)
    && !isPlayerEnclosed(state);
}

function advanceRaiders(state: GameState): RaiderAdvance {
  const balance = state.gameBalance;
  const groups = raidTargetGroups(
    raidableBuildings(state.buildings, isElarisSanctuary(state)),
    balance.raid.targetPriority,
    balance,
  );
  const huntable = playerIsHuntable(state);
  // 'player-first' is aggro at unlimited range: the wave crosses the map for the
  // player and only remembers the base once they are sealed in or down.
  const alwaysHunts = balance.raid.targetPriority === 'player-first';
  // An unregistered blueprint widens the net raiders notice you from. Applied
  // here rather than baked into balance so the Admin panel keeps showing the
  // tuned base rather than a number that silently moves under it.
  const aggroRange = effectiveAggroRangePx(state, balance.defense.raiderAggroRangeTiles * TILE_SIZE);
  const aggroRangeSq = aggroRange * aggroRange;
  let changed = false;

  // Iterated over a copy so defeat can stop the wave immediately without
  // continuing through stale combat decisions.
  for (const raider of [...state.raiders]) {
    // Roamers are advanced by advanceRoamers; a raid never commands them.
    if (raider.roaming) continue;
    const definition = leveledRaiderDefinition(state, raider);

    if (huntable
      && (alwaysHunts
        || squaredDistance(raider.x, raider.y, state.player.x, state.player.y) <= aggroRangeSq)) {
      const hunt = huntPlayer(state, raider, definition);
      if (hunt.changed) changed = true;
      if (hunt.defeat) return { changed: true, defeat: hunt.defeat };
      continue;
    }

    const target = nearestTarget(raider, groups[0] ?? []);
    if (!target) {
      // Nothing left worth breaking: the raid has already won here.
      raider.targetBuildingId = null;
      continue;
    }

    const center = buildingCenter(target);
    if (squaredDistance(raider.x, raider.y, center.x, center.y) <= ATTACK_REACH_SQ) {
      raider.targetBuildingId = target.id;
      if (attack(state, raider, definition, target)) changed = true;
      continue;
    }

    const blocking = stepRaider(state, raider, definition, center);
    if (blocking) {
      raider.targetBuildingId = blocking.id;
      if (attack(state, raider, definition, blocking)) changed = true;
    } else {
      raider.targetBuildingId = null;
    }
    changed = true;
  }
  if (separateRaiders(state)) changed = true;
  return { changed };
}

/**
 * One raider's step toward the player it has noticed.
 *
 * A wall between the two is not routed around — stepRaider hands it back and it
 * gets hit instead, which is how a raid breaks into (or out of) a base without
 * any pathfinding. So baiting a wave into chasing you is real: it pulls them off
 * whatever they were dismantling, at the price of them arriving at you.
 *
 * The same wall also stops the swing once they arrive, so the only way through
 * a defence is to actually bring it down.
 */
function huntPlayer(
  state: GameState,
  raider: RaiderState,
  definition: RaiderDefinition,
): RaiderAdvance {
  const player = state.player;
  if (squaredDistance(raider.x, raider.y, player.x, player.y) <= ATTACK_REACH_SQ) {
    // In reach is not the same as reachable. A raider pressed against the far
    // side of a wall swings at the wall, never through it — the player may shoot
    // back over the top, and that asymmetry is what cover is for.
    const cover = solidBoundaryBetween(state.buildings, raider.x, raider.y, player.x, player.y);
    if (cover) {
      raider.targetBuildingId = cover.id;
      return { changed: attack(state, raider, definition, cover) };
    }
    raider.targetBuildingId = null;
    if (state.tick < raider.nextAttackTick) return { changed: false };
    raider.nextAttackTick = state.tick + definition.attackCooldownTicks;
    player.hp = Math.max(0, player.hp - Math.max(0, Math.floor(definition.playerDamage)));
    if (player.hp > 0) return { changed: true };
    // Cleared so a stale start tick cannot bill the defeated player for
    // exposure seconds spent on the respawn screen.
    state.dangerExposureStartedAtTick = null;
    return { changed: true, defeat: beginPlayerDefeat(state, 'raider') };
  }

  // Rounded because the player walks on interpolated, fractional pixels while
  // raider positions must stay whole — an unrounded target would hand stepRaider
  // a fractional step and break the canonical state hash mid-raid.
  const blocking = stepRaider(state, raider, definition, {
    x: Math.round(player.x),
    y: Math.round(player.y),
  });
  raider.targetBuildingId = blocking?.id ?? null;
  if (blocking) attack(state, raider, definition, blocking);
  return { changed: true };
}

function nearestTarget(raider: RaiderState, targets: readonly BuildingState[]): BuildingState | null {
  let nearest: BuildingState | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const center = buildingCenter(target);
    const distance = squaredDistance(raider.x, raider.y, center.x, center.y);
    // Strictly less keeps the first target in array order on a tie, so the
    // Air Purifier priority in raidTargets survives equidistant candidates.
    if (distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Walk one step toward the target on a single cardinal axis, exactly like the
 * player's grid movement. Returns the boundary in the way when the step is
 * blocked — that return value is the whole "break into the base" behaviour, and
 * it means raiders need no pathfinder: a wall is not an obstacle to route
 * around, it is the next thing to hit.
 */
function stepRaider(
  state: GameState,
  raider: RaiderState,
  definition: RaiderDefinition,
  target: { x: number; y: number },
): BuildingState | null {
  const dx = target.x - raider.x;
  const dy = target.y - raider.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const directionX = horizontal ? Math.sign(dx) as -1 | 0 | 1 : 0;
  const directionY = horizontal ? 0 : Math.sign(dy) as -1 | 0 | 1;
  if (directionX === 0 && directionY === 0) return null;

  const blocking = blockingBoundary(state.buildings, raider.x, raider.y, directionX, directionY);
  if (blocking) return blocking;

  const step = Math.min(definition.speedPxPerTick, Math.abs(horizontal ? dx : dy));
  raider.x += directionX * step;
  raider.y += directionY * step;
  return null;
}

/**
 * Push apart hostiles that ended the tick inside each other's personal space,
 * so a pack converging on one target arrives as a crowd instead of melting into
 * a single raider.
 *
 * Run as a resolution pass after everything has moved rather than as a refusal
 * inside stepRaider: refusing a crowded step deadlocks a wave into a frozen
 * staircase behind whoever arrived first, while a nudge lets every raider keep
 * walking its own line and still hold a gap.
 */
function separateRaiders(state: GameState): boolean {
  const raiders = state.raiders;
  let moved = false;
  // Two relaxation passes: in a packed line the pushes a middle raider takes
  // from either side cancel on the first pass, and the second one — run after
  // the ends have already moved out — is what actually opens the gap.
  for (let pass = 0; pass < SEPARATION_PASSES; pass += 1) {
    for (let i = 0; i < raiders.length; i += 1) {
      for (let j = i + 1; j < raiders.length; j += 1) {
        const near = raiders[i]!;
        const far = raiders[j]!;
        const dx = far.x - near.x;
        const dy = far.y - near.y;
        const gapSq = dx * dx + dy * dy;
        if (gapSq >= SEPARATION_SQ) continue;
        // Half the shortfall each, so one pass clears the overlap outright. A
        // trickle of a pixel or two per tick would lose to the pursuit step
        // pulling the pair straight back together and settle into a permanent
        // huddle. The shove stays under a tile, so the boundary it could cross
        // is exactly the one blockingBoundary checks.
        const shove = Math.ceil((SEPARATION_PX - Math.sqrt(gapSq)) / 2);
        // Apart along whichever axis already has the most daylight, so the pair
        // resolves the way it is already leaning. A perfectly stacked pair has
        // no lean at all, and falls back to east/west so it still comes apart.
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const sign = (horizontal ? Math.sign(dx) : Math.sign(dy)) || 1;
        const directionX = horizontal ? sign : 0;
        const directionY = horizontal ? 0 : sign;
        if (nudge(state, far, directionX, directionY, shove)) moved = true;
        if (nudge(state, near, -directionX, -directionY, shove)) moved = true;
      }
    }
  }
  return moved;
}

/**
 * A shove sideways, refused by the same walls that stop a step — being crowded
 * must never post a raider through a boundary it has not broken.
 */
function nudge(
  state: GameState,
  raider: RaiderState,
  directionX: number,
  directionY: number,
  distance: number,
): boolean {
  if (blockingBoundary(state.buildings, raider.x, raider.y, directionX, directionY)) return false;
  const x = clampToWorld(raider.x + directionX * distance);
  const y = clampToWorld(raider.y + directionY * distance);
  if (x === raider.x && y === raider.y) return false;
  raider.x = x;
  raider.y = y;
  return true;
}

/**
 * The solid boundary a one-tile cardinal step would cross, or null. This
 * mirrors isBuildingBoundaryCrossingBlocked, but returns the offending part
 * rather than a boolean, because a raider needs to know what to attack.
 */
export function blockingBoundary(
  buildings: readonly BuildingState[],
  x: number,
  y: number,
  directionX: number,
  directionY: number,
): BuildingState | null {
  if ((directionX === 0) === (directionY === 0)) return null;
  const tileX = Math.floor(x / TILE_SIZE);
  const tileY = Math.floor(y / TILE_SIZE);
  const edge = directionX < 0 ? 'west' : directionX > 0 ? 'east' : directionY < 0 ? 'north' : 'south';
  const boundary = buildOccupancy(buildings).boundaries.get(boundaryEdgeKey(tileX, tileY, edge));
  if (!boundary) return null;
  // Doors and gates deliberately share an enclosure edge without blocking, so
  // a raider walks straight through one — an unwalled doorway is a real hole.
  const boundaryClass = buildableById(boundary.definitionId).boundaryClass;
  if (boundaryClass !== 'wall' && boundaryClass !== 'fence') return null;
  return boundary;
}

function attack(
  state: GameState,
  raider: RaiderState,
  definition: RaiderDefinition,
  target: BuildingState,
): boolean {
  if (state.tick < raider.nextAttackTick) return false;
  raider.nextAttackTick = state.tick + definition.attackCooldownTicks;
  const isBoundary = buildableById(target.definitionId).layer === 'boundary';
  const damage = isBoundary
    ? Math.floor(definition.damage * definition.wallDamagePercent / 100)
    : definition.damage;
  return damageStructure(state, target.id, damage).ok;
}

/* -------------------------------------------------------------------------- */
/* Turrets                                                                     */
/* -------------------------------------------------------------------------- */

export function turrets(buildings: readonly BuildingState[]): BuildingState[] {
  return buildings.filter((building) => building.definitionId === 'turret');
}

function advanceTurrets(state: GameState): { changed: boolean; bounty: number } {
  const defense = state.gameBalance.defense;
  const rangePx = defense.turretRangeTiles * TILE_SIZE;
  let changed = false;
  let bounty = 0;
  for (const turret of turrets(state.buildings)) {
    const ammunition = turret.turret;
    if (!ammunition || ammunition.ammo <= 0 || state.tick < ammunition.nextFireTick) continue;

    const center = buildingCenter(turret);
    const range = rangePx * rangePx;
    let victim: RaiderState | null = null;
    let victimDistance = Number.POSITIVE_INFINITY;
    for (const raider of state.raiders) {
      // Turrets defend against raids. Letting them farm passing roamers would
      // turn a loaded turret into an idle coin generator.
      if (raider.roaming) continue;
      const distance = squaredDistance(center.x, center.y, raider.x, raider.y);
      if (distance <= range && distance < victimDistance) {
        victim = raider;
        victimDistance = distance;
      }
    }
    if (!victim) continue;

    ammunition.ammo -= 1;
    ammunition.nextFireTick = state.tick + defense.turretCooldownTicks;
    bounty += damageRaider(state, victim, defense.turretDamage).bounty;
    changed = true;
  }
  return { changed, bounty };
}

/* -------------------------------------------------------------------------- */
/* Roaming hostiles                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Hostiles that live in the world rather than arriving with a raid.
 *
 * They exist because a sword and a bow were otherwise only useful for the one
 * minute per cycle a raid was running. A roamer notices a player who comes
 * close, chases them within a leash of its spawn, and walks home when they get
 * away — so engaging one is always the player's choice, which is what keeps
 * crossing a map from feeling like running a gauntlet.
 *
 * Roamers deliberately never touch buildings. A base is threatened by raids;
 * making the overworld chip at it too would turn every trip into a repair bill.
 */
export const ROAMER_KIND_IDS: readonly RaiderKindId[] = RAIDER_KIND_IDS
  .filter((kindId) => raiderDefinition(kindId).roaming === true);

/** Roamers stay out of town, and out of the way while a raid is running. */
function areaAcceptsRoamers(state: GameState): boolean {
  if (isElarisSanctuary(state)) return false;
  const timer = survivalSchedule(state);
  return !(timer.phase === 'danger' && timer.threat === 'raid');
}

/**
 * One fixed step of overworld hostility: top the area up, then move whatever is
 * alive. Kept separate from advanceRaid because roamers outlive raid cycles and
 * must keep running during the safe phase, which is most of the game.
 */
export function advanceRoamers(state: GameState): RaidAdvanceResult {
  if (state.pendingRespawn) return { changed: false };
  let changed = false;
  if (!areaAcceptsRoamers(state)) return { changed };
  if (spawnRoamersIfShort(state)) changed = true;

  const balance = state.gameBalance.defense;
  const safetyBps = snarlfoxDetectionMultiplierBps(state, state.player.x, state.player.y);
  const leashSq = (balance.roamerLeashTiles * TILE_SIZE) ** 2;
  const huntable = playerIsHuntable(state);

  // Copied so defeat can stop hostility immediately without carrying on
  // through stale combat decisions.
  for (const roamer of [...state.raiders]) {
    if (!roamer.roaming) continue;
    const definition = leveledRaiderDefinition(state, roamer);
    const home = { x: roamer.homeX ?? roamer.x, y: roamer.homeY ?? roamer.y };
    const leashed = squaredDistance(roamer.x, roamer.y, home.x, home.y) > leashSq;
    // Per kind, so a Drifter is something to walk past and a Poacher something
    // that comes for you. The zone stays at its base size however high the
    // roamer's level is: a levelled enemy should be a longer fight, never one
    // that is harder to decline.
    const aggroSq = (definition.aggroRangePx * safetyBps / 10_000) ** 2;

    if (huntable
      && !leashed
      && definition.aggroRangePx > 0
      && squaredDistance(roamer.x, roamer.y, state.player.x, state.player.y) <= aggroSq) {
      const hunt = huntPlayer(state, roamer, definition);
      if (hunt.changed) changed = true;
      if (hunt.defeat) return { changed: true, defeat: hunt.defeat };
      continue;
    }

    // Out of leash or out of interest: walk home. Standing still at the end of
    // the tether would leave a permanent ring of stuck enemies around the map.
    if (squaredDistance(roamer.x, roamer.y, home.x, home.y) > TILE_SIZE * TILE_SIZE) {
      stepRaider(state, roamer, definition, home);
      changed = true;
    }
  }
  if (separateRaiders(state)) changed = true;
  return { changed };
}

/**
 * Keep an area stocked. The quota is checked on a fixed cadence rather than
 * from a per-kill timer so nothing new has to be persisted, and the spawn point
 * comes from a hash of (seed, area, slot) so the same world always populates
 * the same way.
 */
function spawnRoamersIfShort(state: GameState): boolean {
  const balance = state.gameBalance.defense;
  if (ROAMER_KIND_IDS.length === 0) return false;
  const alive = state.raiders.filter((raider) => raider.roaming).length;
  if (alive >= balance.roamersPerArea) return false;
  if (state.tick % Math.max(1, balance.roamerRespawnTicks) !== 0) return false;

  // The tick joins the seed so a rejected attempt picks somewhere else next
  // time. Keyed on slot alone, a spawn point that happened to land in town or
  // on top of the player would be re-rolled to the same rejected spot forever,
  // and the area would simply never restock. Still fully deterministic: the
  // tick is state, so a replayed save makes identical choices.
  const rng = createRng(roamerSeed(state.seed, state.currentArea.key, alive + state.tick));
  const kindId = ROAMER_KIND_IDS[rng.nextInt(0, ROAMER_KIND_IDS.length)]!;
  const x = clampToWorld(rng.nextInt(0, WORLD_PX));
  const y = clampToWorld(rng.nextInt(0, WORLD_PX));
  const level = spawnLevel(state.currentArea.key, x, y, state.gameBalance.world);
  const definition = leveledRaiderDefinition(state, { kindId, level });
  // Never on top of the player: a hostile materialising in melee reach reads as
  // a bug, not as danger. Measured against the widest zone any kind has rather
  // than this one's, so the rule does not get laxer for the kind the roll
  // happened to pick.
  const minimumDistance = widestRoamerAggroPx(state) + TILE_SIZE * 2;
  if (squaredDistance(x, y, state.player.x, state.player.y) < minimumDistance * minimumDistance) return false;
  if (isWithinTownSafeZoneWorldPosition(x, y)) return false;

  state.raiders.push({
    id: `roamer-${state.nextEntityId}`,
    kindId,
    x: Math.round(x),
    y: Math.round(y),
    hp: definition.maxHp,
    maxHp: definition.maxHp,
    level,
    targetBuildingId: null,
    nextAttackTick: state.tick + definition.attackCooldownTicks,
    roaming: true,
    homeX: Math.round(x),
    homeY: Math.round(y),
  });
  state.nextEntityId += 1;
  return true;
}

/**
 * The widest aggro zone any roaming kind currently has. Spawn spacing measures
 * against this rather than the kind actually rolled, so tuning one kind's zone
 * up can never let a different kind materialise inside its own reach.
 */
function widestRoamerAggroPx(state: GameState): number {
  return ROAMER_KIND_IDS.reduce(
    (widest, kindId) => Math.max(widest, state.gameBalance.raiders[kindId].aggroRangePx),
    0,
  );
}

function roamerSeed(worldSeed: number, areaKey: string, slot: number): number {
  let hash = Math.imul(worldSeed >>> 0, 0x27d4eb2d) >>> 0;
  for (let index = 0; index < areaKey.length; index += 1) {
    hash = Math.imul(hash ^ areaKey.charCodeAt(index), 0x165667b1) >>> 0;
  }
  return Math.imul(hash ^ (slot + 1), 0x9e3779b1) >>> 0;
}

export interface RaiderDamageResult {
  killed: boolean;
  /** Coins credited for the kill; zero unless this hit was the fatal one. */
  bounty: number;
  /** The blueprint this raider was carrying, if the kill yielded one. */
  blueprintId: string | null;
}

/**
 * Apply damage and, at zero, remove the raider and pay its bounty.
 *
 * The single death chokepoint for live raiders, which is why the coins are
 * credited here rather than at each call site. Absent bases never route through
 * it: a base that fought its raid off-screen kills raiders but earns nothing,
 * because the bounty is payment for having been there.
 */
export function damageRaider(state: GameState, raider: RaiderState, amount: number): RaiderDamageResult {
  raider.hp = Math.max(0, raider.hp - Math.max(0, Math.floor(amount)));
  if (raider.hp > 0) return { killed: false, bounty: 0, blueprintId: null };

  const definition = leveledRaiderDefinition(state, raider);
  const bounty = raiderBounty(definition);
  const index = state.raiders.indexOf(raider);
  if (index >= 0) state.raiders.splice(index, 1);
  // Loot lands on the ground rather than in the bag: a kill during a fight must
  // never fail because the player was carrying too much to pick it up yet.
  // Loot scales with the level that made the fight longer, the same way the
  // bounty does — a levelled raider that cost twice the arrows for the same six
  // back would make the far side of the map a place to avoid.
  for (const [resource, amount] of Object.entries(definition.loot ?? {}) as Array<[ResourceId, number]>) {
    const payout = scaleByLevel(amount, raider.level, definition.levelMultiplierBps);
    if (payout > 0) addGroundDrop(state, resource, payout, raider.x, raider.y);
  }
  if (bounty > 0) {
    creditCoins(state, bounty, `Level ${raider.level} ${definition.displayName} down · +${bounty} coins`);
  }
  // Raiders hunt blueprint carriers, so a defeated one may be carrying what it
  // came for. Rolled from the raider's own position, not a running RNG, so the
  // same fight always resolves the same way.
  const find = rollRaiderBlueprint(state, raider);
  return { killed: true, bounty, blueprintId: find && !find.spilled ? find.blueprintId : null };
}

/* -------------------------------------------------------------------------- */
/* Turret ammunition                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Turrets fire the player's own arrows. Reusing the existing consumable means
 * defence competes with hunting for the same stockpile, and the arrow crafting
 * loop the player already knows is the one that keeps the walls firing.
 */
export function loadTurretAmmo(state: GameState, buildingId: string, requested: number): CommandResult {
  const turret = state.buildings.find((building) => building.id === buildingId && building.definitionId === 'turret');
  if (!turret) return { ok: false, message: 'Turret not found' };
  const ammunition = turret.turret ?? (turret.turret = { ammo: 0, nextFireTick: 0 });

  const capacity = state.gameBalance.defense.turretAmmoCapacity;
  const space = capacity - ammunition.ammo;
  if (space <= 0) return { ok: false, message: 'Turret is fully loaded', targetId: turret.id };
  const amount = Math.min(Math.max(0, Math.floor(requested)), space, state.inventory.arrow);
  if (amount <= 0) return { ok: false, message: 'No arrows to load', targetId: turret.id };

  state.inventory.arrow -= amount;
  ammunition.ammo += amount;
  return { ok: true, message: `Loaded ${amount} arrows (${ammunition.ammo}/${capacity})`, targetId: turret.id };
}

export function unloadTurretAmmo(state: GameState, buildingId: string, requested: number): CommandResult {
  const turret = state.buildings.find((building) => building.id === buildingId && building.definitionId === 'turret');
  if (!turret) return { ok: false, message: 'Turret not found' };
  const ammunition = turret.turret;
  if (!ammunition || ammunition.ammo <= 0) return { ok: false, message: 'Turret is empty', targetId: turret.id };

  const amount = Math.min(Math.max(0, Math.floor(requested)), ammunition.ammo);
  if (amount <= 0) return { ok: false, message: 'Turret is empty', targetId: turret.id };
  if (!tryAddResource(state, 'arrow', amount)) return { ok: false, message: 'Bag is full', targetId: turret.id };
  ammunition.ammo -= amount;
  return { ok: true, message: `Recovered ${amount} arrows`, targetId: turret.id };
}

/* -------------------------------------------------------------------------- */
/* The player's shot                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Shipped melee reach, kept as the name the presentation layer imports for a
 * loadout-independent "about a swing away". Live reach comes from the equipped
 * tool's Range — see `strikeReachPx`.
 */
export const MELEE_REACH_PX = INTERACTION_RANGE_PX;

/**
 * How far the player's bow can shoot, in world pixels.
 *
 * Reads the equipped bow's Range where one is in hand, and the Bow row's Range
 * otherwise — so a targeting sweep and an arrow's flight agree with the shot
 * that is actually available.
 */
export function playerShotRangePx(state: GameState): number {
  const bow = equippedBow(state);
  return bow
    ? gameToolDefinition(state, bow.definitionId).rangePx
    : state.gameBalance.tools.bow.rangePx;
}

/**
 * What one arrow deals, wherever it lands.
 *
 * The shipped shot damage plus what Dexterity has bought, because "Increases
 * ranged damage" is the promise the character sheet makes for every point spent
 * there and the bow is the only ranged weapon in the world. Kept here beside
 * `playerShotRangePx` so a raider shot and a hunting shot can never disagree
 * about what an arrow is worth.
 */
export function playerShotDamage(state: GameState): number {
  return state.gameBalance.defense.playerShotDamage + rangedDamageBonus(state);
}

/**
 * Returned when a shot found nothing at all to aim at. Named so the presentation
 * can recognise the case and stay silent: firing into empty ground is an
 * ordinary miss-tap, not something worth a toast on every press.
 */
export const NO_SHOT_TARGET_MESSAGE = 'No raider in range';

export interface PlayerShotResult extends CommandResult {
  raiderId?: string;
  killed?: boolean;
  /** Coins earned by this shot, present only when it was a kill. */
  bounty?: number;
}

/**
 * A real-time shot at a raider. Deliberately outside the turn-based encounter
 * system: a raid is not something the player can pause into a duel, and nothing
 * here touches activeEncounter.
 */
export function firePlayerShot(state: GameState, raiderId?: string): PlayerShotResult {
  if (state.tick < state.actionCooldownUntilTick) return { ok: false, message: 'Not ready yet' };
  const bow = equippedBow(state);
  if (!bow) return { ok: false, message: 'Equip a bow to shoot' };
  // What a shot costs is the bow's own cast value, the same figure the creature
  // shot spends, so the two ranged paths can never price an arrow differently.
  const shotCost = gameToolDefinition(state, bow.definitionId).useCost;
  const shortfall = useCostShortfall(state, shotCost);
  if (shortfall) return { ok: false, message: shortfall };
  // Deliberately no line-of-sight test and no enclosure gate: the player shoots
  // through their own walls while nothing shoots back. Cover is a wall you can
  // fight from, and only the player gets it — see solidBoundaryBetween, which
  // every hostile consults before it swings.
  const defense = state.gameBalance.defense;
  const rangePx = gameToolDefinition(state, bow.definitionId).rangePx;
  const target = raiderId
    ? state.raiders.find((raider) => raider.id === raiderId) ?? null
    : nearestRaiderInRange(state);
  if (!target) return { ok: false, message: NO_SHOT_TARGET_MESSAGE };
  if (squaredDistance(state.player.x, state.player.y, target.x, target.y) > rangePx * rangePx) {
    return { ok: false, message: 'Too far away', targetId: target.id };
  }

  payUseCost(state, shotCost);
  state.actionCooldownUntilTick = state.tick + defense.playerShotCooldownTicks;
  // The bow is a tool, so firing wears it. Done here rather than through
  // payStrikeCost because a shot costs no stamina and keeps its own cooldown.
  const bowDefinition = gameToolDefinition(state, bow.definitionId);
  bow.durability = Math.max(0, bow.durability - Math.max(1, bowDefinition.wearPerHit));
  const bowBroke = bow.durability === 0;
  if (bowBroke) state.equippedToolId = null;
  const name = `Level ${target.level} ${gameRaiderDefinition(state, target.kindId).displayName}`;
  const { killed, bounty, blueprintId } = damageRaider(state, target, playerShotDamage(state));
  const looted = blueprintId ? ` · Blueprint: ${blueprintId.replace(/-/g, ' ')}` : '';
  return {
    ok: true,
    message: (killed ? `${name} down · +${bounty} coins${looted}` : `Hit ${name} (${target.hp}/${target.maxHp})`)
      + (bowBroke ? ' · Bow broke' : ''),
    raiderId: target.id,
    killed,
    ...(killed ? { bounty } : {}),
  };
}

/**
 * A melee swing at a raider with whatever is in hand. Routed through the same
 * strike path as chopping a tree, so an axe's raider row is what decides the
 * damage and the axe wears for having been used as a weapon.
 *
 * Bare hands are deliberately allowed. Being caught mid-raid with a broken tool
 * should mean a bad fight, not a player standing there unable to act at all.
 */
export function strikeRaiderMelee(state: GameState, raiderId?: string): PlayerShotResult {
  const blocked = strikeBlockedReason(state);
  if (blocked) return { ok: false, message: blocked };
  // The same rule shooting has: the swing lands through a wall, and the raider
  // on the far side can only answer by breaking it.
  const reachPx = strikeReachPx(state);
  const target = raiderId
    ? state.raiders.find((raider) => raider.id === raiderId) ?? null
    : nearestRaiderInRange(state, reachPx);
  if (!target) return { ok: false, message: 'No raider in reach' };
  if (squaredDistance(state.player.x, state.player.y, target.x, target.y) > reachPx * reachPx) {
    return { ok: false, message: 'Too far — move closer', targetId: target.id };
  }

  const profile = strikeProfile(state, 'raider');
  if (profile.damage <= 0) {
    return { ok: false, message: 'That tool cannot be used as a weapon', targetId: target.id };
  }
  if (profile.tool && profile.tool.durability <= 0) {
    return { ok: false, message: `Your ${profile.definition!.displayName} is broken`, targetId: target.id };
  }

  const name = `Level ${target.level} ${gameRaiderDefinition(state, target.kindId).displayName}`;
  const { killed, bounty, blueprintId } = damageRaider(state, target, profile.damage);
  const looted = blueprintId ? ` · Blueprint: ${blueprintId.replace(/-/g, ' ')}` : '';
  const toolBroke = payStrikeCost(state, profile);
  return {
    ok: true,
    message: killed
      ? `${name} down · +${bounty} coins${looted}${toolBroke ? ' · Tool broke' : ''}`
      : `Hit ${name} (${target.hp}/${target.maxHp})${toolBroke ? ' · Tool broke' : ''}`,
    raiderId: target.id,
    killed,
    toolBroke,
    ...(killed ? { bounty } : {}),
  };
}

export function nearestRaiderInRange(
  state: GameState,
  range = playerShotRangePx(state),
): RaiderState | null {
  let nearest: RaiderState | null = null;
  let nearestDistance = range * range;
  for (const raider of state.raiders) {
    const distance = squaredDistance(state.player.x, state.player.y, raider.x, raider.y);
    if (distance <= nearestDistance) {
      nearest = raider;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/* -------------------------------------------------------------------------- */
/* Absent bases                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Settle every base the player was not standing in when the round ended.
 *
 * This is an abstract exchange, not a hidden simulation: the base's turrets
 * spend what ammunition they have, that firepower kills as many raiders as it
 * can pay for, and whatever survives spends the round breaking the base down —
 * walls first, then the facilities they were protecting. Deterministic, and
 * cheap enough to run for every visited area at once.
 */
export function resolveAbsentBaseRaids(state: GameState, cycleIndex: number): AbsentBaseRaidReport[] {
  const reports: AbsentBaseRaidReport[] = [];
  for (const [key, area] of Object.entries(state.visitedAreas) as Array<[string, AreaSnapshot]>) {
    if (state.raidSettledAreaKeys.includes(key)) continue;
    const exposedBuildings = raidableBuildings(area.buildings, key === '0,0' && !hasElarisFallen(state));
    if (raidTargets(exposedBuildings, state.gameBalance.raid.targetPriority, state.gameBalance).length === 0) continue;

    const report = settleBase(state, key, area, cycleIndex);
    if (report) reports.push(report);
  }
  reports.sort((left, right) => left.areaKey.localeCompare(right.areaKey));
  return reports;
}

function settleBase(
  state: GameState,
  key: string,
  area: AreaSnapshot,
  cycleIndex: number,
): AbsentBaseRaidReport | null {
  const balance = state.gameBalance;
  const defense = balance.defense;
  const exposedBuildings = raidableBuildings(area.buildings, key === '0,0' && !hasElarisFallen(state));
  const wave = raidWaveFor(state.seed, key, raidNumberFor(cycleIndex), ratingTenths(exposedBuildings), balance);
  if (wave.length === 0) return null;

  // Firepower the base can pay for this round, in hit points of damage.
  let firepower = 0;
  for (const turret of turrets(exposedBuildings)) {
    const ammunition = turret.turret;
    if (!ammunition || ammunition.ammo <= 0) continue;
    const shots = Math.min(ammunition.ammo, defense.turretAbsentRoundShots);
    ammunition.ammo -= shots;
    firepower += shots * defense.turretDamage;
  }

  // The absent round is priced against the same danger minute the live path
  // plays out, minus the warning window nobody is being attacked during.
  const roundTicks = Math.max(
    0,
    (balance.raid.dangerPhaseSecondsByThreat.raid - balance.raid.spawnDelaySeconds) * TICKS_PER_SECOND,
  );
  let defeated = 0;
  let structureDamage = 0;
  // The same anchor the live path levels against — the first prioritised
  // target — so an absent outpost far from town is not quietly raided by
  // weaker enemies than a watched one would face.
  const anchor = buildingCenter(
    raidTargets(exposedBuildings, balance.raid.targetPriority, balance)[0] ?? exposedBuildings[0]!,
  );
  const level = spawnLevel(key, anchor.x, anchor.y, balance.world);
  for (const kindId of wave) {
    const definition = leveledRaiderDefinition(state, { kindId, level });
    if (firepower >= definition.maxHp) {
      firepower -= definition.maxHp;
      defeated += 1;
      continue;
    }
    // A survivor spends the whole danger minute hitting the base.
    structureDamage += definition.damage * Math.floor(roundTicks / definition.attackCooldownTicks);
  }

  const destroyed = applyStructureDamage(state, area, structureDamage);
  return {
    areaKey: key,
    areaName: area.name,
    raidersDefeated: defeated,
    raidersTotal: wave.length,
    destroyed,
  };
}

/**
 * Spend a damage budget on one base: its boundaries first, then the facilities
 * behind them, in stable order. Damage is applied through the same
 * damageStructure chokepoint the live raid uses, so an absent base is destroyed
 * by exactly the rules a watched one is.
 */
function applyStructureDamage(state: GameState, area: AreaSnapshot, budget: number): string[] {
  const destroyed: string[] = [];
  if (budget <= 0) return destroyed;

  // damageStructure operates on the active buildings list, so the absent area's
  // buildings are swapped in for the duration and swapped back afterwards. The
  // area snapshot and state.buildings reference the same array for the current
  // area, which is exactly why an already-settled area is skipped upstream.
  const activeBuildings = state.buildings;
  state.buildings = area.buildings;
  try {
    let remaining = budget;
    const exposedBuildings = raidableBuildings(area.buildings, area.key === '0,0' && !hasElarisFallen(state));
    for (const building of orderedTargets(exposedBuildings, state.gameBalance)) {
      if (remaining <= 0) break;
      const health = structureMaxHp(building, state.gameBalance);
      if (health === null) continue;
      const spent = Math.min(remaining, building.hp ?? health);
      remaining -= spent;
      if (damageStructure(state, building.id, spent).destroyed) {
        destroyed.push(buildableById(building.definitionId).displayName);
      }
    }
  } finally {
    area.buildings = state.buildings;
    state.buildings = activeBuildings;
  }
  return destroyed;
}

/**
 * Walls take the beating before the facilities they were built to protect, and
 * the facilities themselves are spent in the same target order the live raid
 * uses — so an absent base loses its Air Purifier at the same point in the
 * round a watched one would.
 */
function orderedTargets(buildings: readonly BuildingState[], balance: GameBalanceState): BuildingState[] {
  const walls: BuildingState[] = [];
  const facilities: BuildingState[] = [];
  for (const building of buildings) {
    if (structureMaxHp(building, balance) === null) continue;
    if (buildableById(building.definitionId).layer === 'boundary') walls.push(building);
    else facilities.push(building);
  }
  const prioritised = raidTargets(buildings, balance.raid.targetPriority, balance);
  facilities.sort((left, right) => rank(prioritised, left) - rank(prioritised, right));
  return [...walls, ...facilities];
}

/** Position in the live target order; anything unranked settles last. */
function rank(prioritised: readonly BuildingState[], building: BuildingState): number {
  const index = prioritised.findIndex((candidate) => candidate.id === building.id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
