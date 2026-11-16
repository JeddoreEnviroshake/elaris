import { describe, expect, it } from 'vitest';
import {
  damageWildCreature, isEating, isHeldInPlace, offerBlockedReason, offerToCreature, tameChance, throwSnareAtCreature,
} from '../../src/simulation/tameChance';
import { advanceWildCreatures } from '../../src/simulation/creatureCombat';
import { snareTarget, useHotbarItem } from '../../src/simulation/hotbarItems';
import { beginOpeningTrust } from '../../src/simulation/onboarding';
import { STARTER_TUFTLE_POSITION } from '../../src/content/onboarding';
import { newWildCreature } from '../../src/simulation/worldGeneration';
import { createInitialState, type GameState, type SpeciesId, type WildCreatureState } from '../../src/simulation/state';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { migrateToCurrent } from '../../src/persistence/migrations';
import { CONTENT_VERSION, SAVE_SCHEMA_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { prepareOpeningTaming } from '../helpers/openingJourney';
import {
  TAME_CHANCE_MAX_BPS, TAME_CHANCE_MIN_BPS, TAME_PITY_PER_MISS_BPS, TAME_STAGGER_TICKS,
} from '../../src/config/balance';

/** A clean field with one creature beside the player, away from town and the opening fixture. */
function field(speciesId: SpeciesId, seed = 9): { state: GameState; wild: WildCreatureState } {
  const state = createInitialState(seed);
  state.player.x = 2_000; state.player.y = 2_000;
  const wild = newWildCreature(`test-${speciesId}`, speciesId, 2_020, 2_000);
  state.wildCreatures = [wild];
  state.tick = 1_000;
  return { state, wild };
}

describe('tame chance', () => {
  it('is a near-hopeless throw at a full-health, unfed, hostile creature', () => {
    const { state, wild } = field('mistmoth');
    wild.aggroUntilTick = state.tick + 600;
    const { chanceBps, parts } = tameChance(state, wild);
    expect(chanceBps).toBeLessThanOrEqual(600);
    expect(parts.hp).toBe(0);
    expect(parts.unnoticed).toBe(0);
  });

  it('pays off when the player does the work: fed, worn down, staggered, unnoticed', () => {
    const { state, wild } = field('mistmoth');
    state.inventory.fiber = 3;
    for (let offer = 0; offer < 3; offer++) expect(offerToCreature(state, wild.id).ok).toBe(true);
    damageWildCreature(state, wild, wild.hp - Math.floor(wild.maxHp / 4));
    expect(tameChance(state, wild).chanceBps).toBeGreaterThanOrEqual(8_500);
  });

  it('keeps the starter species friendly: one berry and an unseen approach is a fair coin', () => {
    const { state, wild } = field('tuftle');
    state.inventory.berry = 1;
    offerToCreature(state, wild.id);
    const chance = tameChance(state, wild).chanceBps;
    expect(chance).toBeGreaterThanOrEqual(4_500);
    expect(chance).toBeLessThanOrEqual(6_500);
  });

  it('multiplies the whole sum by the Reinforced Snare tier', () => {
    const basic = field('glade-stag'); basic.state.inventory['taming-snare'] = 1;
    const reinforced = field('glade-stag'); reinforced.state.inventory['reinforced-snare'] = 1;
    const a = tameChance(basic.state, basic.wild).chanceBps;
    const b = tameChance(reinforced.state, reinforced.wild).chanceBps;
    expect(b).toBe(Math.max(TAME_CHANCE_MIN_BPS, Math.min(TAME_CHANCE_MAX_BPS, Math.floor(a * 16_000 / 10_000))));
  });

  it('always reports whole basis points inside the clamp', () => {
    for (const speciesId of ['tuftle', 'craghopper', 'glade-stag', 'snarlfox', 'masonmole', 'bulwark-boar', 'quillfinch', 'mistmoth', 'slingtail'] as const) {
      const { state, wild } = field(speciesId);
      for (const hp of [wild.maxHp, Math.floor(wild.maxHp / 3), 1]) {
        wild.hp = hp;
        const { chanceBps, parts } = tameChance(state, wild);
        expect(Number.isSafeInteger(chanceBps)).toBe(true);
        expect(chanceBps).toBeGreaterThanOrEqual(TAME_CHANCE_MIN_BPS);
        expect(chanceBps).toBeLessThanOrEqual(TAME_CHANCE_MAX_BPS);
        expect(Object.values(parts).every(Number.isSafeInteger)).toBe(true);
      }
    }
  });
});

describe('stagger', () => {
  it('fires once, at a quarter health, and holds the creature in place', () => {
    const { state, wild } = field('craghopper');
    expect(damageWildCreature(state, wild, 1).staggered).toBe(false);
    const quarter = Math.floor(wild.maxHp / 4);
    expect(damageWildCreature(state, wild, wild.hp - quarter).staggered).toBe(true);
    expect(wild.staggerUntilTick).toBe(state.tick + TAME_STAGGER_TICKS);
    expect(tameChance(state, wild).parts.stagger).toBeGreaterThan(0);
    const at = { x: wild.x, y: wild.y };
    wild.aggroUntilTick = state.tick + 600;
    for (let i = 0; i < 30; i++) { state.tick++; advanceWildCreatures(state); }
    expect({ x: wild.x, y: wild.y }).toEqual(at);
    state.tick = wild.staggerUntilTick! + 1;
    expect(damageWildCreature(state, wild, 1).staggered).toBe(false);
  });
});

describe('offering food', () => {
  it('prefers the favourite, calms the creature, and caps what food alone can do', () => {
    const { state, wild } = field('masonmole');
    state.inventory.stone = 2; state.inventory.berry = 5;
    wild.aggroUntilTick = state.tick + 600;
    expect(offerToCreature(state, wild.id).message).toContain('loves it');
    expect(state.inventory.stone).toBe(1);
    expect(state.inventory.berry).toBe(5);
    expect(isEating(state, wild)).toBe(true);
    expect(isHeldInPlace(state, wild)).toBe(true);
    expect(wild.aggroUntilTick).toBe(0);
    // Offers stack, even mid-meal, up to the species' food cap.
    expect(offerToCreature(state, wild.id).ok).toBe(true);
    expect(wild.captureBonusBps).toBe(2_400);
    state.inventory.stone = 10;
    for (let i = 0; i < 6; i++) offerToCreature(state, wild.id);
    expect(wild.captureBonusBps).toBe(6_000);
    expect(offerBlockedReason(state, wild.id)).toBe('It has eaten its fill');
  });

  it('falls back to a small berry bonus and refuses a spooked creature', () => {
    const { state, wild } = field('glade-stag');
    state.inventory.fiber = 0; state.inventory.berry = 1;
    offerToCreature(state, wild.id);
    expect(wild.captureBonusBps).toBe(400);
    const other = field('glade-stag');
    other.state.inventory.fiber = 1;
    other.wild.fleeUntilTick = other.state.tick + 100;
    expect(offerToCreature(other.state, other.wild.id).ok).toBe(false);
    expect(other.state.inventory.fiber).toBe(1);
  });

  it('ends the meal when the creature is struck', () => {
    const { state, wild } = field('tuftle');
    state.inventory.berry = 1;
    offerToCreature(state, wild.id);
    damageWildCreature(state, wild, 1);
    expect(isEating(state, wild)).toBe(false);
  });
});

describe('throwing a snare', () => {
  it('takes the creature on a hit and grants it to the roster', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { state, wild } = field('tuftle', seed);
      state.inventory['taming-snare'] = 1;
      wild.hp = 1; wild.captureBonusBps = 5_000;
      const result = throwSnareAtCreature(state, wild.id);
      if (!result.tamed) continue;
      expect(state.ownedCreatures.map((owned) => owned.speciesId)).toEqual(['tuftle']);
      expect(state.wildCreatures).toHaveLength(0);
      return;
    }
    throw new Error('a 95% throw never landed across 59 seeds');
  });

  it('on a miss: spends the snare, halves food progress, adds pity, and reacts by temperament', () => {
    for (let seed = 1; seed < 200; seed++) {
      const { state, wild } = field('bulwark-boar', seed);
      state.inventory['taming-snare'] = 1;
      wild.captureBonusBps = 2_000;
      const result = throwSnareAtCreature(state, wild.id);
      if (!result.missed) continue;
      expect(state.inventory['taming-snare']).toBe(0);
      expect(wild.captureBonusBps).toBe(1_000);
      expect(wild.snareMisses).toBe(1);
      expect(tameChance(state, wild).parts.pity).toBe(TAME_PITY_PER_MISS_BPS);
      expect(wild.aggroUntilTick).toBeGreaterThan(state.tick);
      return;
    }
    throw new Error('no miss found');
  });

  it('makes a passive creature run rather than fight after a miss', () => {
    for (let seed = 1; seed < 200; seed++) {
      const { state, wild } = field('mistmoth', seed);
      state.inventory['taming-snare'] = 1;
      if (!throwSnareAtCreature(state, wild.id).missed) continue;
      expect(wild.fleeUntilTick).toBeGreaterThan(state.tick);
      expect(wild.aggroUntilTick).toBe(0);
      return;
    }
    throw new Error('no miss found');
  });

  it('is deterministic for the same seed and the same throws', () => {
    const run = () => {
      const { state, wild } = field('snarlfox', 77);
      state.inventory['taming-snare'] = 4;
      for (let i = 0; i < 4 && state.wildCreatures.length; i++) {
        throwSnareAtCreature(state, wild.id);
        wild.aggroUntilTick = 0; wild.fleeUntilTick = 0;
      }
      return canonicalizeGameState(state);
    };
    expect(run()).toBe(run());
  });

  it('refuses without spending anything when the roster cannot take the species', () => {
    const { state, wild } = field('tuftle');
    state.inventory['taming-snare'] = 1;
    state.ownedCreatures = Array.from({ length: 30 }, (_, index) => ({
      id: `owned-${index}`, speciesId: 'tuftle', name: 'Tuftle', role: 'rest', assignment: null, worksiteId: null,
      nextWorkTick: 0, housingId: null, workRemainderMs: 0, bondXp: 0, selectedBattleAbilityId: 'tuftle-guard', level: 1,
    }));
    expect(throwSnareAtCreature(state, wild.id).ok).toBe(false);
    expect(state.inventory['taming-snare']).toBe(1);
  });
});

