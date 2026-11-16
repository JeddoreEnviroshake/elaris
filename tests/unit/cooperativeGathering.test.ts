import { OPENING_CHAPTER_VERSION } from '../../src/content/onboarding';
import { befriendOpeningTuftle, prepareOpeningTaming } from '../helpers/openingJourney';
import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, SAVE_SCHEMA_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { RESOURCE_STACK_SIZE } from '../../src/config/balance';
import { OPENING_SHELTER_BLUEPRINTS, createOpeningChapter } from '../../src/content/onboarding';
import { createInitialState, type GameState, type ResourceNodeState } from '../../src/simulation/state';
import { beginOpeningTrust, offerOpeningTuftle, reconcileOpeningChapter } from '../../src/simulation/onboarding';
import { activeQuest } from '../../src/simulation/progression';
import { gatherNearest } from '../../src/simulation/gameplayCommands';
import { inventoryCapacity } from '../../src/simulation/characterProgression';
import { activeFollowerGatherAssistance } from '../../src/simulation/creatureRoles';
import { starterGroveAnchor } from '../../src/simulation/worldGeneration';
import { migrateToCurrent } from '../../src/persistence/migrations';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { followerCreaturePlacements, followerAssistanceLift } from '../../src/presentation/followerCreatures';

function save(state: GameState, version = SAVE_SCHEMA_VERSION) {
  return { meta: { saveVersion: version, worldGenVersion: WORLD_GEN_VERSION, contentVersion: CONTENT_VERSION, appVersion: 'test', savedAt: 1 }, state };
}
function partnered() {
  const state = createInitialState(42);
  state.player.x = 82 * 16;
  state.player.y = 82 * 16;
  befriendOpeningTuftle(state);
  Object.assign(state.player, starterGroveAnchor(state.seed));
  state.gameBalance.objects.plant.yieldMin = 1;
  state.gameBalance.objects.plant.yieldMax = 1;
  state.gameBalance.objects.plant.minimumToolTier = 0;
  return state;
}
function harvest(state: GameState) {
  const node: ResourceNodeState = {
    id: 'cooperative-plant', kind: 'plant', x: state.player.x + 16, y: state.player.y,
    hp: 1, maxHp: 1, respawnAtTick: null,
  };
  state.resourceNodes = [node];
  state.tick = Math.max(state.tick, state.actionCooldownUntilTick);
  return gatherNearest(state);
}

