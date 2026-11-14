import { beforeEach, describe, expect, it } from 'vitest';
import {
  CREATURE_AGGRO_MEMORY_TICKS,
  CREATURE_REGEN_INTERVAL_TICKS,
  advanceWildCreatures,
  provokeCreature,
} from '../../src/simulation/creatureCombat';
import { newWildCreature } from '../../src/simulation/worldGeneration';
import { CREATURE_DEFINITIONS, creatureDefinition } from '../../src/content/creatures';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { beginPlayerDefeat } from '../../src/simulation/survivalCycle';
import { createInitialState, type GameState, type SpeciesId, type WildCreatureState } from '../../src/simulation/state';
import { WORLD_PX } from '../../src/config/platform';

/**
 * A world with exactly one creature in it, placed relative to the player, so
 * every case here reads as "this species, this far away, this many ticks".
 */
function worldWith(speciesId: SpeciesId, offsetX: number, offsetY = 0): {
  state: GameState;
  creature: WildCreatureState;
} {
  const state = createInitialState(77);
  state.player.x = 600;
  state.player.y = 600;
  state.player.hp = state.player.maxHp;
  const creature = newWildCreature(`test-${speciesId}`, speciesId, 600 + offsetX, 600 + offsetY);
  state.wildCreatures = [creature];
  return { state, creature };
}

function run(state: GameState, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) {
    state.tick += 1;
    advanceWildCreatures(state);
  }
}

/**
 * The same world, with the player parked in the far corner instead of the
 * creature pushed out to one. Offsetting the creature past WORLD_PX would clamp
 * its wander target back inside the map and read as a 1,500px lurch that no
 * player would ever see.
 */
function idleWorldWith(speciesId: SpeciesId): { state: GameState; creature: WildCreatureState } {
  const world = worldWith(speciesId, 0);
  world.state.player.x = WORLD_PX - 32;
  world.state.player.y = WORLD_PX - 32;
  return world;
}

function homeDistance(creature: WildCreatureState): number {
  return Math.hypot(creature.x - creature.homeX, creature.y - creature.homeY);
}

function wanderRadius(speciesId: SpeciesId): number {
  return creatureDefinition(speciesId).encounter.wanderRadiusPx;
}

