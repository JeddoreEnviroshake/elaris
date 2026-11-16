import { describe, expect, it } from 'vitest';
import { befriendOpeningTuftle } from '../helpers/openingJourney';
import { OPENING_CHAPTER_VERSION, createOpeningChapter, createOpeningThreat, OPENING_FOG_PREPARATION_SECONDS, OPENING_FOG_SECONDS } from '../../src/content/onboarding';
import { CONTENT_VERSION, SAVE_SCHEMA_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { TILE_SIZE, WORLD_PX } from '../../src/config/platform';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { recordOpeningGatherAssistance } from '../../src/simulation/onboardingProgress';
import { reconcileOpeningShelter, shelterChecklist, shelterLayout } from '../../src/simulation/openingShelter';
import { placeBuildBatch } from '../../src/simulation/batchBuilding';
import { advanceOpeningFog, acknowledgeOpeningFog, openingFogGuidance } from '../../src/simulation/openingFog';
import { advanceSurvivalCycle, beginPlayerDefeat, chooseRespawn, dangerGraceTimer, isPlayerSheltered, startDangerPhaseNow, survivalSchedule, survivalTimerAtTick } from '../../src/simulation/survivalCycle';
import { advanceRaid } from '../../src/simulation/raids';
import { advanceArcaneStorm } from '../../src/simulation/arcaneStorm';
import { enterWorldArea, enterVisitedArea } from '../../src/simulation/areas';
import { createGridMovementState, NO_MOVE, stepMovement } from '../../src/simulation/commands';
import { settleOfflineTime } from '../../src/simulation/offline';
import { reconcileQuestProgress } from '../../src/simulation/progression';
import { migrateToCurrent, SaveValidationError } from '../../src/persistence/migrations';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { depositResourceStackInFieldCache, withdrawResourceStackFromFieldCache } from '../../src/simulation/gameplayCommands';

const TPS = 60;
function envelope(state: GameState, version = SAVE_SCHEMA_VERSION) {
  return { meta: { saveVersion: version, contentVersion: CONTENT_VERSION, worldGenVersion: WORLD_GEN_VERSION, appVersion: 'test', savedAt: 1 }, state };
}
function readyShelter() {
  const state = createInitialState(42);
  state.player.x = 82 * TILE_SIZE; state.player.y = 82 * TILE_SIZE;
  befriendOpeningTuftle(state);
  recordOpeningGatherAssistance(state, state.onboarding.companionId!, 1);
  reconcileOpeningShelter(state);
  const site = state.onboarding.shelterPlan!;
  state.player.x = (site.tileX + 1.5) * TILE_SIZE; state.player.y = (site.tileY + 3) * TILE_SIZE;
  state.inventory.fiber = 100; state.inventory.wood = 100; state.inventory.stone = 100;
  for (const stage of shelterLayout(site)) expect(placeBuildBatch(state, stage).ok).toBe(true);
  state.player.y = (site.tileY + 1.5) * TILE_SIZE;
  // An arbitrary late tick proves the lesson never rewinds the simulation clock.
  state.tick = 73_107;
  reconcileQuestProgress(state);
  return state;
}
function observeShelter(state: GameState) {
  state.tick = state.onboarding.firstThreat!.fogStartsAtTick!;
  for (let i = 0; i < TPS; i++) { advanceOpeningFog(state); state.tick++; }
}

describe('first fog lesson', () => {
  it('keeps fresh worlds free of scheduled threats until a working shelter is ready', () => {
    const state = createInitialState(42);
    state.tick = 1_000_000;
    expect(survivalSchedule(state)).toMatchObject({ phase: 'safe', threat: 'fog', openingPhase: 'waiting', cycleIndex: 0 });
    expect(advanceSurvivalCycle(state)).toBeNull();
    expect(state.dangerExposureStartedAtTick).toBeNull();
    expect(advanceRaid(state).absentReports).toBeUndefined();
    expect(state.raiders.filter((raider) => !raider.roaming)).toEqual([]);
    expect(advanceArcaneStorm(state).changed).toBe(false);
    expect(state.arcaneStorm.strikes).toEqual([]);
    const movement = createGridMovementState();
    stepMovement(state, NO_MOVE, 1000 / TPS, movement);
    expect(state.tick).toBe(1_000_001);
    expect(state.onboarding.firstThreat!.fogStartsAtTick).toBeNull();
    const tick = state.tick;
    expect(startDangerPhaseNow(state).ok).toBe(false);
    expect(state.tick).toBe(tick);
  });

  it('persists preparation at shelter completion without resetting tick or using optional banners', () => {
    const state = readyShelter(); const threat = state.onboarding.firstThreat!;
    expect(state.tick).toBe(73_107);
    expect(threat.preparationStartedAtTick).toBe(state.tick);
    expect(threat.fogStartsAtTick).toBe(state.tick + OPENING_FOG_PREPARATION_SECONDS * TPS);
    expect(threat.fogEndsAtTick).toBe(threat.fogStartsAtTick! + OPENING_FOG_SECONDS * TPS);
    expect(survivalSchedule(state)).toMatchObject({ openingPhase: 'preparing', label: '0:45', phase: 'safe' });
    const before = structuredClone(threat);
    state.buildings = state.buildings.filter((building) => building.definitionId !== 'air-purifier');
    reconcileQuestProgress(state);
    expect(state.onboarding.firstThreat).toEqual(before);
    expect(shelterChecklist(state).ready).toBe(false);
  });

  it('uses the same phase boundaries for countdown, exposure, raid and storm consumers', () => {
    const state = readyShelter(); const threat = state.onboarding.firstThreat!;
    state.tick = threat.fogStartsAtTick! - 1;
    expect(survivalSchedule(state)).toMatchObject({ openingPhase: 'preparing', phase: 'safe', secondsRemaining: 1, dangerElapsedTicks: null });
    state.tick++;
    expect(survivalSchedule(state)).toMatchObject({ openingPhase: 'fog', phase: 'danger', secondsRemaining: 45, dangerElapsedTicks: 0, dangerDurationTicks: 45 * TPS });
    expect(advanceRaid(state).absentReports).toBeUndefined();
    expect(advanceArcaneStorm(state).changed).toBe(false);
    state.tick = threat.fogEndsAtTick! - 1;
    expect(survivalSchedule(state)).toMatchObject({ phase: 'danger', secondsRemaining: 1 });
    state.tick++;
    expect(survivalSchedule(state)).toMatchObject({ phase: 'safe', threat: 'raid', cycleIndex: 1, openingPhase: null });
    expect(dangerGraceTimer(state)).toBeNull();
    expect(advanceSurvivalCycle(state)).toBeNull();
  });

  it('uses real enclosure and purifier coverage and explains exposure after a missing wall', () => {
    const state = readyShelter(); const site = state.onboarding.shelterPlan!;
    state.tick = state.onboarding.firstThreat!.fogStartsAtTick!;
    state.player.x = (site.tileX + 3.5) * TILE_SIZE;
    expect(isPlayerSheltered(state)).toBe(true);
    expect(openingFogGuidance(state)?.detail).toContain('protected here');
    const wall = state.buildings.find((building) => building.boundaryEdge === 'north')!;
    state.buildings = state.buildings.filter((building) => building.id !== wall.id);
    expect(shelterChecklist(state).gaps).toContainEqual(expect.objectContaining({ tileX: wall.tileX, tileY: wall.tileY, edge: 'north' }));
    expect(isPlayerSheltered(state)).toBe(false);
    expect(openingFogGuidance(state)?.detail).toContain('You are exposed');
    const hp = state.player.hp;
    advanceSurvivalCycle(state);
    expect(dangerGraceTimer(state)?.secondsRemaining).toBe(state.gameBalance.raid.graceSeconds);
    state.tick += (state.gameBalance.raid.graceSeconds + 1) * TPS;
    advanceSurvivalCycle(state);
    expect(state.player.hp).toBeLessThan(hp);
    state.player.x = 70.5 * TILE_SIZE; state.player.y = 90.5 * TILE_SIZE;
    expect(isPlayerSheltered(state)).toBe(true);
    advanceSurvivalCycle(state);
    expect(state.dangerExposureStartedAtTick).toBeNull();
    expect(dangerGraceTimer(state)).toBeNull();
  });

  it('resumes preparation and active fog exactly, and closed-game time cannot finish the lesson', () => {
    let state = readyShelter();
    const planned = structuredClone(state.onboarding.firstThreat);
    state = migrateToCurrent(envelope(state)).save.state;
    expect(state.onboarding.firstThreat).toEqual(planned);
    state.tick = state.onboarding.firstThreat!.fogStartsAtTick! + 12 * TPS;
    advanceOpeningFog(state);
    const view = survivalSchedule(state);
    const tick = state.tick;
    state = migrateToCurrent(envelope(state)).save.state;
    settleOfflineTime(state, 24 * 60 * 60 * 1000);
    expect(state.tick).toBe(tick);
    expect(survivalSchedule(state)).toEqual(view);
    expect(state.onboarding.completedMilestoneIds).not.toContain('weather-fog');
    expect(state.onboarding.firstThreat!.fogStartsAtTick).toBe(planned!.fogStartsAtTick);
  });

  it('allows ordinary storage transfers and safe construction during the fog', () => {
    const state = readyShelter(); const site = state.onboarding.shelterPlan!;
    state.tick = state.onboarding.firstThreat!.fogStartsAtTick!;
    const cache = state.buildings.find((building) => building.definitionId === 'field-cache')!;
    const before = state.inventory.fiber;
    expect(depositResourceStackInFieldCache(state, 'fiber', 0, cache.id).ok).toBe(true);
    expect(state.inventory.fiber).toBeLessThan(before);
    expect(withdrawResourceStackFromFieldCache(state, 'fiber', 0, cache.id).ok).toBe(true);
    expect(state.inventory.fiber).toBe(before);
    expect(placeBuildBatch(state, [{ definitionId: 'field-cache', tileX: site.tileX + 2, tileY: site.tileY }]).ok).toBe(true);
    expect(isPlayerSheltered(state)).toBe(true);
    const hp = state.player.hp;
    for (let i = 0; i < 2 * TPS; i++) { state.tick++; advanceOpeningFog(state); advanceSurvivalCycle(state); }
    expect(state.player.hp).toBe(hp);
  });

  it('credits real protected time once and keeps a dismissible aftermath after reloading', () => {
    let state = readyShelter();
    state.tick = state.onboarding.firstThreat!.fogStartsAtTick!;
    for (let i = 0; i < 500; i++) reconcileQuestProgress(state);
    expect(state.onboarding.firstThreat!.shelteredTicks).toBe(1);
    observeShelter(state);
    // The first tick was already sampled, so observe one more distinct tick.
    advanceOpeningFog(state);
    const preparedAt = state.onboarding.firstThreat!.preparationStartedAtTick;
    state.tick = state.onboarding.firstThreat!.fogEndsAtTick!;
    expect(advanceOpeningFog(state)).toBe(true);
    expect(state.onboarding.status).toBe('active');
    expect(openingFogGuidance(state)?.title).toBe('The air is clear');
    state = migrateToCurrent(envelope(state)).save.state;
    expect(openingFogGuidance(state)?.notice).toBe(true);
    expect(acknowledgeOpeningFog(state).ok).toBe(true);
    expect(acknowledgeOpeningFog(state).ok).toBe(false);
    expect(openingFogGuidance(state)).toBeNull();
    reconcileQuestProgress(state); // The paddock phase is now available.
    expect(reconcileQuestProgress(state)).toBe(false);
    expect(state.onboarding.firstThreat!.preparationStartedAtTick).toBe(preparedAt);
    expect(state.onboarding.completedMilestoneIds.filter((id) => id === 'weather-fog')).toHaveLength(1);
  });

  it('keeps a failed lesson recoverable through sanctuary and a later ordinary fog', () => {
    const state = readyShelter(); observeShelter(state);
    beginPlayerDefeat(state);
    expect(state.onboarding.firstThreat!.shelteredTicks).toBe(0);
    expect(chooseRespawn(state, 'elaris-sanctuary').ok).toBe(true);
    state.tick = state.onboarding.firstThreat!.fogEndsAtTick!;
    advanceOpeningFog(state);
    expect(state.onboarding.completedMilestoneIds).not.toContain('weather-fog');
    expect(openingFogGuidance(state)?.title).toBe('Weather the next fog');
    enterWorldArea(state, 1, 0);
    advanceOpeningFog(state);
    expect(state.onboarding.firstThreat!.releasedAtTick).toBeNull();
    expect(survivalSchedule(state)).toMatchObject({ cycleIndex: 1, threat: 'raid' });
    enterWorldArea(state, 0, 0);
    const raid = state.gameBalance.raid;
    const raidCycle = (raid.safePhaseSeconds + raid.dangerPhaseSecondsByThreat.raid) * TPS;
    state.tick += raidCycle + raid.safePhaseSeconds * TPS;
    for (let i = 0; i < TPS; i++) { advanceOpeningFog(state); state.tick++; }
    state.tick += raid.dangerPhaseSecondsByThreat.fog * TPS;
    advanceOpeningFog(state);
    expect(state.onboarding.completedMilestoneIds).toContain('weather-fog');
  });

  it('warns at the region edge and permanently releases protection through every travel path', () => {
    const state = createInitialState(42); state.tick = 927;
    state.player.x = WORLD_PX - TILE_SIZE;
    expect(openingFogGuidance(state)?.departureWarning).toBe(true);
    expect(enterWorldArea(state, 1, 0)).toBe(true);
    expect(state.onboarding.firstThreat!.releasedAtTick).toBe(927);
    expect(survivalSchedule(state)).toMatchObject({ openingPhase: null, phase: 'safe', cycleIndex: 0 });
    expect(openingFogGuidance(state)?.title).toBe('Guided protection ended');
    state.tick += 10;
    expect(enterVisitedArea(state, '0,0')).toBe(true);
    expect(enterVisitedArea(state, '1,0')).toBe(true);
    expect(state.onboarding.firstThreat!.releasedAtTick).toBe(927);
    expect(survivalSchedule(state)).toMatchObject(survivalTimerAtTick(10, state.gameBalance.raid));
    expect(migrateToCurrent(envelope(state)).save.state.onboarding.firstThreat!.releasedAtTick).toBe(927);
  });

  it('continues real raids and storms at the shifted ordinary schedule after the lesson', () => {
    const state = readyShelter(); observeShelter(state);
    const end = state.onboarding.firstThreat!.fogEndsAtTick!;
    state.tick = end; advanceOpeningFog(state);
    const raid = state.gameBalance.raid;
    const fogCycle = (raid.safePhaseSeconds + raid.dangerPhaseSecondsByThreat.fog) * TPS;
    state.tick = end + (raid.safePhaseSeconds + raid.spawnDelaySeconds) * TPS;
    advanceRaid(state);
    expect(state.raidCycleIndex).toBe(1);
    expect(state.raiders.filter((raider) => !raider.roaming).length).toBeGreaterThan(0);
    const raidCycle = (raid.safePhaseSeconds + raid.dangerPhaseSecondsByThreat.raid) * TPS;
    state.tick = end + fogCycle + raidCycle * 2 + raid.safePhaseSeconds * TPS + 8 * TPS;
    enterWorldArea(state, 1, 0);
    expect(state.onboarding.firstThreat!.releasedAtTick).toBeNull();
    expect(survivalSchedule(state)).toMatchObject({ cycleIndex: 4, threat: 'storm', phase: 'danger' });
    advanceArcaneStorm(state);
    expect(state.arcaneStorm.nextStrikeIndex).toBeGreaterThan(0);
  });

  it('upgrades v84 chapters without changing any ordinary threat boundary or owned property', () => {
    const state = readyShelter();
    state.onboarding.version = 3; state.onboarding.status = 'complete';
    const raw = envelope(state, 84);
    delete (raw.state.onboarding as Partial<typeof raw.state.onboarding>).firstThreat;
    const before = structuredClone(state);
    const loaded = migrateToCurrent(raw).save.state;
    expect(loaded.onboarding).toMatchObject({ version: OPENING_CHAPTER_VERSION, status: 'active', firstThreat: { mode: 'ordinary', fogStartsAtTick: null } });
    expect(loaded.tick).toBe(before.tick);
    expect(loaded.buildings).toEqual(before.buildings);
    expect(loaded.ownedCreatures).toEqual(before.ownedCreatures);
    expect(loaded.inventory).toEqual(before.inventory);
    expect(loaded.unlockedItemIds).toEqual(before.unlockedItemIds);
    for (const tick of [0, 35_999, 36_000, 39_600, 80_000, 200_000, 1_000_000]) {
      loaded.tick = tick;
      expect(survivalSchedule(loaded)).toMatchObject(survivalTimerAtTick(tick, loaded.gameBalance.raid));
    }
  });

  it('settles absent bases only at the shifted raid boundary, never during introductory fog', () => {
    const state = readyShelter(); observeShelter(state);
    const end = state.onboarding.firstThreat!.fogEndsAtTick!;
    expect(advanceRaid(state).absentReports).toBeUndefined();
    state.tick = end; advanceOpeningFog(state);
    enterWorldArea(state, 1, 0);
    const raid = state.gameBalance.raid;
    state.tick = end + (raid.safePhaseSeconds + raid.spawnDelaySeconds) * TPS;
    advanceRaid(state);
    expect(state.raidCycleIndex).toBe(1);
    state.tick = end + (raid.safePhaseSeconds + raid.dangerPhaseSecondsByThreat.raid) * TPS - 1;
    expect(advanceRaid(state).absentReports).toBeUndefined();
    state.tick++;
    expect(advanceRaid(state).absentReports).toEqual(expect.arrayContaining([expect.objectContaining({ areaKey: '0,0' })]));
    expect(advanceRaid(state).absentReports).toBeUndefined();
  });

  it('skips an ordinary safe phase precisely even when the opening offset is not second-aligned', () => {
    const state = readyShelter(); const end = state.onboarding.firstThreat!.fogEndsAtTick!;
    state.tick = end + 123;
    expect(startDangerPhaseNow(state).ok).toBe(true);
    expect(state.tick).toBe(end + state.gameBalance.raid.safePhaseSeconds * TPS);
    expect(survivalSchedule(state)).toMatchObject({ cycleIndex: 1, phase: 'danger', threat: 'raid', dangerElapsedTicks: 0 });
  });

  it('leaves legacy worlds out of the lesson and rejects inconsistent new schedules', () => {
    const legacy = createInitialState(42); legacy.onboarding = createOpeningChapter(42, true);
    legacy.tick = 80_000;
    const before = canonicalizeGameState(legacy);
    expect(advanceOpeningFog(legacy)).toBe(false);
    expect(canonicalizeGameState(legacy)).toBe(before);
    expect(survivalSchedule(legacy)).toMatchObject(survivalTimerAtTick(legacy.tick, legacy.gameBalance.raid));
    const valid = readyShelter();
    for (const patch of [{ fogStartsAtTick: null }, { preparationStartedAtTick: valid.tick + 1 }, { shelteredTicks: 61 }, { releasedAtTick: valid.tick + 1 }, { mode: 'ordinary' }]) {
      const state = structuredClone(valid);
      Object.assign(state.onboarding.firstThreat!, patch);
      expect(() => migrateToCurrent(envelope(state))).toThrow(SaveValidationError);
    }
    valid.onboarding.firstThreat = createOpeningThreat('ordinary');
    expect(() => migrateToCurrent(envelope(valid))).not.toThrow();
  });
});
