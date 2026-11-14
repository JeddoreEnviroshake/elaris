import { OPENING_PADDOCK_BLUEPRINTS } from '../content/onboarding';
import { producerForSpecies } from '../content/producers';
import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { INTERACTION_RANGE_PX } from '../config/balance';
import { batchCost, type BuildRequest } from './batchBuilding';
import { boundarySpan, boundarySegmentAnchors, buildingCenterPx } from './buildingGeometry';
import { boundaryEdgeKey, buildOccupancy, cellKey, enclosureGaps, environmentAt } from './environmentProgress';
import { addGroundDrop, setCreatureRole, tryAddResource, type CommandResult } from './gameplayCommands';
import { assignCreatureHousing, collectHousingBin, HOUSING_SLOTS, housingBinCapacity, housingBinCount, housingCapacityForBuilding, isHousingBuilding } from './workerHousing';
import { learnBlueprint } from './blueprintKnowledge';
import { completeOpeningMilestone } from './onboardingProgress';
import { clearSite, type ShelterSite } from './openingShelter';
import { terrainAt, terrainCapabilities } from './landscape';
import { starterGroveAnchor } from './worldGeneration';
import { starterBiomeAt } from './biomes';
import { buildableById } from '../content/buildingParts';
import type { GameState, ResourceId } from './state';

export const PADDOCK_SUPPLIES = { wood: 10, fiber: 12 } as const;
export const PADDOCK_STAGES = ['Ground cover', 'North fence', 'South fence', 'West fence', 'East fence', 'Gate', 'Small Pen'] as const;
export function paddockLayout(site: ShelterSite): BuildRequest[][] {
  const { tileX: x, tileY: y } = site;
  const ground: BuildRequest[] = [];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 4; dx++) ground.push({ definitionId: 'thatch-ground', tileX: x + dx, tileY: y + dy });
  const fence = (dx: number, dy: number, boundaryEdge: NonNullable<BuildRequest['boundaryEdge']>): BuildRequest => ({ definitionId: 'thatch-fence', tileX: x + dx, tileY: y + dy, boundaryEdge });
  return [ground, [fence(0, 0, 'north'), fence(2, 0, 'north')], [fence(0, 1, 'south')], [fence(0, 0, 'west')], [fence(3, 0, 'east')],
    [{ definitionId: 'thatch-gate', tileX: x + 2, tileY: y + 1, boundaryEdge: 'south' }], [{ definitionId: 'small-pen', tileX: x, tileY: y }]];
}
export const paddockMaterialBudget = () => batchCost(paddockLayout({ areaKey: '0,0', tileX: 0, tileY: 0 }).flat());

/** A clear, reachable starter plot. The right half is grassland reserved for the future garden. */
export function findPaddockSite(state: GameState): ShelterSite | null {
  if (state.currentArea.key !== '0,0') return null;
  const home = state.onboarding.shelterHome;
  const grove = starterGroveAnchor(state.seed);
  const origin = home?.areaKey === '0,0' ? home : { tileX: Math.floor(grove.x / TILE_SIZE), tileY: Math.floor(grove.y / TILE_SIZE) };
  const queue = [{ tileX: origin.tileX, tileY: origin.tileY }]; const seen = new Set<string>([cellKey(origin.tileX, origin.tileY)]);
  for (let i = 0; i < queue.length && i < 5000; i++) {
    const point = queue[i]!;
    if (clearSite(state, point.tileX, point.tileY)
      && [0, 1].every((dy) => [2, 3].every((dx) => starterBiomeAt(state.currentArea.seed, (point.tileX + dx + .5) * TILE_SIZE, (point.tileY + dy + .5) * TILE_SIZE) === 'grassland'))) return { areaKey: '0,0', ...point };
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]] as const) {
      const x = point.tileX + dx; const y = point.tileY + dy; const key = cellKey(x, y);
      if (seen.has(key) || Math.abs(x - origin.tileX) > 32 || Math.abs(y - origin.tileY) > 32 || x < 1 || y < 1 || x + 4 >= WORLD_TILES || y + 2 >= WORLD_TILES) continue;
      seen.add(key);
      if (terrainCapabilities(terrainAt(state.seed, state.currentArea, x, y)).walkable) queue.push({ tileX: x, tileY: y });
    }
  }
  return null;
}

