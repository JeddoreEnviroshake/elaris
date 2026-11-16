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
import { isBuildingBoundaryStepBlocked } from './buildingCollision';
import { buildOccupancy, type Occupancy } from './environmentProgress';
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
import { advanceSiteSearch, discoverNearbySites, type SiteSearchResult } from './sites';

/**
 * Transient per-tick movement intention derived from input. Not part of saved
 * GameState — input is re-derived each frame. `x`/`y` select a direction in
 * [-1, 1]. Held (continuous) input walks freely at any angle; magnitude is
 * ignored, so a light stick walks as fast as a full one. A tap (not
 * continuous) moves exactly one tile along its dominant axis.
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
  /** Held controls walk freely; a non-continuous intent is a one-tile d-pad tap. */
  continuous?: boolean;
  /**
   * Whole degrees clockwise from north (-y) the player is looking. When set,
   * `facing` follows this heading's quadrant instead of the travel direction,
   * so first person can strafe without turning the character.
   */
  heading?: number;
}

export const NO_MOVE: MoveIntent = { x: 0, y: 0, slow: false, sprint: false };

type CardinalComponent = -1 | 0 | 1;

/**
 * Transient movement progress. This is deliberately not saved.
 *
 * Overworld: `moving` means a d-pad tap is in flight (`tapRemaining` pixels
 * left along `directionX`/`directionY`); free walking keeps it false. `subX`
 * and `subY` carry the sub-pixel remainder in fixed-point thousandths of a
 * pixel, so the saved position stays whole pixels and a slow walk still
 * accumulates. Interiors keep the tile-move fields (`targetX`/`targetY`).
 */
export interface GridMovementState {
  moving: boolean;
  targetX: number;
  targetY: number;
  directionX: CardinalComponent;
  directionY: CardinalComponent;
  slow: boolean;
  subX: number;
  subY: number;
  tapRemaining: number;
  /**
   * Ticks sprinted since the last stamina charge. Sprinting bills one whole
   * second at a time, so a tap of the toggle between tiles is never charged a
   * partial point the bar cannot represent.
   */
  sprintTicks: number;
}

export function createGridMovementState(): GridMovementState {
  return {
    moving: false, targetX: 0, targetY: 0, directionX: 0, directionY: 0, slow: false,
    subX: 0, subY: 0, tapRemaining: 0, sprintTicks: 0,
  };
}

