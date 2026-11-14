import { leveledCreatureDefinition } from '../config/balance';
import { isOpeningTuftle, isOpeningGuardian } from '../content/onboarding';
import { TILE_SIZE, WORLD_PX } from '../config/platform';
import { isWithinTownSafeZoneWorldPosition } from '../content/townDefences';
import type { CreatureDefinition } from '../content/creatures';
import { coordinateHash } from './biomes';
import { defensePower } from './characterProgression';
import { blockingBoundary, playerIsHuntable } from './raids';
import { solidBoundaryBetween } from './buildingCollision';
import { beginPlayerDefeat, type PlayerDefeatResult } from './survivalCycle';
import type { GameState, WildCreatureState } from './state';

/**
 * Wild creatures as real-time inhabitants of the overworld.
 *
 * They used to be scenery that opened a battle screen when touched, which meant
 * the world had exactly one kind of live threat in it — raiders — and only for
 * the one minute per cycle a raid was running. A creature now wanders its patch,
 * notices, chases, flees, and hits on its own cadence, so the decision to start
 * a fight is made by walking up to something rather than by opening a menu.
 *
 * Wandering is what sells the rest of it. A creature that stood on its spawn
 * pixel until provoked read as a prop no matter how good its combat was, and
 * the ambling pace versus the chase pace is how a player reads "it has noticed
 * me" before any health bar appears.
 *
 * The rules follow `advanceRoamers`, deliberately: it already solved aggro,
 * leashing, and walking home in whole pixels, and two hostiles that behave by
 * different rules would read as a bug. What differs is that a creature's
 * behavior comes from its `temperament`, so most of the roster ignores a player
 * who leaves it alone.
 *
 * Determinism rules this module obeys:
 *   - Positions and ticks are whole numbers; canonicalizeGameState rejects
 *     anything else, and a creature's position is part of the hash.
 *   - No RNG. Every decision is a comparison against state, or a pure hash of
 *     the world seed and the tick, so a replayed save makes identical choices
 *     without consuming the shared stream every other system replays against.
 *   - Creatures never touch buildings. They will not step through a wall, and
 *     they will not attack one either — a base is threatened by raids, and
 *     wildlife chipping at it too would turn every trip into a repair bill.
 */

/** How long a provoked creature stays hostile after it last saw the player. */
export const CREATURE_AGGRO_MEMORY_TICKS = 600;

/** How long a skittish creature runs after being provoked. */
export const CREATURE_FLEE_TICKS = 300;

/** Ticks between regeneration points once a creature is idle back at home. */
export const CREATURE_REGEN_INTERVAL_TICKS = 30;

/**
 * How long one wander decision holds before the creature picks another. Long
 * enough that a creature commits to a direction — a shorter segment reads as
 * twitching in place rather than as an animal crossing its patch.
 */
export const CREATURE_WANDER_SEGMENT_TICKS = 120;

/** Close enough to home to count as arrived, so nothing jitters on the spot. */
const HOME_TOLERANCE_PX = TILE_SIZE;

/**
 * Eight compass offsets in tenths of a unit, so a wander step is whole-integer
 * arithmetic. Deliberately not `Math.cos`/`Math.sin`: transcendentals are
 * implementation-defined at the last bit, and a creature position feeds the
 * canonical state hash that two clients have to agree on.
 */
const WANDER_DIRECTIONS: readonly (readonly [number, number])[] = [
  [10, 0], [7, 7], [0, 10], [-7, 7], [-10, 0], [-7, -7], [0, -10], [7, -7],
];

export interface CreatureAdvanceResult {
  changed: boolean;
  defeat?: PlayerDefeatResult;
}

/**
 * Turn a creature hostile. Exported because being struck is the main way a
 * placid species ever becomes dangerous, and the strike path lives elsewhere.
 * A skittish creature runs instead of retaliating — it is still marked hostile
 * so that cornering it produces a fight rather than a free kill.
 */
export function provokeCreature(state: GameState, creature: WildCreatureState): void {
  const definition = leveledCreatureDefinition(state, creature);
  creature.aggroUntilTick = state.tick + CREATURE_AGGRO_MEMORY_TICKS;
  if (definition.temperament === 'skittish') creature.fleeUntilTick = state.tick + CREATURE_FLEE_TICKS;
}

