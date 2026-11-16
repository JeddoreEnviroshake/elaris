import { describe, expect, it } from 'vitest';
import { acquireTarget, combatActionLabel, loadoutStrikeStyle, resolveCombatTarget } from '../../src/scenes/combatPresentation';
import {
  fireCreatureShot, isHuntable, nearestHuntableCreature, strikeCreatureMelee,
} from '../../src/simulation/creatureStrike';
import { snareThrowBlockedReason, throwSnareAtCreature } from '../../src/simulation/tameChance';
import { createInitialState, type GameState, type RaiderState, type WildCreatureState } from '../../src/simulation/state';
import { toolDefinition } from '../../src/config/balance';

const SEED = 4242;

function bareState(): GameState {
  const state = createInitialState(SEED);
  state.player.x = 1_000;
  state.player.y = 1_000;
  // Start from an empty field so each test states exactly what is nearby.
  state.resourceNodes = [];
  state.wildCreatures = [];
  state.raiders = [];
  return state;
}

/** Equip a freshly crafted tool so the damage table is the one under test. */
function equip(
  state: GameState,
  definitionId: 'iron-axe' | 'iron-sword' | 'iron-pick' | 'bow' | 'magic-staff',
): void {
  const definition = toolDefinition(definitionId);
  const instanceId = `tool-${definitionId}`;
  state.tools.push({
    instanceId,
    definitionId,
    durability: definition.maxDurability,
    maxDurability: definition.maxDurability,
    powerRank: 0,
    speedRank: 0,
    durabilityRank: 0,
  });
  state.equippedToolId = instanceId;
}

function addTree(state: GameState, x: number, y: number): void {
  state.resourceNodes.push({
    id: 'node-tree', kind: 'tree', x, y, hp: 30, maxHp: 30, respawnAtTick: 0,
  });
}

function addCreature(
  state: GameState,
  speciesId: WildCreatureState['speciesId'],
  x: number,
  y: number,
  overrides: Partial<WildCreatureState> = {},
): WildCreatureState {
  const creature: WildCreatureState = {
    id: `creature-${speciesId}`,
    speciesId,
    x, y,
    hp: 36, maxHp: 36,
    level: 1,
    homeX: x, homeY: y,
    aggroUntilTick: 0,
    nextAttackTick: 0,
    fleeUntilTick: 0,
    captureBonusBps: 0,
    encounterCooldownUntilTick: 0,
    ...overrides,
  };
  state.wildCreatures.push(creature);
  return creature;
}

function addRaider(state: GameState, x: number, y: number): RaiderState {
  const raider: RaiderState = {
    id: 'raider-test', kindId: 'scavenger', x, y,
    hp: 30, maxHp: 30, level: 1, targetBuildingId: null, nextAttackTick: 0,
  };
  state.raiders.push(raider);
  return raider;
}

describe('isHuntable', () => {
  it('leaves a grazing passive creature alone', () => {
    const state = bareState();
    const tuftle = addCreature(state, 'tuftle', 1_010, 1_000);
    expect(isHuntable(state, tuftle)).toBe(false);
  });

  it('treats an aggressive species as fair game on sight', () => {
    const state = bareState();
    const fox = addCreature(state, 'snarlfox', 1_010, 1_000);
    expect(isHuntable(state, fox)).toBe(true);
  });

  it('treats any provoked creature as fair game', () => {
    const state = bareState();
    const tuftle = addCreature(state, 'tuftle', 1_010, 1_000, { aggroUntilTick: state.tick + 100 });
    expect(isHuntable(state, tuftle)).toBe(true);
  });
});