export function resetGridMovement(movement: GridMovementState): void {
  movement.moving = false;
  movement.directionX = 0;
  movement.directionY = 0;
  movement.slow = false;
  movement.subX = 0;
  movement.subY = 0;
  movement.tapRemaining = 0;
  // sprintTicks deliberately survives: this runs at the end of every tap, and
  // a sprint that spans taps must keep billing whole seconds across them.
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

/** Half the player's footprint, used to keep the sprite inside world bounds. */
const PLAYER_HALF = TILE_SIZE / 2;

/**
 * Half the terrain collision box. The box is 10 px wide, smaller than a tile,
 * so one-tile gaps and doorways stay passable without pixel-perfect alignment.
 */
const PLAYER_BOX_HALF = 5;

/** Fixed-point sub-pixel units per pixel carried between ticks. */
const SUBPIXELS_PER_PIXEL = 1000;

/** Length of a quantised direction vector; diagonals come out slightly under. */
export const DIRECTION_SCALE = 1024;

/**
 * Reduce an analog direction to an integer vector of length DIRECTION_SCALE.
 * This is the one place floating point touches the direction: everything the
 * simulation does with it afterwards is integer arithmetic, so a recorded
 * intent stream replays identically on any engine. `Math.sqrt` is correctly
 * rounded by the spec, unlike `Math.hypot`.
 */
export function quantizeDirection(x: number, y: number): { x: number; y: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const length = Math.sqrt(x * x + y * y);
  if (length === 0) return null;
  const qx = Math.round((x / length) * DIRECTION_SCALE);
  const qy = Math.round((y / length) * DIRECTION_SCALE);
  if (qx === 0 && qy === 0) return null;
  return { x: qx, y: qy };
}

/** The four-way facing for a heading in whole degrees clockwise from north. */
export function facingFromHeading(heading: number): Facing {
  const degrees = ((Math.round(heading) % 360) + 360) % 360;
  if (degrees >= 315 || degrees < 45) return 'up';
  if (degrees < 135) return 'right';
  if (degrees < 225) return 'down';
  return 'left';
}

function facingFromVector(x: number, y: number): Facing {
  // A tie is resolved horizontally, matching cardinalDirection.
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

/** Simulation ticks in one second, the unit sprint stamina is billed in. */
const TICKS_PER_SECOND = 60;

/**
 * Advance one fixed simulation step. Held input walks freely at any angle and
 * slides along obstacles; a d-pad tap travels exactly one tile and, once
 * started, finishes even if input is released. Player speed changes travel
 * time, never the distance of a tap. The boolean result signals that durable
 * automation changed.
 */
export function stepMovement(
  state: GameState,
  intent: MoveIntent,
  stepMs: number,
  movement: GridMovementState,
  onPlayerDefeated?: (result: PlayerDefeatResult) => void,
  onAbsentBaseRaids?: (reports: readonly AbsentBaseRaidReport[]) => void,
  onPlayerDamaged?: (damage: number) => void,
  onSiteSearch?: (result: SiteSearchResult) => void,
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

  if (intent.continuous) movement.slow = intent.slow;
  advanceFreeMovement(state, intent, Math.max(0, stepMs), sprinting, movement);
  const exposureStartedAtTick = state.dangerExposureStartedAtTick;
  const hpBeforeExposure = state.player.hp;
  const defeat = advanceSurvivalCycle(state);
  if (state.player.hp < hpBeforeExposure) onPlayerDamaged?.(hpBeforeExposure - state.player.hp);
  const landmarkDiscovered = discoverNearbyRegionalLandmark(state) !== null;
  const sitesDiscovered = discoverNearbySites(state);
  // Judged after this tick's hostiles, movement and exposure, so a step or a
  // hit on the same tick a search would finish still interrupts it.
  const hadSearch = state.activeSearch !== null;
  const search = advanceSiteSearch(state);
  if (search) onSiteSearch?.(search);
  const searchChanged = search !== null || hadSearch !== (state.activeSearch !== null);
  if (defeat) {
    resetGridMovement(movement);
    onPlayerDefeated?.(defeat);
  }
  const exposureChanged = exposureStartedAtTick !== state.dangerExposureStartedAtTick;
  const healthChanged = hpBeforeExposure !== state.player.hp;
  return protectionExpired || raidChanged || expeditionChanged || workerChanged || passiveChanged || logisticsChanged || cartDockChanged || gardenChanged || woodlotChanged || furnaceChanged || renewalChanged || dropsChanged || recoveryChanged || sprintSpent || exposureChanged || healthChanged || defeat !== null || landmarkDiscovered || sitesDiscovered || searchChanged;
}

interface StepContext {
  occupancy: Occupancy;
  /** Walkability by tile, memoised for the pixels stepped in one tick. */
  tiles: Map<string, boolean>;
}

/**
 * Move the player for one tick. The displacement is computed in integer
 * fixed point from the quantised direction, then applied one whole pixel at a
 * time, X before Y, so a blocked axis slides along the obstacle and no speed
 * can tunnel through a wall.
 */
function advanceFreeMovement(
  state: GameState,
  intent: MoveIntent,
  stepMs: number,
  sprinting: boolean,
  movement: GridMovementState,
): void {
  const player = state.player;
  // Saves from the grid era could stop mid-tile on a fraction.
  if (!Number.isInteger(player.x)) player.x = Math.round(player.x);
  if (!Number.isInteger(player.y)) player.y = Math.round(player.y);

  // A look heading (first person) turns the character even while standing
  // still, so wall attacks and the rowboat aim where the player is looking.
  if (intent.heading !== undefined && !movement.moving) player.facing = facingFromHeading(intent.heading);

  let directionX: number;
  let directionY: number;
  if (movement.moving) {
    directionX = movement.directionX * DIRECTION_SCALE;
    directionY = movement.directionY * DIRECTION_SCALE;
  } else if (!intent.continuous) {
    const cardinal = cardinalDirection(intent);
    if (!cardinal) {
      movement.subX = 0;
      movement.subY = 0;
      return;
    }
    player.facing = intent.heading !== undefined ? facingFromHeading(intent.heading) : cardinal.facing;
    movement.moving = true;
    movement.directionX = cardinal.x;
    movement.directionY = cardinal.y;
    movement.tapRemaining = TILE_SIZE;
    movement.slow = intent.slow;
    movement.subX = 0;
    movement.subY = 0;
    directionX = cardinal.x * DIRECTION_SCALE;
    directionY = cardinal.y * DIRECTION_SCALE;
  } else {
    const direction = quantizeDirection(intent.x, intent.y);
    if (!direction) {
      movement.subX = 0;
      movement.subY = 0;
      return;
    }
    player.facing = intent.heading !== undefined
      ? facingFromHeading(intent.heading)
      : facingFromVector(direction.x, direction.y);
    directionX = direction.x;
    directionY = direction.y;
  }

  const speed = movementSpeed(state, sprinting) * (movement.slow ? SLOW_WALK_FACTOR : 1);
  // px/s × ms is exactly thousandths of a pixel: the whole tick's budget.
  const budget = Math.round(speed * stepMs);
  if (!(budget > 0)) return;
  movement.subX += Math.trunc((budget * directionX) / DIRECTION_SCALE);
  movement.subY += Math.trunc((budget * directionY) / DIRECTION_SCALE);
  let pixelsX = Math.trunc(movement.subX / SUBPIXELS_PER_PIXEL);
  let pixelsY = Math.trunc(movement.subY / SUBPIXELS_PER_PIXEL);
  movement.subX -= pixelsX * SUBPIXELS_PER_PIXEL;
  movement.subY -= pixelsY * SUBPIXELS_PER_PIXEL;
  if (movement.moving) {
    // A tap is axis-aligned; cap it so it lands exactly one tile away.
    pixelsX = Math.sign(pixelsX) * Math.min(Math.abs(pixelsX), movement.tapRemaining);
    pixelsY = Math.sign(pixelsY) * Math.min(Math.abs(pixelsY), movement.tapRemaining);
  }

  const context: StepContext = { occupancy: buildOccupancy(state.buildings), tiles: new Map() };
  const areaKey = state.currentArea.key;
  const movedX = stepAxis(state, true, pixelsX, context);
  if (state.currentArea.key !== areaKey) {
    resetGridMovement(movement);
    return;
  }
  const movedY = stepAxis(state, false, pixelsY, context);
  if (state.currentArea.key !== areaKey) {
    resetGridMovement(movement);
    return;
  }
  if (movedX !== pixelsX) movement.subX = 0;
  if (movedY !== pixelsY) movement.subY = 0;
  if (movement.moving) {
    movement.tapRemaining -= Math.abs(movedX) + Math.abs(movedY);
    const blocked = movedX !== pixelsX || movedY !== pixelsY;
    if (blocked || movement.tapRemaining <= 0) resetGridMovement(movement);
  }
}

/** Step whole pixels along one axis until done or blocked; returns the signed distance moved. */
function stepAxis(state: GameState, horizontal: boolean, pixels: number, context: StepContext): number {
  const player = state.player;
  const sign = Math.sign(pixels);
  let moved = 0;
  while (moved !== pixels) {
    const fromX = player.x;
    const fromY = player.y;
    const toX = horizontal ? fromX + sign : fromX;
    const toY = horizontal ? fromY : fromY + sign;
    const coordinate = horizontal ? toX : toY;
    if (coordinate < PLAYER_HALF || coordinate > WORLD_PX - PLAYER_HALF) {
      // Pushing outward against the world edge is how the player travels on.
      tryEnterAdjacentArea(state, horizontal ? (sign < 0 ? 'left' : 'right') : (sign < 0 ? 'up' : 'down'));
      return moved;
    }
    if (!canStepTo(state, fromX, fromY, toX, toY, context)) return moved;
    player.x = toX;
    player.y = toY;
    moved += sign;
  }
  return moved;
}

function canStepTo(state: GameState, fromX: number, fromY: number, toX: number, toY: number, context: StepContext): boolean {
  if (isBuildingBoundaryStepBlocked(state.buildings, fromX, fromY, toX, toY, context.occupancy)) return false;
  const destinationBlocked = blockedBoxCorners(state, toX, toY, context);
  // A box already overlapping bad ground (an old save, an off-centre area
  // entry, or a bridge just demolished) may move anywhere that is no worse, so
  // nobody is ever trapped; a clear box may never step onto bad ground.
  if (destinationBlocked > 0) {
    const startBlocked = blockedBoxCorners(state, fromX, fromY, context);
    if (startBlocked === 0 || destinationBlocked > startBlocked) return false;
  }
  const resolved = resolveTownMovement(state, fromX, fromY, toX, toY);
  return resolved.x === toX && resolved.y === toY;
}

/** Terrain is tested at the four corners of the collision box; returns how many are on bad ground. */
function blockedBoxCorners(state: GameState, x: number, y: number, context: StepContext): number {
  const left = Math.floor((x - PLAYER_BOX_HALF) / TILE_SIZE);
  const right = Math.floor((x + PLAYER_BOX_HALF - 1) / TILE_SIZE);
  const top = Math.floor((y - PLAYER_BOX_HALF) / TILE_SIZE);
  const bottom = Math.floor((y + PLAYER_BOX_HALF - 1) / TILE_SIZE);
  return (tileAllows(state, left, top, context) ? 0 : 1)
    + (tileAllows(state, right, top, context) ? 0 : 1)
    + (tileAllows(state, left, bottom, context) ? 0 : 1)
    + (tileAllows(state, right, bottom, context) ? 0 : 1);
}

function tileAllows(state: GameState, tileX: number, tileY: number, context: StepContext): boolean {
  const key = `${tileX},${tileY}`;
  let allowed = context.tiles.get(key);
  if (allowed === undefined) {
    const terrain = terrainAtWithBuildings(state.seed, state.currentArea, state.buildings, tileX, tileY);
    allowed = terrainAllows(terrain, state.player.traversalMode ?? 'foot');
    context.tiles.set(key, allowed);
  }
  return allowed;
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
