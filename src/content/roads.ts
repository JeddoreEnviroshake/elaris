import { WORLD_TILES, TILE_SIZE } from '../config/platform';
import { authoredWorldAreaByKey } from './world';
import { townBuildingsInArea } from './townBuildings';
import type { ResourceNodeKind } from '../simulation/state';

export interface RoadPoint { x: number; y: number }
export interface RoadSegment { start: RoadPoint; end: RoadPoint; width: number }
interface RoadLayout { segments: readonly RoadSegment[]; square: { x: number; y: number; radius: number } | null }
const layouts = new Map<string, RoadLayout>();

/** Shared by terrain, spawning, and rendering; coordinates are in world tiles. */
export function roadsForArea(areaKey: string): RoadLayout {
  const cached = layouts.get(areaKey); if (cached) return cached;
  const segments: RoadSegment[] = [];
  if (authoredWorldAreaByKey(areaKey)) segments.push({ start: { x: 0, y: 85 }, end: { x: WORLD_TILES, y: 85 }, width: 4 });
  if (areaKey === '0,0') segments.push(
    { start: { x: 62, y: 84 }, end: { x: 75, y: 84 }, width: 2.3 },
    { start: { x: 82, y: 84 }, end: { x: 82, y: 98 }, width: 2.15 },
    { start: { x: 82, y: 84 }, end: { x: 105, y: 87 }, width: 1.9 },
    { start: { x: 104.5, y: 66 }, end: { x: 104.5, y: 85 }, width: 2 },
  );
  for (const { door, footprint } of townBuildingsInArea(areaKey)) {
    const outwardX = door.tileX === footprint.tileX ? -1 : door.tileX === footprint.tileX + footprint.tilesWide - 1 ? 1 : 0;
    const outwardY = door.tileY === footprint.tileY ? -1 : door.tileY === footprint.tileY + footprint.tilesHigh - 1 ? 1 : 0;
    const start = { x: door.tileX + .8, y: door.tileY + .5 };
    segments.push({ start, end: { x: start.x + outwardX * 5.2, y: start.y + outwardY * 5.2 }, width: 1.75 });
  }
  const layout = { segments, square: areaKey === '0,0' ? { x: 82, y: 84, radius: 7.2 } : null };
  layouts.set(areaKey, layout); return layout;
}

export function isRoadPosition(areaKey: string, x: number, y: number, clearance = 0): boolean {
  const layout = roadsForArea(areaKey);
  if (layout.square && Math.hypot(x - layout.square.x, y - layout.square.y) <= layout.square.radius + clearance) return true;
  return layout.segments.some(({ start, end, width }) => {
    const dx = end.x - start.x; const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared)) : 0;
    return Math.hypot(x - start.x - dx * t, y - start.y - dy * t) <= width / 2 + clearance;
  });
}

export const isRoadTile = (areaKey: string, tileX: number, tileY: number) => isRoadPosition(areaKey, tileX + .5, tileY + .5);

/** Keep the visible canopy/boulder clear, not just the resource's center point. */
export function isResourceClearOfRoad(areaKey: string, node: { kind: ResourceNodeKind; x: number; y: number }): boolean {
  const radius = node.kind === 'tree' || node.kind === 'stone' || node.kind === 'metal' ? 2 : node.kind === 'berry-bush' ? .9 : .45;
  return !isRoadPosition(areaKey, node.x / TILE_SIZE, node.y / TILE_SIZE, radius);
}
