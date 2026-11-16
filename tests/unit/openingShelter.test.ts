import { OPENING_CHAPTER_VERSION } from '../../src/content/onboarding';
import { befriendOpeningTuftle } from '../helpers/openingJourney';
import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { recordOpeningGatherAssistance } from '../../src/simulation/onboardingProgress';
import { shelterLayout, shelterChecklist, shelterMaterialBudget, reconcileOpeningShelter, claimShelterSupplies, moveShelterPlan, findShelterSite } from '../../src/simulation/openingShelter';
import { batchCost, checkBuildBatch, placeBuildBatch, shapedBuildRequests, undoBuildGroup } from '../../src/simulation/batchBuilding';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { migrateToCurrent } from '../../src/persistence/migrations';
import { SAVE_SCHEMA_VERSION, CONTENT_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { RESOURCE_STACK_SIZE } from '../../src/config/balance';
import { inventoryCapacity } from '../../src/simulation/characterProgression';
import { enclosedEnvironment } from './helpers/buildings';

function readyToBuild(seed = 42) {
  const state = createInitialState(seed);
  state.player.x = 82 * 16; state.player.y = 82 * 16;
  befriendOpeningTuftle(state);
  recordOpeningGatherAssistance(state, state.onboarding.companionId!, 1);
  reconcileOpeningShelter(state);
  return state;
}
function stocked() {
  const state = readyToBuild();
  const site = state.onboarding.shelterPlan!;
  state.player.x = (site.tileX + 1.5) * 16; state.player.y = (site.tileY + 3) * 16;
  state.inventory.fiber = 100; state.inventory.wood = 100; state.inventory.stone = 100;
  return state;
}
function envelope(state: GameState, version = SAVE_SCHEMA_VERSION) {
  return { meta: { saveVersion: version, contentVersion: CONTENT_VERSION, worldGenVersion: WORLD_GEN_VERSION, appVersion: 'test', savedAt: 1 }, state };
}

describe('guided shelter and grouped building', () => {
  it('budgets the complete suggested room and finds clear ground across seeds', () => {
    expect(shelterMaterialBudget()).toEqual({ fiber: 33, wood: 8, stone: 2 });
    for (const seed of [0, 1, 7, 42, 99, 12345, 0xffffffff]) {
      const state = readyToBuild(seed);
      const site = state.onboarding.shelterPlan;
      expect(site, `missing shelter site for ${seed}`).not.toBeNull();
      state.player.x = (site!.tileX + 1.5) * 16; state.player.y = (site!.tileY + 3) * 16;
      state.inventory.fiber = 100; state.inventory.wood = 100; state.inventory.stone = 100;
      for (const requests of shelterLayout(site!)) expect(placeBuildBatch(state, requests), `${seed}: ${JSON.stringify(requests)}`).toMatchObject({ ok: true });
      expect(shelterChecklist(state)).toMatchObject({ area: 8, ready: true, breathable: true, entrance: true });
    }
  });

  it('previews atomically and refuses an entire unaffordable or obstructed group', () => {
    const state = stocked(); const requests = shelterLayout(state.onboarding.shelterPlan!)[0]!;
    const before = canonicalizeGameState(state);
    expect(checkBuildBatch(state, requests).ok).toBe(true);
    expect(canonicalizeGameState(state)).toBe(before);
    state.inventory.fiber = 7;
    const poor = canonicalizeGameState(state);
    expect(placeBuildBatch(state, requests)).toMatchObject({ ok: false });
    expect(canonicalizeGameState(state)).toBe(poor);
    state.inventory.fiber = 100;
    const occupied = [...requests, requests[0]!];
    const blocked = canonicalizeGameState(state);
    expect(placeBuildBatch(state, occupied).ok).toBe(false);
    expect(canonicalizeGameState(state)).toBe(blocked);
  });

  it('supports rectangular floor areas and correctly oriented wall lines with bounded sizes', () => {
    const start = { tileX: 10, tileY: 10 }; const end = { tileX: 13, tileY: 11 };
    const floors = shapedBuildRequests('thatch-floor', 'area', end, start);
    expect(floors).toHaveLength(8);
    expect(batchCost(floors)).toEqual({ fiber: 8 });
    expect(shapedBuildRequests('thatch-wall', 'line', start, end, 'north')).toHaveLength(4);
    expect(shapedBuildRequests('thatch-wall', 'line', start, end, 'west')).toHaveLength(2);
    expect(shapedBuildRequests('thatch-floor', 'area', start, { tileX: 100, tileY: 100 })).toEqual([]);
    expect(shapedBuildRequests('air-purifier', 'area', start, end)).toEqual([]);
  });

  it('refunds a group only once, including overflow refunds on the ground', () => {
    const state = stocked(); const floors = shelterLayout(state.onboarding.shelterPlan!)[0]!;
    const result = placeBuildBatch(state, floors);
    const ids = result.buildings!.map((building) => building.id);
    expect(state.inventory.fiber).toBe(92);
    expect(undoBuildGroup(state, [...ids, ids[0]!]).ok).toBe(true);
    expect(state.inventory.fiber).toBe(100);
    expect(undoBuildGroup(state, ids).ok).toBe(false);
    const again = placeBuildBatch(state, floors);
    state.inventory.fiber = 0;
    state.inventory.wood = inventoryCapacity(state) * RESOURCE_STACK_SIZE;
    expect(undoBuildGroup(state, again.buildings!.map((building) => building.id)).ok).toBe(true);
    expect(state.groundDrops.filter((drop) => drop.resource === 'fiber').reduce((sum, drop) => sum + drop.amount, 0)).toBe(8);
  });

  it('identifies the exact missing edge and stops declaring the whole room protected', () => {
    const state = stocked();
    for (const stage of shelterLayout(state.onboarding.shelterPlan!)) placeBuildBatch(state, stage);
    expect(shelterChecklist(state).ready).toBe(true);
    const wall = state.buildings.find((building) => building.definitionId === 'thatch-wall' && building.boundaryEdge === 'north')!;
    state.buildings = state.buildings.filter((building) => building.id !== wall.id);
    const check = shelterChecklist(state);
    expect(check).toMatchObject({ ready: false, enclosed: false, breathable: false });
    expect(check.gaps).toContainEqual(expect.objectContaining({ tileX: wall.tileX, tileY: wall.tileY, edge: 'north' }));
  });

  it('requires a clear door and facilities in the same room', () => {
    const state = stocked(); const site = state.onboarding.shelterPlan!;
    for (const stage of shelterLayout(site)) placeBuildBatch(state, stage);
    const cache = state.buildings.find((building) => building.definitionId === 'field-cache')!;
    cache.tileX = site.tileX + 1; cache.tileY = site.tileY + 1;
    expect(shelterChecklist(state).entrance).toBe(false);
    cache.tileX = site.tileX + 8;
    expect(shelterChecklist(state).storage).toBe(false);
  });

  it('accepts custom rooms and saves the home without replaying completed steps', () => {
    const state = stocked(); const site = state.onboarding.shelterPlan!;
    state.buildings = enclosedEnvironment(site.tileX, site.tileY, 2, 4);
    const door = state.buildings.find((building) => building.boundaryEdge === 'south')!;
    door.definitionId = 'wood-door';
    state.buildings.push({ id: 'custom-purifier', definitionId: 'air-purifier', tileX: site.tileX, tileY: site.tileY },
      { id: 'custom-cache', definitionId: 'field-cache', tileX: site.tileX + 1, tileY: site.tileY });
    expect(shelterChecklist(state).ready).toBe(true);
    expect(reconcileOpeningShelter(state)).toBe(true);
    expect(state.onboarding.status).toBe('active');
    expect(state.onboarding.completedMilestoneIds).toContain('build-shelter');
    const loaded = migrateToCurrent(envelope(state)).save.state;
    expect(loaded.onboarding).toEqual(state.onboarding);
    expect(reconcileOpeningShelter(loaded)).toBe(false);
  });

  it('persists the relocated guide and unfinished work, and claims supplies exactly once', () => {
    const state = stocked(); const initial = { ...state.onboarding.shelterPlan! };
    expect(moveShelterPlan(state, 1, 0).ok).toBe(true);
    expect(state.onboarding.shelterPlan!.tileX).toBe(initial.tileX + 1);
    expect(placeBuildBatch(state, shelterLayout(state.onboarding.shelterPlan!)[0]!).ok).toBe(true);
    const inventory = { ...state.inventory };
    expect(claimShelterSupplies(state).ok).toBe(true);
    expect(claimShelterSupplies(state).ok).toBe(false);
    expect(state.inventory.fiber).toBe(inventory.fiber + 16);
    const loaded = migrateToCurrent(envelope(state)).save.state;
    expect(loaded.onboarding.shelterPlan).toEqual(state.onboarding.shelterPlan);
    expect(loaded.buildings).toHaveLength(8);
    expect(shelterChecklist(loaded).ready).toBe(false);
    expect(claimShelterSupplies(loaded).ok).toBe(false);
  });

  it('does not respawn the authored resource patch after harvest or reload', () => {
    const state = readyToBuild();
    const plants = state.resourceNodes.filter((node) => node.id.startsWith('shelter-plant-'));
    expect(plants.length).toBe(4);
    for (const plant of plants) plant.hp = 0;
    reconcileOpeningShelter(state);
    const loaded = migrateToCurrent(envelope(state)).save.state;
    reconcileOpeningShelter(loaded);
    expect(loaded.resourceNodes.filter((node) => node.id.startsWith('shelter-plant-'))).toHaveLength(4);
    expect(loaded.resourceNodes.filter((node) => node.id.startsWith('shelter-plant-')).every((node) => node.hp === 0)).toBe(true);
  });

  it('migrates the completed gathering release into shelter guidance without losing progress', () => {
    const state = stocked();
    state.onboarding.version = 2; state.onboarding.status = 'complete';
    state.onboarding.issuedRewardIds = ['starter-partner', 'shelter-recipes'];
    const raw = envelope(state, 83);
    delete (raw.state.onboarding as Partial<typeof raw.state.onboarding>).shelterPlan;
    delete (raw.state.onboarding as Partial<typeof raw.state.onboarding>).shelterHome;
    const loaded = migrateToCurrent(raw).save.state;
    expect(loaded.onboarding).toMatchObject({ version: OPENING_CHAPTER_VERSION, status: 'active', shelterPlan: null, shelterHome: null });
    expect(loaded.inventory).toEqual(state.inventory);
    expect(loaded.ownedCreatures).toEqual(state.ownedCreatures);
    expect(loaded.unlockedItemIds).toEqual(state.unlockedItemIds);
    expect(findShelterSite(loaded)).not.toBeNull();
  });
});