/**
 * One fixed step of wild-creature behavior for the current area.
 *
 * Runs on every tick rather than only during a danger phase: wildlife is not a
 * raid, and a world whose creatures freeze for most of the cycle would feel
 * like a stage set.
 */
export function advanceWildCreatures(state: GameState): CreatureAdvanceResult {
  if (state.pendingRespawn) return { changed: false };
  let changed = false;

  // A creature that would be hunting is held off while the player stands in the
  // town safe zone, matching the rule roamers already follow. Town is where the
  // player banks, sells, and reads quests; it cannot also be a place to be bitten.
  const huntable = playerIsHuntable(state)
    && !isWithinTownSafeZoneWorldPosition(state.player.x, state.player.y);

  // Copied so a defeat stops the loop immediately rather than carrying on
  // through stale decisions made against a dead player.
  for (const creature of [...state.wildCreatures]) {
    if (isOpeningTuftle(state, creature.id) || isOpeningGuardian(state, creature.id)) continue;
    const definition = leveledCreatureDefinition(state, creature);
    const step = advanceCreature(state, creature, definition, huntable);
    if (step.changed) changed = true;
    if (step.defeat) return { changed: true, defeat: step.defeat };
  }
  return { changed };
}

function advanceCreature(
  state: GameState,
  creature: WildCreatureState,
  definition: CreatureDefinition,
  huntable: boolean,
): CreatureAdvanceResult {
  const profile = definition.encounter;
  const player = state.player;
  const playerDistanceSq = squaredDistance(creature.x, creature.y, player.x, player.y);
  const homeDistanceSq = squaredDistance(creature.x, creature.y, creature.homeX, creature.homeY);
  const leashed = homeDistanceSq > profile.leashPx * profile.leashPx;

  if (huntable && creature.fleeUntilTick > state.tick) {
    return flee(state, creature, definition);
  }

  // Unprovoked aggression is opt-in per species: `aggroRangePx` is 0 for
  // everything but the aggressive roster, so a Tuftle is only ever dangerous to
  // a player who swung first.
  const noticesPlayer = profile.aggroRangePx > 0
    && playerDistanceSq <= profile.aggroRangePx * profile.aggroRangePx;
  if (huntable && !leashed && noticesPlayer) {
    creature.aggroUntilTick = state.tick + CREATURE_AGGRO_MEMORY_TICKS;
  }

  if (huntable && !leashed && creature.aggroUntilTick > state.tick) {
    return hunt(state, creature, definition, playerDistanceSq);
  }

  // Out of leash, out of memory, or out of danger: drop hostility, then go back
  // to living in the world. Standing still wherever the chase ended would leave
  // the map ringed with stuck creatures far from where it generated them.
  if (creature.aggroUntilTick !== 0) {
    creature.aggroUntilTick = 0;
    creature.fleeUntilTick = 0;
    return { changed: true };
  }

  // Walk all the way to the wander point, not merely near it: cardinal steps
  // clamp to the remaining delta, so this lands exactly on the target instead
  // of parking a pixel short of it and re-deciding forever.
  const target = wanderTarget(state, creature, definition);
  const moved = stepCreature(state, creature, wanderSpeed(profile.speedPxPerTick), target);
  // Healing covers the whole patch a creature roams rather than the spawn pixel
  // alone, and keeps the looser tolerance on top so one wedged against a wall on
  // the way back still recovers rather than staying wounded indefinitely.
  const healRadius = profile.wanderRadiusPx + HOME_TOLERANCE_PX;
  const healed = homeDistanceSq <= healRadius * healRadius && regenerate(state, creature);
  return { changed: moved || healed };
}

/**
 * Where an unbothered creature is currently headed.
 *
 * Derived, not stored: the target is a pure function of the creature's spawn
 * point and the current wander segment, so it survives a save round-trip
 * without a new state field and without consuming the shared RNG stream that
 * every other system replays against. Two clients on the same tick compute the
 * same point.
 */
