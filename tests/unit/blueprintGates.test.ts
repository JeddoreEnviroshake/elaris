import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_GATES,
  FACILITY_BLUEPRINT_IDS,
  blueprintsGrantedAtLevel,
  blueprintsGrantedUpToLevel,
} from '../../src/content/blueprintGates';
import { BLUEPRINT_ITEM_IDS, knowsBlueprint } from '../../src/simulation/blueprintKnowledge';
import {
  claimAllBlueprintGrants,
  claimBlueprintGrant,
  hasPendingBlueprintGrants,
  queueLevelBlueprints,
} from '../../src/simulation/blueprintGrants';
import { grantXp } from '../../src/simulation/characterProgression';
import { createInitialState } from '../../src/simulation/state';

describe('blueprint level gates', () => {
  it('hands out the authored table at the authored levels', () => {
    expect(blueprintsGrantedAtLevel(1)).toEqual([
      'thatch-floor', 'thatch-wall', 'thatch-door',
      'wooden-axe', 'wooden-sickle', 'wooden-pick',
    ]);
    expect(blueprintsGrantedAtLevel(2)).toEqual(['cloth-mask', 'air-purifier']);
    expect(blueprintsGrantedAtLevel(4)).toEqual([
      'wooden-sword', 'field-cache', 'workbench', 'bow', 'arrow',
    ]);
    expect(blueprintsGrantedAtLevel(5)).toEqual([]);
    expect(blueprintsGrantedAtLevel(7)).toEqual(['bed', 'taming-snare']);
    // Levels with no gate are silent rather than an error.
    expect(blueprintsGrantedAtLevel(6)).toEqual([]);
    expect(blueprintsGrantedAtLevel(99)).toEqual([]);
  });

  it('sweeps a material tier without re-granting what an earlier level named', () => {
    const thatch = blueprintsGrantedAtLevel(3);
    expect(thatch).toContain('thatch-fence');
    // Named at level 1, so the level-3 sweep must not hand them over again.
    expect(thatch).not.toContain('thatch-floor');
    expect(thatch).not.toContain('thatch-wall');
    expect(thatch).not.toContain('thatch-door');

    const wood = blueprintsGrantedAtLevel(10);
    expect(wood).toContain('wood-wall');
    expect(wood).toContain('wood-bridge');
    // Named at level 1 and level 4 respectively.
    expect(wood).not.toContain('wooden-axe');
    expect(wood).not.toContain('wooden-sword');

    expect(blueprintsGrantedAtLevel(15)).toContain('stone-pick');
    expect(blueprintsGrantedAtLevel(20)).toContain('iron-sword');
    expect(blueprintsGrantedAtLevel(20)).toContain('metal-gate');
  });

  it('leaves the facilities to be found rather than sweeping them into a tier', () => {
    // stone-yard begins with "stone-" but is a facility, so the level-15 sweep
    // must step over it the way it does every other facility.
    expect(blueprintsGrantedAtLevel(15)).not.toContain('stone-yard');
    // A facility only ever reaches a gate by being named in it — the Storage
    // Box, Workbench, Bed and Air Purifier are. No sweep may ever add one, so
    // a facility added later joins the found pool by default.
    const named = new Set<string>(BLUEPRINT_GATES.flatMap((gate) => gate.items));
    const gated = new Set<string>(blueprintsGrantedUpToLevel(99));
    for (const id of FACILITY_BLUEPRINT_IDS) {
      expect(gated.has(id)).toBe(named.has(id));
    }
    // And most of them are not named at all: the homestead is found, not earned.
    const foundFacilities = [...FACILITY_BLUEPRINT_IDS].filter((id) => !named.has(id));
    expect(foundFacilities.length).toBeGreaterThan(FACILITY_BLUEPRINT_IDS.size / 2);
  });

  it('never grants the same blueprint from two different levels', () => {
    const seen = new Set<string>();
    for (const gate of BLUEPRINT_GATES) {
      for (const id of blueprintsGrantedAtLevel(gate.level)) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  it('only ever names real blueprints', () => {
    for (const gate of BLUEPRINT_GATES) {
      for (const id of blueprintsGrantedAtLevel(gate.level)) {
        expect(BLUEPRINT_ITEM_IDS).toContain(id);
      }
    }
  });

  it('accumulates every gate at or below a level', () => {
    const upToFive = blueprintsGrantedUpToLevel(5);
    expect(upToFive).toContain('thatch-floor');
    expect(upToFive).toContain('workbench');
    expect(upToFive).toContain('bow');
    expect(upToFive).not.toContain('bed');
    expect(blueprintsGrantedUpToLevel(20).length).toBeGreaterThan(upToFive.length);
  });
});

describe('core blueprint grants', () => {
  it('queues rather than teaches, so the reveal is the player action', () => {
    const state = createInitialState(7);
    // 260 XP is two levels, which crosses the level-2 survival gate.
    expect(grantXp(state, 260).levelsGained).toBe(2);
    expect(hasPendingBlueprintGrants(state)).toBe(true);
    expect(state.pendingBlueprintGrantIds).toContain('cloth-mask');
    // Earned is not the same as known: the tab still shows ???? until claimed.
    expect(knowsBlueprint(state, 'cloth-mask')).toBe(false);

    expect(claimBlueprintGrant(state, 'cloth-mask')).toBe(true);
    expect(knowsBlueprint(state, 'cloth-mask')).toBe(true);
    expect(state.pendingBlueprintGrantIds).not.toContain('cloth-mask');
    // Claiming twice is a no-op rather than a duplicate.
    expect(claimBlueprintGrant(state, 'cloth-mask')).toBe(false);
  });

  it('claims the whole queue at once and leaves nothing waiting', () => {
    const state = createInitialState(7);
    grantXp(state, 260);
    const pending = [...state.pendingBlueprintGrantIds];
    expect(pending.length).toBeGreaterThan(0);
    expect(claimAllBlueprintGrants(state)).toEqual(pending);
    expect(hasPendingBlueprintGrants(state)).toBe(false);
    for (const id of pending) expect(knowsBlueprint(state, id)).toBe(true);
  });

  it('never queues a blueprint already known or already waiting', () => {
    const state = createInitialState(7);
    expect(queueLevelBlueprints(state, 1)).toEqual([]); // level 1 is known at birth
    expect(queueLevelBlueprints(state, 2)).toHaveLength(2);
    expect(queueLevelBlueprints(state, 2)).toEqual([]); // already waiting
    claimAllBlueprintGrants(state);
    expect(queueLevelBlueprints(state, 2)).toEqual([]); // now already known
  });
});
