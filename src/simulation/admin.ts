import {
  ARCANE_STORM_MAX_PLAYER_DAMAGE, AREA_THEME_IDS,
  BAG_ITEM_IDS, RESOURCE_NODE_KINDS, STRIKE_TARGETS, STRUCTURE_FACILITY_IDS,
  TOOL_DEFINITIONS, WALL_MATERIAL_IDS, leveledCreatureDefinition, leveledRaiderDefinition,
} from '../config/balance';
import { WORLD_PX } from '../config/platform';
import { CREATURE_DEFINITIONS } from '../content/creatures';
import { DANGER_THREAT_IDS, DANGER_THREAT_NAMES } from '../content/dangerThreats';
import { TOOL_DURABILITY_BPS_PER_RANK } from '../content/economy';
import { RAIDER_KIND_IDS, raiderDefinition } from '../content/raiders';
import { ELARIS_CAMERA_PITCH_TENTHS_RANGE, ELARIS_CAMERA_YAW_TENTHS_RANGE } from '../three/cameraControls';
import { ATTRIBUTE_GAIN_FIELDS, ATTRIBUTE_LABELS } from './characterProgression';
import { structureMaxHp } from './gameplayCommands';
import { isBlueprintItemId } from './blueprintKnowledge';
import type { GameBalanceState, GameState, InventoryState, PlayerState, WildCreatureState } from './state';

export interface AdminDraft {
  player: PlayerState;
  inventory: InventoryState;
  coins: number;
  unlockedItemIds: string[];
  gameBalance: GameBalanceState;
}

export interface AdminUpdateResult { ok: boolean; message: string }

export function createAdminDraft(state: GameState): AdminDraft {
  return structuredClone({
    player: state.player,
    inventory: state.inventory,
    coins: state.coins,
    unlockedItemIds: state.unlockedItemIds,
    gameBalance: state.gameBalance,
  });
}

/** Validate first, then commit the entire staged Admin update atomically. */
export function applyAdminUpdate(state: GameState, draft: AdminDraft): AdminUpdateResult {
  const error = validateAdminDraft(draft);
  if (error) return { ok: false, message: error };

  commitLocalAdminUpdate(state, draft);
  commitGameBalance(state, draft.gameBalance);
  return { ok: true, message: 'Admin update pushed to the game and save' };
}

export function applyLocalAdminUpdate(state: GameState, draft: AdminDraft): AdminUpdateResult {
  const error = validateLocalAdminDraft(draft);
  if (error) return { ok: false, message: error };
  commitLocalAdminUpdate(state, draft);
  return { ok: true, message: 'Local values pushed to this character and save' };
}

export function applyGameBalance(state: GameState, balance: GameBalanceState): AdminUpdateResult {
  const error = validateGameBalance(balance);
  if (error) return { ok: false, message: error };
  commitGameBalance(state, balance);
  return { ok: true, message: 'Global values applied to this game' };
}

function commitLocalAdminUpdate(state: GameState, draft: AdminDraft): void {

  state.player = structuredClone(draft.player);
  state.inventory = structuredClone(draft.inventory);
  state.coins = draft.coins;
  state.unlockedItemIds = [...new Set(draft.unlockedItemIds)].sort();
}

function commitGameBalance(state: GameState, balance: GameBalanceState): void {
  state.gameBalance = structuredClone(balance);

  // Existing instances adopt the updated definition durability while keeping
  // their current damage (clamped if the new maximum is lower).
  for (const tool of state.tools) {
    const base = state.gameBalance.tools[tool.definitionId].maxDurability;
    const nextMax = Math.floor(base * (10_000 + tool.durabilityRank * TOOL_DURABILITY_BPS_PER_RANK) / 10_000);
    tool.maxDurability = nextMax;
    tool.durability = Math.min(tool.durability, nextMax);
  }

  reconcileResourceNodes(state.resourceNodes, state.gameBalance);
  for (const area of Object.values(state.visitedAreas)) reconcileResourceNodes(area.resourceNodes, state.gameBalance);

  reconcileStructures(state.buildings, state.gameBalance);
  for (const area of Object.values(state.visitedAreas)) reconcileStructures(area.buildings, state.gameBalance);

  // Raiders mid-raid adopt the new profile, keeping the damage already dealt to
  // them so retuning during a danger minute never heals the wave to full.
  for (const raider of state.raiders) {
    // Through the levelled definition, so retuning a kind's base health moves
    // a level 4 of it by four levels' worth rather than dropping it to base.
    const nextMax = leveledRaiderDefinition(state, raider).maxHp;
    const damageTaken = Math.max(0, raider.maxHp - raider.hp);
    raider.maxHp = nextMax;
    raider.hp = Math.max(1, nextMax - damageTaken);
  }

  // Wild creatures follow the same rule. Their health has lived in the world
  // since creatures became real-time inhabitants, so an edit that did not reach
  // them would leave the map full of animals contradicting their own species.
  for (const creature of state.wildCreatures) reconcileCreature(state, creature);
  for (const area of Object.values(state.visitedAreas)) {
    for (const creature of area.wildCreatures) reconcileCreature(state, creature);
  }
}

