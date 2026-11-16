import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, PLAYER_SPEED_PX_PER_S, SLOW_WALK_FACTOR, TILE_SIZE, WORLD_PX } from '../../src/config/platform';
import {
  createGridMovementState,
  facingFromHeading,
  NO_MOVE,
  quantizeDirection,
  stepMovement,
  type MoveIntent,
} from '../../src/simulation/commands';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { staminaRegeneration } from '../../src/simulation/characterProgression';
import { beginPlayerDefeat } from '../../src/simulation/survivalCycle';
import { provokeCreature } from '../../src/simulation/creatureCombat';
import { newWildCreature } from '../../src/simulation/worldGeneration';

const SEED = 1234;
const tileCentre = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;
const moveToOpenGround = (state: GameState) => {
  state.player.x = 40 * TILE_SIZE;
  state.player.y = 40 * TILE_SIZE;
};
const hold = (x: number, y: number, extra: Partial<MoveIntent> = {}): MoveIntent => ({
  x, y, slow: false, continuous: true, ...extra,
});
const tap = (x: number, y: number): MoveIntent => ({ x, y, slow: false });
const run = (state: GameState, intent: MoveIntent, ticks: number, movement = createGridMovementState()) => {
  for (let tick = 0; tick < ticks; tick += 1) stepMovement(state, intent, FIXED_STEP_MS, movement);
  return movement;
};

