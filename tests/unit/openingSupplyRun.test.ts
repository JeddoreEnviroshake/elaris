import { describe, expect, it } from 'vitest';
import { readySupplyRun } from '../helpers/openingJourney';
import { CONTENT_VERSION, SAVE_SCHEMA_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { createOpeningChapter, OPENING_CHAPTER_VERSION, openingGuardianId, openingSupplyCacheId } from '../../src/content/onboarding';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { beginOpeningGuardPractice, claimOpeningDiscovery, openOpeningSideCache, recoverOpeningSupplies, reconcileOpeningSupplyRun, supplyRunRoute, supplyRunTarget } from '../../src/simulation/openingSupplyRun';
import { encounterDistance, resolveEncounterAction } from '../../src/simulation/encounters';
import { openNearestContainer } from '../../src/simulation/worldContainers';
import { activeQuest, reconcileQuestProgress } from '../../src/simulation/progression';
import { migrateToCurrent, SaveValidationError } from '../../src/persistence/migrations';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { advanceWildCreatures } from '../../src/simulation/creatureCombat';
import { dropCarriedBlueprint, recoverBlueprintDrop, expireBlueprintDrops, registerCarriedBlueprint, scrapCarriedBlueprint } from '../../src/simulation/carriedBlueprints';
import { sellCarriedBlueprint } from '../../src/simulation/npcStock';
import { elarisPublicWorkbenchCenterPx } from '../../src/simulation/elarisWorkbench';
import { RESOURCE_STACK_SIZE } from '../../src/config/balance';
import { inventoryCapacity } from '../../src/simulation/characterProgression';
import { dropResourceStack, usedInventorySlots } from '../../src/simulation/gameplayCommands';
import { beginPlayerDefeat, chooseRespawn, survivalSchedule } from '../../src/simulation/survivalCycle';

function envelope(state: GameState, version = SAVE_SCHEMA_VERSION) {
  return { meta: { saveVersion: version, contentVersion: CONTENT_VERSION, worldGenVersion: WORLD_GEN_VERSION, appVersion: 'test', savedAt: 1 }, state };
}
function atCart(seed = 42) {
  const state = readySupplyRun(seed); const site = state.onboarding.supplyRun!.site!;
  state.player.x = (site.tileX + .5) * 16; state.player.y = (site.tileY + .5) * 16;
  reconcileQuestProgress(state); return state;
}

describe('nearby supply run', () => {
  it('authors a reachable road landmark, optional log, and return route across starter seeds', () => {
    for (const seed of [0, 1, 7, 42, 99, 12345, 0xffffffff]) {
      const state = readySupplyRun(seed); const site = state.onboarding.supplyRun!.site;
      expect(site, `missing cart for ${seed}`).not.toBeNull();
      const route = supplyRunRoute(state, site!);
      expect(route, `unreachable cart for ${seed}`).not.toBeNull();
      expect(route!.length).toBeLessThan(120);
      expect(state.containers.filter((container) => container.id === openingSupplyCacheId(seed))).toHaveLength(1);
      expect(state.containers.some((container) => container.id === `opening-side-cache-${seed}`)).toBe(true);
      state.player.x = (site!.tileX + .5) * 16; state.player.y = (site!.tileY + .5) * 16;
      recoverOpeningSupplies(state);
      expect(supplyRunTarget(state)?.label).toBe('Public workbench');
      expect(supplyRunRoute(state, { tileX: 85, tileY: 83 }), `return route for ${seed}`).not.toBeNull();
    }
  });

  it('recovers supplies and exactly one carried blueprint without requiring combat', () => {
    const state = atCart(); const before = { ...state.inventory };
    expect(openNearestContainer(state).ok).toBe(true); reconcileQuestProgress(state);
    expect(state.inventory.wood).toBe(before.wood + 4); expect(state.inventory.fiber).toBe(before.fiber + 2);
    expect(state.carriedBlueprints.filter((paper) => paper.blueprintId === 'garden-bed')).toHaveLength(1);
    expect(state.unlockedItemIds).not.toContain('garden-bed');
    expect(state.onboarding.supplyRun).toMatchObject({ guardianDefeated: false, guardianStarted: false, suppliesRecovered: true, blueprintClaimed: true });
    expect(state.onboarding.status).toBe('active');
    expect(recoverOpeningSupplies(state).ok).toBe(false);
    expect(claimOpeningDiscovery(state).ok).toBe(false);
    expect(state.carriedBlueprints).toHaveLength(1);
    expect(state.onboarding.completedMilestoneIds).toEqual(expect.arrayContaining(['recover-supplies', 'collect-discovery']));
  });

  it('defers a full-bag discovery durably and allows delivery at the public workbench', () => {
    let state = atCart();
    state.inventory.fiber = 0; state.inventory.wood = 0;
    state.inventory.wood = (inventoryCapacity(state) - usedInventorySlots(state)) * RESOURCE_STACK_SIZE;
    expect(usedInventorySlots(state)).toBe(inventoryCapacity(state));
    expect(recoverOpeningSupplies(state).ok).toBe(true);
    expect(state.carriedBlueprints).toHaveLength(0);
    expect(state.onboarding.supplyRun).toMatchObject({ suppliesRecovered: true, blueprintClaimed: false });
    state = migrateToCurrent(envelope(state)).save.state;
    expect(claimOpeningDiscovery(state).ok).toBe(false);
    const bench = elarisPublicWorkbenchCenterPx(); state.player.x = bench.x; state.player.y = bench.y;
    expect(dropResourceStack(state, 'wood', 0).ok).toBe(true);
    expect(usedInventorySlots(state)).toBe(inventoryCapacity(state) - 1);
    expect(claimOpeningDiscovery(state).ok).toBe(true);
    expect(claimOpeningDiscovery(state).ok).toBe(false);
    expect(state.carriedBlueprints).toHaveLength(1);
  });

  it('shows enemy intent before actions, selects the original Tuftle, and records actual prevented damage', () => {
    const state = atCart();
    expect(beginOpeningGuardPractice(state).ok).toBe(true);
    expect(state.activeEncounter).toMatchObject({ wildCreatureId: openingGuardianId(state.seed), companionCreatureId: state.onboarding.companionId, selectedCompanionAbilityId: 'tuftle-guard', enemyIntent: 'advance' });
    let prevented = 0;
    for (let i = 0; i < 12; i++) {
      const control = structuredClone(state); control.activeEncounter!.selectedCompanionAbilityId = null;
      const original = resolveEncounterAction(control, 'rest');
      const result = resolveEncounterAction(state, 'rest');
      const guarded = result.companionAbility?.guardedDamage ?? 0;
      if (guarded > 0) {
        expect(result.creatureStrike!.damage + guarded).toBe(original.creatureStrike!.damage);
        prevented += guarded; break;
      }
    }
    expect(prevented).toBeGreaterThan(0);
    expect(state.onboarding.supplyRun!.guardedDamage).toBe(prevented);
    expect(migrateToCurrent(envelope(state)).save.state.activeEncounter).toEqual(state.activeEncounter);
  });

  it('retreats safely, preserves health/progress for retry, and never duplicates the guardian', () => {
    let state = atCart(); beginOpeningGuardPractice(state);
    resolveEncounterAction(state, 'rest');
    const hp = state.player.hp; const wildHp = state.activeEncounter!.creatureHp;
    expect(resolveEncounterAction(state, 'flee')).toMatchObject({ ok: true, ended: true, fled: true });
    expect(state.player.hp).toBe(hp);
    const x = state.wildCreatures.find((wild) => wild.id === openingGuardianId(state.seed))!.x;
    for (let i = 0; i < 200; i++) { state.tick++; advanceWildCreatures(state); }
    expect(state.wildCreatures.find((wild) => wild.id === openingGuardianId(state.seed))!.x).toBe(x);
    state = migrateToCurrent(envelope(state)).save.state;
    expect(beginOpeningGuardPractice(state).ok).toBe(true);
    expect(state.activeEncounter!.creatureHp).toBe(wildHp);
    expect(state.wildCreatures.filter((wild) => wild.id === openingGuardianId(state.seed))).toHaveLength(1);
    resolveEncounterAction(state, 'flee');
    expect(recoverOpeningSupplies(state).ok).toBe(true);
  });

  it('gives one optional cache reward and refuses remote or in-battle recovery', () => {
    const state = atCart(); const site = state.onboarding.supplyRun!.site!;
    expect(openOpeningSideCache(state).ok).toBe(false);
    state.player.x -= 4 * 16;
    const before = state.inventory.berry;
    expect(openOpeningSideCache(state).ok).toBe(true);
    expect(state.inventory.berry).toBe(before + 3);
    expect(openOpeningSideCache(state).ok).toBe(false);
    expect(recoverOpeningSupplies(state).ok).toBe(false);
    state.player.x = (site.tileX + .5) * 16;
    beginOpeningGuardPractice(state);
    expect(recoverOpeningSupplies(state).ok).toBe(false);
  });

  it('allows a short normal arena win without farming or respawning the guardian', () => {
    const state = atCart(); beginOpeningGuardPractice(state);
    for (let round = 0; round < 30 && state.activeEncounter; round++) {
      const action = encounterDistance(state.activeEncounter) > 10 ? 'forward' : state.player.stamina >= 10 ? 'melee' : 'rest';
      const result = resolveEncounterAction(state, action);
      expect(result.playerDefeated).not.toBe(true);
    }
    expect(state.onboarding.supplyRun!.guardianDefeated).toBe(true);
    expect(state.activeEncounter).toBeNull();
    expect(beginOpeningGuardPractice(state).ok).toBe(false);
    reconcileQuestProgress(state);
    expect(state.wildCreatures.some((wild) => wild.id === openingGuardianId(state.seed))).toBe(false);
    expect(recoverOpeningSupplies(state).ok).toBe(true);
  });

  it('reports player-built route obstructions without moving or deleting property', () => {
    const state = readySupplyRun(); const x = Math.floor(state.player.x / 16); const y = Math.floor(state.player.y / 16);
    for (const edge of ['north', 'south', 'west', 'east'] as const) state.buildings.push({ id: `route-block-${edge}`, definitionId: 'wood-wall', tileX: x, tileY: y, boundaryEdge: edge });
    const before = canonicalizeGameState(state);
    expect(supplyRunRoute(state, state.onboarding.supplyRun!.site!)).toBeNull();
    expect(canonicalizeGameState(state)).toBe(before);
  });

  it('keeps the unique discovery recoverable after defeat and prevents disposal before registration', () => {
    let state = atCart(); recoverOpeningSupplies(state); reconcileQuestProgress(state);
    const originalId = state.onboarding.supplyRun!.blueprintInstanceId!;
    expect(activeQuest(state)?.id).toBe('opening-register-discovery');
    const bench = elarisPublicWorkbenchCenterPx(); state.player.x = bench.x; state.player.y = bench.y;
    expect(scrapCarriedBlueprint(state, originalId).ok).toBe(false);
    expect(sellCarriedBlueprint(state, originalId).ok).toBe(false);
    beginPlayerDefeat(state);
    expect(state.blueprintDrops).toHaveLength(1);
    const drop = state.blueprintDrops[0]!;
    expect(supplyRunTarget(state)).toMatchObject({ tileX: Math.floor(drop.x / 16), tileY: Math.floor(drop.y / 16), label: 'Discovery paper' });
    state = migrateToCurrent(envelope(state)).save.state;
    state.tick += 100_000;
    expect(expireBlueprintDrops(state)).toBe(false);
    chooseRespawn(state, 'elaris-sanctuary'); state.player.x = drop.x; state.player.y = drop.y;
    expect(recoverBlueprintDrop(state, drop.id).ok).toBe(true);
    const newId = state.onboarding.supplyRun!.blueprintInstanceId!;
    expect(newId).not.toBe(originalId);
    expect(state.onboarding.supplyRun!.blueprintDropId).toBeNull();
    expect(dropCarriedBlueprint(state, newId).ok).toBe(true);
    expect(state.blueprintDrops[0]!.expiresAtTick).toBe(Number.MAX_SAFE_INTEGER);
    recoverBlueprintDrop(state, state.blueprintDrops[0]!.id);
    state.player.x = bench.x; state.player.y = bench.y;
    expect(registerCarriedBlueprint(state, state.onboarding.supplyRun!.blueprintInstanceId!).ok).toBe(true);
    expect(state.unlockedItemIds).toContain('garden-bed');
    expect(state.carriedBlueprints).toHaveLength(0);
    expect(supplyRunTarget(state)).toBeNull();
    reconcileQuestProgress(state);
    expect(activeQuest(state)?.id).toBe('opening-build-garden');
  });

  it('keeps an already known Garden Bed recipe and finishes without creating a duplicate paper', () => {
    const state = atCart(); state.unlockedItemIds.push('garden-bed');
    expect(recoverOpeningSupplies(state).ok).toBe(true); reconcileQuestProgress(state);
    expect(state.onboarding.status).toBe('active');
    expect(state.onboarding.completedMilestoneIds).toContain('register-discovery');
    expect(state.onboarding.supplyRun!.blueprintClaimed).toBe(true);
    expect(state.carriedBlueprints).toHaveLength(0);
    expect(supplyRunTarget(state)).toBeNull();
    expect(migrateToCurrent(envelope(state)).save.state.unlockedItemIds).toEqual(state.unlockedItemIds);
  });

  it('preserves v86 worlds, threat timing, and ownership while enabling the supply run', () => {
    const state = readySupplyRun(); state.onboarding.version = 5; state.onboarding.status = 'complete';
    const raw = envelope(state, 86); delete (raw.state.onboarding as Partial<typeof raw.state.onboarding>).supplyRun;
    const before = structuredClone(state); const timer = survivalSchedule(state);
    const loaded = migrateToCurrent(raw).save.state;
    expect(loaded.onboarding).toMatchObject({ version: OPENING_CHAPTER_VERSION, status: 'active', supplyRun: { site: null, blueprintClaimed: false } });
    expect(survivalSchedule(loaded)).toEqual(timer); expect(loaded.tick).toBe(before.tick);
    expect(loaded.ownedCreatures).toEqual(before.ownedCreatures); expect(loaded.buildings).toEqual(before.buildings); expect(loaded.inventory).toEqual(before.inventory);
    const legacy = createInitialState(42); legacy.onboarding = createOpeningChapter(42, true);
    const json = canonicalizeGameState(legacy);
    expect(reconcileOpeningSupplyRun(legacy)).toBe(false); expect(canonicalizeGameState(legacy)).toBe(json);
  });

  it('rejects inconsistent discovery state and never rerolls rewards on reload', () => {
    const state = atCart(); recoverOpeningSupplies(state); reconcileQuestProgress(state);
    const loaded = migrateToCurrent(envelope(state)).save.state;
    expect(loaded.onboarding.supplyRun).toEqual(state.onboarding.supplyRun);
    expect(recoverOpeningSupplies(loaded).ok).toBe(false);
    expect(loaded.carriedBlueprints).toEqual(state.carriedBlueprints);
    const invalid = atCart(); invalid.onboarding.supplyRun!.blueprintClaimed = true;
    expect(() => migrateToCurrent(envelope(invalid))).toThrow(SaveValidationError);
  });
});
