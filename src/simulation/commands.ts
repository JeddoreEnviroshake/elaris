import { SLOW_WALK_FACTOR, TILE_SIZE, WORLD_PX } from '../config/platform';
import type { Facing, GameState } from './state';
import { advanceGroundDropExpiry, advanceResourceRenewal, advanceTuftleWork, expireToolDrops } from './gameplayCommands';
import { expireBlueprintDrops } from './carriedBlueprints';
import { advanceDeathCacheExpiry } from './deathCache';
import { advanceGardenBeds } from './gardenBeds';
import { advanceWoodlotPlanters } from './woodlotPlanters';
import { canSprint, movementSpeed, recoverPlayer, sprintStaminaPerSecond } from './characterProgression';
import { describeArea, enterAdjacentArea } from './areas';
import { resolveTownMovement } from './town';
import { advanceFurnaces } from './processing';
import { isBuildingBoundaryCrossingBlocked } from './buildingCollision';
import { advanceSurvivalCycle, type PlayerDefeatResult } from './survivalCycle';
import { advanceArcaneStorm } from './arcaneStorm';
import { advanceRaid, advanceRoamers, type AbsentBaseRaidReport } from './raids';
import { advanceWildCreatures } from './creatureCombat';
import { terrainAllows, terrainAtWithBuildings } from './landscape';
import { canTravelToWorldArea } from '../content/world';
import { discoverNearbyRegionalLandmark } from './regionalProgress';
import { advanceCartDockTransfers } from './cartDocks';
import { advanceLogisticsRouting } from './logistics';
import { advanceExpeditions } from './expeditions';
import { advanceCreatureWorkPassives } from './creatureWorkPassives';
import { advanceOpeningFog } from './openingFog';

/**
 * Transient per-tick movement intention derived from input. Not part of saved
 * GameState — input is re-derived each frame. `x`/`y` select a direction in
 * [-1, 1]; grid movement reduces it to one cardinal axis.
 */
export interface MoveIntent {
  x: number;
  y: number;
  /** Explicit slow-walk request (Shift), independent of magnitude. */
  slow: boolean;
  /**
   * The Sprint toggle. Optional so the many call sites that never sprint —
   * interiors, tests, scripted movement — keep reading as plain walking.
   */
  sprint?: boolean;
}

export const NO_MOVE: MoveIntent = { x: 0, y: 0, slow: false, sprint: false };

type CardinalComponent = -1 | 0 | 1;

/** Transient progress for one tile-sized move. This is deliberately not saved. */
export interface GridMovementState {
  moving: boolean;
  targetX: number;
  targetY: number;
  directionX: CardinalComponent;
  directionY: CardinalComponent;
  slow: boolean;
  /**
   * Ticks sprinted since the last stamina charge. Sprinting bills one whole
   * second at a time, so a tap of the toggle between tiles is never charged a
   * partial point the bar cannot represent.
   */
  sprintTicks: number;
}

export function createGridMovementState(): GridMovementState {
  return { moving: false, targetX: 0, targetY: 0, directionX: 0, directionY: 0, slow: false, sprintTicks: 0 };
}

export function resetGridMovement(movement: GridMovementState): void {
  movement.moving = false;
  movement.directionX = 0;
  movement.directionY = 0;
  movement.slow = false;
  // sprintTicks deliberately survives: this runs at the end of every tile, and
  // a sprint that spans tiles must keep billing whole seconds across them.
}

export function cardinalDirection(intent: MoveIntent): { x: CardinalComponent; y: CardinalComponent; facing: Facing } | null {
  const absX = Math.abs(intent.x);
  const absY = Math.abs(intent.y);
  if (absX === 0 && absY === 0) return null;
  // A tie is resolved horizontally so two simultaneous keys can never create
  // diagonal travel. Analog input naturally follows its dominant axis.
  if (absX >= absY) {
    const x = Math.sign(intent.x) as CardinalComponent;
    return { x, y: 0, facing: x < 0 ? 'left' : 'right' };
  }
  const y = Math.sign(intent.y) as CardinalComponent;
  return { x: 0, y, facing: y < 0 ? 'up' : 'down' };
}

/** Half the player's collision box, used to keep the sprite inside world bounds. */
const PLAYER_HALF = TILE_SIZE / 2;

/** Simulation ticks in one second, the unit sprint stamina is billed in. */
const TICKS_PER_SECOND = 60;

/**
 * Advance one fixed simulation step. Input starts at most one cardinal,
 * tile-sized move. Once started, that move finishes even if input is released;
 * held input can start the next tile on a later simulation step. Player speed
 * changes travel time, never the distance of a move. The boolean result signals
 * that durable automation changed.
 */
