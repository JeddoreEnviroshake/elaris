import { describe, expect, it } from 'vitest';
import { createOpeningChapter, STARTER_TUFTLE_POSITION, starterTuftleId, activeOpeningMilestone } from '../../src/content/onboarding';
import { CONTENT_VERSION, SAVE_SCHEMA_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { beginOpeningTrust, completeOpeningMilestone, nameOpeningCompanion, offerOpeningTuftle, openingTuftleFed, reconcileOpeningChapter, throwOpeningSnare } from '../../src/simulation/onboarding';
import { activeQuest, reconcileQuestProgress, openingQuestViews } from '../../src/simulation/progression';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { migrateToCurrent, SaveValidationError } from '../../src/persistence/migrations';
import { acquireWildCreature } from '../../src/simulation/creatureAcquisition';
import { strikeCreatureMelee } from '../../src/simulation/creatureStrike';
import { throwSnareAtCreature } from '../../src/simulation/tameChance';
import { advanceWildCreatures } from '../../src/simulation/creatureCombat';
import { prepareOpeningTaming } from '../helpers/openingJourney';
import { recordOpeningBerryPick } from '../../src/simulation/onboardingProgress';
import { terrainAt } from '../../src/simulation/landscape';
import { isTownFootprintWorldPosition } from '../../src/content/townBuildings';
import { setCreatureRole } from '../../src/simulation/gameplayCommands';
import { enterWorldArea } from '../../src/simulation/areas';

function envelope(state: GameState, version = SAVE_SCHEMA_VERSION) {
  return { meta: { saveVersion: version, contentVersion: CONTENT_VERSION, worldGenVersion: WORLD_GEN_VERSION, appVersion: 'test', savedAt: 1 }, state };
}
function approach(seed = 42) {
  const state = createInitialState(seed);
  state.player.x = STARTER_TUFTLE_POSITION.x - 16;
  state.player.y = STARTER_TUFTLE_POSITION.y;
  return state;
}
function befriend(state: GameState) {
  prepareOpeningTaming(state);
  expect(beginOpeningTrust(state).ok).toBe(true);
  offerOpeningTuftle(state);
  expect(throwOpeningSnare(state).ok).toBe(true);
  expect(state.onboarding.status).toBe('active');
}

describe('opening chapter and early Tuftle partnership', () => {
  it('guarantees a visible, walkable, stable roadside encounter across starter seeds', () => {
    for (const seed of [0, 1, 7, 42, 99, 12345, 0xffffffff]) {
      const state = createInitialState(seed);
      const wild = state.wildCreatures.find((creature) => creature.id === starterTuftleId(seed))!;
      expect(wild).toMatchObject({ speciesId: 'tuftle', level: 1, ...STARTER_TUFTLE_POSITION });
      expect(Math.hypot(state.player.x - wild.x, state.player.y - wild.y)).toBeLessThan(64);
      for (const [x, y] of [[80, 80], [81, 80], [82, 80], [82, 81], [82, 82]]) {
        expect(['ground', 'bridge']).toContain(terrainAt(seed, state.currentArea, x!, y!));
        expect(isTownFootprintWorldPosition(x! * 16, y! * 16)).toBe(false);
      }
    }
  });

  it('puts the partnership ahead of the ordinary quest guide without removing those quests', () => {
    const state = approach();
    expect(activeQuest(state)?.id).toBe('opening-pick-berries');
    expect(openingQuestViews(state).map((quest) => quest.complete)).toEqual(Array(16).fill(false));
    expect(beginOpeningTrust(state).ok).toBe(false);
    prepareOpeningTaming(state);
    expect(activeQuest(state)?.id).toBe('opening-meet-tuftle');
    expect(beginOpeningTrust(state).ok).toBe(true);
    expect(activeQuest(state)?.id).toBe('opening-befriend-tuftle');
    befriend(state);
    expect(openingQuestViews(state).map((quest) => quest.complete)).toEqual([true, true, true, true, true, ...Array(11).fill(false)]);
    expect(activeQuest(state)?.id).toBe('opening-gather-together');
  });

  it('waits for the foraging and crafting lessons, then spends the berry and snare the player made', () => {
    const state = createInitialState(42);
    Object.assign(state.player, STARTER_TUFTLE_POSITION);
    expect(state.unlockedItemIds).not.toContain('taming-snare');
    expect(beginOpeningTrust(state).ok).toBe(false);
    prepareOpeningTaming(state);
    const berries = state.inventory.berry;
    expect(beginOpeningTrust(state).ok).toBe(true);
    expect(offerOpeningTuftle(state).ok).toBe(true);
    expect(state.inventory.berry).toBe(berries - 1);
    expect(throwOpeningSnare(state).ok).toBe(true);
    expect(state.inventory['taming-snare']).toBe(0);
  });

  it('credits each foraging and crafting lesson from the real actions', () => {
    const state = approach();
    state.questProgress.crafted['taming-snare'] = 1;
    reconcileOpeningChapter(state);
    expect(activeOpeningMilestone(state)?.id).toBe('pick-berries');
    expect(recordOpeningBerryPick(state)).toBe(true);
    expect(activeOpeningMilestone(state)?.id).toBe('craft-axe');
    state.questProgress.crafted['wooden-axe'] = 1;
    reconcileOpeningChapter(state);
    expect(state.unlockedItemIds).toContain('taming-snare');
    reconcileOpeningChapter(state);
    expect(activeOpeningMilestone(state)?.id).toBe('meet-tuftle');
  });

  it('resumes a fed Tuftle from a save and reaches the same deterministic outcome', () => {
    const state = approach();
    prepareOpeningTaming(state);
    beginOpeningTrust(state);
    offerOpeningTuftle(state);
    const saved = migrateToCurrent(JSON.parse(JSON.stringify(envelope(state)))).save.state;
    expect(saved.onboarding).toEqual(state.onboarding);
    expect(openingTuftleFed(saved)).toBe(true);
    expect(beginOpeningTrust(saved).ok).toBe(true);
    throwOpeningSnare(state);
    throwOpeningSnare(saved);
    expect(canonicalizeGameState(saved)).toBe(canonicalizeGameState(state));
    expect(saved.onboarding.status).toBe('active');
  });

  it('allows mistakes and retries without consuming any irreplaceable resources', () => {
    const state = approach();
    prepareOpeningTaming(state);
    const inventoryBefore = structuredClone(state.inventory);
    beginOpeningTrust(state);
    expect(throwOpeningSnare(state).ok).toBe(false);
    expect(offerOpeningTuftle(state).ok).toBe(true);
    expect(offerOpeningTuftle(state).ok).toBe(false);
    expect(state.onboarding.status).toBe('active');
    expect(state.ownedCreatures).toHaveLength(0);
    expect(throwOpeningSnare(state).ok).toBe(true);
    expect(state.inventory).toEqual({ ...inventoryBefore, berry: inventoryBefore.berry - 1, 'taming-snare': inventoryBefore['taming-snare'] - 1 });
  });

  it('creates exactly one normal, named follower and records the reward once', () => {
    const state = approach();
    const nextId = state.nextEntityId;
    befriend(state);
    const creature = state.ownedCreatures[0]!;
    expect(creature).toMatchObject({ id: `creature-${nextId}`, speciesId: 'tuftle', role: 'follow', level: 1 });
    expect(state.wildCreatures.some((wild) => wild.id === starterTuftleId(state.seed))).toBe(false);
    expect(state.firstTamedSpeciesIds).toEqual(['tuftle']);
    expect(throwOpeningSnare(state).ok).toBe(false);
    expect(beginOpeningTrust(state).ok).toBe(false);
    expect(reconcileOpeningChapter(state)).toBe(false);
    expect(state.ownedCreatures).toHaveLength(1);
    expect(state.nextEntityId).toBe(nextId + 1);
    expect(state.onboarding.issuedRewardIds).toEqual(['starter-partner']);
    expect(nameOpeningCompanion(state, ' Moss ').ok).toBe(true);
    expect(nameOpeningCompanion(state, ' ').ok).toBe(false);
    expect(nameOpeningCompanion(state, 'x'.repeat(25)).ok).toBe(false);
    const saved = migrateToCurrent(envelope(state)).save.state;
    expect(saved.ownedCreatures[0]).toMatchObject({ name: 'Moss', role: 'follow' });
    expect(setCreatureRole(saved, creature.id, 'rest').ok).toBe(true);
    expect(setCreatureRole(saved, creature.id, 'follow').ok).toBe(true);
  });

  it('does not allow attacks, movement AI, or ordinary captures to consume the introductory creature', () => {
    const state = approach();
    const id = starterTuftleId(state.seed);
    const wild = state.wildCreatures.find((creature) => creature.id === id)!;
    const before = structuredClone(wild);
    expect(strikeCreatureMelee(state, id).ok).toBe(false);
    state.inventory['taming-snare'] = 1;
    expect(throwSnareAtCreature(state, id).ok).toBe(false);
    for (let step = 0; step < 250; step++) { state.tick++; advanceWildCreatures(state); }
    expect(wild).toEqual(before);
    expect(state.inventory['taming-snare']).toBe(1);
  });

  it('records early milestones idempotently, independently of UI or reward collection', () => {
    const state = approach();
    expect(completeOpeningMilestone(state, 'befriend-tuftle')).toBe(true);
    expect(activeOpeningMilestone(state)?.id).toBe('pick-berries');
    expect(completeOpeningMilestone(state, 'befriend-tuftle')).toBe(false);
    expect(state.onboarding.issuedRewardIds).toEqual([]);
  });

  it('credits a Tuftle acquired out of order without giving a duplicate', () => {
    const state = approach();
    const ordinary = state.wildCreatures.find((wild) => wild.speciesId === 'tuftle' && wild.id !== starterTuftleId(state.seed))!;
    const creature = acquireWildCreature(state, ordinary)!;
    reconcileQuestProgress(state);
    expect(state.onboarding).toMatchObject({ status: 'active', companionId: creature.id });
    expect(state.ownedCreatures).toHaveLength(1);
    expect(state.wildCreatures.some((wild) => wild.id === starterTuftleId(state.seed))).toBe(false);
  });

  it('recovers a missing authored fixture without duplicating it', () => {
    const state = approach();
    state.wildCreatures = [];
    expect(reconcileOpeningChapter(state)).toBe(true);
    expect(reconcileOpeningChapter(state)).toBe(false);
    expect(state.wildCreatures).toHaveLength(1);
  });

  it('can leave, reload, and return to the same paused introduction', () => {
    const state = approach();
    prepareOpeningTaming(state);
    beginOpeningTrust(state);
    offerOpeningTuftle(state);
    enterWorldArea(state, 1, 0);
    expect(beginOpeningTrust(state).ok).toBe(false);
    const reloaded = migrateToCurrent(envelope(state)).save.state;
    enterWorldArea(reloaded, 0, 0);
    Object.assign(reloaded.player, STARTER_TUFTLE_POSITION);
    expect(beginOpeningTrust(reloaded).ok).toBe(true);
    expect(openingTuftleFed(reloaded)).toBe(true);
    expect(throwOpeningSnare(reloaded).ok).toBe(true);
    expect(reloaded.onboarding.status).toBe('active');
    expect(reloaded.visitedAreas['0,0']?.wildCreatures.some((wild) => wild.id === starterTuftleId(state.seed))).toBe(false);
    enterWorldArea(reloaded, 1, 0);
    enterWorldArea(reloaded, 0, 0);
    expect(reloaded.wildCreatures.some((wild) => wild.id === starterTuftleId(state.seed))).toBe(false);
    expect(reloaded.ownedCreatures).toHaveLength(1);
  });

  it('migrates existing v81 saves as legacy and preserves their entire prior state', () => {
    const state = approach();
    state.onboarding = createOpeningChapter(state.seed, true);
    state.wildCreatures = state.wildCreatures.filter((wild) => wild.id !== starterTuftleId(state.seed));
    state.tick = 123456;
    state.coins = 73;
    const ordinary = state.wildCreatures.find((wild) => wild.speciesId === 'tuftle')!;
    const existingCompanion = acquireWildCreature(state, ordinary)!;
    existingCompanion.name = 'Juniper';
    setCreatureRole(state, existingCompanion.id, 'follow');
    state.buildings.push({ id: 'building-20', definitionId: 'thatch-floor', tileX: 45, tileY: 80 });
    state.nextEntityId = 21;
    state.completedQuestIds = ['gather-fiber'];
    state.claimedQuestRewardIds = ['gather-fiber'];
    const previous = structuredClone(state);
    const raw = envelope(state, 81);
    delete (raw.state as Partial<GameState>).onboarding;
    const { save, migrated } = migrateToCurrent(raw);
    expect(migrated).toBe(true);
    expect(save.state).toEqual(previous);
    expect(activeQuest(save.state)?.id).not.toMatch(/^opening-/);
    expect(openingQuestViews(save.state)).toEqual([]);
    expect(beginOpeningTrust(save.state).ok).toBe(false);
    expect(migrateToCurrent(save).migrated).toBe(false);
  });

  it('keeps a legacy save at tick zero opted out of the opening', () => {
    const state = createInitialState(7);
    const { save } = migrateToCurrent(envelope(state, 81));
    expect(save.state.onboarding.status).toBe('legacy');
    expect(save.state.tick).toBe(0);
    expect(reconcileOpeningChapter(save.state)).toBe(false);
    expect(save.state.wildCreatures.some((wild) => wild.id === starterTuftleId(7))).toBe(false);
  });

  it('rejects corrupt opening versions and rewards before loading', () => {
    const state = approach();
    beginOpeningTrust(state);
    for (const corrupt of [
      { version: 99 }, { issuedRewardIds: ['starter-partner'] },
      { status: 'complete' }, { starterWildCreatureId: 'another-creature' },
    ]) {
      const broken = structuredClone(state);
      Object.assign(broken.onboarding, corrupt);
      expect(() => migrateToCurrent(envelope(broken))).toThrow(SaveValidationError);
    }
  });
});
