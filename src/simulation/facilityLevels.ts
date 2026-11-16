import { BAG_ITEM_LABELS } from '../config/balance';
import { buildableById, type ResourceAmounts } from '../content/buildingParts';
import {
  FACILITY_HP_BONUS_PCT_PER_LEVEL, FACILITY_LEVEL_COSTS, FURNACE_QUEUE_BY_LEVEL, FURNACE_WORK_PCT_BY_LEVEL,
  MAX_FACILITY_LEVEL, PURIFIER_RADIUS_BY_LEVEL, STORAGE_SLOTS_BY_LEVEL, TURRET_COOLDOWN_PCT_BY_LEVEL,
  TURRET_DAMAGE_PCT_BY_LEVEL, TURRET_RANGE_BONUS_TILES_BY_LEVEL, WAR_TABLE_MISSIONS_BY_LEVEL,
  WORKBENCH_MAX_TEMPER_RANK_BY_LEVEL, isLeveledFacilityId,
} from '../content/facilityLevels';
import { buildingCenterPx } from './buildingGeometry';
import { BUILD_RANGE_PX } from './gameplayCommands';
import type { BuildingState, GameState, ResourceId } from './state';

/**
 * Facility levels: the one place every level effect is derived. Callers ask
 * here (slots, queue, purifier radius, turret numbers, temper rank, HP) rather
 * than reading a level and applying a table themselves.
 *
 * `BuildingState.level` is optional and absent means level 1, the same
 * convention `hp` uses, so a building placed before levels existed needs no
 * rewrite and an unlevelled facility costs nothing to persist.
 */

/** 1..MAX_FACILITY_LEVEL. Anything unexpected in a save reads as level 1. */
export function facilityLevel(building: Pick<BuildingState, 'level'>): number {
  const level = building.level;
  if (!Number.isSafeInteger(level)) return 1;
  return Math.max(1, Math.min(MAX_FACILITY_LEVEL, level!));
}

function byLevel<T>(table: readonly [T, T, T], building: Pick<BuildingState, 'level'>): T {
  return table[facilityLevel(building) - 1]!;
}

/** Floor of `value * pct / 100`, the integer rule for every percentage here. */
function percentOf(value: number, pct: number): number {
  return Math.floor((value * pct) / 100);
}

/** Base max HP plus 50% of it for every level past the first. */
export function leveledMaxHp(baseMaxHp: number, building: Pick<BuildingState, 'level'>): number {
  return baseMaxHp + percentOf(baseMaxHp, FACILITY_HP_BONUS_PCT_PER_LEVEL * (facilityLevel(building) - 1));
}

export function storageSlotsForLevel(building: Pick<BuildingState, 'definitionId' | 'level'>): number {
  const table = building.definitionId === 'warehouse' ? STORAGE_SLOTS_BY_LEVEL.warehouse : STORAGE_SLOTS_BY_LEVEL['field-cache'];
  return byLevel(table, building);
}

export function furnaceQueueCapacity(furnace: Pick<BuildingState, 'level'>): number {
  return byLevel(FURNACE_QUEUE_BY_LEVEL, furnace);
}

/** Work time for one smelt at this furnace, in whole milliseconds, never below 1. */
export function furnaceWorkMs(furnace: Pick<BuildingState, 'level'>, baseMs: number): number {
  return Math.max(1, percentOf(baseMs, byLevel(FURNACE_WORK_PCT_BY_LEVEL, furnace)));
}

export function purifierRadiusTiles(purifier: Pick<BuildingState, 'level'>): number {
  return byLevel(PURIFIER_RADIUS_BY_LEVEL, purifier);
}

export interface TurretStats {
  readonly damage: number;
  readonly rangeTiles: number;
  readonly cooldownTicks: number;
}

/** A turret's live numbers: the shared defence balance, adjusted for its level. */
export function turretStats(
  turret: Pick<BuildingState, 'level'>,
  defense: { turretDamage: number; turretRangeTiles: number; turretCooldownTicks: number },
): TurretStats {
  return {
    damage: percentOf(defense.turretDamage, byLevel(TURRET_DAMAGE_PCT_BY_LEVEL, turret)),
    rangeTiles: defense.turretRangeTiles + byLevel(TURRET_RANGE_BONUS_TILES_BY_LEVEL, turret),
    cooldownTicks: Math.max(1, percentOf(defense.turretCooldownTicks, byLevel(TURRET_COOLDOWN_PCT_BY_LEVEL, turret))),
  };
}

export function workbenchMaxTemperRank(workbench: Pick<BuildingState, 'level'>): number {
  return byLevel(WORKBENCH_MAX_TEMPER_RANK_BY_LEVEL, workbench);
}

export function warTableMissionSlots(table: Pick<BuildingState, 'level'>): number {
  return byLevel(WAR_TABLE_MISSIONS_BY_LEVEL, table);
}

/** What the next level costs, or null at the top level or for a facility without levels. */
export function facilityUpgradeCost(building: Pick<BuildingState, 'definitionId' | 'level'>): ResourceAmounts | null {
  if (!isLeveledFacilityId(building.definitionId)) return null;
  const level = facilityLevel(building);
  if (level >= MAX_FACILITY_LEVEL) return null;
  return FACILITY_LEVEL_COSTS[building.definitionId][level - 1]!;
}

/** First thing missing from the bag, as "Need 3 more Clockwork", or null. */
export function missingForCost(state: GameState, cost: ResourceAmounts): string | null {
  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceId, number]>) {
    const short = amount - state.inventory[resource];
    if (short > 0) return `Need ${short} more ${BAG_ITEM_LABELS[resource]}`;
  }
  return null;
}

export function facilityUpgradeBlockedReason(state: GameState, building: BuildingState): string | null {
  if (!isLeveledFacilityId(building.definitionId)) return `${buildableById(building.definitionId).displayName} has no levels`;
  const cost = facilityUpgradeCost(building);
  if (!cost) return 'Already at the highest level';
  const center = buildingCenterPx(building);
  if (Math.hypot(center.x - state.player.x, center.y - state.player.y) > BUILD_RANGE_PX) return 'Too far away';
  return missingForCost(state, cost);
}

/**
 * Raise a facility one level: pays the cost, raises the level and clears any
 * damage so it stands at its new, larger full health.
 */
export function upgradeFacility(state: GameState, buildingId: string): { ok: boolean; message: string; targetId?: string } {
  const building = state.buildings.find((candidate) => candidate.id === buildingId);
  if (!building) return { ok: false, message: 'Building not found' };
  const blocked = facilityUpgradeBlockedReason(state, building);
  if (blocked) return { ok: false, message: blocked, targetId: building.id };
  const cost = facilityUpgradeCost(building)!;
  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceId, number]>) state.inventory[resource] -= amount;
  building.level = facilityLevel(building) + 1;
  delete building.hp;
  return {
    ok: true,
    message: `${buildableById(building.definitionId).displayName} upgraded to level ${building.level}`,
    targetId: building.id,
  };
}
