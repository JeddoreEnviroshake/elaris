import { buildableById } from '../content/buildingParts';
import { isResourceClearOfRoad } from '../content/roads';
import { isTownFootprintTile } from '../content/townBuildings';
import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { starterGroveAnchor } from './worldGeneration';
import { terrainAt, terrainAtWithBuildings, terrainCapabilities } from './landscape';
import { cellKey, environments, enclosureGaps, type EnvironmentInfo } from './environmentProgress';
import { airPurifierProtectedCells, isPlayerSheltered } from './survivalCycle';
import { effectiveBoundaryEdge, effectiveBuildingDimensions } from './buildingGeometry';
import { batchCost, type BuildRequest } from './batchBuilding';
import { tryAddResource, addGroundDrop, type CommandResult } from './gameplayCommands';
import type { BuildingState, GameState, ResourceId } from './state';
import { completeOpeningMilestone } from './onboardingProgress';

export interface ShelterSite { areaKey: string; tileX: number; tileY: number }
export const SHELTER_SUPPLIES = { fiber: 16, wood: 4, stone: 2 } as const;
export const SHELTER_STAGE_LABELS = ['Floors', 'North wall', 'South wall', 'West wall', 'East wall', 'Door', 'Air Purifier', 'Storage Box'] as const;

export function shelterLayout(site: ShelterSite): BuildRequest[][] {
  const { tileX: x, tileY: y } = site;
  const floors: BuildRequest[] = [];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 4; dx++) floors.push({ definitionId: 'thatch-floor', tileX: x + dx, tileY: y + dy });
  const wall = (dx: number, dy: number, boundaryEdge: NonNullable<BuildRequest['boundaryEdge']>): BuildRequest => ({ definitionId: 'thatch-wall', tileX: x + dx, tileY: y + dy, boundaryEdge });
  return [floors, [0, 1, 2, 3].map((dx) => wall(dx, 0, 'north')),
    [0, 2, 3].map((dx) => wall(dx, 1, 'south')), [0, 1].map((dy) => wall(0, dy, 'west')),
    [0, 1].map((dy) => wall(3, dy, 'east')), [{ definitionId: 'thatch-door', tileX: x + 1, tileY: y + 1, boundaryEdge: 'south' }],
    [{ definitionId: 'air-purifier', tileX: x, tileY: y }], [{ definitionId: 'field-cache', tileX: x + 3, tileY: y }]];
}

export const shelterMaterialBudget = () => batchCost(shelterLayout({ areaKey: '0,0', tileX: 0, tileY: 0 }).flat());

/** A dry clearing connected to the starter grove. Never clears or moves existing player property. */
export function findShelterSite(state: GameState): ShelterSite | null {
  if (state.currentArea.key !== '0,0') return null;
  const grove = starterGroveAnchor(state.seed);
  const start = { tileX: Math.floor(grove.x / TILE_SIZE), tileY: Math.floor(grove.y / TILE_SIZE) };
  const queue = [start]; const seen = new Set<string>([cellKey(start.tileX, start.tileY)]);
  for (let index = 0; index < queue.length && index < 2000; index++) {
    const point = queue[index]!;
    if (Math.abs(point.tileX - start.tileX) + Math.abs(point.tileY - start.tileY) >= 3 && clearSite(state, point.tileX, point.tileY)) return { areaKey: '0,0', ...point };
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const x = point.tileX + dx!; const y = point.tileY + dy!; const key = cellKey(x, y);
      if (seen.has(key) || Math.abs(x - start.tileX) > 16 || Math.abs(y - start.tileY) > 16 || x < 1 || y < 1 || x >= WORLD_TILES - 5 || y >= WORLD_TILES - 3) continue;
      seen.add(key);
      if (!terrainCapabilities(terrainAt(state.seed, state.currentArea, x, y)).walkable || isTownFootprintTile(x, y)) continue;
      queue.push({ tileX: x, tileY: y });
    }
  }
  return null;
}