export function remainingPaddockStage(state: GameState, site: ShelterSite, index: number): BuildRequest[] {
  const occupancy = buildOccupancy(state.buildings);
  return (paddockLayout(site)[index] ?? []).filter((request) => {
    const wanted = buildableById(request.definitionId);
    if (wanted.layer === 'boundary') return !boundarySegmentAnchors(request.tileX, request.tileY, request.boundaryEdge!, boundarySpan(wanted)).every((segment) => {
      const existing = occupancy.boundaries.get(boundaryEdgeKey(segment.tileX, segment.tileY, segment.edge));
      const kind = existing && buildableById(existing.definitionId).boundaryClass;
      return wanted.boundaryClass === 'gate' ? kind === 'gate' : kind === 'fence' || kind === 'gate';
    });
    return !state.buildings.some((building) => building.tileX === request.tileX && building.tileY === request.tileY
      && (wanted.layer === 'surface' ? buildableById(building.definitionId).surfaceKind === 'ground' : building.definitionId === request.definitionId));
  });
}

export function paddockView(state: GameState) {
  const chapter = state.onboarding; const production = chapter.production;
  const creature = state.ownedCreatures.find((candidate) => candidate.id === chapter.companionId) ?? null;
  const candidates = state.buildings.filter(isHousingBuilding);
  const housing = candidates.find((building) => building.id === creature?.housingId)
    ?? candidates.find((building) => { const view = housingCapacityForBuilding(state, building); return view && view.area >= 8 && view.capacity >= 1 && view.available > 0
      && state.ownedCreatures.filter((candidate) => candidate.housingId === building.id).length < HOUSING_SLOTS[building.definitionId]; }) ?? candidates[0] ?? null;
  const capacity = housing ? housingCapacityForBuilding(state, housing) : null;
  const yard = housing ? environmentAt(state.buildings, housing.tileX, housing.tileY) : null;
  const gap = yard ? enclosureGaps(state.buildings).find((edge) => yard.cells.has(cellKey(edge.tileX, edge.tileY))) : null;
  const ready = !!capacity && capacity.area >= 8 && capacity.capacity >= 1;
  const away = !!creature && state.expeditions.some((expedition) => expedition.creatureId === creature.id);
  const canReserve = ready && !!housing && (creature?.housingId === housing.id || !!capacity && capacity.available > 0
    && state.ownedCreatures.filter((candidate) => candidate.housingId === housing.id).length < HOUSING_SLOTS[housing.definitionId]);
  const working = !!creature && !away && ready && creature.role === 'work' && creature.worksiteId === housing?.id;
  const bin = housing ? housingBinCount(housing) : 0; const binCapacity = housing ? housingBinCapacity(housing) : 0;
  const producer = producerForSpecies('tuftle')!;
  const full = !!housing && bin + (producer.outputPerCycle.fiber ?? 0) > binCapacity;
  const recovery = gap ? `Close the ${gap.edge} edge at X ${gap.tileX}, Y ${gap.tileY}.`
    : !ready ? 'Enclose at least eight connected ground-cover tiles with fences and gates, and place the Pen fully inside.' : '';
  const status = !creature ? 'Your Tuftle is missing. Tame or order a replacement Tuftle to continue.' : away ? `${creature.name} is away. Collect its expedition return before assigning it.`
    : !ready ? recovery : !canReserve ? 'Housing full · free a reserved slot in Creatures or build another Pen and expand the yard.' : working ? full ? 'Storage full · collect fiber to resume. Stored output is safe.' : 'Working'
      : creature.role === 'follow' ? 'Following · helping you gather; home production is stopped.' : 'Resting · choose Work to start production.';
  const center = housing ? buildingCenterPx(housing) : null;
  const inReach = !!center && Math.hypot(center.x - state.player.x, center.y - state.player.y) <= INTERACTION_RANGE_PX;
  return { creature, housing, capacity, area: yard?.area ?? 0, ready, canReserve, working, away, full, bin, binCapacity, recovery, status, inReach,
    nextDeliverySeconds: Math.ceil((producer.cycleMs - (creature?.workRemainderMs ?? 0)) / 1000),
    collectedFiber: production?.collectedFiber ?? 0, producedFiber: production?.producedFiber ?? 0 };
}