describe('v92 migration', () => {
  it('closes an open arena, hands the creature its health back, and drops the tutorial session', () => {
    const { state, wild } = field('craghopper');
    const raw = JSON.parse(JSON.stringify({ meta: { saveVersion: 91, contentVersion: 69, worldGenVersion: WORLD_GEN_VERSION, appVersion: 'test', savedAt: 1 }, state }));
    raw.state.activeEncounter = { wildCreatureId: wild.id, creatureHp: 5 };
    raw.state.onboarding.trustSession = null;
    if (raw.state.onboarding.supplyRun) Object.assign(raw.state.onboarding.supplyRun, { guardianStarted: false, guardianDefeated: false, guardedDamage: 0 });
    raw.state.wildCreatures.push({ ...raw.state.wildCreatures[0], id: `opening-guardian-${state.seed}` });
    const migrated = migrateToCurrent(raw).save;
    expect(migrated.meta).toMatchObject({ saveVersion: SAVE_SCHEMA_VERSION, contentVersion: CONTENT_VERSION });
    expect('activeEncounter' in migrated.state).toBe(false);
    expect('trustSession' in migrated.state.onboarding).toBe(false);
    expect(migrated.state.wildCreatures).toHaveLength(1);
    expect(migrated.state.wildCreatures[0]!.hp).toBe(5);
  });
});