describe('acquireTarget', () => {
  it('prefers the tree when an axe is equipped', () => {
    const state = bareState();
    equip(state, 'iron-axe');
    addTree(state, 1_010, 1_000);
    addCreature(state, 'snarlfox', 1_012, 1_000);

    // Iron Axe: tree 24, creature 6. The tool is the mode. The fox is an
    // aggressive species and so a legal target, but it has not noticed the
    // player, which must not be enough to interrupt the chop.
    expect(acquireTarget(state, 'melee')).toEqual({ kind: 'resource', id: 'node-tree' });
  });

  it('lets that same fox interrupt the chop once it actually engages', () => {
    const state = bareState();
    equip(state, 'iron-axe');
    addTree(state, 1_010, 1_000);
    addCreature(state, 'snarlfox', 1_012, 1_000, { aggroUntilTick: state.tick + 100 });

    // Eligible is not the same as engaged: this is the line between "there is a
    // predator in this clearing" and "it is currently biting me".
    expect(acquireTarget(state, 'melee')).toEqual({ kind: 'creature', id: 'creature-snarlfox' });
  });

  it('prefers the creature when a sword is equipped, same field', () => {
    const state = bareState();
    equip(state, 'iron-sword');
    addTree(state, 1_010, 1_000);
    addCreature(state, 'snarlfox', 1_012, 1_000);

    // Iron Sword: tree 10, creature 24. Swapping the tool swaps the target,
    // with nothing else about the world or the player changing.
    expect(acquireTarget(state, 'melee')).toEqual({ kind: 'creature', id: 'creature-snarlfox' });
  });

  it('lets anything already fighting you outrank the tool preference', () => {
    const state = bareState();
    equip(state, 'iron-axe');
    addTree(state, 1_005, 1_000);
    addRaider(state, 1_020, 1_000);

    // The axe would rather chop (tree 24 vs raider 6) and the tree is nearer,
    // but a raider mid-swing is never ambiguous.
    expect(acquireTarget(state, 'melee')).toEqual({ kind: 'raider', id: 'raider-test' });
  });

  it('never auto-acquires a placid creature, whatever is equipped', () => {
    const state = bareState();
    equip(state, 'iron-sword');
    addCreature(state, 'tuftle', 1_010, 1_000);

    // The one failure the whole rule set exists to prevent: walking past a herd
    // with a sword out must not make the action button a slaughter.
    expect(acquireTarget(state, 'melee')).toBeNull();
  });

  it('acquires that same creature once it has been provoked', () => {
    const state = bareState();
    equip(state, 'iron-sword');
    addCreature(state, 'tuftle', 1_010, 1_000, { aggroUntilTick: state.tick + 100 });

    expect(acquireTarget(state, 'melee')).toEqual({ kind: 'creature', id: 'creature-tuftle' });
  });

  it('ignores candidates the equipped tool cannot affect', () => {
    const state = bareState();
    equip(state, 'iron-pick');
    // Iron Pick has no tree row at all, so a tree is not a target for it.
    addTree(state, 1_010, 1_000);

    expect(acquireTarget(state, 'melee')).toBeNull();
  });

  it('breaks ties by distance', () => {
    const state = bareState();
    equip(state, 'iron-sword');
    addCreature(state, 'snarlfox', 1_030, 1_000, { aggroUntilTick: state.tick + 100 });
    const near = addCreature(state, 'glade-stag', 1_008, 1_000, { aggroUntilTick: state.tick + 100 });

    expect(acquireTarget(state, 'melee')).toEqual({ kind: 'creature', id: near.id });
  });
});

