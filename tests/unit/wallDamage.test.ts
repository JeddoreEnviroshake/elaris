import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import { WALL_MAX_HP } from '../../src/config/balance';
import {
  attackFacedWall, isWallDamaged, nearestFacedWall, repairWall, wallHp, wallMaxHp,
} from '../../src/simulation/gameplayCommands';
import { createInitialState, type BuildingDefinitionId, type GameState } from '../../src/simulation/state';

/** One wall on the north edge of tile (40,40), with the player facing it. */
function stateFacingWall(definitionId: BuildingDefinitionId): GameState {
  const state = createInitialState(11);
  state.resourceNodes = [];
  state.wildCreatures = [];
  state.buildings = [{ id: 'wall-1', definitionId, tileX: 40, tileY: 40, boundaryEdge: 'north' }];
  state.player.x = 40.5 * TILE_SIZE;
  state.player.y = 40 * TILE_SIZE - 8;
  state.player.facing = 'down';
  state.player.stamina = state.player.maxStamina;
  return state;
}

/** Bare-handed swings, refilling stamina and clearing the cooldown between hits. */
function swing(state: GameState): ReturnType<typeof attackFacedWall> {
  state.tick = state.actionCooldownUntilTick;
  state.player.stamina = state.player.maxStamina;
  return attackFacedWall(state);
}