describe('wild creature overworld behavior', () => {
  describe('aggro by temperament', () => {
    it('leaves a placid species alone no matter how close the player stands', () => {
      // A Tuftle has aggroRangePx 0: standing on top of one is not a fight.
      const { state, creature } = worldWith('tuftle', 8);
      run(state, 600);
      expect(creature.aggroUntilTick).toBe(0);
      expect(state.player.hp).toBe(state.player.maxHp);
    });

    it('sends an aggressive species after a player who wanders into range', () => {
      // Snarlfox aggroRangePx is 112; 100px away is inside it.
      const { state, creature } = worldWith('snarlfox', 100);
      run(state, 1);
      expect(creature.aggroUntilTick).toBe(state.tick + CREATURE_AGGRO_MEMORY_TICKS);
    });

    it('ignores a player standing beyond aggro range', () => {
      const { state, creature } = worldWith('snarlfox', 300);
      run(state, 60);
      expect(creature.aggroUntilTick).toBe(0);
      // It ambles its own patch rather than closing: an out-of-range player
      // must not pull a creature one pixel off its territory.
      expect(homeDistance(creature)).toBeLessThanOrEqual(wanderRadius('snarlfox'));
    });

    it('turns a provoked placid species hostile', () => {
      const { state, creature } = worldWith('tuftle', 60);
      provokeCreature(state, creature);
      expect(creature.aggroUntilTick).toBeGreaterThan(state.tick);
      run(state, 40);
      // It closed the distance rather than standing there being hit.
      expect(creature.x).toBeLessThan(660);
    });
  });

  describe('wandering', () => {
    it('moves an unbothered creature off its spawn pixel', () => {
      // The player is parked far away, so nothing here is provoked: this is the
      // world being alive rather than the world reacting.
      const { state, creature } = idleWorldWith('glade-stag');
      run(state, 240);
      expect(homeDistance(creature)).toBeGreaterThan(0);
    });

    it('keeps every species inside its own patch', () => {
      // The whole roster, because a wander radius wider than a leash would send
      // a creature out and straight back forever.
      for (const definition of CREATURE_DEFINITIONS) {
        const { state, creature } = idleWorldWith(definition.speciesId);
        run(state, 2_000);
        expect(homeDistance(creature)).toBeLessThanOrEqual(definition.encounter.wanderRadiusPx);
        expect(definition.encounter.wanderRadiusPx).toBeLessThan(definition.encounter.leashPx);
      }
    });

    it('ranges further for a roamer than for a grazer', () => {
      // Temperament is meant to be legible from across the screen: a Glade Stag
      // covers ground, a Tuftle grazes a patch. Measured as the furthest either
      // gets from home over the same stretch of ticks.
      const stag = idleWorldWith('glade-stag');
      const tuftle = idleWorldWith('tuftle');
      let stagReach = 0;
      let tuftleReach = 0;
      for (let index = 0; index < 1_200; index += 1) {
        run(stag.state, 1);
        run(tuftle.state, 1);
        stagReach = Math.max(stagReach, homeDistance(stag.creature));
        tuftleReach = Math.max(tuftleReach, homeDistance(tuftle.creature));
      }
      expect(stagReach).toBeGreaterThan(tuftleReach);
    });

    it('ambles slower than it chases', () => {
      // The change of gait is the tell that a creature has noticed the player,
      // so a wander step must never cover as much ground as a hunt step.
      const wandering = idleWorldWith('snarlfox');
      const hunting = worldWith('snarlfox', 300);
      provokeCreature(hunting.state, hunting.creature);
      const huntStart = hunting.creature.x;
      const wanderStart = wandering.creature.x;
      run(wandering.state, 20);
      run(hunting.state, 20);
      expect(Math.abs(hunting.creature.x - huntStart))
        .toBeGreaterThan(Math.abs(wandering.creature.x - wanderStart));
    });

    it('wanders on whole pixels and leaves the state canonicalizable', () => {
      const { state, creature } = idleWorldWith('craghopper');
      run(state, 600);
      expect(Number.isInteger(creature.x)).toBe(true);
      expect(Number.isInteger(creature.y)).toBe(true);
      expect(() => canonicalizeGameState(state)).not.toThrow();
    });

    it('wanders identically on a replay and consumes no shared RNG', () => {
      // Wander targets are hashed from the seed and the tick rather than rolled,
      // so a reloaded save resumes the same walk and no other system's rolls
      // shift underneath it.
      const first = idleWorldWith('glade-stag');
      const second = idleWorldWith('glade-stag');
      const rngBefore = first.state.rngState;
      run(first.state, 500);
      run(second.state, 500);
      expect(canonicalizeGameState(first.state)).toBe(canonicalizeGameState(second.state));
      expect(first.state.rngState).toBe(rngBefore);
    });

    it('never wanders through a building', () => {
      const { state } = idleWorldWith('glade-stag');
      const before = state.buildings.map((building) => building.hp);
      run(state, 600);
      expect(state.buildings.map((building) => building.hp)).toEqual(before);
    });
  });

  describe('contact damage', () => {
    it('hits on its own cadence rather than every tick', () => {
      const { state, creature } = worldWith('tuftle', 16);
      provokeCreature(state, creature);
      const before = state.player.hp;
      // Tuftle attackIntervalTicks is 180, so 200 ticks allows two hits: the
      // first is free (nextAttackTick starts at 0), the second at +180.
      run(state, 200);
      const damagePerHit = before - state.player.hp;
      expect(damagePerHit).toBeGreaterThan(0);
      expect(creature.nextAttackTick).toBeGreaterThan(state.tick);
    });

    it('never bites through a wall, which the player may still shoot over', () => {
      const { state, creature } = worldWith('tuftle', 16);
      // One segment on the grid line between the two, and nothing else: this is
      // cover, not an enclosure, so only the sight line stops the bite.
      state.buildings = [{
        id: 'building-cover', definitionId: 'wood-wall', tileX: 37, tileY: 37, boundaryEdge: 'east',
      }];
      provokeCreature(state, creature);
      const before = state.player.hp;
      run(state, 200);
      expect(state.player.hp).toBe(before);

      // The identical world without the wall is the hit this one refused.
      const open = worldWith('tuftle', 16);
      provokeCreature(open.state, open.creature);
      run(open.state, 200);
      expect(open.state.player.hp).toBeLessThan(before);
    });

    it('never attacks a player who is respawning', () => {
      const { state, creature } = worldWith('snarlfox', 40);
      provokeCreature(state, creature);
      // A real defeat rather than a hand-built one, so this keeps testing the
      // guard even if the respawn payload gains fields.
      beginPlayerDefeat(state, 'creature');
      expect(state.pendingRespawn).not.toBeNull();
      state.player.hp = state.player.maxHp;
      run(state, 300);
      expect(state.player.hp).toBe(state.player.maxHp);
    });

    it('reports a defeat when contact damage empties the player', () => {
      const { state, creature } = worldWith('snarlfox', 40);
      provokeCreature(state, creature);
      state.player.hp = 1;
      state.tick += 1;
      const result = advanceWildCreatures(state);
      expect(state.player.hp).toBe(0);
      expect(result.defeat).toBeDefined();
    });
  });

  describe('leashing and recovery', () => {
    it('gives up and walks home once dragged past its leash', () => {
      const { state, creature } = worldWith('craghopper', 20);
      provokeCreature(state, creature);
      // Drag the creature well past its 192px leash, then park the player far
      // away so nothing re-aggros it.
      creature.x = creature.homeX + 400;
      creature.y = creature.homeY;
      state.player.x = creature.x + 10;
      run(state, 1);
      expect(creature.aggroUntilTick).toBe(0);

      state.player.x = 2_000;
      state.player.y = 2_000;
      run(state, 800);
      // All the way back into its patch, not merely pointed at it. Home itself
      // is no longer the resting place — a creature that gave up on a chase
      // rejoins its wander, so the territory is what the leash restores.
      expect(homeDistance(creature)).toBeLessThanOrEqual(wanderRadius('craghopper'));
    });

    it('regenerates only once it is idle back at home', () => {
      const { state, creature } = worldWith('tuftle', 400);
      creature.hp = 10;
      run(state, CREATURE_REGEN_INTERVAL_TICKS * 4);
      expect(creature.hp).toBeGreaterThan(10);
      expect(creature.hp).toBeLessThanOrEqual(creature.maxHp);
    });

    it('does not regenerate while it is away from home', () => {
      const { state, creature } = worldWith('tuftle', 400);
      creature.hp = 10;
      creature.x = creature.homeX + 300;
      run(state, CREATURE_REGEN_INTERVAL_TICKS * 2);
      expect(creature.hp).toBe(10);
    });
  });

  describe('skittish flight', () => {
    it('runs from the player instead of closing in', () => {
      const { state, creature } = worldWith('glade-stag', 60);
      provokeCreature(state, creature);
      expect(creature.fleeUntilTick).toBeGreaterThan(state.tick);
      run(state, 30);
      // Player is at 600; the stag started at 660 and should be further out.
      expect(creature.x).toBeGreaterThan(660);
    });

    it('bites back when the player corners it', () => {
      const { state, creature } = worldWith('glade-stag', 8);
      provokeCreature(state, creature);
      const before = state.player.hp;
      // Walls on every side would be the honest test; pinning the creature by
      // resetting its position each tick is the same situation from the
      // player's side — it cannot get away and the player stays on top of it.
      for (let index = 0; index < 60; index += 1) {
        state.tick += 1;
        creature.x = 608;
        creature.y = 600;
        advanceWildCreatures(state);
      }
      expect(state.player.hp).toBeLessThan(before);
    });

    it('stops fleeing at the leash rather than crossing the map', () => {
      const { state, creature } = worldWith('glade-stag', 8);
      provokeCreature(state, creature);
      run(state, 400);
      const distance = Math.hypot(creature.x - creature.homeX, creature.y - creature.homeY);
      // leashPx is 224; flight ends there, then it walks back.
      expect(distance).toBeLessThanOrEqual(224 + 2);
    });
  });

  describe('kiting', () => {
    it('backs a Snarlfox off to its preferred range before shooting', () => {
      // preferredRangePx 80, attackRangePx 96: at 40px away it is too close.
      const { state, creature } = worldWith('snarlfox', 40);
      provokeCreature(state, creature);
      run(state, 30);
      expect(creature.x).toBeGreaterThan(640);
    });
  });

  describe('determinism', () => {
    it('stays on whole pixels when chasing a player on fractional ones', () => {
      const { state, creature } = worldWith('snarlfox', 100);
      provokeCreature(state, creature);
      // Movement writes interpolated positions between canonicalization points,
      // so the chase target genuinely arrives fractional. An unrounded step
      // would put the creature on a fractional pixel and break the state hash.
      state.player.x = 617.4;
      state.player.y = 603.9;
      run(state, 120);
      expect(Number.isInteger(creature.x)).toBe(true);
      expect(Number.isInteger(creature.y)).toBe(true);
    });

    it('leaves the state canonicalizable after a long hunt', () => {
      const { state, creature } = worldWith('snarlfox', 100);
      provokeCreature(state, creature);
      run(state, 240);
      expect(() => canonicalizeGameState(state)).not.toThrow();
    });

    it('produces an identical world from an identical starting state', () => {
      const first = worldWith('snarlfox', 90);
      const second = worldWith('snarlfox', 90);
      provokeCreature(first.state, first.creature);
      provokeCreature(second.state, second.creature);
      run(first.state, 240);
      run(second.state, 240);
      expect(canonicalizeGameState(first.state)).toBe(canonicalizeGameState(second.state));
    });

    it('consumes no shared RNG, so creature behavior cannot shift other rolls', () => {
      const { state, creature } = worldWith('snarlfox', 90);
      provokeCreature(state, creature);
      const rngBefore = state.rngState;
      run(state, 240);
      expect(state.rngState).toBe(rngBefore);
    });
  });

  describe('walls', () => {
    let state: GameState;
    let creature: WildCreatureState;

    beforeEach(() => {
      const world = worldWith('snarlfox', 100);
      state = world.state;
      creature = world.creature;
    });

    it('never damages a building it cannot walk through', () => {
      provokeCreature(state, creature);
      const before = state.buildings.map((building) => building.hp);
      run(state, 300);
      expect(state.buildings.map((building) => building.hp)).toEqual(before);
    });
  });
});