export function clearSite(state: GameState, left: number, top: number): boolean {
  for (let y = top - 1; y <= top + 2; y++) for (let x = left - 1; x <= left + 4; x++) {
    if (x < 0 || y < 0 || x >= WORLD_TILES || y >= WORLD_TILES || !terrainCapabilities(terrainAt(state.seed, state.currentArea, x, y)).buildable || isTownFootprintTile(x, y)) return false;
    if (state.resourceNodes.some((node) => node.hp > 0 && Math.floor(node.x / TILE_SIZE) === x && Math.floor(node.y / TILE_SIZE) === y)) return false;
    if (state.containers.some((container) => !container.opened && Math.floor(container.x / TILE_SIZE) === x && Math.floor(container.y / TILE_SIZE) === y)) return false;
    if (state.buildings.some((building) => {
      const dimensions = effectiveBuildingDimensions(building);
      return x >= building.tileX && x < building.tileX + dimensions.tilesWide && y >= building.tileY && y < building.tileY + dimensions.tilesHigh;
    })) return false;
  }
  return true;
}

function inside(room: EnvironmentInfo, building: BuildingState): boolean {
  const size = effectiveBuildingDimensions(building);
  for (let dy = 0; dy < size.tilesHigh; dy++) for (let dx = 0; dx < size.tilesWide; dx++) if (!room.cells.has(cellKey(building.tileX + dx, building.tileY + dy))) return false;
  return true;
}

function usableDoor(state: GameState, room: EnvironmentInfo): boolean {
  return state.buildings.some((building) => {
    if (buildableById(building.definitionId).boundaryClass !== 'door') return false;
    const edge = effectiveBoundaryEdge(building);
    const x = building.tileX; const y = building.tileY;
    const a = { x, y }; const b = { x: x + (edge === 'east' ? 1 : edge === 'west' ? -1 : 0), y: y + (edge === 'south' ? 1 : edge === 'north' ? -1 : 0) };
    if (room.cells.has(cellKey(a.x, a.y)) === room.cells.has(cellKey(b.x, b.y))) return false;
    const outside = room.cells.has(cellKey(a.x, a.y)) ? b : a;
    const insideCell = room.cells.has(cellKey(a.x, a.y)) ? a : b;
    const covers = (other: BuildingState, point: { x: number; y: number }) => {
      const size = effectiveBuildingDimensions(other);
      return point.x >= other.tileX && point.x < other.tileX + size.tilesWide && point.y >= other.tileY && point.y < other.tileY + size.tilesHigh;
    };
    return terrainCapabilities(terrainAtWithBuildings(state.seed, state.currentArea, state.buildings, outside.x, outside.y)).walkable
      && !isTownFootprintTile(outside.x, outside.y, state.currentArea.key)
      && !state.buildings.some((other) => buildableById(other.definitionId).layer === 'footprint' && (covers(other, outside) || covers(other, insideCell)));
  });
}

export function shelterChecklist(state: GameState) {
  const rooms = environments(state.buildings).filter((room) => room.kind === 'indoor');
  const protectedCells = airPurifierProtectedCells(state.buildings);
  const views = rooms.map((room) => {
    const floor = room.area >= 8;
    const enclosed = room.valid && room.enclosed && room.tier >= 8;
    const entrance = usableDoor(state, room);
    const purifier = state.buildings.some((building) => building.definitionId === 'air-purifier' && inside(room, building));
    const storage = state.buildings.some((building) => (building.definitionId === 'field-cache' || building.definitionId === 'warehouse') && inside(room, building));
    const breathable = enclosed && purifier && [...room.cells].every((cell) => protectedCells.has(cell));
    return { room, floor, enclosed, entrance, purifier, storage, breathable, ready: floor && enclosed && entrance && storage && breathable,
      score: Number(floor) + Number(enclosed) + Number(entrance) + Number(purifier) + Number(storage) + Number(breathable) };
  }).sort((a, b) => Number(b.ready) - Number(a.ready) || b.score - a.score || b.room.area - a.room.area);
  const best = views[0];
  const gaps = best ? enclosureGaps(state.buildings).filter((gap) => best.room.cells.has(cellKey(gap.tileX, gap.tileY))) : [];
  return { area: best?.room.area ?? 0, floor: best?.floor ?? false, enclosed: best?.enclosed ?? false, entrance: best?.entrance ?? false,
    purifier: best?.purifier ?? false, storage: best?.storage ?? false, breathable: best?.breathable ?? false, ready: best?.ready ?? false,
    gaps, protectedHere: isPlayerSheltered(state), room: best?.room ?? null };
}

