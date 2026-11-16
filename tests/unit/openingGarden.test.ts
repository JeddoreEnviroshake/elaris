import { describe, expect, it } from 'vitest';
import { readyGarden, readySupplyRun } from '../helpers/openingJourney';
import { CONTENT_VERSION, SAVE_SCHEMA_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { GARDEN_BED_GROW_TICKS, GARDEN_BED_YIELD_FIBER, RESOURCE_STACK_SIZE } from '../../src/config/balance';
import { createOpeningChapter, OPENING_CHAPTER_VERSION } from '../../src/content/onboarding';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { acknowledgeOpeningJourney, findOpeningGardenSite, harvestOpeningGarden, moveOpeningGardenPlan, openingGardenAvailable, openingGardenBuildRequest, openingGardenTarget, openingGardenView, openingNextGoal, reconcileOpeningGarden, registerOpeningDiscovery } from '../../src/simulation/openingGarden';
import { activeQuest, reconcileQuestProgress } from '../../src/simulation/progression';
import { checkBuildBatch, placeBuildBatch } from '../../src/simulation/batchBuilding';
import { advanceGardenBeds, harvestGardenBed } from '../../src/simulation/gardenBeds';
import { migrateToCurrent, SaveValidationError } from '../../src/persistence/migrations';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { canRegisterHere, dropCarriedBlueprint, recoverBlueprintDrop, registerCarriedBlueprint, stashBlueprintInBox, takeBlueprintFromBox } from '../../src/simulation/carriedBlueprints';
import { inventoryCapacity } from '../../src/simulation/characterProgression';
import { damageStructure, dropResourceStack, removeBuilding, undoBuildingPlacement, usedInventorySlots } from '../../src/simulation/gameplayCommands';
import { supplyRunRoute } from '../../src/simulation/openingSupplyRun';
import { paddockView } from '../../src/simulation/openingPaddock';
import { survivalSchedule } from '../../src/simulation/survivalCycle';
import { enterWorldArea } from '../../src/simulation/areas';
import { recordOpeningGardenHarvest } from '../../src/simulation/onboardingProgress';
import { elarisPublicWorkbenchCenterPx } from '../../src/simulation/elarisWorkbench';

const envelope = (state: GameState, version = SAVE_SCHEMA_VERSION) => ({ meta: { saveVersion: version, contentVersion: CONTENT_VERSION, worldGenVersion: WORLD_GEN_VERSION, appVersion: 'test', savedAt: 1 }, state });
function registered(seed = 42) { const state = readyGarden(seed); expect(registerOpeningDiscovery(state).ok).toBe(true); reconcileQuestProgress(state); return state; }
function planted(seed = 42) {
  const state = registered(seed); const plan = state.onboarding.garden!.plan!;
  state.player.x = (plan.tileX + 1.5) * 16; state.player.y = (plan.tileY + 1.5) * 16;
  expect(placeBuildBatch(state, openingGardenBuildRequest(state)).ok).toBe(true); reconcileQuestProgress(state);
  return state;
}
function grow(state: GameState, ticks: number) { for (let i = 0; i < ticks; i++) { state.tick++; advanceGardenBeds(state); } }
function finished() { const state = planted(); grow(state, GARDEN_BED_GROW_TICKS); expect(harvestOpeningGarden(state).ok).toBe(true); reconcileQuestProgress(state); return state; }

describe('return home and first garden payoff', () => {
  it('requires the real paper at a real workbench and makes ownership permanent exactly once', () => {
    const early = readySupplyRun(); expect(openingGardenAvailable(early)).toBe(false); expect(registerOpeningDiscovery(early).ok).toBe(false);
    const state = readyGarden(); const id = state.onboarding.supplyRun!.blueprintInstanceId!;
    expect(activeQuest(state)?.id).toBe('opening-register-discovery');
    const bag = { ...state.inventory }; state.player.x = 34 * 16; state.player.y = 85 * 16;
    expect(canRegisterHere(state)).toBe(false); expect(registerOpeningDiscovery(state).ok).toBe(false);
    expect(state.carriedBlueprints.some((paper) => paper.instanceId === id)).toBe(true);
    ({ x: state.player.x, y: state.player.y } = elarisPublicWorkbenchCenterPx());
    expect(registerOpeningDiscovery(state).ok).toBe(true); reconcileQuestProgress(state);
    expect(state.unlockedItemIds).toContain('garden-bed'); expect(state.carriedBlueprints).toHaveLength(0);
    expect(state.inventory).toEqual(bag); expect(registerOpeningDiscovery(state).ok).toBe(false);
    expect(activeQuest(state)?.id).toBe('opening-build-garden');
    expect(migrateToCurrent(envelope(state)).save.state.unlockedItemIds).toEqual(state.unlockedItemIds);
  });

  it('offers a reachable, affordable bed in the reserved paddock half across starter seeds', () => {
    for (const seed of [0, 1, 7, 42, 99, 12345, 0xffffffff]) {
      const state = registered(seed); const plan = state.onboarding.garden!.plan!;
      expect(plan, `missing plan for ${seed}`).not.toBeNull();
      const before = canonicalizeGameState(state); expect(findOpeningGardenSite(state)).toEqual(plan); expect(canonicalizeGameState(state)).toBe(before);
      expect(plan.tileX).toBe(state.onboarding.production!.plan!.tileX + 2); expect(plan.tileY).toBe(state.onboarding.production!.plan!.tileY);
      expect(supplyRunRoute(state, openingGardenTarget(state)!), `unreachable garden for ${seed}`).not.toBeNull();
      state.player.x = (plan.tileX + 1.5) * 16; state.player.y = (plan.tileY + 1.5) * 16;
      const bag = { ...state.inventory }; const roster = structuredClone(state.ownedCreatures);
      expect(placeBuildBatch(state, openingGardenBuildRequest(state)).ok).toBe(true); reconcileQuestProgress(state);
      expect(state.inventory.wood).toBe(bag.wood - 4); expect(state.inventory.fiber).toBe(bag.fiber - 2);
      expect(paddockView(state).ready).toBe(true); expect(paddockView(state).creature!.role).toBe('follow'); expect(state.ownedCreatures).toEqual(roster);
      expect(openingGardenBuildRequest(state)).toEqual([]); expect(state.buildings.filter((bed) => bed.definitionId === 'garden-bed')).toHaveLength(1);
    }
  });

  it('uses normal preview validation, costs, reach, and collision without moving property', () => {
    const state = registered(); const buildings = structuredClone(state.buildings); const resources = structuredClone(state.resourceNodes);
    expect(checkBuildBatch(state, openingGardenBuildRequest(state)).message).toMatch(/range/);
    const plan = { ...state.onboarding.garden!.plan! };
    expect(moveOpeningGardenPlan(state, 0, 1).ok).toBe(true); expect(state.onboarding.garden!.plan!.tileY).toBe(plan.tileY + 1);
    expect(state.buildings).toEqual(buildings); expect(state.resourceNodes).toEqual(resources);
    state.onboarding.garden!.plan = { areaKey: '0,0', tileX: buildings.find((building) => building.definitionId === 'small-pen')!.tileX, tileY: plan.tileY };
    state.player.x = (plan.tileX + 1.5) * 16; state.player.y = (plan.tileY + 1.5) * 16;
    const bag = { ...state.inventory }; expect(placeBuildBatch(state, openingGardenBuildRequest(state)).ok).toBe(false);
    expect(state.inventory).toEqual(bag); expect(state.buildings).toEqual(buildings);
    state.onboarding.garden!.plan = plan; state.inventory.wood = 3;
    expect(placeBuildBatch(state, openingGardenBuildRequest(state)).ok).toBe(false); expect(state.inventory.wood).toBe(3);
  });

  it('credits normal registration and a custom garden without granting recipes or building duplicates', () => {
    const state = readyGarden(); expect(registerCarriedBlueprint(state, state.carriedBlueprints[0]!.instanceId).ok).toBe(true); reconcileQuestProgress(state);
    const plan = state.onboarding.garden!.plan!; state.player.x = (plan.tileX + .5) * 16; state.player.y = (plan.tileY + 3) * 16;
    expect(placeBuildBatch(state, [{ definitionId: 'garden-bed', tileX: plan.tileX, tileY: plan.tileY + 2 }]).ok).toBe(true); reconcileQuestProgress(state);
    expect(state.onboarding.completedMilestoneIds).toContain('build-garden'); expect(openingGardenView(state).bed!.tileY).toBe(plan.tileY + 2);
    expect(openingGardenBuildRequest(state)).toEqual([]); expect(activeQuest(state)?.id).toBe('opening-harvest-garden');
  });

  it('preserves partial growth and output through reload and completes only after a real harvest', () => {
    let state = planted(); const bedId = state.onboarding.garden!.bedId!;
    expect(state.onboarding.status).toBe('active'); expect(harvestOpeningGarden(state).ok).toBe(false);
    grow(state, GARDEN_BED_GROW_TICKS / 2); const progress = openingGardenView(state).bed!.garden!.progressTicks;
    expect(progress).toBeGreaterThan(0); state = migrateToCurrent(envelope(state)).save.state;
    const before = canonicalizeGameState(state); advanceGardenBeds(state); expect(canonicalizeGameState(state)).toBe(before);
    expect(openingGardenView(state).bed!.garden!.progressTicks).toBe(progress);
    grow(state, GARDEN_BED_GROW_TICKS / 2); expect(openingGardenView(state).readyFiber).toBe(5); expect(state.onboarding.garden!.harvestedFiber).toBe(0);
    state = migrateToCurrent(envelope(state)).save.state;
    const fiber = state.inventory.fiber; expect(harvestGardenBed(state, bedId).ok).toBe(true); reconcileQuestProgress(state);
    expect(state.inventory.fiber).toBe(fiber + 5); expect(state.onboarding.status).toBe('complete'); expect(state.onboarding.garden!.harvestedFiber).toBe(5);
    expect(activeQuest(state)?.id).toBe('opening-journey-recap'); expect(harvestOpeningGarden(state).ok).toBe(false);
    const completed = canonicalizeGameState(state); expect(reconcileOpeningGarden(state)).toBe(false); expect(canonicalizeGameState(state)).toBe(completed);
    expect(migrateToCurrent(envelope(state)).save.state.onboarding).toEqual(state.onboarding);
  });

  it('leaves a full-bag harvest in the bed through saves and refuses remote collection', () => {
    let state = planted(); grow(state, GARDEN_BED_GROW_TICKS);
    state.inventory.fiber = 0; state.inventory.wood = 0; state.inventory.wood = (inventoryCapacity(state) - usedInventorySlots(state)) * RESOURCE_STACK_SIZE;
    expect(usedInventorySlots(state)).toBe(inventoryCapacity(state)); expect(harvestOpeningGarden(state)).toMatchObject({ ok: false, message: 'Inventory full' });
    expect(openingGardenView(state).readyFiber).toBe(5); expect(state.onboarding.garden!.harvestedFiber).toBe(0);
    state = migrateToCurrent(envelope(state)).save.state; const position = { ...state.player };
    state.player.x = 20 * 16; expect(harvestOpeningGarden(state).ok).toBe(false); expect(openingGardenView(state).readyFiber).toBe(5);
    Object.assign(state.player, position); expect(dropResourceStack(state, 'wood', 0).ok).toBe(true); expect(harvestOpeningGarden(state).ok).toBe(true);
    reconcileQuestProgress(state); expect(state.onboarding.status).toBe('complete');
  });

  it('recovers the dropped or stored paper through ordinary inventory actions before registration', () => {
    const state = readyGarden(); let paperId = state.onboarding.supplyRun!.blueprintInstanceId!;
    expect(dropCarriedBlueprint(state, paperId).ok).toBe(true); expect(registerOpeningDiscovery(state).ok).toBe(false); expect(openingGardenTarget(state)!.label).toBe('Discovery paper');
    expect(recoverBlueprintDrop(state, state.onboarding.supplyRun!.blueprintDropId!).ok).toBe(true); paperId = state.onboarding.supplyRun!.blueprintInstanceId!;
    const box = state.buildings.find((building) => building.definitionId === 'field-cache')!;
    expect(stashBlueprintInBox(state, paperId, box.id).ok).toBe(true); expect(openingGardenView(state).stored!.id).toBe(box.id);
    expect(openingGardenTarget(state)!.label).toBe('Stored discovery'); expect(registerOpeningDiscovery(state).ok).toBe(false);
    expect(takeBlueprintFromBox(state, paperId, box.id).ok).toBe(true); expect(registerOpeningDiscovery(state).ok).toBe(true);
  });

  it('allows a destroyed bed to be rebuilt without erasing permanent discovery or completed lessons', () => {
    const state = planted(); grow(state, 1200); const oldId = state.onboarding.garden!.bedId!;
    state.buildings = state.buildings.filter((building) => building.id !== oldId); reconcileQuestProgress(state);
    expect(state.onboarding.completedMilestoneIds).toContain('build-garden'); expect(state.unlockedItemIds).toContain('garden-bed');
    expect(placeBuildBatch(state, openingGardenBuildRequest(state)).ok).toBe(true); reconcileQuestProgress(state);
    expect(state.onboarding.garden!.bedId).not.toBe(oldId); expect(openingGardenView(state).bed!.garden!.progressTicks).toBe(0);
    grow(state, GARDEN_BED_GROW_TICKS); expect(harvestOpeningGarden(state).ok).toBe(true); reconcileQuestProgress(state); expect(state.onboarding.status).toBe('complete');
  });

  it('spills a stored discovery from a destroyed box so registration cannot be lost with the box', () => {
    const state = readyGarden(); const paperId = state.onboarding.supplyRun!.blueprintInstanceId!;
    const box = state.buildings.find((building) => building.definitionId === 'field-cache')!;
    expect(stashBlueprintInBox(state, paperId, box.id).ok).toBe(true);
    state.player.x = (box.tileX + .5) * 16; state.player.y = (box.tileY + .5) * 16;
    expect(removeBuilding(state, box.id)).toMatchObject({ ok: false, message: expect.stringContaining('Empty the Storage Box') });
    expect(undoBuildingPlacement(state, box.id).ok).toBe(false);
    expect(damageStructure(state, box.id, 100000).destroyed).toBe(true);
    const drop = state.blueprintDrops.find((candidate) => candidate.id === state.onboarding.supplyRun!.blueprintDropId)!;
    expect(drop.blueprintId).toBe('garden-bed'); expect(drop.expiresAtTick).toBe(Number.MAX_SAFE_INTEGER);
    expect(openingGardenTarget(state)!.label).toBe('Discovery paper');
    state.player.x = drop.x; state.player.y = drop.y; expect(recoverBlueprintDrop(state, drop.id).ok).toBe(true);
    ({ x: state.player.x, y: state.player.y } = elarisPublicWorkbenchCenterPx()); expect(registerOpeningDiscovery(state).ok).toBe(true);
    reconcileQuestProgress(state); expect(state.onboarding.completedMilestoneIds).toContain('register-discovery');
  });

  it('does not infer a harvest from an old global counter or a forged source', () => {
    const state = planted(); state.questProgress.gardenFiberHarvested = 500;
    recordOpeningGardenHarvest(state, 'missing', 5); reconcileQuestProgress(state);
    expect(state.onboarding.status).toBe('active'); expect(state.onboarding.garden!.harvestedFiber).toBe(0);
  });

  it('saves an optional next direction, permits changes, and releases guidance when fulfilled', () => {
    const early = planted(); expect(acknowledgeOpeningJourney(early, 'explore').ok).toBe(false);
    let state = finished(); const bag = { ...state.inventory }; const coins = state.coins;
    expect(acknowledgeOpeningJourney(state, 'explore').ok).toBe(true); expect(activeQuest(state)?.id).toBe('opening-next-explore');
    state = migrateToCurrent(envelope(state)).save.state; expect(state.onboarding.garden!.nextGoal).toBe('explore'); expect(state.onboarding.garden!.recapAcknowledged).toBe(true);
    expect(enterWorldArea(state, 1, 0)).toBe(true); expect(openingNextGoal(state)!.complete).toBe(true); expect(activeQuest(state)?.id).not.toBe('opening-next-explore');
    expect(acknowledgeOpeningJourney(state, 'befriend').ok).toBe(true); expect(activeQuest(state)?.id).toBe('opening-next-befriend');
    expect(acknowledgeOpeningJourney(state, null).ok).toBe(true); expect(openingNextGoal(state)).toBeNull(); expect(activeQuest(state)?.id).not.toBe('opening-journey-recap');
    expect(state.inventory).toEqual(bag); expect(state.coins).toBe(coins);
  });

  it('upgrades a completed v87 supply run without changing its world, timing, inventory, or learned garden', () => {
    const state = planted(); grow(state, 1200); const before = structuredClone(state); const timer = survivalSchedule(state);
    state.onboarding.completedMilestoneIds = state.onboarding.completedMilestoneIds.filter((id) => !['register-discovery', 'build-garden', 'harvest-garden'].includes(id));
    state.onboarding.version = 6; state.onboarding.status = 'complete'; const raw = envelope(state, 87);
    delete (raw.state.onboarding as Partial<typeof state.onboarding>).garden;
    const loaded = migrateToCurrent(raw).save.state;
    expect(loaded.onboarding).toMatchObject({ version: OPENING_CHAPTER_VERSION, status: 'active', garden: { bedId: null, harvestedFiber: 0, recapAcknowledged: false } });
    expect(loaded.tick).toBe(before.tick); expect(survivalSchedule(loaded)).toEqual(timer); expect(loaded.buildings).toEqual(before.buildings); expect(loaded.inventory).toEqual(before.inventory);
    expect(loaded.ownedCreatures).toEqual(before.ownedCreatures); expect(loaded.unlockedItemIds).toEqual(before.unlockedItemIds); expect(loaded.onboarding.supplyRun).toEqual(before.onboarding.supplyRun);
    reconcileQuestProgress(loaded); expect(loaded.onboarding.garden!.bedId).toBe(before.onboarding.garden!.bedId); expect(loaded.onboarding.completedMilestoneIds).toContain('build-garden');
    expect(loaded.onboarding.status).toBe('active'); expect(openingGardenBuildRequest(loaded)).toEqual([]);
  });

  it('leaves legacy worlds inactive and rejects inconsistent or premature completion data', () => {
    const legacy = createInitialState(42); legacy.onboarding = createOpeningChapter(42, true); const raw = envelope(legacy, 87);
    delete (raw.state.onboarding as Partial<typeof legacy.onboarding>).garden;
    const loaded = migrateToCurrent(raw).save.state; expect(loaded.onboarding.garden).toBeNull(); const before = canonicalizeGameState(loaded);
    expect(reconcileOpeningGarden(loaded)).toBe(false); expect(canonicalizeGameState(loaded)).toBe(before);
    const premature = registered(); premature.onboarding.garden!.recapAcknowledged = true;
    expect(() => migrateToCurrent(envelope(premature))).toThrow(SaveValidationError);
    const excessive = finished(); excessive.onboarding.garden!.harvestedFiber = GARDEN_BED_YIELD_FIBER + 1;
    expect(() => migrateToCurrent(envelope(excessive))).toThrow(SaveValidationError);
    const fake = registered(); fake.onboarding.completedMilestoneIds.push('harvest-garden');
    expect(() => migrateToCurrent(envelope(fake))).toThrow(SaveValidationError);
  });
});
