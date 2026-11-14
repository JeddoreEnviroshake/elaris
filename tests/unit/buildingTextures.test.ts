import { describe, expect, it } from 'vitest';
import {
  buildingTextureKey,
  ENCLOSURE_GUIDE_WIDTH,
  markerTextureKey,
  WALL_VISUAL_THICKNESS,
} from '../../src/art/buildingTextures';
import { TextureKeys } from '../../src/art/textureKeys';
import type { BuildingState, FurnaceQueueItem } from '../../src/simulation/state';

const building = (definitionId: BuildingState['definitionId'], extra: Partial<BuildingState> = {}): BuildingState => ({
  id: 'fixture', definitionId, tileX: 1, tileY: 1, ...extra,
});

const queueItem = (extra: Partial<FurnaceQueueItem> = {}): FurnaceQueueItem => ({
  recipe: 'iron-ingot', remainingWorkMs: 100, reservedInputs: { 'iron-ore': 2, wood: 1 },
  completedOutput: 0, blocked: false, ...extra,
});

describe('state-readable building textures', () => {
  it('keeps wall art exactly three times thicker than the enclosure guide', () => {
    expect(ENCLOSURE_GUIDE_WIDTH).toBe(2);
    expect(WALL_VISUAL_THICKNESS).toBe(ENCLOSURE_GUIDE_WIDTH * 3);
  });

  it('distinguishes empty and filled caches', () => {
    expect(buildingTextureKey(building('field-cache', { storage: { wood: 0, stone: 0, fiber: 0 } }))).toBe(TextureKeys.FieldCache);
    expect(buildingTextureKey(building('field-cache', { storage: { wood: 1, stone: 0, fiber: 0 } }))).toBe(TextureKeys.FieldCacheFull);
  });

  it('prioritizes blocked, ready, active, and idle furnace states', () => {
    expect(buildingTextureKey(building('furnace', { furnace: { queue: [] } }))).toBe(TextureKeys.Furnace);
    expect(buildingTextureKey(building('furnace', { furnace: { queue: [queueItem()] } }))).toBe(TextureKeys.FurnaceActive);
    expect(buildingTextureKey(building('furnace', { furnace: { queue: [queueItem({ completedOutput: 1, remainingWorkMs: 0 })] } }))).toBe(TextureKeys.FurnaceReady);
    expect(buildingTextureKey(building('furnace', { furnace: { queue: [queueItem({ blocked: true })] } }))).toBe(TextureKeys.FurnaceBlocked);
  });

  it('shows growing and harvest-ready renewable facilities', () => {
    expect(buildingTextureKey(building('garden-bed', { garden: { progressTicks: 1, readyFiber: 0, nextGrowthTick: 2 } }))).toBe(TextureKeys.GardenBedGrowing);
    expect(buildingTextureKey(building('garden-bed', { garden: { progressTicks: 1, readyFiber: 2, nextGrowthTick: 2 } }))).toBe(TextureKeys.GardenBedReady);
    expect(buildingTextureKey(building('woodlot-planter', { woodlot: { progressTicks: 1, readyWood: 0, nextGrowthTick: 2 } }))).toBe(TextureKeys.PlanterGrowing);
    expect(buildingTextureKey(building('woodlot-planter', { woodlot: { progressTicks: 1, readyWood: 2, nextGrowthTick: 2 } }))).toBe(TextureKeys.PlanterReady);
  });

  it('uses a distinct marker silhouette for each legacy environment kind', () => {
    expect(markerTextureKey('indoor')).toBe(TextureKeys.Marker);
    expect(markerTextureKey('paddock')).toBe(TextureKeys.MarkerPaddock);
    expect(markerTextureKey('workYard')).toBe(TextureKeys.MarkerWorkYard);
  });

  it('keeps every stable texture key unique', () => {
    const keys = Object.values(TextureKeys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