describe('free movement', () => {
  it.each([false, true])('walks a held direction at the published speed with whole-pixel positions (sprint: %s)', (sprint) => {
    const state = createInitialState(SEED);
    moveToOpenGround(state);
    const start = state.player.x;
    const movement = createGridMovementState();
    for (let tick = 0; tick < 60; tick += 1) {
      stepMovement(state, hold(1, 0, { sprint }), FIXED_STEP_MS, movement);
      expect(Number.isInteger(state.player.x)).toBe(true);
      expect(Number.isInteger(state.player.y)).toBe(true);
    }
    const expected = PLAYER_SPEED_PX_PER_S * (sprint ? 1.5 : 1);
    expect(Math.abs(state.player.x - start - expected)).toBeLessThanOrEqual(1);
  });

  it('walks diagonals at the same speed, never faster', () => {
    const straight = createInitialState(SEED);
    const diagonal = createInitialState(SEED);
    moveToOpenGround(straight);
    moveToOpenGround(diagonal);
    const sx = diagonal.player.x;
    const sy = diagonal.player.y;
    run(straight, hold(1, 0), 120);
    run(diagonal, hold(1, 1), 120);
    const straightDistance = straight.player.x - sx;
    const diagonalDistance = Math.hypot(diagonal.player.x - sx, diagonal.player.y - sy);
    expect(diagonal.player.x - sx).toBe(diagonal.player.y - sy);
    expect(diagonalDistance).toBeLessThanOrEqual(straightDistance);
    expect(diagonalDistance).toBeGreaterThan(straightDistance - 2);
  });

  it('walks any analog angle, not just the dominant axis', () => {
    const state = createInitialState(SEED);
    moveToOpenGround(state);
    const sx = state.player.x;
    const sy = state.player.y;
    run(state, hold(0.9, -0.3), 120);
    const dx = state.player.x - sx;
    const dy = state.player.y - sy;
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeLessThan(0);
    expect(Math.abs(dy / dx - (-0.3 / 0.9))).toBeLessThan(0.05);
    expect(state.player.facing).toBe('right');
  });

  it('ignores stick deflection: a light push walks as fast as a full one', () => {
    const light = createInitialState(SEED);
    const full = createInitialState(SEED);
    moveToOpenGround(light);
    moveToOpenGround(full);
    run(light, hold(0.2, 0), 60);
    run(full, hold(1, 0), 60);
    expect(light.player.x).toBe(full.player.x);
  });

  it('accumulates a slow walk below one pixel per tick', () => {
    const state = createInitialState(SEED);
    moveToOpenGround(state);
    state.gameBalance.characterDefaults.walkSpeed = 12;
    const start = state.player.x;
    run(state, hold(1, 0, { slow: true }), 120);
    const expected = 12 * SLOW_WALK_FACTOR * 2;
    expect(Math.abs(state.player.x - start - expected)).toBeLessThanOrEqual(1);
  });

  it('slides along water instead of stopping when walking diagonally into it', () => {
    const state = createInitialState(SEED);
    state.player.x = tileCentre(40);
    state.player.y = tileCentre(40);
    // A wall of placed water along the row below.
    state.buildings = [38, 39, 40, 41, 42, 43, 44].map((tileX) => ({
      id: `water-${tileX}`, definitionId: 'water', tileX, tileY: 41,
    }));
    const sx = state.player.x;
    run(state, hold(1, 1), 60);
    expect(state.player.x).toBeGreaterThan(sx + 40);
    // The box's bottom row stays on the dry tile row.
    expect(Math.floor((state.player.y + 4) / TILE_SIZE)).toBe(40);
  });

  it('slides along a player-built wall', () => {
    const state = createInitialState(SEED);
    state.player.x = tileCentre(40);
    state.player.y = tileCentre(40);
    state.buildings = [40, 41, 42, 43].map((tileX) => ({
      id: `wall-${tileX}`, definitionId: 'wood-wall', tileX, tileY: 40, boundaryEdge: 'south' as const,
    }));
    const sx = state.player.x;
    run(state, hold(1, 1), 30);
    expect(state.player.x).toBeGreaterThan(sx + 20);
    expect(state.player.y).toBe(tileCentre(40));
  });

  it('never steps into placed water and enters it once a bridge is added', () => {
    const state = createInitialState(SEED);
    state.player.x = tileCentre(40);
    state.player.y = tileCentre(40);
    state.buildings = [{ id: 'water', definitionId: 'water', tileX: 41, tileY: 40 }];
    run(state, hold(1, 0), 60);
    expect(Math.floor((state.player.x + 4) / TILE_SIZE)).toBe(40);

    state.buildings.push({ id: 'bridge', definitionId: 'wood-bridge', tileX: 41, tileY: 40 });
    run(state, hold(1, 0), 20);
    expect(state.player.x).toBeGreaterThan(41 * TILE_SIZE);
  });

  it('passes a one-tile doorway without pixel-perfect alignment', () => {
    const state = createInitialState(SEED);
    // A horizontal wall along the north edge of row 40 with a door at tile 41.
    state.buildings = [
      { id: 'wall-a', definitionId: 'wood-wall', tileX: 40, tileY: 40, boundaryEdge: 'north' },
      { id: 'door', definitionId: 'wood-door', tileX: 41, tileY: 40, boundaryEdge: 'north' },
      { id: 'wall-b', definitionId: 'wood-wall', tileX: 42, tileY: 40, boundaryEdge: 'north' },
    ];
    // Off-centre by five pixels.
    state.player.x = tileCentre(41) + 5;
    state.player.y = tileCentre(41);
    run(state, hold(0, -1), 40);
    expect(state.player.y).toBeLessThan(40 * TILE_SIZE - 4);

    // The walls either side stay solid.
    state.player.x = tileCentre(40);
    state.player.y = tileCentre(41);
    run(state, hold(0, -1), 40);
    expect(state.player.y).toBe(tileCentre(40));
  });

  it('never tunnels through a fence edge, even sprinting through a long tick', () => {
    const state = createInitialState(SEED);
    state.player.x = tileCentre(40);
    state.player.y = tileCentre(40);
    state.buildings = [{ id: 'fence', definitionId: 'wood-fence', tileX: 40, tileY: 40, boundaryEdge: 'east' }];
    const movement = createGridMovementState();
    stepMovement(state, hold(1, 0, { sprint: true }), 1000, movement);
    expect(state.player.x).toBe(41 * TILE_SIZE - 1);
  });

  it('crosses doors and gates while fences remain solid', () => {
    const crossEast = (definitionId: 'wood-door' | 'wood-gate' | 'wood-fence') => {
      const state = createInitialState(SEED);
      state.player.x = tileCentre(40);
      state.player.y = tileCentre(40);
      state.buildings = [{ id: definitionId, definitionId, tileX: 40, tileY: 40, boundaryEdge: 'east' }];
      run(state, hold(1, 0), 30);
      return state.player.x;
    };
    expect(crossEast('wood-door')).toBeGreaterThan(41 * TILE_SIZE);
    expect(crossEast('wood-gate')).toBeGreaterThan(41 * TILE_SIZE);
    expect(crossEast('wood-fence')).toBe(41 * TILE_SIZE - 1);
  });

  it('blocks the second space of a two-space fence', () => {
    const state = createInitialState(SEED);
    state.player.x = tileCentre(40);
    state.player.y = tileCentre(41);
    state.buildings = [{ id: 'wide-fence', definitionId: 'wood-fence', tileX: 40, tileY: 40, boundaryEdge: 'east' }];
    run(state, hold(1, 0), 30);
    expect(state.player.x).toBe(41 * TILE_SIZE - 1);
  });

  it('blocks walls from either side and from the ends of their visible sprite', () => {
    const state = createInitialState(SEED);
    state.buildings = [{ id: 'east-wall', definitionId: 'wood-wall', tileX: 40, tileY: 40, boundaryEdge: 'east' }];
    state.player.x = tileCentre(40);
    state.player.y = tileCentre(40);
    run(state, hold(1, 0), 30);
    expect(state.player.x).toBe(tileCentre(40));
    expect(state.player.facing).toBe('right');

    state.player.x = tileCentre(41);
    run(state, hold(-1, 0), 30);
    expect(state.player.x).toBe(tileCentre(41));
    expect(state.player.facing).toBe('left');

    // From above, along the wall's own line: the square sprite is solid.
    state.player.x = 41 * TILE_SIZE;
    state.player.y = tileCentre(38);
    run(state, hold(0, 1), 60);
    expect(state.player.y).toBe(40 * TILE_SIZE);
  });

  it('keeps a door passable where it meets a wall segment', () => {
    const state = createInitialState(SEED);
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 41 * TILE_SIZE;
    state.buildings = [
      { id: 'wall', definitionId: 'wood-wall', tileX: 40, tileY: 40, boundaryEdge: 'east' },
      { id: 'door', definitionId: 'wood-door', tileX: 40, tileY: 41, boundaryEdge: 'east' },
    ];
    run(state, hold(1, 0), 30);
    expect(state.player.x).toBeGreaterThan(41 * TILE_SIZE);
  });

  it('enters the neighbouring area from an off-centre position, keeping the perpendicular coordinate', () => {
    const state = createInitialState(SEED);
    state.player.x = WORLD_PX - TILE_SIZE / 2 - 1;
    state.player.y = 85 * TILE_SIZE + 3;
    const y = state.player.y;
    const movement = createGridMovementState();
    for (let tick = 0; tick < 10 && state.currentArea.x === 0; tick += 1) {
      stepMovement(state, hold(1, 0), FIXED_STEP_MS, movement);
    }
    expect(state.currentArea.x).toBe(1);
    expect(state.currentArea.name).not.toBe('Elaris');
    expect(state.player.y).toBe(y);
    expect(state.player.x).toBe(TILE_SIZE / 2 + 1);
  });

  it('keeps every number in state an integer across a long varied walk', () => {
    const state = createInitialState(SEED);
    moveToOpenGround(state);
    const movement = createGridMovementState();
    const intents = [hold(0.31, -0.77), hold(-1, 0.2, { sprint: true }), hold(0.05, 1, { slow: true }), tap(1, 0), NO_MOVE];
    for (let tick = 0; tick < 600; tick += 1) {
      stepMovement(state, intents[Math.floor(tick / 37) % intents.length]!, FIXED_STEP_MS, movement);
      if (tick % 50 === 0) expect(() => canonicalizeGameState(state)).not.toThrow();
    }
    expect(() => canonicalizeGameState(state)).not.toThrow();
  });

  it('replays a recorded intent stream to an identical state', () => {
    const stream: MoveIntent[] = [];
    for (let tick = 0; tick < 400; tick += 1) {
      const angle = tick * 0.037;
      stream.push(hold(Math.cos(angle), Math.sin(angle), { sprint: tick % 90 < 30, slow: tick % 130 > 110 }));
    }
    const play = () => {
      const state = createInitialState(SEED);
      moveToOpenGround(state);
      const movement = createGridMovementState();
      for (const intent of stream) stepMovement(state, intent, FIXED_STEP_MS, movement);
      return canonicalizeGameState(state);
    };
    expect(play()).toBe(play());
  });

  it('quantises directions to integers and never longer than the scale', () => {
    expect(quantizeDirection(0, 0)).toBeNull();
    expect(quantizeDirection(1, 0)).toEqual({ x: 1024, y: 0 });
    const diagonal = quantizeDirection(1, 1)!;
    expect(Number.isInteger(diagonal.x)).toBe(true);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeLessThanOrEqual(1024);
  });

  it('takes facing from the heading so strafing does not turn the character', () => {
    const state = createInitialState(SEED);
    moveToOpenGround(state);
    run(state, hold(1, 0, { heading: 0 }), 10);
    expect(state.player.facing).toBe('up');
    run(state, hold(0, -1, { heading: 200 }), 10);
    expect(state.player.facing).toBe('down');
    expect(facingFromHeading(-90)).toBe('left');
    expect(facingFromHeading(44)).toBe('up');
    expect(facingFromHeading(45)).toBe('right');
  });

  it('does not move and preserves facing on a zero intent', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.player.facing = 'up';
    const sx = state.player.x;
    stepMovement(state, NO_MOVE, 1000, movement);
    expect(state.player.x).toBe(sx);
    expect(state.player.facing).toBe('up');
    expect(state.tick).toBe(1);
  });

  it('rounds a fractional grid-era position to whole pixels on the next step', () => {
    const state = createInitialState(SEED);
    moveToOpenGround(state);
    state.player.x += 0.4;
    state.player.y += 0.6;
    stepMovement(state, NO_MOVE, FIXED_STEP_MS, createGridMovementState());
    expect(Number.isInteger(state.player.x)).toBe(true);
    expect(Number.isInteger(state.player.y)).toBe(true);
  });
});