describe('wall health', () => {
  it('gives walls material health and leaves other parts unbreakable', () => {
    // Wood outlasts thatch by a wide margin; both are sized so a raider needs
    // several seconds on a wall rather than a single swing.
    expect(WALL_MAX_HP.wood).toBeGreaterThan(WALL_MAX_HP.thatch);
    const wood = stateFacingWall('wood-wall').buildings[0]!;
    const thatch = stateFacingWall('thatch-wall').buildings[0]!;
    expect([wallMaxHp(wood), wallHp(wood)]).toEqual([WALL_MAX_HP.wood, WALL_MAX_HP.wood]);
    expect([wallMaxHp(thatch), wallHp(thatch)]).toEqual([WALL_MAX_HP.thatch, WALL_MAX_HP.thatch]);
    // Only walls take weapon damage: doors, fences, and gates are not targets.
    for (const id of ['wood-door', 'wood-fence', 'wood-gate'] as const) {
      const state = stateFacingWall(id);
      expect(wallMaxHp(state.buildings[0]!)).toBeNull();
      expect(nearestFacedWall(state)).toBeNull();
      expect(swing(state)).toMatchObject({ ok: false, message: 'No wall in reach' });
    }
  });

  it('damages the faced wall and destroys it without a salvage refund', () => {
    const state = stateFacingWall('thatch-wall');
    const woodBefore = state.inventory.wood;
    const fiberBefore = state.inventory.fiber;

    // Bare hands chip 3 per swing, so a thatch wall takes many of them.
    const thatchMax = WALL_MAX_HP.thatch;
    expect(swing(state)).toMatchObject({ ok: true, message: `Thatch Wall ${thatchMax - 3}/${thatchMax}`, targetId: 'wall-1' });
    expect(wallHp(state.buildings[0]!)).toBe(thatchMax - 3);
    expect(swing(state)).toMatchObject({ message: `Thatch Wall ${thatchMax - 6}/${thatchMax}` });

    let killed = swing(state);
    while (state.buildings.length > 0) killed = swing(state);
    expect(killed).toMatchObject({ ok: true, message: 'Thatch Wall destroyed', depleted: true });
    expect(state.buildings).toEqual([]);
    // Destruction is not demolition: nothing is salvaged back into the bag.
    expect(state.inventory.wood).toBe(woodBefore);
    expect(state.inventory.fiber).toBe(fiberBefore);
  });

  it('spends stamina, holds the action cooldown, and never overshoots zero', () => {
    const state = stateFacingWall('wood-wall');
    const first = attackFacedWall(state);
    expect(first.ok).toBe(true);
    expect(state.player.stamina).toBe(state.player.maxStamina - 2);
    expect(state.actionCooldownUntilTick).toBeGreaterThan(state.tick);
    expect(attackFacedWall(state)).toEqual({ ok: false, message: 'Not ready yet' });

    state.tick = state.actionCooldownUntilTick;
    state.player.stamina = 1;
    expect(attackFacedWall(state)).toMatchObject({ ok: false, message: 'Not enough stamina' });

    // Tearing a wood wall down bare-handed takes its full health in 3 HP chips.
    let swings = 1;
    const limit = Math.ceil(WALL_MAX_HP.wood / 3);
    while (state.buildings.length > 0) {
      expect(swing(state).ok).toBe(true);
      swings += 1;
      expect(swings).toBeLessThanOrEqual(limit);
    }
    expect(swings).toBe(limit);
  });

  it('only targets a wall the player is facing, within melee reach', () => {
    const state = stateFacingWall('wood-wall');
    expect(nearestFacedWall(state)?.id).toBe('wall-1');

    // Facing away leaves the wall alone, so walking past never damages a base.
    state.player.facing = 'up';
    expect(nearestFacedWall(state)).toBeNull();
    state.player.facing = 'left';
    expect(nearestFacedWall(state)).toBeNull();

    // Out of melee reach even while facing it.
    state.player.facing = 'down';
    state.player.y = 40 * TILE_SIZE - 3 * TILE_SIZE;
    expect(nearestFacedWall(state)).toBeNull();
    expect(attackFacedWall(state)).toMatchObject({ ok: false, message: 'No wall in reach' });
  });

  it('repairs a damaged wall to full for half the price of building a new one', () => {
    const state = stateFacingWall('wood-wall');
    state.inventory.wood = 0;
    swing(state);
    expect(isWallDamaged(state.buildings[0]!)).toBe(true);

    // A Wood Wall costs 1 wood; half of that still rounds up to 1, because a
    // repair is never free. No discount for light damage either.
    expect(repairWall(state, 'wall-1')).toMatchObject({ ok: false, message: 'Need 1 more wood' });
    state.inventory.wood = 3;
    expect(repairWall(state, 'wall-1')).toMatchObject({ ok: true, message: 'Repaired Wood Wall' });
    expect(state.inventory.wood).toBe(2);

    // Full health is stored as the undamaged representation, so a repaired wall
    // persists exactly like a freshly placed one and drops its health bar.
    const wall = state.buildings[0]!;
    expect(wall.hp).toBeUndefined();
    expect(wallHp(wall)).toBe(WALL_MAX_HP.wood);
    expect(isWallDamaged(wall)).toBe(false);
  });

  it('charges half a pricier wall’s materials, rounded up, whatever the damage', () => {
    const state = stateFacingWall('stone-wall');
    state.inventory.stone = 0;
    swing(state);
    expect(isWallDamaged(state.buildings[0]!)).toBe(true);

    // A Stone Wall costs 3 stone, so a repair costs 2 — half, rounded up.
    expect(repairWall(state, 'wall-1')).toMatchObject({ ok: false, message: 'Need 2 more stone' });
    state.inventory.stone = 5;
    expect(repairWall(state, 'wall-1')).toMatchObject({ ok: true, message: 'Repaired Stone Wall' });
    expect(state.inventory.stone).toBe(3);
    expect(isWallDamaged(state.buildings[0]!)).toBe(false);
  });

  it('refuses to repair an undamaged wall, a non-wall, or one out of reach', () => {
    const state = stateFacingWall('wood-wall');
    state.inventory.wood = 10;
    expect(repairWall(state, 'wall-1')).toMatchObject({ ok: false, message: 'Wood Wall is not damaged' });
    expect(repairWall(state, 'nope')).toMatchObject({ ok: false, message: 'Wall not found' });

    swing(state);
    state.player.y = 0;
    expect(repairWall(state, 'wall-1')).toMatchObject({ ok: false, message: 'Too far away' });
    expect(state.inventory.wood).toBe(10);

    const door = stateFacingWall('wood-door');
    door.inventory.wood = 10;
    expect(repairWall(door, 'wall-1')).toMatchObject({ ok: false, message: 'Wall not found' });
  });

  it('reads an undamaged wall from older saves as full health', () => {
    const state = stateFacingWall('wood-wall');
    const wall = state.buildings[0]!;
    expect(wall.hp).toBeUndefined();
    expect(wallHp(wall)).toBe(WALL_MAX_HP.wood);
    // A persisted value above the material maximum still clamps to full.
    wall.hp = 999;
    expect(wallHp(wall)).toBe(WALL_MAX_HP.wood);
  });
});
