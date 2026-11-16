import { OPENING_NEXT_GOALS, type OpeningNextGoal } from '../content/onboarding';
import { buildableById } from '../content/buildingParts';
import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { GARDEN_BED_YIELD_FIBER, INTERACTION_RANGE_PX } from '../config/balance';
import { buildingCenterPx, effectiveBuildingDimensions } from './buildingGeometry';
import { validatePlacement, type CommandResult } from './gameplayCommands';
import { canRegisterHere, registerCarriedBlueprint } from './carriedBlueprints';
import { knowsBlueprint } from './blueprintKnowledge';
import { completeOpeningMilestone } from './onboardingProgress';
import { describeGardenBed, harvestGardenBed } from './gardenBeds';
import { ELARIS_PUBLIC_WORKBENCH_TILE, isElarisPublicWorkbenchServing } from './elarisWorkbench';
import { environments } from './environmentProgress';
import type { ShelterSite } from './openingShelter';
import type { BuildRequest } from './batchBuilding';
import type { GameState } from './state';

export const openingGardenAvailable = (state: GameState) => !!state.onboarding.garden && state.onboarding.completedMilestoneIds.includes('collect-discovery');

/** Prefer the paddock's reserved right half; never clear or move the player's property. */
export function findOpeningGardenSite(state: GameState): ShelterSite | null {
  if (state.currentArea.key !== '0,0' || !knowsBlueprint(state, 'garden-bed')) return null;
  const companion = state.ownedCreatures.find((creature) => creature.id === state.onboarding.companionId);
  const pen = state.buildings.find((building) => building.id === companion?.housingId);
  const origin = pen ?? state.onboarding.production?.plan ?? state.onboarding.shelterHome;
  if (!origin) return null;
  const preferred = { tileX: origin.tileX + 2, tileY: origin.tileY };
  for (let radius = 0; radius <= 8; radius++) for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
    const tileX = preferred.tileX + dx; const tileY = preferred.tileY + dy;
    if (tileX < 0 || tileY < 0 || tileX + 2 > WORLD_TILES || tileY + 1 >= WORLD_TILES) continue;
    if (state.buildings.some((building) => buildableById(building.definitionId).boundaryClass === 'gate'
      && building.tileX >= tileX && building.tileX < tileX + 2 && Math.abs(building.tileY - tileY) < 1)) continue;
    if (state.containers.some((container) => Math.floor(container.x / TILE_SIZE) >= tileX && Math.floor(container.x / TILE_SIZE) < tileX + 2 && Math.floor(container.y / TILE_SIZE) === tileY)) continue;
    // Site selection ignores the player's present distance, while the actual preview and build use normal reach checks.
    const draft = { ...state, player: { ...state.player, x: (tileX + 1) * TILE_SIZE, y: (tileY + 2) * TILE_SIZE } };
    if (validatePlacement(draft, draft.buildings, buildableById('garden-bed'), tileX, tileY).ok) return { areaKey: '0,0', tileX, tileY };
  }
  return null;
}

export function openingGardenView(state: GameState) {
  const garden = state.onboarding.garden;
  const bed = state.currentArea.key === '0,0' ? state.buildings.find((building) => building.id === garden?.bedId && building.definitionId === 'garden-bed')
    ?? state.buildings.find((building) => building.definitionId === 'garden-bed') ?? null : null;
  const center = bed ? buildingCenterPx(bed) : null;
  const paper = state.carriedBlueprints.find((candidate) => candidate.instanceId === state.onboarding.supplyRun?.blueprintInstanceId)
    ?? state.carriedBlueprints.find((candidate) => candidate.blueprintId === 'garden-bed') ?? null;
  const stored = state.buildings.find((building) => building.storedBlueprints?.some((candidate) => candidate.instanceId === state.onboarding.supplyRun?.blueprintInstanceId)) ?? null;
  return { bed, paper, stored, known: knowsBlueprint(state, 'garden-bed'), canRegister: canRegisterHere(state),
    inReach: !!center && Math.hypot(center.x - state.player.x, center.y - state.player.y) <= INTERACTION_RANGE_PX,
    status: bed ? describeGardenBed(state, bed).message : 'Build a Garden Bed to start growing fiber.',
    readyFiber: bed?.garden?.readyFiber ?? 0 };
}

export function reconcileOpeningGarden(state: GameState): boolean {
  if (!openingGardenAvailable(state) || state.onboarding.status !== 'active') return false;
  const garden = state.onboarding.garden!; let changed = false;
  if (!knowsBlueprint(state, 'garden-bed')) return false;
  if (completeOpeningMilestone(state, 'register-discovery')) changed = true;
  const { bed } = openingGardenView(state);
  if (bed) {
    if (garden.bedId !== bed.id) { garden.bedId = bed.id; changed = true; }
    if (completeOpeningMilestone(state, 'build-garden')) changed = true;
  } else if (!garden.plan && state.currentArea.key === '0,0') {
    garden.plan = findOpeningGardenSite(state); if (garden.plan) changed = true;
  }
  if (garden.harvestedFiber >= GARDEN_BED_YIELD_FIBER) {
    completeOpeningMilestone(state, 'harvest-garden'); state.onboarding.status = 'complete'; changed = true;
  }
  return changed;
}