describe('d-pad taps', () => {
  it('moves exactly one tile for one tap', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    const startX = state.player.x;
    stepMovement(state, tap(1, 0), 1000, movement);
    expect(state.player.x - startX).toBe(TILE_SIZE);
    expect(state.player.facing).toBe('right');
    expect(movement.moving).toBe(false);
    expect(state.tick).toBe(1);
  });

  it('finishes the tile after the tap is released', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    const startX = state.player.x;
    stepMovement(state, tap(1, 0), 50, movement);
    expect(state.player.x).toBeGreaterThan(startX);
    expect(state.player.x).toBeLessThan(startX + TILE_SIZE);
    expect(movement.moving).toBe(true);
    for (let tick = 0; tick < 20; tick += 1) stepMovement(state, NO_MOVE, FIXED_STEP_MS, movement);
    expect(state.player.x).toBe(startX + TILE_SIZE);
    expect(movement.moving).toBe(false);
  });

  it('reduces a diagonal tap to its dominant axis', () => {
    const state = createInitialState(SEED);
    moveToOpenGround(state);
    const sx = state.player.x;
    const sy = state.player.y;
    stepMovement(state, tap(1, 0.6), 1000, createGridMovementState());
    expect(state.player.x).toBe(sx + TILE_SIZE);
    expect(state.player.y).toBe(sy);
  });

  it('uses speed to change travel time without changing the tile distance', () => {
    const slow = createInitialState(SEED);
    const fast = createInitialState(SEED);
    moveToOpenGround(slow);
    moveToOpenGround(fast);
    slow.gameBalance.characterDefaults.walkSpeed = 32;
    fast.gameBalance.characterDefaults.walkSpeed = 64;
    const slowMovement = createGridMovementState();
    const fastMovement = createGridMovementState();
    const start = slow.player.x;
    stepMovement(slow, tap(1, 0), 250, slowMovement);
    stepMovement(fast, tap(1, 0), 250, fastMovement);
    expect(slow.player.x - start).toBe(8);
    expect(slowMovement.moving).toBe(true);
    expect(fast.player.x - start).toBe(TILE_SIZE);
    expect(fastMovement.moving).toBe(false);
  });

  it('moves one tile faster while a followed Glade Stag is mounted', () => {
    const state = createInitialState(SEED);
    moveToOpenGround(state);
    state.ownedCreatures.push({
      id: 'creature-stag', speciesId: 'glade-stag', name: 'Fern', role: 'follow',
      assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'glade-stag-forward',
    });
    const startX = state.player.x;
    stepMovement(state, tap(1, 0), 100, createGridMovementState());
    expect(state.player.x).toBe(startX + TILE_SIZE);
  });

  it('stops a tap at an obstacle instead of rejecting it outright', () => {
    const state = createInitialState(SEED);
    state.player.x = tileCentre(40);
    state.player.y = tileCentre(40);
    state.buildings = [{ id: 'fence', definitionId: 'wood-fence', tileX: 40, tileY: 40, boundaryEdge: 'east' }];
    const movement = createGridMovementState();
    stepMovement(state, tap(1, 0), 1000, movement);
    expect(state.player.x).toBe(41 * TILE_SIZE - 1);
    expect(movement.moving).toBe(false);
  });
});