describe('cooperative fiber gathering', () => {
  it('grants exactly 25% extra fiber, with the first bonus within four small harvests', () => {
    const assisted = partnered();
    const alone = structuredClone(assisted);
    alone.ownedCreatures[0]!.role = 'rest';
    const results = Array.from({ length: 8 }, () => { harvest(alone); return harvest(assisted); });
    expect(alone.inventory.fiber).toBe(8);
    expect(assisted.inventory.fiber).toBe(10);
    expect(results.slice(0, 3).every((result) => !result.gatherAssistance)).toBe(true);
    expect(results[3]!.gatherAssistance).toMatchObject({ creatureName: 'Tuftle', bonusUnits: 1, resource: 'fiber', openingCompleted: true });
    expect(results[7]!.message).toContain('Tuftle helped: +1 fiber');
  });

  it('preserves fractional credit through save/reload and does not pay it while resting', () => {
    const original = partnered();
    harvest(original); harvest(original); harvest(original);
    expect(original.yieldRemainderByResource.fiber).toBe(7500);
    const loaded = migrateToCurrent(save(structuredClone(original))).save.state;
    loaded.ownedCreatures[0]!.role = 'rest';
    expect(harvest(loaded).gatherAssistance).toBeUndefined();
    expect(loaded.yieldRemainderByResource.fiber).toBe(7500);
    loaded.ownedCreatures[0]!.role = 'follow';
    expect(harvest(loaded).gatherAssistance?.bonusUnits).toBe(1);
    harvest(original);
    expect(original.onboarding).toEqual(loaded.onboarding);
    const direct = migrateToCurrent(save(structuredClone(original))).save.state;
    harvest(original); harvest(direct);
    expect(canonicalizeGameState(original)).toBe(canonicalizeGameState(direct));
  });

  it('stops helping for rest, work, expeditions, and targets beyond the support radius', () => {
    const state = partnered();
    const creature = state.ownedCreatures[0]!;
    const node = { id: 'node', kind: 'plant', x: state.player.x + 48, y: state.player.y, hp: 1, maxHp: 1, respawnAtTick: null } as ResourceNodeState;
    expect(activeFollowerGatherAssistance(state, node, 'fiber')?.amountBps).toBe(2500);
    node.x++;
    expect(activeFollowerGatherAssistance(state, node, 'fiber')).toBeNull();
    node.x--;
    for (const role of ['rest', 'work'] as const) {
      creature.role = role;
      expect(activeFollowerGatherAssistance(state, node, 'fiber')).toBeNull();
    }
    creature.role = 'follow';
    state.expeditions.push({ id: 'away', creatureId: creature.id, routeId: 'short-forage', remainingMs: 1000, rollIndex: 0 });
    expect(activeFollowerGatherAssistance(state, node, 'fiber')).toBeNull();
    state.expeditions = [];
    expect(activeFollowerGatherAssistance(state, { ...node, kind: 'tree' }, 'fiber')).toBeNull();
    expect(activeFollowerGatherAssistance(state, node, 'wood')).toBeNull();
  });

  it('does not stack duplicate helpers and attributes the deterministic winning helper', () => {
    const state = partnered();
    state.ownedCreatures.push({ ...state.ownedCreatures[0]!, id: 'creature-2', name: 'Other' });
    for (let index = 0; index < 4; index++) harvest(state);
    expect(state.inventory.fiber).toBe(5);
    expect(state.onboarding.status).toBe('active');
  });

  it('keeps the full award in ground drops when the bag has no space', () => {
    const state = partnered();
    state.inventory.fiber = 0;
    state.inventory.berry = 0;
    state.inventory.arrow = 0;
    state.inventory.wood = inventoryCapacity(state) * RESOURCE_STACK_SIZE;
    for (let index = 0; index < 4; index++) expect(harvest(state).ok).toBe(true);
    expect(state.inventory.fiber).toBe(0);
    expect(state.groundDrops.filter((drop) => drop.resource === 'fiber').reduce((sum, drop) => sum + drop.amount, 0)).toBe(5);
    expect(state.onboarding.status).toBe('active');
  });

  it('automatically grants only the essential shelter knowledge exactly once', () => {
    const state = partnered();
    expect(state.player.level).toBe(1);
    expect(state.unlockedItemIds).not.toContain('air-purifier');
    state.pendingBlueprintGrantIds.push('air-purifier');
    for (let index = 0; index < 4; index++) harvest(state);
    for (const id of OPENING_SHELTER_BLUEPRINTS) expect(state.unlockedItemIds).toContain(id);
    expect(state.unlockedItemIds).not.toContain('small-pen');
    expect(state.pendingBlueprintGrantIds).not.toContain('air-purifier');
    expect(state.onboarding.completedMilestoneIds).toContain('gather-together');
    expect(state.onboarding.issuedRewardIds).toEqual(['starter-partner', 'shelter-recipes']);
    const knowledge = [...state.unlockedItemIds];
    for (let index = 0; index < 4; index++) harvest(state);
    expect(state.unlockedItemIds).toEqual(knowledge);
    const loaded = migrateToCurrent(save(state)).save.state;
    expect(loaded.onboarding.status).toBe('active');
    expect(loaded.ownedCreatures).toHaveLength(1);
  });

  it('continues the previous release’s completed partnership without duplicating its creature or knowledge', () => {
    const state = partnered();
    state.ownedCreatures[0]!.name = 'Moss';
    state.onboarding.version = 1;
    state.onboarding.status = 'complete';
    state.tick = 1234;
    const previous = structuredClone(state);
    const { save: loaded } = migrateToCurrent(save(state, 82));
    expect(loaded.state.onboarding).toMatchObject({ version: OPENING_CHAPTER_VERSION, status: 'active', companionId: state.onboarding.companionId });
    expect(loaded.state.ownedCreatures).toEqual(previous.ownedCreatures);
    expect(loaded.state.unlockedItemIds).toEqual(previous.unlockedItemIds);
    expect(loaded.state.tick).toBe(1234);
    for (let index = 0; index < 4; index++) harvest(loaded.state);
    expect(loaded.state.onboarding.status).toBe('active');
    expect(loaded.state.ownedCreatures).toHaveLength(1);
  });

  it('preserves a fed opening Tuftle and keeps legacy worlds opted out', () => {
    const state = createInitialState(7);
    state.player.x = 82 * 16; state.player.y = 82 * 16;
    prepareOpeningTaming(state); beginOpeningTrust(state); offerOpeningTuftle(state);
    state.onboarding.version = 1;
    const loaded = migrateToCurrent(save(state, 82)).save.state;
    const fixture = (wild: { id: string }) => wild.id === state.onboarding.starterWildCreatureId;
    expect(loaded.wildCreatures.find(fixture)?.captureBonusBps).toBeGreaterThan(0);
    const legacy = migrateToCurrent(save(createInitialState(7), 81)).save.state;
    expect(legacy.onboarding.status).toBe('legacy');
    expect(legacy.unlockedItemIds).not.toContain('field-cache');
  });

  it('draws followers and their assistance without changing any authoritative state', () => {
    const state = partnered();
    const before = canonicalizeGameState(state);
    const placement = followerCreaturePlacements(state)[0]!;
    expect(placement.id).toBe(state.onboarding.companionId);
    expect(Math.hypot(placement.x - state.player.x, placement.y - state.player.y)).toBeLessThan(32);
    const assistance = { creatureId: placement.id, x: 0, y: 0, progress: 0.5 };
    expect(followerAssistanceLift(placement.id, assistance, false)).toBeGreaterThan(0);
    expect(followerAssistanceLift(placement.id, assistance, true)).toBe(0);
    expect(canonicalizeGameState(state)).toBe(before);
    state.ownedCreatures[0]!.role = 'rest';
    expect(followerCreaturePlacements(state)).toEqual([]);
  });

  it('explains inactive helpers and accepts a replacement without replaying the introduction', () => {
    const state = partnered();
    state.ownedCreatures[0]!.role = 'rest';
    expect(activeQuest(state)?.objective).toContain('Assign Tuftle to Follow');
    const replacement = { ...state.ownedCreatures[0]!, id: 'replacement-tuftle', role: 'follow' as const };
    state.ownedCreatures = [];
    expect(reconcileOpeningChapter(state)).toBe(false);
    expect(activeQuest(state)?.objective).toContain('Bring a Tuftle along');
    state.ownedCreatures.push(replacement);
    expect(reconcileOpeningChapter(state)).toBe(true);
    expect(state.onboarding.companionId).toBe(replacement.id);
    expect(state.onboarding.issuedRewardIds).toEqual(['starter-partner']);
    for (let index = 0; index < 4; index++) harvest(state);
    expect(state.onboarding.status).toBe('active');
  });

  it('lets legacy companions help without awarding new tutorial recipes or restarting progression', () => {
    const state = partnered();
    state.onboarding = createOpeningChapter(state.seed, true);
    for (let index = 0; index < 4; index++) harvest(state);
    expect(state.inventory.fiber).toBe(5);
    expect(state.onboarding.status).toBe('legacy');
    expect(state.onboarding.issuedRewardIds).toEqual([]);
    expect(state.unlockedItemIds).not.toContain('field-cache');
  });
});
