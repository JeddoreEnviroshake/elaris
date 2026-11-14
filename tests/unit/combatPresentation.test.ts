import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import {
  approachAlpha,
  combatActionLabel,
  damageNumberAppearance,
  damageNumberOffsetX,
  healthBarAlpha,
  healthBarColor,
  HEALTH_BAR_LINGER_MS,
  LOCK_LEASH_PX,
  resolveCombatTarget,
  styleRangePx,
  type ResolvedCombatTarget,
} from '../../src/scenes/combatPresentation';
import { createInitialState, type GameState, type RaiderState } from '../../src/simulation/state';

const SEED = 4242;

function stateWithPlayerAt(x: number, y: number): GameState {
  const state = createInitialState(SEED);
  state.player.x = x;
  state.player.y = y;
  return state;
}

function addRaider(state: GameState, x: number, y: number, hp = 30): RaiderState {
  const raider: RaiderState = {
    id: 'raider-test',
    kindId: 'scavenger',
    x,
    y,
    hp,
    maxHp: 30,
    level: 1,
    targetBuildingId: null,
    nextAttackTick: 0,
  };
  state.raiders.push(raider);
  return raider;
}

describe('resolveCombatTarget', () => {
  it('returns null for no lock', () => {
    const state = stateWithPlayerAt(0, 0);
    expect(resolveCombatTarget(state, null, 'melee')).toBeNull();
  });

  it('resolves a locked raider with its display name and health', () => {
    const state = stateWithPlayerAt(100, 100);
    addRaider(state, 110, 100, 18);

    const resolved = resolveCombatTarget(state, { kind: 'raider', id: 'raider-test' }, 'melee');

    expect(resolved).not.toBeNull();
    expect(resolved!.label).toBe('Scavenger');
    expect(resolved!.hp).toBe(18);
    expect(resolved!.maxHp).toBe(30);
    expect(resolved!.inRange).toBe(true);
  });

  it('drops a lock on a raider that left the world', () => {
    const state = stateWithPlayerAt(100, 100);
    addRaider(state, 110, 100);
    state.raiders = [];

    expect(resolveCombatTarget(state, { kind: 'raider', id: 'raider-test' }, 'melee')).toBeNull();
  });

  it('keeps a lock that is out of attack range but reports it', () => {
    const state = stateWithPlayerAt(100, 100);
    // Well past melee reach, comfortably inside the leash.
    addRaider(state, 100 + TILE_SIZE * 6, 100);

    const resolved = resolveCombatTarget(state, { kind: 'raider', id: 'raider-test' }, 'melee');

    expect(resolved).not.toBeNull();
    expect(resolved!.inRange).toBe(false);
  });

  it('drops a lock once the player walks past the leash', () => {
    const state = stateWithPlayerAt(100, 100);
    addRaider(state, 100 + LOCK_LEASH_PX + 1, 100);

    expect(resolveCombatTarget(state, { kind: 'raider', id: 'raider-test' }, 'melee')).toBeNull();
  });

  it('drops a lock on a depleted resource node', () => {
    const state = stateWithPlayerAt(0, 0);
    const node = state.resourceNodes[0]!;
    state.player.x = node.x;
    state.player.y = node.y;
    node.hp = 0;

    expect(resolveCombatTarget(state, { kind: 'resource', id: node.id }, 'melee')).toBeNull();
  });

  it('resolves a live resource node the player is standing on', () => {
    const state = stateWithPlayerAt(0, 0);
    const node = state.resourceNodes[0]!;
    state.player.x = node.x;
    state.player.y = node.y;

    const resolved = resolveCombatTarget(state, { kind: 'resource', id: node.id }, 'melee');

    expect(resolved).not.toBeNull();
    expect(resolved!.inRange).toBe(true);
    expect(resolved!.maxHp).toBe(node.maxHp);
  });
});

describe('styleRangePx', () => {
  it('gives ranged the Bow row Range, longer than a bare-handed swing', () => {
    const state = stateWithPlayerAt(0, 0);
    expect(styleRangePx(state, 'ranged')).toBe(state.gameBalance.tools.bow.rangePx);
    expect(styleRangePx(state, 'ranged')).toBeGreaterThan(styleRangePx(state, 'melee'));
  });

  it('reads melee reach from the equipped tool Range', () => {
    const state = stateWithPlayerAt(0, 0);
    state.gameBalance.tools['iron-sword'].rangePx = TILE_SIZE * 4;
    state.tools.push({
      instanceId: 'tool-1',
      definitionId: 'iron-sword',
      durability: 10,
      maxDurability: 10,
      powerRank: 0,
      speedRank: 0,
      durabilityRank: 0,
    });
    state.equippedToolId = 'tool-1';

    expect(styleRangePx(state, 'melee')).toBe(TILE_SIZE * 4);
  });

  it('tracks an Admin edit to the Bow Range', () => {
    const state = stateWithPlayerAt(0, 0);
    state.gameBalance.tools.bow.rangePx = TILE_SIZE * 12;
    expect(styleRangePx(state, 'ranged')).toBe(TILE_SIZE * 12);
  });
});