export function stepMovement(
  state: GameState,
  intent: MoveIntent,
  stepMs: number,
  movement: GridMovementState,
  onPlayerDefeated?: (result: PlayerDefeatResult) => void,
  onAbsentBaseRaids?: (reports: readonly AbsentBaseRaidReport[]) => void,
  onPlayerDamaged?: (damage: number) => void,
): boolean {
  if (state.pendingRespawn) {
    resetGridMovement(movement);
    return false;
  }
  state.tick += 1;
  const openingChanged = advanceOpeningFog(state);
  const protectionExpired = state.respawnProtectionUntilTick !== null
    && state.tick >= state.respawnProtectionUntilTick;
  if (protectionExpired) state.respawnProtectionUntilTick = null;
  // The storm resolves before this step's movement is applied, so the player
  // gets every tick of the telegraph to leave, and an impact is judged against
  // where those earlier ticks actually carried them.
  let hpBeforeHostile = state.player.hp;
  const storm = advanceArcaneStorm(state);
  if (state.player.hp < hpBeforeHostile) onPlayerDamaged?.(hpBeforeHostile - state.player.hp);
  hpBeforeHostile = state.player.hp;
  const raid = advanceRaid(state);
  if (state.player.hp < hpBeforeHostile) onPlayerDamaged?.(hpBeforeHostile - state.player.hp);
  // Roamers run on every tick, not just raid nights — that is the whole point
  // of them, so they advance outside advanceRaid's danger-phase gate.
  hpBeforeHostile = state.player.hp;
  const roamers = advanceRoamers(state);
  if (state.player.hp < hpBeforeHostile) onPlayerDamaged?.(hpBeforeHostile - state.player.hp);
  // Wildlife runs on the same every-tick footing as roamers. Most of the roster
  // ignores a player who leaves it alone, so this is quiet until provoked.
  hpBeforeHostile = state.player.hp;
  const creatures = advanceWildCreatures(state);
  if (state.player.hp < hpBeforeHostile) onPlayerDamaged?.(hpBeforeHostile - state.player.hp);
  if (raid.absentReports) onAbsentBaseRaids?.(raid.absentReports);
  // A raider's hit can drop the player, and that respawn is reported through the
  // same callback exposure death uses — the player should not have to care which
  // of the two danger phases killed them.
  // A roamer kills exactly like a raider does, so both defeats route through the
  // same respawn callback; the raid is checked first only because it is the
  // phase the player is more likely to be in when both could fire.
  // An arcane impact kills exactly as a raider does, and reports through the
  // same callback: the player should not have to care which danger phase it was.
  const hostileDefeat = storm.defeat ?? raid.defeat ?? roamers.defeat ?? creatures.defeat;
  if (hostileDefeat) {
    resetGridMovement(movement);
    onPlayerDefeated?.(hostileDefeat);
    return true;
  }
  const raidChanged = openingChanged || storm.changed || raid.changed || roamers.changed || creatures.changed;
  const workerChanged = advanceTuftleWork(state);
  // Work passives run after production and after the hostiles have moved, so a
  // Masonmole repairs the wall a raider just hit rather than the one it is
  // about to, and a defender answers this tick's positions.
  const passiveChanged = advanceCreatureWorkPassives(state);
  const logisticsChanged = advanceLogisticsRouting(state).changed;
  const cartDockChanged = advanceCartDockTransfers(state).changed;
  const gardenChanged = advanceGardenBeds(state);
  const woodlotChanged = advanceWoodlotPlanters(state);
  const furnaceChanged = state.tick % 60 === 0 && advanceFurnaces(state, 1_000).progressed;
  // Expeditions run on the same once-a-second budget as the Furnace, and on the
  // identical function the offline settlement calls.
  const expeditionChanged = state.tick % 60 === 0 && advanceExpeditions(state, 1_000).changed;
  const renewalChanged = advanceResourceRenewal(state);
  // Each sweep is called outright rather than chained with `||`: short-circuit
  // would skip the later ones on any tick the first found something, leaving a
  // death cache lying a tick past its deadline for no reason.
  const groundDropsExpired = advanceGroundDropExpiry(state);
  const blueprintDropsExpired = expireBlueprintDrops(state);
  const toolDropsExpired = expireToolDrops(state);
  const deathCacheExpired = advanceDeathCacheExpiry(state);
  const dropsChanged = groundDropsExpired || blueprintDropsExpired || toolDropsExpired || deathCacheExpired;
  // Sprinting is only under way when the toggle is on, the player is actually
  // travelling, and there is stamina left to bill for the second.
  const sprinting = intent.sprint === true
    && canSprint(state)
    && (movement.moving || cardinalDirection(intent) !== null);
  const recoveryChanged = recoverPlayer(state, sprinting);
  const staminaBeforeSprint = state.player.stamina;
  if (sprinting) {
    movement.sprintTicks += 1;
    if (movement.sprintTicks >= TICKS_PER_SECOND) {
      movement.sprintTicks -= TICKS_PER_SECOND;
      state.player.stamina = Math.max(0, state.player.stamina - sprintStaminaPerSecond(state));
    }
  } else {
    movement.sprintTicks = 0;
  }
  const sprintSpent = state.player.stamina !== staminaBeforeSprint;

  const player = state.player;
  if (!movement.moving) {
    const direction = cardinalDirection(intent);
    if (!direction) {
      const exposureStartedAtTick = state.dangerExposureStartedAtTick;
      const hpBeforeExposure = state.player.hp;
      const defeat = advanceSurvivalCycle(state);
      if (state.player.hp < hpBeforeExposure) onPlayerDamaged?.(hpBeforeExposure - state.player.hp);
      const landmarkDiscovered = discoverNearbyRegionalLandmark(state) !== null;
      if (defeat) onPlayerDefeated?.(defeat);
      const exposureChanged = exposureStartedAtTick !== state.dangerExposureStartedAtTick;
      const healthChanged = hpBeforeExposure !== state.player.hp;
      return protectionExpired || raidChanged || expeditionChanged || workerChanged || passiveChanged || logisticsChanged || cartDockChanged || gardenChanged || woodlotChanged || furnaceChanged || renewalChanged || dropsChanged || recoveryChanged || exposureChanged || healthChanged || defeat !== null || landmarkDiscovered;
    }
    player.facing = direction.facing;

    if (isBuildingBoundaryCrossingBlocked(state.buildings, player.x, player.y, direction.x, direction.y)) {
      resetGridMovement(movement);
    } else if (direction.x < 0 && player.x <= PLAYER_HALF) tryEnterAdjacentArea(state, 'left');
    else if (direction.x > 0 && player.x >= WORLD_PX - PLAYER_HALF) tryEnterAdjacentArea(state, 'right');
    else if (direction.y < 0 && player.y <= PLAYER_HALF) tryEnterAdjacentArea(state, 'up');
    else if (direction.y > 0 && player.y >= WORLD_PX - PLAYER_HALF) tryEnterAdjacentArea(state, 'down');
    else {
      const targetX = clamp(player.x + direction.x * TILE_SIZE, PLAYER_HALF, WORLD_PX - PLAYER_HALF);
      const targetY = clamp(player.y + direction.y * TILE_SIZE, PLAYER_HALF, WORLD_PX - PLAYER_HALF);
      const targetTerrain = terrainAtWithBuildings(
        state.seed,
        state.currentArea,
        state.buildings,
        Math.floor(targetX / TILE_SIZE),
        Math.floor(targetY / TILE_SIZE),
      );
      if (terrainAllows(targetTerrain, player.traversalMode ?? 'foot')) {
        const resolved = resolveTownMovement(state, player.x, player.y, targetX, targetY);
        if (resolved.x === targetX && resolved.y === targetY) {
          movement.moving = true;
          movement.targetX = targetX;
          movement.targetY = targetY;
          movement.directionX = direction.x;
          movement.directionY = direction.y;
          movement.slow = intent.slow;
        }
      }
    }
  }

  if (movement.moving) {
    const remaining = Math.hypot(movement.targetX - player.x, movement.targetY - player.y);
    const speed = movementSpeed(state, sprinting) * (movement.slow ? SLOW_WALK_FACTOR : 1);
    const distance = Math.max(0, speed * (stepMs / 1000));
    if (distance >= remaining) {
      player.x = movement.targetX;
      player.y = movement.targetY;
      resetGridMovement(movement);
    } else {
      player.x += movement.directionX * distance;
      player.y += movement.directionY * distance;
    }
  }
  const exposureStartedAtTick = state.dangerExposureStartedAtTick;
  const hpBeforeExposure = state.player.hp;
  const defeat = advanceSurvivalCycle(state);
  if (state.player.hp < hpBeforeExposure) onPlayerDamaged?.(hpBeforeExposure - state.player.hp);
  const landmarkDiscovered = discoverNearbyRegionalLandmark(state) !== null;
  if (defeat) {
    resetGridMovement(movement);
    onPlayerDefeated?.(defeat);
  }
  const exposureChanged = exposureStartedAtTick !== state.dangerExposureStartedAtTick;
  const healthChanged = hpBeforeExposure !== state.player.hp;
  return protectionExpired || raidChanged || expeditionChanged || workerChanged || passiveChanged || logisticsChanged || cartDockChanged || gardenChanged || woodlotChanged || furnaceChanged || renewalChanged || dropsChanged || recoveryChanged || sprintSpent || exposureChanged || healthChanged || defeat !== null || landmarkDiscovered;
}

function tryEnterAdjacentArea(state: GameState, direction: Facing): boolean {
  const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
  const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  const destinationX = state.currentArea.x + dx;
  const destinationY = state.currentArea.y + dy;
  if (!canTravelToWorldArea(state.currentArea.x, state.currentArea.y, destinationX, destinationY)) return false;
  const destination = describeArea(state.seed, destinationX, destinationY);
  const tileX = direction === 'left' ? WORLD_PX / TILE_SIZE - 1 : direction === 'right' ? 0 : Math.floor(state.player.x / TILE_SIZE);
  const tileY = direction === 'up' ? WORLD_PX / TILE_SIZE - 1 : direction === 'down' ? 0 : Math.floor(state.player.y / TILE_SIZE);
  const destinationBuildings = state.visitedAreas[destination.key]?.buildings ?? [];
  if (!terrainAllows(terrainAtWithBuildings(state.seed, destination, destinationBuildings, tileX, tileY), state.player.traversalMode ?? 'foot')) return false;
  return enterAdjacentArea(state, direction);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
