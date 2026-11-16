import { STORAGE_BOX_SLOTS, WAREHOUSE_SLOTS } from '../config/balance';
import type { ResourceAmounts } from './buildingParts';
import type { BuildingDefinitionId } from '../simulation/state';

/**
 * Facility levels: what each level of each facility costs and does.
 *
 * Levels are paid for in salvage at your own base, which is the whole point of
 * going outside (see outlands-and-bases-plan.md, Phase 2). Every effect is a
 * whole-number table read by exactly one helper in simulation/facilityLevels,
 * so no caller re-derives a level's effect.
 */
export type LeveledFacilityId = 'workbench' | 'furnace' | 'field-cache' | 'warehouse' | 'air-purifier' | 'turret' | 'war-table';

export const LEVELED_FACILITY_IDS: readonly LeveledFacilityId[] = [
  'workbench', 'furnace', 'field-cache', 'warehouse', 'air-purifier', 'turret', 'war-table',
];

export const MAX_FACILITY_LEVEL = 3;

export function isLeveledFacilityId(id: BuildingDefinitionId | string): id is LeveledFacilityId {
  return (LEVELED_FACILITY_IDS as readonly string[]).includes(id);
}

/** Cost to reach level 2, then level 3. */
export const FACILITY_LEVEL_COSTS: Readonly<Record<LeveledFacilityId, readonly [ResourceAmounts, ResourceAmounts]>> = {
  workbench: [{ 'scrap-iron': 12, clockwork: 4 }, { clockwork: 8, lens: 4, 'construct-core': 1 }],
  furnace: [{ 'scrap-iron': 10, clockwork: 2 }, { clockwork: 6, 'construct-core': 1 }],
  'field-cache': [{ 'scrap-iron': 6 }, { clockwork: 4 }],
  warehouse: [{ 'scrap-iron': 16, clockwork: 4 }, { clockwork: 8, 'ancient-alloy': 2 }],
  'air-purifier': [{ 'scrap-iron': 8, lens: 2 }, { lens: 6, 'arcane-dust': 4, 'construct-core': 1 }],
  turret: [{ 'scrap-iron': 8, clockwork: 2 }, { clockwork: 4, lens: 2, 'construct-core': 1 }],
  'war-table': [{ 'scrap-iron': 6, lens: 2 }, { lens: 4, 'arcane-dust': 4 }],
};

/** One short line per level (index 0 is level 1), for the facility panel. */
export const FACILITY_LEVEL_EFFECTS: Readonly<Record<LeveledFacilityId, readonly [string, string, string]>> = {
  workbench: ['Tempers tools to rank 1', 'Tempers tools to rank 3', 'Tempers tools to rank 4'],
  furnace: ['Queue 4 · normal smelt time', 'Queue 6 · smelts 25% faster', 'Queue 8 · smelts 50% faster'],
  'field-cache': [`${STORAGE_BOX_SLOTS} slots`, '9 slots', '12 slots'],
  warehouse: [`${WAREHOUSE_SLOTS} slots`, '32 slots', '40 slots'],
  'air-purifier': ['Outdoor radius 1 tile', 'Outdoor radius 2 tiles', 'Outdoor radius 3 tiles'],
  turret: ['Normal damage', 'Damage +50%', 'Damage +50% · range +2 tiles · fires 25% faster'],
  'war-table': ['1 active mission', '2 active missions', '3 active missions'],
};

/** Every level past the first adds this share of the base maximum HP. */
export const FACILITY_HP_BONUS_PCT_PER_LEVEL = 50;

// Effect tables, indexed by level - 1.
export const STORAGE_SLOTS_BY_LEVEL: Readonly<Record<'field-cache' | 'warehouse', readonly [number, number, number]>> = {
  'field-cache': [STORAGE_BOX_SLOTS, 9, 12],
  warehouse: [WAREHOUSE_SLOTS, 32, 40],
};
export const FURNACE_QUEUE_BY_LEVEL: readonly [number, number, number] = [4, 6, 8];
/** Smelt work time as a percentage of the base recipe time. */
export const FURNACE_WORK_PCT_BY_LEVEL: readonly [number, number, number] = [100, 75, 50];
export const PURIFIER_RADIUS_BY_LEVEL: readonly [number, number, number] = [1, 2, 3];
export const TURRET_DAMAGE_PCT_BY_LEVEL: readonly [number, number, number] = [100, 150, 150];
export const TURRET_RANGE_BONUS_TILES_BY_LEVEL: readonly [number, number, number] = [0, 0, 2];
export const TURRET_COOLDOWN_PCT_BY_LEVEL: readonly [number, number, number] = [100, 100, 75];
/** The highest tool rank a Workbench of each level can temper to. */
export const WORKBENCH_MAX_TEMPER_RANK_BY_LEVEL: readonly [number, number, number] = [1, 3, 4];
/** Missions a War Table can hold active at once (used from Phase 3). */
export const WAR_TABLE_MISSIONS_BY_LEVEL: readonly [number, number, number] = [1, 2, 3];