describe('sprint and stamina', () => {
  it('sprints at the published multiple of walking speed', () => {
    const walk = createInitialState(SEED);
    const sprint = createInitialState(SEED);
    moveToOpenGround(walk);
    moveToOpenGround(sprint);
    const start = walk.player.x;
    run(walk, hold(1, 0), 60);
    run(sprint, hold(1, 0, { sprint: true }), 60);
    expect(Math.abs(sprint.player.x - start - (walk.player.x - start) * 1.5)).toBeLessThanOrEqual(1);
  });

  it('charges the sprint stamina cost once per full second of sprinting', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    const cost = state.gameBalance.characterDefaults.sprintStaminaPerSecond;
    state.player.stamina = 40;
    const right = hold(1, 0, { sprint: true });
    for (let tick = 0; tick < 59; tick += 1) stepMovement(state, right, 16, movement);
    expect(state.player.stamina).toBe(40);
    stepMovement(state, right, 16, movement);
    expect(state.player.stamina).toBe(40 - cost);
  });

  it('holds stamina regeneration while sprinting but not while walking', () => {
    const sprintState = createInitialState(SEED);
    const walkState = createInitialState(SEED);
    const sprintMovement = createGridMovementState();
    const walkMovement = createGridMovementState();
    moveToOpenGround(sprintState);
    moveToOpenGround(walkState);
    sprintState.player.stamina = 40;
    walkState.player.stamina = 40;
    const regen = staminaRegeneration(walkState);
    const cost = sprintState.gameBalance.characterDefaults.sprintStaminaPerSecond;
    for (let tick = 0; tick < 60; tick += 1) {
      stepMovement(sprintState, hold(1, 0, { sprint: true }), 16, sprintMovement);
      stepMovement(walkState, hold(1, 0), 16, walkMovement);
    }
    expect(sprintState.player.stamina).toBe(40 - cost);
    expect(walkState.player.stamina).toBe(40 + regen);
  });

  it('falls back to walking speed once stamina cannot pay for a sprint second', () => {
    const walk = createInitialState(SEED);
    const tired = createInitialState(SEED);
    moveToOpenGround(walk);
    moveToOpenGround(tired);
    tired.player.stamina = 0;
    run(walk, hold(1, 0), 30);
    run(tired, hold(1, 0, { sprint: true }), 30);
    expect(tired.player.x).toBe(walk.player.x);
    expect(tired.player.stamina).toBe(0);
  });

  it('does not spend sprint stamina while standing still', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    state.player.stamina = 40;
    for (let tick = 0; tick < 120; tick += 1) stepMovement(state, hold(0, 0, { sprint: true }), 16, movement);
    expect(state.player.stamina).toBeGreaterThan(40);
  });
});

describe('step housekeeping', () => {
  it('reports the exact damage a hostile deals to the player', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    const creature = newWildCreature('damage-reporter', 'tuftle', state.player.x + 8, state.player.y);
    state.wildCreatures = [creature];
    provokeCreature(state, creature);
    const hpBefore = state.player.hp;
    const reported: number[] = [];
    stepMovement(state, NO_MOVE, 16, movement, undefined, undefined, (damage) => reported.push(damage));
    expect(reported).toEqual([hpBefore - state.player.hp]);
    expect(reported[0]).toBeGreaterThan(0);
  });

  it('pauses the simulation clock and movement while respawn is pending', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    beginPlayerDefeat(state, 'creature');
    const tick = state.tick;
    const x = state.player.x;
    expect(stepMovement(state, hold(1, 0), 1000, movement)).toBe(false);
    expect(state.tick).toBe(tick);
    expect(state.player.x).toBe(x);
    expect(movement.moving).toBe(false);
  });
});