export function reconcileOpeningPaddock(state: GameState): boolean {
  const chapter = state.onboarding; const production = chapter.production;
  if (!production || chapter.status !== 'active' || !chapter.completedMilestoneIds.includes('weather-fog')) return false;
  let changed = false;
  if (!chapter.issuedRewardIds.includes('paddock-recipes')) {
    for (const id of OPENING_PADDOCK_BLUEPRINTS) learnBlueprint(state, id);
    state.pendingBlueprintGrantIds = state.pendingBlueprintGrantIds.filter((id) => !OPENING_PADDOCK_BLUEPRINTS.some((recipe) => recipe === id));
    chapter.issuedRewardIds.push('paddock-recipes'); changed = true;
  }
  if (!production.plan && state.currentArea.key === '0,0') { production.plan = findPaddockSite(state); if (production.plan) changed = true; }
  const view = paddockView(state);
  if (view.ready && completeOpeningMilestone(state, 'build-paddock')) changed = true;
  if (chapter.completedMilestoneIds.includes('build-paddock') && production.collectedFiber >= 2 && completeOpeningMilestone(state, 'collect-production')) changed = true;
  if (chapter.completedMilestoneIds.includes('collect-production') && view.ready && view.creature?.role === 'follow' && !view.away) {
    if (completeOpeningMilestone(state, 'return-to-follow')) changed = true;
  }
  return changed;
}

export function claimPaddockSupplies(state: GameState): CommandResult {
  const chapter = state.onboarding;
  if (chapter.status !== 'active' || !chapter.completedMilestoneIds.includes('weather-fog') || chapter.issuedRewardIds.includes('paddock-supplies')) return { ok: false, message: 'Paddock supplies are not available or already collected' };
  for (const [id, amount] of Object.entries(PADDOCK_SUPPLIES)) if (!tryAddResource(state, id as ResourceId, amount)) addGroundDrop(state, id as ResourceId, amount, state.player.x, state.player.y);
  chapter.issuedRewardIds.push('paddock-supplies');
  return { ok: true, message: 'Paddock supplies: 10 wood and 12 fiber. Overflow waits on the ground beside you.' };
}

export function movePaddockPlan(state: GameState, dx: number, dy: number): CommandResult {
  const production = state.onboarding.production; const plan = production?.plan;
  if (!plan || state.onboarding.status !== 'active' || plan.areaKey !== state.currentArea.key || !Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1) return { ok: false, message: 'Return to the suggested paddock first' };
  const tileX = plan.tileX + dx; const tileY = plan.tileY + dy;
  if (tileX < 0 || tileY < 0 || tileX + 4 > WORLD_TILES || tileY + 2 > WORLD_TILES) return { ok: false, message: 'Keep the paddock inside the map' };
  production.plan = { ...plan, tileX, tileY };
  return { ok: true, message: 'Paddock footprint moved; existing structures stay in place. Keep grassland free for a future garden.' };
}

export function startOpeningWork(state: GameState): CommandResult {
  if (!state.onboarding.completedMilestoneIds.includes('weather-fog')) return { ok: false, message: 'Weather the first fog before this lesson' };
  const view = paddockView(state);
  if (!view.creature || !view.housing || !view.canReserve || view.away) return { ok: false, message: view.status };
  if (view.working) return { ok: false, message: 'Your Tuftle is already working' };
  const before = structuredClone(view.creature);
  const housed = assignCreatureHousing(state, view.creature.id, view.housing.id);
  if (!housed.ok) return housed;
  const result = setCreatureRole(state, view.creature.id, 'work');
  if (!result.ok) Object.assign(view.creature, before);
  return result;
}
export function collectOpeningOutput(state: GameState): CommandResult {
  const view = paddockView(state);
  if (!view.housing || !view.inReach) return { ok: false, message: 'Walk near the Pen to collect its output' };
  return collectHousingBin(state, view.housing.id, 'fiber');
}
export function followOpeningCompanion(state: GameState): CommandResult {
  const id = state.onboarding.companionId;
  return id ? setCreatureRole(state, id, 'follow') : { ok: false, message: 'No opening Tuftle found' };
}