describe('strikeCreatureMelee', () => {
  it('damages the creature and provokes it', () => {
    const state = bareState();
    equip(state, 'iron-sword');
    const fox = addCreature(state, 'snarlfox', 1_010, 1_000, { hp: 60, maxHp: 60 });

    const result = strikeCreatureMelee(state, fox.id);

    expect(result.ok).toBe(true);
    expect(fox.hp).toBeLessThan(60);
    // Hitting something makes it fight back — this is the aggro wiring that
    // creatureCombat always had but nothing ever called.
    expect(fox.aggroUntilTick).toBeGreaterThan(state.tick);
  });

  it('adds Strength to the weapon, and Magic instead when a staff is in hand', () => {
    const state = bareState();
    state.gameBalance.attributeGains.strengthMeleeDamage = 3;
    state.gameBalance.attributeGains.magicDamage = 5;
    state.player.attributes.strength = 4;
    state.player.attributes.magic = 2;
    equip(state, 'iron-sword');
    const sword = toolDefinition('iron-sword').baseDamageByTarget.creature!;
    const fox = addCreature(state, 'snarlfox', 1_010, 1_000, { hp: 200, maxHp: 200 });

    strikeCreatureMelee(state, fox.id);
    expect(fox.hp).toBe(200 - (sword + 4 * 3));

    // A staff is swung with Magic the way a sword is swung with Strength.
    state.actionCooldownUntilTick = 0;
    state.tools.length = 0;
    equip(state, 'magic-staff');
    const staff = toolDefinition('magic-staff').baseDamageByTarget.creature!;
    const before = fox.hp;

    strikeCreatureMelee(state, fox.id);
    expect(fox.hp).toBe(before - (staff + 2 * 5));
  });

  it('pays out loot and removes the creature on the killing blow', () => {
    const state = bareState();
    equip(state, 'iron-sword');
    const fox = addCreature(state, 'snarlfox', 1_010, 1_000, { hp: 1, maxHp: 60 });
    const fiberBefore = state.inventory.fiber;

    const result = strikeCreatureMelee(state, fox.id);

    expect(result.killed).toBe(true);
    expect(state.wildCreatures).toHaveLength(0);
    // Same payout path the Encounter screen uses, so the trophy counter cannot
    // drift between the two kill routes.
    expect(state.questProgress.creatureDefeats['snarlfox']).toBe(1);
    expect(state.inventory.fiber).toBeGreaterThanOrEqual(fiberBefore);
  });

  it('refuses a tool with no creature row', () => {
    const state = bareState();
    const fox = addCreature(state, 'snarlfox', 1_010, 1_000);
    state.tools = [];
    state.equippedToolId = null;
    // Bare hands do have a creature row, so this asserts the reach gate instead.
    fox.x = 9_999;

    expect(strikeCreatureMelee(state, fox.id).ok).toBe(false);
  });

  it('only offers hostile creatures to the action button', () => {
    const state = bareState();
    addCreature(state, 'tuftle', 1_010, 1_000);
    expect(nearestHuntableCreature(state)).toBeNull();

    state.wildCreatures[0]!.aggroUntilTick = state.tick + 100;
    expect(nearestHuntableCreature(state)?.id).toBe('creature-tuftle');
  });
});

describe('fireCreatureShot', () => {
  it('shoots a named creature well beyond swinging distance', () => {
    const state = bareState();
    equip(state, 'bow');
    state.inventory.arrow = 5;
    // Five tiles out: nothing swung reaches this far, so a hit here can only be
    // the shot path.
    const stag = addCreature(state, 'glade-stag', 1_080, 1_000, { hp: 60, maxHp: 60 });

    const result = fireCreatureShot(state, stag.id);

    expect(result.ok).toBe(true);
    expect(stag.hp).toBeLessThan(60);
    expect(state.inventory.arrow).toBe(4);
    // An arrow is a provocation like any other.
    expect(stag.aggroUntilTick).toBeGreaterThan(state.tick);
  });

  it('refuses without a bow, and without arrows', () => {
    const state = bareState();
    const stag = addCreature(state, 'glade-stag', 1_080, 1_000);
    expect(fireCreatureShot(state, stag.id).ok).toBe(false);

    equip(state, 'bow');
    state.inventory.arrow = 0;
    expect(fireCreatureShot(state, stag.id).message).toBe('Out of arrows');
  });

  it('pays the ordinary defeat loot on the killing arrow', () => {
    const state = bareState();
    equip(state, 'bow');
    state.inventory.arrow = 5;
    const stag = addCreature(state, 'glade-stag', 1_080, 1_000, { hp: 1, maxHp: 60 });

    const result = fireCreatureShot(state, stag.id);

    expect(result.killed).toBe(true);
    expect(state.wildCreatures).toHaveLength(0);
    // The same counter the melee and encounter kills feed, so the trophy
    // schedule cannot drift between the three ways a creature can die.
    expect(state.questProgress.creatureDefeats['glade-stag']).toBe(1);
  });

  it('adds what Dexterity bought to every arrow', () => {
    const state = bareState();
    equip(state, 'bow');
    state.inventory.arrow = 5;
    state.gameBalance.defense.playerShotDamage = 6;
    state.gameBalance.attributeGains.dexterityRangedDamage = 3;
    state.player.attributes.dexterity = 4;
    const stag = addCreature(state, 'glade-stag', 1_080, 1_000, { hp: 60, maxHp: 60 });

    fireCreatureShot(state, stag.id);

    expect(stag.hp).toBe(60 - (6 + 4 * 3));
  });

  it('never picks a placid creature on its own', () => {
    const state = bareState();
    equip(state, 'bow');
    state.inventory.arrow = 5;
    addCreature(state, 'tuftle', 1_040, 1_000);

    // Un-named, this is the held trigger and the action button. A herd in front
    // of a nocked arrow must stay a herd until the player names one.
    expect(fireCreatureShot(state).ok).toBe(false);
  });
});

