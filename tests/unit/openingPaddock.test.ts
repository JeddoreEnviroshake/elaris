import { OPENING_CHAPTER_VERSION } from '../../src/content/onboarding';
import { describe, expect, it } from 'vitest';
import { createOpeningChapter } from '../../src/content/onboarding';
import { CONTENT_VERSION, SAVE_SCHEMA_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { beginOpeningTrust, actOpeningTrust } from '../../src/simulation/onboarding';
import { completeOpeningMilestone, recordOpeningGatherAssistance } from '../../src/simulation/onboardingProgress';
import { reconcileOpeningShelter, shelterLayout } from '../../src/simulation/openingShelter';
import { advanceOpeningFog } from '../../src/simulation/openingFog';
import { reconcileQuestProgress } from '../../src/simulation/progression';
import { placeBuildBatch } from '../../src/simulation/batchBuilding';
import { claimPaddockSupplies, collectOpeningOutput, findPaddockSite, followOpeningCompanion, movePaddockPlan, paddockLayout, paddockMaterialBudget, paddockView, reconcileOpeningPaddock, startOpeningWork } from '../../src/simulation/openingPaddock';
import { advanceWorkerProduction, collectHousingBin, housingCapacityForBuilding, settleWorkerProduction } from '../../src/simulation/workerHousing';
import { setCreatureRole } from '../../src/simulation/gameplayCommands';
import { activeFollowerGatherAssistance } from '../../src/simulation/creatureRoles';
import { migrateToCurrent, SaveValidationError } from '../../src/persistence/migrations';
import { starterBiomeAt } from '../../src/simulation/biomes';
import { isBuildingBoundaryCrossingBlocked } from '../../src/simulation/buildingCollision';
import { enclosedEnvironment } from './helpers/buildings';
import { RESOURCE_STACK_SIZE } from '../../src/config/balance';
import { inventoryCapacity } from '../../src/simulation/characterProgression';
import { learnBlueprint } from '../../src/simulation/blueprintKnowledge';

function envelope(state: GameState, version = SAVE_SCHEMA_VERSION) {
  return { meta: { saveVersion: version, contentVersion: CONTENT_VERSION, worldGenVersion: WORLD_GEN_VERSION, appVersion: 'test', savedAt: 1 }, state };
}
function afterFog(seed = 42) {
  const state = createInitialState(seed);
  state.player.x = 82 * 16; state.player.y = 82 * 16;
  beginOpeningTrust(state); for (let i = 0; i < 4; i++) actOpeningTrust(state, 'steady');
  recordOpeningGatherAssistance(state, state.onboarding.companionId!, 1); reconcileOpeningShelter(state);
  const site = state.onboarding.shelterPlan!;
  state.player.x = (site.tileX + 1.5) * 16; state.player.y = (site.tileY + 3) * 16;
  state.inventory.fiber = 200; state.inventory.wood = 200; state.inventory.stone = 100;
  for (const stage of shelterLayout(site)) expect(placeBuildBatch(state, stage).ok).toBe(true);
  state.player.y = (site.tileY + 1.5) * 16; reconcileQuestProgress(state);
  state.tick = state.onboarding.firstThreat!.fogStartsAtTick!;
  for (let i = 0; i < 60; i++) { advanceOpeningFog(state); state.tick++; }
  state.tick = state.onboarding.firstThreat!.fogEndsAtTick!; reconcileQuestProgress(state);
  return state;
}
function built() {
  const state = afterFog(); const plan = state.onboarding.production!.plan!;
  state.player.x = (plan.tileX + 2.5) * 16; state.player.y = (plan.tileY + 3) * 16;
  for (const stage of paddockLayout(plan)) expect(placeBuildBatch(state, stage).ok).toBe(true);
  reconcileQuestProgress(state);
  return state;
}
function seconds(state: GameState, amount: number) {
  for (let i = 0; i < amount; i++) { state.tick += 60; advanceWorkerProduction(state); }
}

describe('guided paddock and first autonomous production', () => {
  it('grants required recipes once after fog and builds an actual usable eight-tile yard across starter seeds', () => {
    expect(paddockMaterialBudget()).toEqual({ fiber: 19, wood: 10 });
    for (const seed of [0, 1, 7, 42, 99, 12345, 0xffffffff]) {
      const state = afterFog(seed); const plan = state.onboarding.production!.plan;
      expect(plan, `no paddock for ${seed}`).not.toBeNull();
      expect(state.unlockedItemIds).toEqual(expect.arrayContaining(['thatch-ground', 'thatch-fence', 'thatch-gate', 'small-pen']));
      expect(state.onboarding.issuedRewardIds.filter((id) => id === 'paddock-recipes')).toHaveLength(1);
      state.player.x = (plan!.tileX + 2.5) * 16; state.player.y = (plan!.tileY + 3) * 16;
      for (const stage of paddockLayout(plan!)) expect(placeBuildBatch(state, stage).ok, `${seed}: ${JSON.stringify(stage)}`).toBe(true);
      const pen = state.buildings.find((building) => building.definitionId === 'small-pen')!;
      expect(housingCapacityForBuilding(state, pen)).toMatchObject({ area: 8, capacity: 1, available: 1 });
      // Both gate lanes remain clear; the right half has future Garden Bed soil.
      for (const dx of [2, 3]) {
        expect(isBuildingBoundaryCrossingBlocked(state.buildings, (plan!.tileX + dx + .5) * 16, (plan!.tileY + 2.5) * 16, 0, -1)).toBe(false);
        expect(starterBiomeAt(state.currentArea.seed, (plan!.tileX + dx + .5) * 16, (plan!.tileY + .5) * 16)).toBe('grassland');
      }
      learnBlueprint(state, 'garden-bed'); // Only a layout check; the lesson does not grant this later reward.
      expect(placeBuildBatch(state, [{ definitionId: 'garden-bed', tileX: plan!.tileX + 2, tileY: plan!.tileY }]).ok).toBe(true);
    }
  });

  it('uses the same Tuftle and normal fifteen-second production, then collects exactly once', () => {
    const state = built(); const id = state.onboarding.companionId;
    expect(startOpeningWork(state).ok).toBe(true);
    const view = paddockView(state); const housingId = view.creature!.housingId;
    expect(view.creature).toMatchObject({ id, role: 'work', worksiteId: housingId });
    seconds(state, 14); expect(view.housing!.housing!.bin.fiber).toBe(0);
    expect(startOpeningWork(state).ok).toBe(false); // pressing again cannot reset the timer
    seconds(state, 1); expect(view.housing!.housing!.bin.fiber).toBe(2);
    const before = state.inventory.fiber;
    expect(collectOpeningOutput(state).ok).toBe(true); reconcileQuestProgress(state);
    expect(state.inventory.fiber).toBe(before + 2);
    expect(collectOpeningOutput(state).ok).toBe(false);
    expect(state.onboarding.completedMilestoneIds).toContain('collect-production');
    expect(followOpeningCompanion(state).ok).toBe(true); reconcileQuestProgress(state);
    expect(state.onboarding.status).toBe('active');
    expect(state.onboarding.completedMilestoneIds).toContain('return-to-follow');
    expect(view.creature).toMatchObject({ id, role: 'follow', housingId });
    const produced = state.workerResourcesProduced;
    seconds(state, 30); expect(state.workerResourcesProduced).toBe(produced);
    expect(activeFollowerGatherAssistance(state, { id: 'test', kind: 'plant', x: state.player.x, y: state.player.y, hp: 1, maxHp: 1, respawnAtTick: null }, 'fiber')?.creatureId).toBe(id);
  });

  it('accepts custom housing and credits early production without recreating a Tuftle', () => {
    const state = afterFog(); const plan = state.onboarding.production!.plan!;
    const custom = enclosedEnvironment(plan.tileX, plan.tileY, 2, 4, 'workYard');
    state.buildings = state.buildings.filter((building) => building.definitionId !== 'small-pen');
    state.buildings.push(...custom, { id: 'custom-pen', definitionId: 'small-pen', tileX: plan.tileX, tileY: plan.tileY, housing: { bin: { fiber: 0, berry: 0 } } });
    reconcileQuestProgress(state);
    expect(state.onboarding.completedMilestoneIds).toContain('build-paddock');
    expect(startOpeningWork(state).ok).toBe(true);
    settleWorkerProduction(state, 15_000);
    expect(collectHousingBin(state, 'custom-pen', 'fiber').ok).toBe(true);
    expect(setCreatureRole(state, state.onboarding.companionId!, 'follow').ok).toBe(true);
    reconcileQuestProgress(state);
    expect(state.onboarding.status).toBe('active');
    expect(state.onboarding.completedMilestoneIds).toContain('return-to-follow');
    expect(state.ownedCreatures).toHaveLength(1);
  });

  it('reports a full bin, preserves stored output, and resumes without a hidden backlog', () => {
    const state = built(); startOpeningWork(state); seconds(state, 90);
    expect(paddockView(state)).toMatchObject({ working: true, full: true, bin: 12 });
    expect(paddockView(state).status).toContain('Storage full');
    const before = state.workerResourcesProduced;
    seconds(state, 100); expect(state.workerResourcesProduced).toBe(before);
    const inventory = state.inventory.fiber;
    collectOpeningOutput(state); expect(state.inventory.fiber).toBe(inventory + 12);
    seconds(state, 14); expect(paddockView(state).bin).toBe(0);
    seconds(state, 1); expect(paddockView(state).bin).toBe(2);
  });

  it('pauses on broken enclosure, explains the exact repair, and preserves housing and output', () => {
    const state = built(); startOpeningWork(state); seconds(state, 15);
    const view = paddockView(state); const reservation = view.creature!.housingId;
    const fence = state.buildings.find((building) => building.definitionId === 'thatch-fence' && building.boundaryEdge === 'north')!;
    state.buildings = state.buildings.filter((building) => building.id !== fence.id);
    seconds(state, 1);
    expect(paddockView(state).status).toContain(`Close the north edge at X ${fence.tileX}, Y ${fence.tileY}`);
    expect(view.creature).toMatchObject({ role: 'rest', housingId: reservation });
    expect(view.housing!.housing!.bin.fiber).toBe(2);
    state.buildings.push(fence);
    expect(startOpeningWork(state).ok).toBe(true);
  });

  it('persists a partial production cycle, moved footprint, and one-time supply bundle', () => {
    let state = built();
    expect(movePaddockPlan(state, 1, 0).ok).toBe(true);
    const plan = state.onboarding.production!.plan;
    expect(claimPaddockSupplies(state).ok).toBe(true);
    expect(claimPaddockSupplies(state).ok).toBe(false);
    startOpeningWork(state); seconds(state, 7);
    const companion = structuredClone(paddockView(state).creature);
    state = migrateToCurrent(envelope(state)).save.state;
    expect(paddockView(state).creature).toEqual(companion);
    expect(state.onboarding.production!.plan).toEqual(plan);
    expect(claimPaddockSupplies(state).ok).toBe(false);
    seconds(state, 8); expect(paddockView(state).bin).toBe(2);
  });

  it('refuses remote/full-bag collection without losing output, and delivers supply overflow on the ground', () => {
    const state = built(); startOpeningWork(state); seconds(state, 15);
    const x = state.player.x; state.player.x = 0;
    expect(collectOpeningOutput(state).ok).toBe(false); state.player.x = x;
    state.inventory.fiber = 0; state.inventory.wood = inventoryCapacity(state) * RESOURCE_STACK_SIZE; state.inventory.stone = 0;
    expect(collectOpeningOutput(state).ok).toBe(false);
    expect(paddockView(state).bin).toBe(2);
    expect(claimPaddockSupplies(state).ok).toBe(true);
    expect(state.groundDrops.some((drop) => drop.resource === 'fiber' && drop.amount === 12)).toBe(true);
    state.inventory.wood = 0;
    expect(collectOpeningOutput(state).ok).toBe(true);
  });

  it('does not count old fiber or another Tuftle’s production as the opening partner’s first delivery', () => {
    const state = built(); const pen = paddockView(state).housing!;
    pen.housing!.bin.fiber = 2;
    collectHousingBin(state, pen.id, 'fiber'); reconcileQuestProgress(state);
    expect(state.onboarding.production!.collectedFiber).toBe(0);
    expect(state.onboarding.completedMilestoneIds).not.toContain('collect-production');
    const original = paddockView(state).creature!;
    const other = { ...structuredClone(original), id: 'other', role: 'work' as const, housingId: pen.id, worksiteId: pen.id };
    state.ownedCreatures.push(other);
    settleWorkerProduction(state, 15_000);
    expect(pen.housing!.bin.fiber).toBe(2);
    collectHousingBin(state, pen.id, 'fiber');
    expect(state.onboarding.production!.producedFiber).toBe(0);
  });

  it('credits work completed before the guidance becomes relevant', () => {
    const state = built();
    state.onboarding.completedMilestoneIds = state.onboarding.completedMilestoneIds.filter((id) => id !== 'weather-fog' && id !== 'build-paddock');
    state.onboarding.issuedRewardIds = state.onboarding.issuedRewardIds.filter((id) => !id.startsWith('paddock-'));
    state.onboarding.production!.plan = null;
    expect(setCreatureRole(state, state.onboarding.companionId!, 'work').ok).toBe(true);
    seconds(state, 15); collectHousingBin(state, paddockView(state).housing!.id, 'fiber');
    expect(state.onboarding.production!.collectedFiber).toBe(2);
    expect(state.onboarding.completedMilestoneIds).not.toContain('collect-production');
    completeOpeningMilestone(state, 'weather-fog'); reconcileOpeningPaddock(state);
    expect(state.onboarding.completedMilestoneIds).toEqual(expect.arrayContaining(['build-paddock', 'collect-production']));
  });

  it('explains housing reserved by another creature without changing the opening Tuftle’s role', () => {
    const state = built(); const view = paddockView(state); const original = view.creature!;
    state.ownedCreatures.push({ ...structuredClone(original), id: 'other-resident', housingId: view.housing!.id });
    expect(paddockView(state).status).toContain('Housing full');
    expect(paddockView(state).canReserve).toBe(false);
    expect(startOpeningWork(state).ok).toBe(false);
    expect(original.role).toBe('follow'); expect(original.housingId).toBeNull();
  });

  it('upgrades v85 completion without replaying fog or altering the world and validates new progress', () => {
    const state = built(); startOpeningWork(state); seconds(state, 15);
    state.onboarding.completedMilestoneIds = state.onboarding.completedMilestoneIds.filter((id) => id !== 'build-paddock');
    state.onboarding.version = 4; state.onboarding.status = 'complete';
    state.onboarding.issuedRewardIds = state.onboarding.issuedRewardIds.filter((id) => !id.startsWith('paddock-'));
    const raw = envelope(state, 85); delete (raw.state.onboarding as Partial<typeof raw.state.onboarding>).production;
    const before = structuredClone(state);
    const loaded = migrateToCurrent(raw).save.state;
    expect(loaded.onboarding).toMatchObject({ version: OPENING_CHAPTER_VERSION, status: 'active', production: { producedFiber: 0, collectedFiber: 0, plan: null } });
    expect(loaded.tick).toBe(before.tick); expect(loaded.onboarding.firstThreat).toEqual(before.onboarding.firstThreat);
    expect(loaded.ownedCreatures).toEqual(before.ownedCreatures); expect(loaded.buildings).toEqual(before.buildings); expect(loaded.inventory).toEqual(before.inventory);
    expect(loaded.buildings.find((building) => building.definitionId === 'small-pen')!.housing!.bin.fiber).toBe(2);
    const invalid = structuredClone(loaded); invalid.onboarding.production!.collectedFiber = 2;
    expect(() => migrateToCurrent(envelope(invalid))).toThrow(SaveValidationError);
    const legacy = createInitialState(42); legacy.onboarding = createOpeningChapter(42, true);
    expect(reconcileOpeningPaddock(legacy)).toBe(false); expect(findPaddockSite(legacy)).not.toBeNull();
    expect(legacy.onboarding.production).toBeNull();
  });
});