describe('combatActionLabel', () => {
  const target = (over: Partial<ResolvedCombatTarget>): ResolvedCombatTarget => ({
    kind: 'resource', id: 'n', x: 0, y: 0, label: 'Tree',
    hp: 5, maxHp: 10, distancePx: 0, inRange: true, ...over,
  });

  it('falls back when nothing is locked', () => {
    expect(combatActionLabel(null, 'Gather')).toBe('Gather');
  });

  it('names the verb per node kind', () => {
    expect(combatActionLabel(target({ label: 'Tree' }), 'Gather')).toBe('Chop Tree');
    expect(combatActionLabel(target({ label: 'Stone' }), 'Gather')).toBe('Mine Stone');
    expect(combatActionLabel(target({ label: 'Berry bush' }), 'Gather')).toBe('Gather Berry bush');
  });

  it('names a locked raider', () => {
    expect(combatActionLabel(target({ kind: 'raider', label: 'Breaker' }), 'Gather')).toBe('Strike Breaker');
  });

  it('says so when the locked target is out of reach', () => {
    expect(combatActionLabel(target({ inRange: false }), 'Gather')).toBe('Tree — too far');
  });
});

describe('healthBarAlpha', () => {
  it('hides a bar for something never damaged', () => {
    expect(healthBarAlpha(1_000, Number.NEGATIVE_INFINITY, 30, 30)).toBe(0);
  });

  it('shows a damaged bar in full', () => {
    expect(healthBarAlpha(1_000, 900, 12, 30)).toBe(1);
  });

  it('keeps a topped-up bar up through the linger window', () => {
    expect(healthBarAlpha(1_000 + HEALTH_BAR_LINGER_MS, 1_000, 30, 30)).toBe(1);
  });

  it('fades a topped-up bar out after the linger window', () => {
    const partway = healthBarAlpha(1_000 + HEALTH_BAR_LINGER_MS + 110, 1_000, 30, 30);
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(1);
    expect(healthBarAlpha(1_000 + HEALTH_BAR_LINGER_MS + 5_000, 1_000, 30, 30)).toBe(0);
  });

  it('hides a bar for something dead', () => {
    expect(healthBarAlpha(1_000, 900, 0, 30)).toBe(0);
  });
});

describe('approachAlpha', () => {
  it('steps toward the target from both directions and never overshoots', () => {
    expect(approachAlpha(0, 1, 10_000)).toBe(1);
    expect(approachAlpha(1, 0, 10_000)).toBe(0);
    expect(approachAlpha(0, 1, 110)).toBeCloseTo(0.5, 1);
  });
});

describe('healthBarColor', () => {
  it('matches the durability thresholds used by the DOM layer', () => {
    expect(healthBarColor(0.9)).toBe(0x4cc07f);
    expect(healthBarColor(0.4)).toBe(0xc9a227);
    expect(healthBarColor(0.1)).toBe(0xd9534f);
  });
});

describe('damage numbers', () => {
  it('inks each style differently', () => {
    const melee = damageNumberAppearance('melee', 'hit', 7).color;
    const ranged = damageNumberAppearance('ranged', 'hit', 7).color;
    const magic = damageNumberAppearance('magic', 'hit', 7).color;
    expect(new Set([melee, ranged, magic]).size).toBe(3);
  });

  it('makes a crit bigger and marks it', () => {
    const hit = damageNumberAppearance('melee', 'hit', 7);
    const crit = damageNumberAppearance('melee', 'crit', 7);
    expect(crit.fontSizePx).toBeGreaterThan(hit.fontSizePx);
    expect(crit.text).toBe('7!');
    expect(hit.text).toBe('7');
  });

  it('renders a miss without a number', () => {
    expect(damageNumberAppearance('ranged', 'miss', 0).text).toBe('Miss');
  });

  it('fans consecutive numbers apart and stays bounded', () => {
    const offsets = Array.from({ length: 7 }, (_, index) => damageNumberOffsetX(index));
    expect(new Set(offsets).size).toBe(7);
    for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(13);
    // Cycles rather than drifting away from the target forever.
    expect(damageNumberOffsetX(7)).toBe(damageNumberOffsetX(0));
  });
});
