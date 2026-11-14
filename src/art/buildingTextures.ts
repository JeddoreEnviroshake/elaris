import type { BuildingState, EnvironmentKind } from '../simulation/state';
import { TextureKeys } from './textureKeys';

/** Shared pixel contract between enclosure diagnostics and wall silhouettes. */
export const ENCLOSURE_GUIDE_WIDTH = 2;
export const WALL_VISUAL_THICKNESS = ENCLOSURE_GUIDE_WIDTH * 3;

export function markerTextureKey(kind: EnvironmentKind): string {
  if (kind === 'paddock') return TextureKeys.MarkerPaddock;
  if (kind === 'workYard') return TextureKeys.MarkerWorkYard;
  return TextureKeys.Marker;
}

/** Select a state-readable texture without coupling presentation to commands. */
export function buildingTextureKey(building: BuildingState): string | null {
  if (building.definitionId === 'environment-marker') {
    return markerTextureKey(building.environmentKind ?? 'indoor');
  }
  if (building.definitionId === 'field-cache') {
    const stored = Object.values(building.storage ?? {}).reduce((sum, amount) => sum + (amount ?? 0), 0);
    return stored > 0 ? TextureKeys.FieldCacheFull : TextureKeys.FieldCache;
  }
  if (building.definitionId === 'furnace') {
    const queue = building.furnace?.queue ?? [];
    if (queue.some((item) => item.blocked)) return TextureKeys.FurnaceBlocked;
    if (queue.some((item) => item.completedOutput > 0)) return TextureKeys.FurnaceReady;
    if (queue.length > 0) return TextureKeys.FurnaceActive;
    return TextureKeys.Furnace;
  }
  if (building.definitionId === 'garden-bed') {
    if ((building.garden?.readyFiber ?? 0) > 0) return TextureKeys.GardenBedReady;
    if ((building.garden?.progressTicks ?? 0) > 0) return TextureKeys.GardenBedGrowing;
    return TextureKeys.GardenBed;
  }
  if (building.definitionId === 'turret') {
    // A dry turret is a hole in the defence, so it says so without a panel open.
    return (building.turret?.ammo ?? 0) > 0 ? TextureKeys.Turret : TextureKeys.TurretEmpty;
  }
  if (building.definitionId === 'woodlot-planter') {
    if ((building.woodlot?.readyWood ?? 0) > 0) return TextureKeys.PlanterReady;
    if ((building.woodlot?.progressTicks ?? 0) > 0) return TextureKeys.PlanterGrowing;
    return TextureKeys.Planter;
  }
  return null;
}