export function registerOpeningDiscovery(state: GameState): CommandResult {
  if (!openingGardenAvailable(state) || state.pendingRespawn) return { ok: false, message: 'Finish the supply run before registering.' };
  const view = openingGardenView(state);
  if (view.known) return { ok: false, message: 'The Garden Bed recipe is already yours.' };
  if (!view.paper) return { ok: false, message: 'Recover the Garden Bed paper or take it from storage first.' };
  return registerCarriedBlueprint(state, view.paper.instanceId);
}

export function openingGardenBuildRequest(state: GameState): BuildRequest[] {
  const plan = state.onboarding.garden?.plan;
  return openingGardenAvailable(state) && knowsBlueprint(state, 'garden-bed') && plan?.areaKey === state.currentArea.key && !openingGardenView(state).bed
    ? [{ definitionId: 'garden-bed', tileX: plan.tileX, tileY: plan.tileY }] : [];
}

export function moveOpeningGardenPlan(state: GameState, dx: number, dy: number): CommandResult {
  const plan = state.onboarding.garden?.plan;
  if (!openingGardenAvailable(state) || !plan || state.onboarding.status !== 'active' || plan.areaKey !== state.currentArea.key
    || !Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1) return { ok: false, message: 'Return to Elaris to move the garden preview.' };
  if (openingGardenView(state).bed) return { ok: false, message: 'Moving a preview does not move an existing Garden Bed.' };
  const tileX = plan.tileX + dx; const tileY = plan.tileY + dy;
  if (tileX < 0 || tileY < 0 || tileX + 2 > WORLD_TILES || tileY >= WORLD_TILES) return { ok: false, message: 'Keep the garden inside the map.' };
  state.onboarding.garden!.plan = { ...plan, tileX, tileY };
  return { ok: true, message: 'Garden preview moved. Existing structures stay in place.' };
}

export function harvestOpeningGarden(state: GameState): CommandResult {
  const view = openingGardenView(state);
  if (!openingGardenAvailable(state) || !view.bed || state.pendingRespawn) return { ok: false, message: 'Walk near your Garden Bed.' };
  return harvestGardenBed(state, view.bed.id);
}

/** The route ends beside solid facilities, within normal interaction range. */
export function openingGardenTarget(state: GameState) {
  if (!openingGardenAvailable(state) || state.currentArea.key !== '0,0' || state.onboarding.status === 'complete') return null;
  const view = openingGardenView(state);
  if (!view.known) {
    const drop = state.blueprintDrops.find((candidate) => candidate.id === state.onboarding.supplyRun?.blueprintDropId);
    if (drop) return { tileX: Math.floor(drop.x / TILE_SIZE), tileY: Math.floor(drop.y / TILE_SIZE), label: 'Discovery paper' };
    if (view.stored) return { tileX: view.stored.tileX, tileY: view.stored.tileY + effectiveBuildingDimensions(view.stored).tilesHigh, label: 'Stored discovery' };
    if (isElarisPublicWorkbenchServing(state)) return { ...ELARIS_PUBLIC_WORKBENCH_TILE, label: 'Public workbench' };
    const bench = state.buildings.find((building) => building.definitionId === 'workbench');
    return bench ? { tileX: bench.tileX, tileY: bench.tileY + effectiveBuildingDimensions(bench).tilesHigh, label: 'Your workbench' } : null;
  }
  const site = view.bed ?? state.onboarding.garden?.plan;
  return site ? { tileX: site.tileX + 1, tileY: site.tileY + (view.bed ? effectiveBuildingDimensions(view.bed).tilesHigh : 1), label: 'Home garden' } : null;
}

export const OPENING_GOAL_LABELS: Record<OpeningNextGoal, string> = { 'expand-home': 'Expand my home', explore: 'Explore beyond Elaris', befriend: 'Befriend another creature' };
export function openingNextGoal(state: GameState) {
  const goal = state.onboarding.garden?.nextGoal;
  if (state.onboarding.status !== 'complete' || !goal) return null;
  const homeBuildings = state.currentArea.key === '0,0' ? state.buildings : state.visitedAreas['0,0']?.buildings ?? [];
  const complete = goal === 'expand-home' ? environments(homeBuildings).some((room) => room.kind === 'indoor' && room.valid && room.enclosed && room.area >= 16)
    : goal === 'explore' ? state.currentArea.key !== '0,0' || Object.keys(state.visitedAreas).some((key) => key !== '0,0') : state.ownedCreatures.length >= 2;
  const objective = goal === 'expand-home' ? 'Expand an enclosed indoor room to sixteen floor tiles. Open Shelter for protection checks.'
    : goal === 'explore' ? 'Follow a road into a neighboring region. Open the world map to choose a destination; prepare for ordinary threats.'
      : 'Befriend or train a second creature. Read its mood in the wild, or visit the Creature Shop in Elaris.';
  return { goal, title: OPENING_GOAL_LABELS[goal], objective, complete };
}

export function acknowledgeOpeningJourney(state: GameState, goal: OpeningNextGoal | null): CommandResult {
  const garden = state.onboarding.garden;
  if (!garden || state.onboarding.status !== 'complete' || !state.onboarding.completedMilestoneIds.includes('harvest-garden')
    || goal !== null && !OPENING_NEXT_GOALS.includes(goal)) return { ok: false, message: 'Finish your first garden harvest before choosing your next direction.' };
  garden.recapAcknowledged = true; garden.nextGoal = goal;
  return { ok: true, message: goal ? `Next direction: ${OPENING_GOAL_LABELS[goal]}. You can change it in Garden.` : 'Your first chapter is complete. Keep playing at your own pace.' };
}