function wanderTarget(
  state: GameState,
  creature: WildCreatureState,
  definition: CreatureDefinition,
): { x: number; y: number } {
  const { wanderRadiusPx, wanderRestBps } = definition.encounter;
  const home = { x: creature.homeX, y: creature.homeY };
  if (wanderRadiusPx <= 0) return home;

  const segment = Math.floor(state.tick / CREATURE_WANDER_SEGMENT_TICKS);
  // A creature that has drifted outside its patch — a chase that ended far from
  // home — always walks back. Resting is only ever a choice made at home, or a
  // leashed creature could roll "stand still" and strand itself out there.
  const outsidePatch = squaredDistance(creature.x, creature.y, home.x, home.y)
    > wanderRadiusPx * wanderRadiusPx;
  if (!outsidePatch && wanderRoll(state, creature, segment, 0x52_4553) * 10_000 < wanderRestBps) {
    return { x: creature.x, y: creature.y };
  }

  const direction = WANDER_DIRECTIONS[
    Math.floor(wanderRoll(state, creature, segment, 0x44_4952) * WANDER_DIRECTIONS.length)
    % WANDER_DIRECTIONS.length
  ]!;
  // At least one tile out, so a segment never resolves to a point the creature
  // is already standing on and wastes itself.
  const reach = TILE_SIZE + Math.floor(
    wanderRoll(state, creature, segment, 0x52_4348) * Math.max(1, wanderRadiusPx - TILE_SIZE),
  );
  return {
    x: clampToWorld(home.x + Math.trunc(direction[0] * reach / 10)),
    y: clampToWorld(home.y + Math.trunc(direction[1] * reach / 10)),
  };
}

/**
 * Seed-stable roll in [0, 1) for one creature's wander segment. `coordinateHash`
 * ends on a signed XOR and can come back negative, so the value is folded before
 * it is used as a probability or an index.
 */
function wanderRoll(
  state: GameState,
  creature: WildCreatureState,
  segment: number,
  salt: number,
): number {
  const raw = coordinateHash(
    (state.seed ^ salt) >>> 0,
    creature.homeX * 31 + segment,
    creature.homeY * 17 + segment,
  );
  return raw - Math.floor(raw);
}

/**
 * Ambling pace: half the hunting speed, never below a pixel a tick. A creature
 * that wandered at chase speed would look like it was permanently fleeing
 * something, and the difference in gait is how the player reads "it has noticed
 * me" without a single UI element.
 */
function wanderSpeed(speedPxPerTick: number): number {
  return Math.max(1, Math.floor(speedPxPerTick / 2));
}

/** Chase and hit, or hold at range and hit, depending on the species behavior. */
function hunt(
  state: GameState,
  creature: WildCreatureState,
  definition: CreatureDefinition,
  playerDistanceSq: number,
): CreatureAdvanceResult {
  const profile = definition.encounter;
  const player = state.player;
  const inReach = playerDistanceSq <= profile.attackRangePx * profile.attackRangePx;

  if (!inReach) {
    // Rounded because the player walks on interpolated, fractional pixels while
    // creature positions must stay whole — an unrounded target would hand
    // stepCreature a fractional step and break the canonical state hash.
    stepCreature(state, creature, profile.speedPxPerTick, {
      x: Math.round(player.x),
      y: Math.round(player.y),
    });
    return { changed: true };
  }

  // A kiter that has been closed on backs off toward its preferred distance
  // before it shoots, which is what makes a Snarlfox a ranged problem rather
  // than a melee one that happens to have a long reach.
  let moved = false;
  if (profile.behavior === 'kite'
    && playerDistanceSq < profile.preferredRangePx * profile.preferredRangePx) {
    moved = stepCreature(state, creature, profile.speedPxPerTick, {
      x: creature.x * 2 - Math.round(player.x),
      y: creature.y * 2 - Math.round(player.y),
    });
  }

  return contactAttack(state, creature, definition, moved);
}

/**
 * Skittish flight. The creature runs from the player, but a player who stays on
 * top of it still gets bitten — cornering something frightened is the one way a
 * Glade Stag fights, and without it fleeing would make the species free loot.
 */