function reconcileCreature(state: GameState, creature: WildCreatureState): void {
  const nextMax = leveledCreatureDefinition(state, creature).encounter.maxHp;
  const damageTaken = Math.max(0, creature.maxHp - creature.hp);
  creature.maxHp = nextMax;
  creature.hp = Math.max(1, nextMax - damageTaken);
}

/** Structures keep the damage they have taken while adopting a new health pool. */
function reconcileStructures(buildings: GameState['buildings'], balance: GameBalanceState): void {
  for (const building of buildings) {
    if (building.hp === undefined) continue;
    const nextMax = structureMaxHp(building, balance);
    if (nextMax === null) continue;
    building.hp = Math.max(1, Math.min(building.hp, nextMax));
  }
}

function reconcileResourceNodes(nodes: GameState['resourceNodes'], balance: GameBalanceState): void {
  for (const node of nodes) {
    const nextMax = balance.objects[node.kind].maxHp;
    const damageTaken = Math.max(0, node.maxHp - node.hp);
    node.maxHp = nextMax;
    if (node.hp > 0) node.hp = Math.max(1, nextMax - damageTaken);
  }
}

export function validateAdminDraft(draft: AdminDraft): string | null {
  return validateLocalAdminDraft(draft) ?? validateGameBalance(draft.gameBalance);
}

export function validateLocalAdminDraft(draft: AdminDraft): string | null {
  const { player } = draft;
  if (!finiteInRange(player.x, 0, WORLD_PX) || !finiteInRange(player.y, 0, WORLD_PX)) return `Position must be between 0 and ${WORLD_PX}`;
  if (!['up', 'down', 'left', 'right'].includes(player.facing)) return 'Facing is invalid';
  for (const [label, value] of [
    ['Max HP', player.maxHp], ['Max stamina', player.maxStamina], ['Max mana', player.maxMana], ['Level', player.level],
  ] as const) if (!positiveInteger(value)) return `${label} must be a positive whole number`;
  for (const [label, value] of [
    ['HP', player.hp], ['Stamina', player.stamina], ['Mana', player.mana], ['XP', player.xp], ['Attribute points', player.attributePoints],
    ...Object.entries(player.attributes), ...Object.entries(draft.inventory),
    ['Coins', draft.coins],
  ] as Array<[string, number]>) if (!nonNegativeInteger(value)) return `${label} must be a non-negative whole number`;
  if (player.hp > player.maxHp) return 'HP cannot exceed Max HP';
  if (player.stamina > player.maxStamina) return 'Stamina cannot exceed Max stamina';
  if (player.mana > player.maxMana) return 'Mana cannot exceed Max mana';
  if (new Set(draft.unlockedItemIds).size !== draft.unlockedItemIds.length
    || draft.unlockedItemIds.some((id) => !isBlueprintItemId(id))) return 'Blueprint selection is invalid';

  return null;
}