describe('hotbar items', () => {
  const aim = (dirX: number, dirY: number, lockedCreatureId: string | null = null) => ({ dirX, dirY, lockedCreatureId });

  it('throws a snare in front of the character and catches the first creature on the line', () => {
    const { state, wild } = field('tuftle');
    wild.x = 2_085; // past arm's reach, inside throwing range
    state.inventory['taming-snare'] = 1;
    expect(snareTarget(state, aim(1, 0))).toBe(wild);
    expect(snareTarget(state, aim(-1, 0))).toBeNull();
    expect(snareTarget(state, aim(0, 1))).toBeNull();
    const result = useHotbarItem(state, 'taming-snare', aim(1, 0));
    expect(result.ok).toBe(true);
    expect(result.tamed || result.missed).toBe(true);
    expect(state.inventory['taming-snare']).toBe(0);
  });

  it('lands a snare that hits nothing on the ground instead of wasting it', () => {
    const { state, wild } = field('tuftle');
    wild.x = 2_085;
    state.inventory['taming-snare'] = 1;
    const drops = state.groundDrops.length;
    const result = useHotbarItem(state, 'taming-snare', aim(-1, 0));
    expect(result).toMatchObject({ ok: true, landed: true, thrownTo: { x: 2_000 - 96, y: 2_000 } });
    expect(state.groundDrops).toHaveLength(drops + 1);
    expect(state.groundDrops.at(-1)).toMatchObject({ resource: 'taming-snare', amount: 1, x: 1_904, y: 2_000 });
  });

  it("turns to a creature within arm's reach when nothing is ahead", () => {
    const { state, wild } = field('tuftle');
    wild.x = 2_000; wild.y = 2_040;
    expect(snareTarget(state, aim(1, 0))).toBe(wild);
  });

  it('prefers a locked creature in range over the aim line', () => {
    const { state, wild } = field('tuftle');
    expect(snareTarget(state, aim(-1, 0, wild.id))).toBe(wild);
  });

  it('feeds the nearest creature, and refuses food it does not want without spending it', () => {
    const { state, wild } = field('masonmole');
    state.inventory.fiber = 1; state.inventory.stone = 1;
    expect(useHotbarItem(state, 'fiber', aim(0, 1)).ok).toBe(false);
    expect(state.inventory.fiber).toBe(1);
    expect(useHotbarItem(state, 'stone', aim(0, 1))).toMatchObject({ ok: true, fed: true, creatureId: wild.id });
    expect(state.inventory.stone).toBe(0);
    state.wildCreatures = [];
    state.inventory.berry = 1;
    expect(useHotbarItem(state, 'berry', aim(0, 1)).message).toBe('No creature close enough to feed');
  });

  it('teaches the tutorial with the same controls: the berry, then the snare the player crafted', () => {
    const state = createInitialState(42);
    Object.assign(state.player, STARTER_TUFTLE_POSITION);
    state.player.x -= 16;
    const before = structuredClone(state.inventory);
    prepareOpeningTaming(state);
    expect(beginOpeningTrust(state).ok).toBe(true);
    expect(useHotbarItem(state, 'taming-snare', aim(1, 0)).ok).toBe(false);
    expect(useHotbarItem(state, 'berry', aim(1, 0))).toMatchObject({ ok: true, fed: true });
    expect(useHotbarItem(state, 'taming-snare', aim(1, 0))).toMatchObject({ ok: true, tamed: true });
    expect(state.ownedCreatures.map((creature) => creature.speciesId)).toEqual(['tuftle']);
    expect(state.inventory).toEqual(before);
  });
});

describe('v93 migration', () => {
  it('credits the new foraging and crafting steps to anyone already past the Tuftle', () => {
    const met = createInitialState(42);
    met.onboarding.completedMilestoneIds = ['meet-tuftle'];
    const fresh = createInitialState(43);
    const envelope = (state: GameState) => JSON.parse(JSON.stringify({ meta: { saveVersion: 92, contentVersion: 70, worldGenVersion: WORLD_GEN_VERSION, appVersion: 'test', savedAt: 1 }, state }));
    const migrated = migrateToCurrent(envelope(met)).save.state.onboarding.completedMilestoneIds;
    expect(migrated).toEqual(['pick-berries', 'craft-axe', 'craft-snare', 'meet-tuftle']);
    expect(migrateToCurrent(envelope(fresh)).save.state.onboarding.completedMilestoneIds).toEqual([]);
  });
});