function flee(
  state: GameState,
  creature: WildCreatureState,
  definition: CreatureDefinition,
): CreatureAdvanceResult {
  const profile = definition.encounter;
  const player = state.player;
  // Flight ends at the leash rather than running the full timer, so a startled
  // creature cannot end up on the far side of the map from where it lives.
  const atLeash = squaredDistance(creature.x, creature.y, creature.homeX, creature.homeY)
    > profile.leashPx * profile.leashPx;
  if (atLeash) {
    creature.fleeUntilTick = 0;
    return { changed: true };
  }
  const moved = stepCreature(state, creature, profile.speedPxPerTick, {
    x: creature.x * 2 - Math.round(player.x),
    y: creature.y * 2 - Math.round(player.y),
  });

  const cornered = squaredDistance(creature.x, creature.y, player.x, player.y)
    <= profile.attackRangePx * profile.attackRangePx;
  if (!cornered) return { changed: moved };
  return contactAttack(state, creature, definition, moved);
}

/**
 * One contact hit on the player, if the cadence allows it. The single place a
 * creature deals damage, so its cost and its defeat handling cannot drift
 * between hunting and being cornered.
 *
 * A wall between the two refuses the hit outright. Unlike a raider, a creature
 * has no answer to it — it will not attack what the player built — so a fence
 * is genuinely the end of the chase, and shooting back over it is the player's
 * privilege alone.
 */
function contactAttack(
  state: GameState,
  creature: WildCreatureState,
  definition: CreatureDefinition,
  movedThisTick: boolean,
): CreatureAdvanceResult {
  if (state.tick < creature.nextAttackTick) return { changed: movedThisTick };
  if (solidBoundaryBetween(state.buildings, creature.x, creature.y, state.player.x, state.player.y)) {
    return { changed: movedThisTick };
  }
  creature.nextAttackTick = state.tick + definition.encounter.attackIntervalTicks;
  // The encounter's contact formula, moved intact: armour shaves the hit, but a
  // connected hit always costs at least a point.
  const damage = Math.max(1, definition.encounter.attackPower - defensePower(state));
  state.player.hp = Math.max(0, state.player.hp - damage);
  if (state.player.hp > 0) return { changed: true };
  // Cleared so a stale start tick cannot bill the defeated player for exposure
  // seconds spent on the respawn screen.
  state.dangerExposureStartedAtTick = null;
  return { changed: true, defeat: beginPlayerDefeat(state, 'creature') };
}

/** Heal one point on a fixed cadence, only while idle at home. */
function regenerate(state: GameState, creature: WildCreatureState): boolean {
  if (creature.hp >= creature.maxHp) return false;
  if (state.tick % CREATURE_REGEN_INTERVAL_TICKS !== 0) return false;
  creature.hp = Math.min(creature.maxHp, creature.hp + 1);
  return true;
}

/**
 * One cardinal step toward a target, in whole pixels. Returns whether the
 * creature actually moved. A wall stops it dead rather than being attacked
 * through: creatures have no quarrel with anything the player built.
 */
function stepCreature(
  state: GameState,
  creature: WildCreatureState,
  speedPxPerTick: number,
  target: { x: number; y: number },
): boolean {
  const dx = target.x - creature.x;
  const dy = target.y - creature.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const directionX = horizontal ? Math.sign(dx) as -1 | 0 | 1 : 0;
  const directionY = horizontal ? 0 : Math.sign(dy) as -1 | 0 | 1;
  if (directionX === 0 && directionY === 0) return false;
  if (blockingBoundary(state.buildings, creature.x, creature.y, directionX, directionY)) return false;

  const step = Math.min(speedPxPerTick, Math.abs(horizontal ? dx : dy));
  const nextX = clampToWorld(creature.x + directionX * step);
  const nextY = clampToWorld(creature.y + directionY * step);
  if (nextX === creature.x && nextY === creature.y) return false;
  creature.x = nextX;
  creature.y = nextY;
  return true;
}

function clampToWorld(value: number): number {
  return Math.max(0, Math.min(WORLD_PX, Math.round(value)));
}

function squaredDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