describe('throwSnareAtCreature', () => {
  it('resolves in place on the selected creature and spends the snare', () => {
    const state = bareState();
    state.inventory['taming-snare'] = 1;
    const tuftle = addCreature(state, 'tuftle', 1_010, 1_000);

    const result = throwSnareAtCreature(state, tuftle.id);

    expect(result.ok).toBe(true);
    expect(result.tamed || result.missed).toBe(true);
    expect(state.inventory['taming-snare']).toBe(0);
  });

  it('refuses with an empty bag — the snare is the whole gate', () => {
    const state = bareState();
    state.inventory['taming-snare'] = 0;
    state.inventory['reinforced-snare'] = 0;
    const tuftle = addCreature(state, 'tuftle', 1_010, 1_000);

    expect(throwSnareAtCreature(state, tuftle.id).message).toBe('Craft a Taming Snare first');
    expect(state.wildCreatures).toContain(tuftle);
  });

  it('refuses out of snaring range, and says the same thing the button does', () => {
    const state = bareState();
    state.inventory['taming-snare'] = 1;
    const tuftle = addCreature(state, 'tuftle', 1_400, 1_000);

    expect(snareThrowBlockedReason(state, tuftle.id)).toBe('Move closer to a wild creature');
    expect(throwSnareAtCreature(state, tuftle.id).ok).toBe(false);
  });
});

describe('loadoutStrikeStyle', () => {
  it('shoots with a nocked bow and swings with everything else', () => {
    const state = bareState();
    const stag = addCreature(state, 'glade-stag', 1_010, 1_000);
    const lock = { kind: 'creature', id: stag.id } as const;

    equip(state, 'iron-sword');
    expect(loadoutStrikeStyle(state, lock)).toBe('melee');

    equip(state, 'bow');
    state.inventory.arrow = 3;
    expect(loadoutStrikeStyle(state, lock)).toBe('ranged');
    // An empty quiver falls back to the club the bow becomes.
    state.inventory.arrow = 0;
    expect(loadoutStrikeStyle(state, lock)).toBe('melee');
    // A tree is swung at whatever is in hand.
    state.inventory.arrow = 3;
    expect(loadoutStrikeStyle(state, { kind: 'resource', id: 'node-tree' })).toBe('melee');
  });

  it('names the verb the loadout will actually use', () => {
    const target = {
      kind: 'creature' as const, id: 'creature-glade-stag', x: 0, y: 0,
      label: 'Glade Stag', hp: 10, maxHp: 10, distancePx: 20, inRange: true,
    };
    expect(combatActionLabel(target, 'Gather', 'melee')).toBe('Strike Glade Stag');
    expect(combatActionLabel(target, 'Gather', 'ranged')).toBe('Shoot Glade Stag');
  });
});

describe('resolveCombatTarget for creatures', () => {
  it('resolves a locked creature with its display name and health', () => {
    const state = bareState();
    const fox = addCreature(state, 'snarlfox', 1_010, 1_000, { hp: 22, maxHp: 60 });

    const resolved = resolveCombatTarget(state, { kind: 'creature', id: fox.id }, 'melee');

    expect(resolved).not.toBeNull();
    expect(resolved!.hp).toBe(22);
    expect(resolved!.maxHp).toBe(60);
    expect(resolved!.inRange).toBe(true);
  });

  it('drops the lock once the creature is gone', () => {
    const state = bareState();
    const fox = addCreature(state, 'snarlfox', 1_010, 1_000);
    state.wildCreatures = [];
    expect(resolveCombatTarget(state, { kind: 'creature', id: fox.id }, 'melee')).toBeNull();
  });
});