export function validateGameBalance(balance: GameBalanceState): string | null {
  const defaults = balance.characterDefaults;
  for (const [label, value] of [
    ['Starting HP', defaults.startingHp],
    ['Starting stamina', defaults.startingStamina],
    ['Starting mana', defaults.startingMana],
    ['Walk Speed', defaults.walkSpeed],
    ['Sprint Speed', defaults.sprintSpeedTenths],
  ] as const) if (!positiveInteger(value)) return `${label} must be a positive whole number`;
  if (!nonNegativeInteger(defaults.sprintStaminaPerSecond)) return 'Sprint SP per second must be a non-negative whole number';
  if (!nonNegativeInteger(defaults.startingAttributePoints)) return 'Starting Attribute Points must be a non-negative whole number';
  const gains = balance.attributeGains;
  if (!gains) return 'Per-attribute-point values are missing';
  for (const field of ATTRIBUTE_GAIN_FIELDS) {
    // A scaled field is edited as a decimal and stored multiplied, so what it
    // has to be is a non-negative multiple of its smallest step — not a whole
    // number of the thing the player is shown.
    if (!nonNegativeInteger(gains[field.key])) {
      return field.scale && field.scale > 1
        ? `${ATTRIBUTE_LABELS[field.attribute]} · ${field.label} must be a non-negative number with at most`
          + ` ${String(field.scale).length - 1} decimal places`
        : `${ATTRIBUTE_LABELS[field.attribute]} · ${field.label} must be a non-negative whole number`;
    }
  }
  for (const [label, perPoint, max] of [
    ['Hit chance', gains.luckHitChanceBps, gains.luckHitChanceMaxBps],
    ['Dodge chance', gains.luckDodgeChanceBps, gains.luckDodgeChanceMaxBps],
    ['Taming success', gains.luckTamingChanceBps, gains.luckTamingChanceMaxBps],
    ['Double-drop chance', gains.luckDoubleDropChanceBps, gains.luckDoubleDropChanceMaxBps],
  ] as const) {
    if (max > 10_000) return `${label} maximum must be at most 10000 basis points`;
    if (perPoint > max) return `${label} per point cannot exceed its maximum`;
  }
  if (gains.speedBattleTiles > gains.speedBattleTilesMax) {
    return 'Battle movement per point cannot exceed its maximum';
  }
  if (!balance.levelUp) return 'On level up values are missing';
  if (!nonNegativeInteger(balance.levelUp.attributePointsPerStat)) return 'Points added to every attribute must be a non-negative whole number';
  if (!nonNegativeInteger(balance.levelUp.spendableAttributePoints)) return 'Spendable Attribute Points must be a non-negative whole number';
  if (!nonNegativeInteger(balance.levelUp.coins)) return 'Gold must be a non-negative whole number';
  for (const [label, value] of [
    ['HP regen', defaults.hpRegenBaseHundredths],
    ['SP regen', defaults.staminaRegenBaseHundredths],
    ['MP regen', defaults.manaRegenBaseHundredths],
  ] as const) if (!nonNegativeInteger(value)) return `${label} must be a non-negative number with at most 2 decimal places`;
  const bagWeight = balance.bagWeight;
  if (!bagWeight || !positiveInteger(bagWeight.capacityHundredths)) return 'Weight Limit must be positive';
  if (!bagWeight.itemHundredths) return 'Bag item weights are missing';
  for (const item of BAG_ITEM_IDS) {
    if (!nonNegativeInteger(bagWeight.itemHundredths[item])) return `${item} weight must be non-negative`;
  }
  const camera = balance.camera;
  if (!camera) return 'Camera angle values are missing';
  for (const [label, value, range] of [
    ['Side angle', camera.yawTenths, ELARIS_CAMERA_YAW_TENTHS_RANGE],
    ['Overhead angle', camera.pitchTenths, ELARIS_CAMERA_PITCH_TENTHS_RANGE],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < range.min || value > range.max) {
      return `${label} must be a whole number of tenths of a degree from ${range.min} to ${range.max}`;
    }
  }
  if (!positiveInteger(balance.hands.actionTicks)) return 'Bare Hands action ticks must be positive';
  if (!positiveInteger(balance.hands.rangePx)) return 'Bare Hands range must be a positive whole number of pixels';
  for (const kind of RESOURCE_NODE_KINDS) {
    if (!nonNegativeInteger(balance.hands.damageByTarget[kind])) return `Bare Hands ${kind} damage must be non-negative`;
    const object = balance.objects[kind];
    if (!object) return `${kind} object values are missing`;
    if (!positiveInteger(object.maxHp)) return `${kind} Max HP must be positive`;
    if (!nonNegativeInteger(object.yieldMin) || !nonNegativeInteger(object.yieldMax) || object.yieldMin > object.yieldMax) {
      return `${kind} yield range is invalid`;
    }
    if (!nonNegativeInteger(object.yieldAmount)) return `${kind} worker yield must be non-negative`;
    if (!['wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot'].includes(object.resource)) return `${kind} resource drop is invalid`;
    if (!nonNegativeInteger(object.respawnTicks)) return `${kind} respawn ticks must be non-negative`;
    if (!positiveInteger(object.hardness)) return `${kind} hardness must be positive`;
    if (!nonNegativeInteger(object.berryYield)) return `${kind} berry yield must be non-negative`;
    const tier = object.minimumToolTier;
    if (!nonNegativeInteger(tier) || tier > 3) return `${kind} minimum tier must be from 0 to 3`;
  }
  const raid = balance.raid;
  for (const [label, value] of [
    ['Safe phase seconds', raid.safePhaseSeconds],
    ['Wave base size', raid.waveBaseSize],
    ['Wave max size', raid.waveMaxSize],
  ] as const) if (!positiveInteger(value)) return `${label} must be a positive whole number`;
  if (!raid.dangerPhaseSecondsByThreat) return 'Danger phase seconds are missing';
  for (const threat of DANGER_THREAT_IDS) {
    if (!positiveInteger(raid.dangerPhaseSecondsByThreat[threat])) {
      return `${DANGER_THREAT_NAMES[threat]} danger phase seconds must be a positive whole number`;
    }
  }
  for (const [label, value] of [
    ['Raider spawn delay', raid.spawnDelaySeconds],
    ['Grace seconds', raid.graceSeconds],
    ['Exposure damage', raid.exposureDamagePerSecond],
    ['Exposure ramp', raid.exposureRampPerSecond],
    ['Maximum exposure damage', raid.exposureMaxDamagePerSecond],
    ['Wave growth per cycle', raid.waveGrowthTenths],
    ['Wave growth per rating', raid.waveRatingTenths],
  ] as const) if (!nonNegativeInteger(value)) return `${label} must be a non-negative whole number`;
  // Only the raid night spawns raiders, so its own length is what the warning
  // window has to fit inside — a short fog night can no longer forbid a long one.
  if (raid.spawnDelaySeconds >= raid.dangerPhaseSecondsByThreat.raid) {
    return `Raider spawn delay must be shorter than the ${DANGER_THREAT_NAMES.raid} danger phase`;
  }
  if (raid.waveBaseSize > raid.waveMaxSize) return 'Wave base size cannot exceed the maximum wave size';
  if (raid.exposureDamagePerSecond > raid.exposureMaxDamagePerSecond) {
    return 'Exposure damage cannot start above its maximum';
  }
  if (!['purifier-first', 'purifier-last', 'nearest', 'player-first'].includes(raid.targetPriority)) return 'Raider target priority is invalid';

  const storm = balance.storm;
  if (!storm) return `${DANGER_THREAT_NAMES.storm} values are missing`;
  for (const [label, value] of [
    ['First impact seconds', storm.firstImpactSeconds],
    ['Impact interval seconds', storm.intervalSeconds],
    ['Telegraph seconds', storm.telegraphSeconds],
    ['Impact radius', storm.impactRadiusTiles],
    ['Reward every N strikes', storm.rewardEveryStrikes],
  ] as const) if (!positiveInteger(value)) return `${label} must be a positive whole number`;
  for (const [label, value] of [
    ['Impact damage', storm.playerDamage],
    ['Reward iron ore', storm.rewardIronOre],
  ] as const) if (!nonNegativeInteger(value)) return `${label} must be a non-negative whole number`;
  // A marker the player cannot see coming is not a dodge test, and one that is
  // still telegraphing when the next appears stops reading as a countdown.
  if (storm.telegraphSeconds >= storm.firstImpactSeconds) {
    return 'Telegraph seconds must be shorter than the first impact';
  }
  if (storm.telegraphSeconds >= storm.intervalSeconds) {
    return 'Telegraph seconds must be shorter than the impact interval';
  }
  // Every impact has to land inside the phase that owns it: a strike scheduled
  // past the boundary would either never resolve or resolve into the next event.
  if (storm.firstImpactSeconds >= raid.dangerPhaseSecondsByThreat.storm) {
    return `First impact must land before the ${DANGER_THREAT_NAMES.storm} danger phase ends`;
  }
  if (storm.playerDamage > ARCANE_STORM_MAX_PLAYER_DAMAGE) {
    return `Impact damage must be at most ${ARCANE_STORM_MAX_PLAYER_DAMAGE}`;
  }

  for (const kindId of RAIDER_KIND_IDS) {
    const name = raiderDefinition(kindId).displayName;
    const raider = balance.raiders[kindId];
    if (!raider) return `${name} values are missing`;
    for (const [label, value] of [
      ['Max HP', raider.maxHp], ['Speed', raider.speedPxPerTick], ['Attack cooldown', raider.attackCooldownTicks],
    ] as const) if (!positiveInteger(value)) return `${name} ${label} must be a positive whole number`;
    for (const [label, value] of [
      ['damage', raider.damage], ['wall damage percent', raider.wallDamagePercent], ['unlock cycle', raider.unlockCycle],
      // Zero is meaningful on both: a kind that never gives chase, and a kind
      // whose levels are cosmetic.
      ['aggro range', raider.aggroRangePx], ['Level Multiplier', raider.levelMultiplierBps],
    ] as const) if (!nonNegativeInteger(value)) return `${name} ${label} must be a non-negative whole number`;
  }

  const defense = balance.defense;
  for (const [label, value] of [
    ['Turret cooldown', defense.turretCooldownTicks],
    ['Turret range', defense.turretRangeTiles],
    ['Turret ammo capacity', defense.turretAmmoCapacity],
    ['Bow cooldown', defense.playerShotCooldownTicks],
    ['Roamer leash', defense.roamerLeashTiles],
    ['Roamer respawn ticks', defense.roamerRespawnTicks],
  ] as const) if (!positiveInteger(value)) return `${label} must be a positive whole number`;
  for (const [label, value] of [
    ['Turret damage', defense.turretDamage],
    ['Turret absent-round shots', defense.turretAbsentRoundShots],
    ['Bow damage', defense.playerShotDamage],
    ['Roamers per area', defense.roamersPerArea],
  ] as const) if (!nonNegativeInteger(value)) return `${label} must be a non-negative whole number`;

  for (const material of WALL_MATERIAL_IDS) {
    if (!positiveInteger(balance.structures.wallHp[material])) return `${material} wall HP must be positive`;
  }
  for (const id of STRUCTURE_FACILITY_IDS) {
    if (!positiveInteger(balance.structures.facilityHp[id])) return `${id} HP must be positive`;
  }

  for (const definition of CREATURE_DEFINITIONS) {
    const creature = balance.creatures[definition.speciesId];
    if (!creature) return `${definition.displayName} values are missing`;
    for (const [label, value] of [
      ['Max HP', creature.maxHp], ['Move speed', creature.moveSpeed], ['Attack range', creature.attackRange],
      ['World speed', creature.speedPxPerTick], ['World attack range', creature.attackRangePx],
      ['Attack interval', creature.attackIntervalTicks], ['Leash', creature.leashPx],
    ] as const) if (!positiveInteger(value)) return `${definition.displayName} ${label} must be a positive whole number`;
    for (const [label, value] of [
      ['attack power', creature.attackPower], ['defense', creature.defense],
      // Zero is meaningful on all three: no unprovoked aggression, no kiting,
      // and levels that carry no stat change.
      ['aggro range', creature.aggroRangePx], ['preferred range', creature.preferredRangePx],
      ['Level Multiplier', creature.levelMultiplierBps],
    ] as const) if (!nonNegativeInteger(value)) return `${definition.displayName} ${label} must be a non-negative whole number`;
    for (const [label, value] of [
      ['tame ease', creature.tameEaseBps], ['dodge chance', creature.dodgeBps],
    ] as const) {
      if (!nonNegativeInteger(value) || value > 10_000) return `${definition.displayName} ${label} must be from 0 to 10000 basis points`;
    }
  }

  const blueprints = balance.blueprints;
  if (!blueprints) return 'Blueprint find values are missing';
  if (!blueprints.nodeTargets) return 'Blueprint node targets are missing';
  for (const kind of RESOURCE_NODE_KINDS) {
    // Zero is meaningful: it switches that source off, which is the only way to
    // stop a counter paying. Negative is not.
    if (!nonNegativeInteger(blueprints.nodeTargets[kind])) return `${kind} per blueprint must be a non-negative whole number`;
  }
  for (const [label, value] of [
    ['Raiders per blueprint', blueprints.raiderTarget],
    ['Creature defeats per blueprint', blueprints.creatureTarget],
    ['Caches per storm', blueprints.stormCachesPerStorm],
    ['Blueprint fog multiplier', blueprints.fogRareMultiplierBps],
  ] as const) if (!nonNegativeInteger(value)) return `${label} must be a non-negative whole number`;
  for (const [label, value] of [
    ['Blueprint jitter', blueprints.jitterBps],
    ['Rare share maximum', blueprints.rareShareMaxBps],
    ['Odds a cache holds a blueprint', blueprints.stormCacheBlueprintBps],
  ] as const) {
    if (!nonNegativeInteger(value) || value > 10_000) return `${label} must be from 0 to 10000 basis points`;
  }
  if (!blueprints.rareShareBpsByTheme) return 'Blueprint rare shares are missing';
  for (const theme of AREA_THEME_IDS) {
    const share = blueprints.rareShareBpsByTheme[theme];
    if (!nonNegativeInteger(share) || share > 10_000) return `${theme} rare share must be from 0 to 10000 basis points`;
  }
  if (!blueprints.raiderTierWeights || !blueprints.stormCacheTierWeights) return 'Blueprint tier weights are missing';
  for (const [label, value] of [
    ['Raider Common', blueprints.raiderTierWeights.common],
    ['Raider Rare', blueprints.raiderTierWeights.rare],
    ['Raider Epic', blueprints.raiderTierWeights.epic],
    ['Arcane cache Rare', blueprints.stormCacheTierWeights.rare],
    ['Arcane cache Epic', blueprints.stormCacheTierWeights.epic],
    ['Arcane cache Legendary', blueprints.stormCacheTierWeights.legendary],
  ] as const) if (!nonNegativeInteger(value)) return `${label} weight must be a non-negative whole number`;
  // Every weight at zero would leave the roll with no tier to land in, so the
  // source would silently stop producing while its counter kept resetting.
  const raiderWeightTotal = blueprints.raiderTierWeights.common
    + blueprints.raiderTierWeights.rare + blueprints.raiderTierWeights.epic;
  if (raiderWeightTotal <= 0) return 'Raider tier weights cannot all be zero';
  const cacheWeightTotal = blueprints.stormCacheTierWeights.rare
    + blueprints.stormCacheTierWeights.epic + blueprints.stormCacheTierWeights.legendary;
  if (cacheWeightTotal <= 0) return 'Arcane cache tier weights cannot all be zero';

  const world = balance.world;
  for (const [label, value] of [
    ['Tiles per level band', world.levelBandTiles],
    ['Maximum enemy level', world.maxEnemyLevel],
  ] as const) if (!positiveInteger(value)) return `${label} must be a positive whole number`;
  for (const [label, value] of [
    ['Levels per area ring', world.levelsPerAreaRing],
    ['Creatures per area', world.creaturesPerArea],
  ] as const) if (!nonNegativeInteger(value)) return `${label} must be a non-negative whole number`;

  for (const definition of TOOL_DEFINITIONS) {
    const tool = balance.tools[definition.definitionId];
    if (!positiveInteger(tool.maxDurability)) return `${definition.displayName} durability must be positive`;
    if (!positiveInteger(tool.actionTicks)) return `${definition.displayName} action ticks must be positive`;
    if (!positiveInteger(tool.rangePx)) return `${definition.displayName} range must be a positive whole number of pixels`;
    if (!nonNegativeInteger(tool.wearPerHit)) return `${definition.displayName} wear must be non-negative`;
    for (const [resource, amount] of Object.entries(tool.craftCost)) {
      if (!nonNegativeInteger(amount)) return `${definition.displayName} ${resource} cost must be non-negative`;
    }
    for (const target of STRIKE_TARGETS) {
      if (!nonNegativeInteger(tool.damageByTarget[target])) return `${definition.displayName} ${target} damage must be non-negative`;
      if (!nonNegativeInteger(tool.wearMultiplierByTarget[target])) return `${definition.displayName} ${target} wear multiplier must be non-negative`;
      if (tool.damageByTarget[target] > 0 && tool.wearMultiplierByTarget[target] <= 0) {
        return `${definition.displayName} needs a positive ${target} wear multiplier when that target is enabled`;
      }
    }
  }
  return null;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return nonNegativeInteger(value) && value > 0;
}

function finiteInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}
