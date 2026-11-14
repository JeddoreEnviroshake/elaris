import { describe, expect, it } from 'vitest';
import { PLAYER_SPEED_PX_PER_S, SLOW_WALK_FACTOR, TILE_SIZE, WORLD_PX } from '../../src/config/platform';
import { createGridMovementState, NO_MOVE, stepMovement } from '../../src/simulation/commands';
import { createInitialState } from '../../src/simulation/state';
import { staminaRegeneration } from '../../src/simulation/characterProgression';
import { beginPlayerDefeat } from '../../src/simulation/survivalCycle';
import { provokeCreature } from '../../src/simulation/creatureCombat';
import { newWildCreature } from '../../src/simulation/worldGeneration';

const SEED = 1234;
const moveToOpenGround = (state: ReturnType<typeof createInitialState>) => {
  state.player.x = 40 * TILE_SIZE;
  state.player.y = 40 * TILE_SIZE;
};

describe('stepMovement', () => {
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

  it('moves exactly one tile for one cardinal input', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    const startX = state.player.x;

    stepMovement(state, { x: 1, y: 0, slow: false }, 1000, movement);

    expect(state.player.x - startX).toBe(TILE_SIZE);
    expect(state.player.facing).toBe('right');
    expect(movement.moving).toBe(false);
    expect(state.tick).toBe(1);
  });

  it('finishes the selected tile after input is released', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    const startX = state.player.x;

    stepMovement(state, { x: 1, y: 0, slow: false }, 50, movement);
    expect(state.player.x).toBeGreaterThan(startX);
    expect(state.player.x).toBeLessThan(startX + TILE_SIZE);
    expect(movement.moving).toBe(true);

    stepMovement(state, NO_MOVE, 1000, movement);
    expect(state.player.x).toBe(startX + TILE_SIZE);
    expect(movement.moving).toBe(false);
  });

  it('requires a later simulation step before held input starts another tile', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    const startX = state.player.x;
    const right = { x: 1, y: 0, slow: false } as const;

    stepMovement(state, right, 1000, movement);
    expect(state.player.x).toBe(startX + TILE_SIZE);
    stepMovement(state, right, 1000, movement);
    expect(state.player.x).toBe(startX + TILE_SIZE * 2);
  });

  it('cardinalizes diagonal input instead of moving diagonally', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    const sx = state.player.x;
    const sy = state.player.y;

    stepMovement(state, { x: 1, y: 1, slow: false }, 1000, movement);

    expect(state.player.x).toBe(sx + TILE_SIZE);
    expect(state.player.y).toBe(sy);
  });

  it('uses speed to change travel time without changing the tile distance', () => {
    const slowState = createInitialState(SEED);
    const fastState = createInitialState(SEED);
    const slowMovement = createGridMovementState();
    const fastMovement = createGridMovementState();
    moveToOpenGround(slowState);
    moveToOpenGround(fastState);
    slowState.gameBalance.characterDefaults.walkSpeed = 32;
    fastState.gameBalance.characterDefaults.walkSpeed = 64;
    const slowStart = slowState.player.x;
    const fastStart = fastState.player.x;

    stepMovement(slowState, { x: 1, y: 0, slow: false }, 250, slowMovement);
    stepMovement(fastState, { x: 1, y: 0, slow: false }, 250, fastMovement);

    expect(slowState.player.x - slowStart).toBe(8);
    expect(slowMovement.targetX).toBe(slowStart + TILE_SIZE);
    expect(slowMovement.moving).toBe(true);
    expect(fastState.player.x - fastStart).toBe(TILE_SIZE);
    expect(fastMovement.targetX).toBe(fastStart + TILE_SIZE);
    expect(fastMovement.moving).toBe(false);
  });

  it('moves one tile faster while a followed Glade Stag is mounted', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    state.ownedCreatures.push({
      id: 'creature-stag', speciesId: 'glade-stag', name: 'Fern', role: 'follow',
      assignment: null, worksiteId: null, nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'glade-stag-forward',
    });
    const startX = state.player.x;

    stepMovement(state, { x: 1, y: 0, slow: false }, 100, movement);

    expect(state.player.x).toBe(startX + TILE_SIZE);
    expect(movement.moving).toBe(false);
  });

  it('retains explicit Shift slow-walk for a tile', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    const startX = state.player.x;

    stepMovement(state, { x: 0.5, y: 0, slow: true }, 100, movement);

    expect(state.player.x - startX).toBeCloseTo(PLAYER_SPEED_PX_PER_S * SLOW_WALK_FACTOR * 0.1, 6);
    expect(movement.targetX).toBe(startX + TILE_SIZE);
  });

  it('sprints at the published multiple of walking speed', () => {
    const walkState = createInitialState(SEED);
    const sprintState = createInitialState(SEED);
    const walkMovement = createGridMovementState();
    const sprintMovement = createGridMovementState();
    moveToOpenGround(walkState);
    moveToOpenGround(sprintState);
    const walkStart = walkState.player.x;
    const sprintStart = sprintState.player.x;

    stepMovement(walkState, { x: 1, y: 0, slow: false }, 100, walkMovement);
    stepMovement(sprintState, { x: 1, y: 0, slow: false, sprint: true }, 100, sprintMovement);

    expect(walkState.player.x - walkStart).toBeCloseTo(PLAYER_SPEED_PX_PER_S * 0.1, 6);
    expect(sprintState.player.x - sprintStart).toBeCloseTo(PLAYER_SPEED_PX_PER_S * 0.1 * 1.5, 6);
  });

  it('charges the sprint stamina cost once per full second of sprinting', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    const cost = state.gameBalance.characterDefaults.sprintStaminaPerSecond;
    state.player.stamina = 40;
    const right = { x: 1, y: 0, slow: false, sprint: true } as const;

    // 59 ticks is under a second, so nothing has been billed yet.
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
      stepMovement(sprintState, { x: 1, y: 0, slow: false, sprint: true }, 16, sprintMovement);
      stepMovement(walkState, { x: 1, y: 0, slow: false }, 16, walkMovement);
    }

    expect(sprintState.player.stamina).toBe(40 - cost);
    expect(walkState.player.stamina).toBe(40 + regen);
  });

  it('falls back to walking speed once stamina cannot pay for a sprint second', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    state.player.stamina = 0;
    const startX = state.player.x;

    stepMovement(state, { x: 1, y: 0, slow: false, sprint: true }, 100, movement);

    expect(state.player.x - startX).toBeCloseTo(PLAYER_SPEED_PX_PER_S * 0.1, 6);
    expect(state.player.stamina).toBe(0);
  });

  it('does not spend sprint stamina while standing still', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    state.player.stamina = 40;

    for (let tick = 0; tick < 120; tick += 1) {
      stepMovement(state, { x: 0, y: 0, slow: false, sprint: true }, 16, movement);
    }

    expect(state.player.stamina).toBeGreaterThan(40);
  });

  it('uses partial joystick deflection only to choose a tile direction', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    state.gameBalance.characterDefaults.walkSpeed = 32;
    const startX = state.player.x;

    stepMovement(state, { x: 0.25, y: 0, slow: false }, 250, movement);

    expect(state.player.x - startX).toBe(8);
    expect(movement.targetX).toBe(startX + TILE_SIZE);
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

  it('rejects a blocked destination tile while leaving door tiles passable', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.player.x = 71.5 * TILE_SIZE;
    state.player.y = 75.5 * TILE_SIZE;
    const wallX = state.player.x;

    stepMovement(state, { x: 1, y: 0, slow: false }, 200, movement);
    expect(state.player.x).toBe(wallX);
    expect(movement.moving).toBe(false);

    state.player.x = 76.5 * TILE_SIZE;
    state.player.y = 80.5 * TILE_SIZE;
    stepMovement(state, { x: 0, y: -1, slow: false }, 1000, movement);
    expect(state.player.y).toBe(79.5 * TILE_SIZE);
  });

  it('blocks foot travel into placed water and permits it after a bridge is added', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.player.x = 40.5 * TILE_SIZE;
    state.player.y = 40.5 * TILE_SIZE;
    state.buildings = [{ id: 'water', definitionId: 'water', tileX: 41, tileY: 40 }];

    stepMovement(state, { x: 1, y: 0, slow: false }, 1_000, movement);
    expect(state.player.x).toBe(40.5 * TILE_SIZE);

    state.buildings.push({ id: 'bridge', definitionId: 'wood-bridge', tileX: 41, tileY: 40 });
    stepMovement(state, { x: 1, y: 0, slow: false }, 1_000, movement);
    expect(state.player.x).toBe(41.5 * TILE_SIZE);
  });

  it('blocks crossing player-built walls from either side', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.player.x = 40.5 * TILE_SIZE;
    state.player.y = 40.5 * TILE_SIZE;
    state.buildings = [{
      id: 'east-wall', definitionId: 'wood-wall', tileX: 40, tileY: 40, boundaryEdge: 'east',
    }];

    stepMovement(state, { x: 1, y: 0, slow: false }, 1000, movement);
    expect(state.player.x).toBe(40.5 * TILE_SIZE);
    expect(state.player.facing).toBe('right');
    expect(movement.moving).toBe(false);

    state.player.x = 41.5 * TILE_SIZE;
    stepMovement(state, { x: -1, y: 0, slow: false }, 1000, movement);
    expect(state.player.x).toBe(41.5 * TILE_SIZE);
    expect(state.player.facing).toBe('left');
    expect(movement.moving).toBe(false);
  });

  it('blocks a horizontal wall from the left and right sides of its visible sprite', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.buildings = [{
      id: 'north-wall', definitionId: 'wood-wall', tileX: 40, tileY: 40, boundaryEdge: 'north',
    }];

    state.player.x = 39.5 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    stepMovement(state, { x: 1, y: 0, slow: false }, 1000, movement);
    expect(state.player.x).toBe(39.5 * TILE_SIZE);
    expect(movement.moving).toBe(false);

    state.player.x = 41.5 * TILE_SIZE;
    stepMovement(state, { x: -1, y: 0, slow: false }, 1000, movement);
    expect(state.player.x).toBe(41.5 * TILE_SIZE);
    expect(movement.moving).toBe(false);
  });

  it('blocks a side-edge wall from above and below its visible sprite', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.buildings = [{
      id: 'west-wall', definitionId: 'thatch-wall', tileX: 40, tileY: 40, boundaryEdge: 'west',
    }];

    state.player.x = 40 * TILE_SIZE;
    state.player.y = 39.5 * TILE_SIZE;
    stepMovement(state, { x: 0, y: 1, slow: false }, 1000, movement);
    expect(state.player.y).toBe(39.5 * TILE_SIZE);
    expect(movement.moving).toBe(false);

    state.player.y = 41.5 * TILE_SIZE;
    stepMovement(state, { x: 0, y: -1, slow: false }, 1000, movement);
    expect(state.player.y).toBe(41.5 * TILE_SIZE);
    expect(movement.moving).toBe(false);
  });

  it('blocks horizontal movement through the end seam of a vertical wall segment', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 41 * TILE_SIZE;
    state.buildings = [{
      id: 'upper-segment', definitionId: 'wood-wall', tileX: 40, tileY: 40, boundaryEdge: 'east',
    }];

    stepMovement(state, { x: 1, y: 0, slow: false }, 1000, movement);
    expect(state.player.x).toBe(40 * TILE_SIZE);
    expect(movement.moving).toBe(false);
  });

  it('keeps a door passable where it meets a wall segment', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 41 * TILE_SIZE;
    state.buildings = [
      { id: 'wall', definitionId: 'wood-wall', tileX: 40, tileY: 40, boundaryEdge: 'east' },
      { id: 'door', definitionId: 'wood-door', tileX: 40, tileY: 41, boundaryEdge: 'east' },
    ];

    stepMovement(state, { x: 1, y: 0, slow: false }, 1000, movement);
    expect(state.player.x).toBe(41 * TILE_SIZE);
    expect(movement.moving).toBe(false);
  });

  it('blocks horizontal walls and rotated wall edges', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.player.x = 40.5 * TILE_SIZE;
    state.player.y = 40.5 * TILE_SIZE;
    state.buildings = [{
      id: 'south-wall', definitionId: 'thatch-wall', tileX: 40, tileY: 40, boundaryEdge: 'east', rotated: true,
    }];

    stepMovement(state, { x: 0, y: 1, slow: false }, 1000, movement);
    expect(state.player.y).toBe(40.5 * TILE_SIZE);
    expect(movement.moving).toBe(false);
  });

  it('allows crossing doors and gates while fences remain solid', () => {
    const crossEast = (definitionId: 'wood-door' | 'wood-gate' | 'wood-fence') => {
      const state = createInitialState(SEED);
      const movement = createGridMovementState();
      state.player.x = 40.5 * TILE_SIZE;
      state.player.y = 40.5 * TILE_SIZE;
      state.buildings = [{ id: definitionId, definitionId, tileX: 40, tileY: 40, boundaryEdge: 'east' }];
      stepMovement(state, { x: 1, y: 0, slow: false }, 1000, movement);
      return state.player.x;
    };

    expect(crossEast('wood-door')).toBe(41.5 * TILE_SIZE);
    expect(crossEast('wood-gate')).toBe(41.5 * TILE_SIZE);
    expect(crossEast('wood-fence')).toBe(40.5 * TILE_SIZE);
  });

  it('blocks movement across the second space of a two-space fence', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.player.x = 40.5 * TILE_SIZE;
    state.player.y = 41.5 * TILE_SIZE;
    state.buildings = [{
      id: 'wide-fence', definitionId: 'wood-fence', tileX: 40, tileY: 40, boundaryEdge: 'east',
    }];

    stepMovement(state, { x: 1, y: 0, slow: false }, 1000, movement);

    expect(state.player.x).toBe(40.5 * TILE_SIZE);
    expect(movement.moving).toBe(false);
  });

  it('enters the neighboring area from the world edge', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    state.player.x = WORLD_PX - TILE_SIZE / 2;

    stepMovement(state, { x: 1, y: 0, slow: false }, 1000, movement);

    expect(state.currentArea.x).toBe(1);
    expect(state.currentArea.name).not.toBe('Elaris');
    expect(state.player.x).toBe(TILE_SIZE / 2 + 1);
  });

  it('pauses the simulation clock and movement while respawn is pending', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    moveToOpenGround(state);
    beginPlayerDefeat(state, 'creature');
    const tick = state.tick;
    const x = state.player.x;

    expect(stepMovement(state, { x: 1, y: 0, slow: false }, 1000, movement)).toBe(false);
    expect(state.tick).toBe(tick);
    expect(state.player.x).toBe(x);
    expect(movement.moving).toBe(false);
  });
});