export function reconcileOpeningShelter(state: GameState): boolean {
  const chapter = state.onboarding;
  if (chapter.status !== 'active' || !chapter.completedMilestoneIds.includes('gather-together')) return false;
  let changed = false;
  if (!chapter.shelterPlan && state.currentArea.key === '0,0') {
    chapter.shelterPlan = findShelterSite(state);
    changed = chapter.shelterPlan !== null;
  }
  // A one-time authored patch supplements the existing grove, without renewing harvested nodes.
  if (chapter.shelterPlan && state.currentArea.key === chapter.shelterPlan.areaKey && !chapter.issuedRewardIds.includes('shelter-grove')) {
    const site = chapter.shelterPlan;
    let planted = 0;
    for (let radius = 2; radius <= 6 && planted < 4; radius++) for (let dy = -radius; dy <= radius && planted < 4; dy++) for (let dx = -radius; dx <= radius && planted < 4; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const x = site.tileX + dx; const y = site.tileY + dy;
      if (x >= site.tileX - 1 && x <= site.tileX + 4 && y >= site.tileY - 1 && y <= site.tileY + 2) continue;
      if (!clearSite(state, x, y)) continue;
      if (!isResourceClearOfRoad(state.currentArea.key, { kind: 'plant', x: (x + .5) * TILE_SIZE, y: (y + .5) * TILE_SIZE })) continue;
      const hp = state.gameBalance.objects.plant.maxHp;
      state.resourceNodes.push({ id: `shelter-plant-${state.seed}-${planted}`, kind: 'plant', x: (x + .5) * TILE_SIZE, y: (y + .5) * TILE_SIZE, hp, maxHp: hp, respawnAtTick: null });
      planted++;
    }
    chapter.issuedRewardIds.push('shelter-grove');
    changed = true;
  }
  const checklist = shelterChecklist(state);
  if (!chapter.completedMilestoneIds.includes('build-shelter') && checklist.ready && checklist.room) {
    const [x, y] = [...checklist.room.cells][0]!.split(',').map(Number);
    chapter.shelterHome = { areaKey: state.currentArea.key, tileX: x!, tileY: y! };
    completeOpeningMilestone(state, 'build-shelter');
    changed = true;
  }
  return changed;
}

export function moveShelterPlan(state: GameState, dx: number, dy: number): CommandResult {
  const plan = state.onboarding.shelterPlan;
  if (!plan || plan.areaKey !== state.currentArea.key || !Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1) return { ok: false, message: 'Return to your suggested shelter site first' };
  const x = plan.tileX + dx; const y = plan.tileY + dy;
  if (x < 0 || y < 0 || x + 4 > WORLD_TILES || y + 2 > WORLD_TILES) return { ok: false, message: 'The shelter must stay inside the map' };
  state.onboarding.shelterPlan = { ...plan, tileX: x, tileY: y };
  return { ok: true, message: 'Suggested footprint moved; existing buildings stay where you placed them' };
}

export function claimShelterSupplies(state: GameState): CommandResult {
  const chapter = state.onboarding;
  if (chapter.status !== 'active' || !chapter.completedMilestoneIds.includes('gather-together') || chapter.issuedRewardIds.includes('shelter-supplies')) return { ok: false, message: 'The building supply bundle has already been collected or is not available yet' };
  for (const [id, amount] of Object.entries(SHELTER_SUPPLIES)) if (!tryAddResource(state, id as ResourceId, amount)) addGroundDrop(state, id as ResourceId, amount, state.player.x, state.player.y);
  chapter.issuedRewardIds.push('shelter-supplies');
  return { ok: true, message: 'Building supplies: 16 fiber, 4 wood, 2 stone. Overflow waits on the ground beside you.' };
}
