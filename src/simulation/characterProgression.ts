import { BAG_WEIGHT_SCALE, gameToolDefinition, INVENTORY_SLOTS, TICKS_PER_SECOND } from '../config/balance';
import { creatureDefinition } from '../content/creatures';
import { TOOL_POWER_PER_RANK } from '../content/economy';
import { PACK_RANK_CAPACITY_HUNDREDTHS } from '../content/npcStock';
import type { AttributeId, GameBalanceState, GameState } from './state';
import { isBagOverburdened, isBagOverweight } from './bagWeight';
import { OVERBURDENED_SPEED_PX_PER_S } from '../config/platform';
import { queueLevelBlueprints } from './blueprintGrants';

export const ATTRIBUTE_IDS: readonly AttributeId[] = [
  'strength', 'dexterity', 'magic', 'luck', 'speed',
  'health', 'healthRegen', 'stamina', 'staminaRegen', 'carryWeight', 'mana', 'manaRegen',
];

export const ATTRIBUTE_LABELS: Readonly<Record<AttributeId, string>> = {
  strength: 'Strength', dexterity: 'Dexterity', magic: 'Magic', luck: 'Luck', speed: 'Speed',
  health: 'Health', healthRegen: 'Health Regeneration',
  stamina: 'Stamina', staminaRegen: 'Stamina Regeneration',
  carryWeight: 'Carry Weight',
  mana: 'Mana', manaRegen: 'Mana Regeneration',
};

export const ATTRIBUTE_DESCRIPTIONS: Readonly<Record<AttributeId, string>> = {
  strength: 'Increases melee damage. Increases damage per hit to resources.',
  dexterity: 'Increases ranged damage.',
  magic: 'Increases magic damage.',
  luck: 'Increases hit chance, dodge chance, and taming success. Increases chance at a 2x resource drop.',
  speed: 'Increases distance traveled in battle and player movement speed.',
  health: 'Increases max health.',
  healthRegen: 'Increases the health recovered every second.',
  stamina: 'Increases max stamina.',
  staminaRegen: 'Increases the stamina recovered every second.',
  carryWeight: 'Increases how much weight the bag can hold.',
  mana: 'Increases max mana.',
  manaRegen: 'Increases the mana recovered every second.',
};

export type AttributeGainKey = keyof GameBalanceState['attributeGains'];

/**
 * How many persisted units make up one unit the player is shown. Saved state
 * has to stay whole-numbered, so a knob that wants decimals is stored in
 * hundredths and divided on the way out — the one place that conversion lives.
 */
export const ATTRIBUTE_GAIN_SCALE = 100;

/**
 * Every per-point value, in the order the Admin panel lists them and grouped by
 * the attribute that grants it. One table so the editor, its validation
 * messages, and this module can never drift apart about which knobs exist.
 *
 * `scale` is how many stored units make one shown unit. A field at
 * ATTRIBUTE_GAIN_SCALE is edited and displayed as a decimal; one at 1 is whole
 * because what it feeds — damage dealt, pixels moved, a maximum written into a
 * character — is itself whole.
 */
export const ATTRIBUTE_GAIN_FIELDS: readonly {
  attribute: AttributeId;
  key: AttributeGainKey;
  label: string;
  /** Defaults to 1: stored exactly as shown. */
  scale?: number;
}[] = [
  { attribute: 'strength', key: 'strengthMeleeDamage', label: 'Melee damage per point' },
  { attribute: 'strength', key: 'strengthGatherDamage', label: 'Resource damage per point' },
  { attribute: 'dexterity', key: 'dexterityRangedDamage', label: 'Ranged damage per point' },
  { attribute: 'magic', key: 'magicDamage', label: 'Magic damage per point' },
  { attribute: 'luck', key: 'luckHitChanceBps', label: 'Hit chance per point (bps)' },
  { attribute: 'luck', key: 'luckHitChanceMaxBps', label: 'Hit chance maximum (bps)' },
  { attribute: 'luck', key: 'luckDodgeChanceBps', label: 'Dodge chance per point (bps)' },
  { attribute: 'luck', key: 'luckDodgeChanceMaxBps', label: 'Dodge chance maximum (bps)' },
  { attribute: 'luck', key: 'luckTamingChanceBps', label: 'Taming success per point (bps)' },
  { attribute: 'luck', key: 'luckTamingChanceMaxBps', label: 'Taming success maximum (bps)' },
  { attribute: 'luck', key: 'luckDoubleDropChanceBps', label: 'Double drop per point (bps)' },
  { attribute: 'luck', key: 'luckDoubleDropChanceMaxBps', label: 'Double drop maximum (bps)' },
  { attribute: 'speed', key: 'speedWalkPxPerSecond', label: 'Walk speed per point (px/s)' },
  { attribute: 'speed', key: 'speedBattleTiles', label: 'Battle spaces per point' },
  { attribute: 'speed', key: 'speedBattleTilesMax', label: 'Battle spaces maximum' },
  { attribute: 'health', key: 'healthMaxHp', label: 'Max HP per point' },
  { attribute: 'healthRegen', key: 'healthRegenHundredths', label: 'HP per second, per point', scale: ATTRIBUTE_GAIN_SCALE },
  { attribute: 'stamina', key: 'staminaMaxStamina', label: 'Max stamina per point' },
  { attribute: 'staminaRegen', key: 'staminaRegenHundredths', label: 'SP per second, per point', scale: ATTRIBUTE_GAIN_SCALE },
  { attribute: 'carryWeight', key: 'carryWeightHundredths', label: 'Carry weight per point', scale: BAG_WEIGHT_SCALE },
  { attribute: 'mana', key: 'manaMaxMana', label: 'Max mana per point' },
  { attribute: 'manaRegen', key: 'manaRegenHundredths', label: 'MP per second, per point', scale: ATTRIBUTE_GAIN_SCALE },
];

/** Format a fixed-point knob the way the character sheet and Admin show it. */
export function formatScaledGain(value: number, scale = 1): string {
  return String(value / scale);
}

/**
 * What one point is worth, read from the published balance rather than written
 * out, so retuning `attributeGains` in Admin → Global Values can never leave the
 * character sheet promising a number the simulation no longer grants.
 */
export function attributePointDetail(balance: GameBalanceState, attribute: AttributeId): string {
  const gains = balance.attributeGains;
  const percent = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
  switch (attribute) {
    case 'strength':
      return `Each point adds ${gains.strengthMeleeDamage} melee damage`
        + ` and ${gains.strengthGatherDamage} damage per hit to resources.`;
    case 'dexterity':
      return `Each point adds ${gains.dexterityRangedDamage} ranged damage.`;
    case 'magic':
      return `Each point adds ${gains.magicDamage} magic damage.`;
    case 'luck':
      return `Each point adds ${percent(gains.luckHitChanceBps)} hit chance,`
        + ` ${percent(gains.luckDodgeChanceBps)} dodge chance,`
        + ` ${percent(gains.luckTamingChanceBps)} taming success, and`
        + ` ${percent(gains.luckDoubleDropChanceBps)} double-resource-drop chance, up to each bonus cap.`;
    case 'speed':
      return `Each point adds ${gains.speedWalkPxPerSecond} px/s movement speed and`
        + ` ${gains.speedBattleTiles} space of battle movement,`
        + ` up to ${gains.speedBattleTilesMax} bonus battle spaces.`;
    case 'health':
      return `Each point adds ${gains.healthMaxHp} maximum health.`;
    case 'healthRegen':
      return `Each point recovers ${formatScaledGain(gains.healthRegenHundredths, ATTRIBUTE_GAIN_SCALE)}`
        + ' more health per second.';
    case 'stamina':
      return `Each point adds ${gains.staminaMaxStamina} maximum stamina.`;
    case 'staminaRegen':
      return `Each point recovers ${formatScaledGain(gains.staminaRegenHundredths, ATTRIBUTE_GAIN_SCALE)}`
        + ' more stamina per second.';
    case 'carryWeight':
      return `Each point adds ${formatScaledGain(gains.carryWeightHundredths, BAG_WEIGHT_SCALE)} carry weight.`;
    case 'mana':
      return `Each point adds ${gains.manaMaxMana} maximum mana.`;
    case 'manaRegen':
      return `Each point recovers ${formatScaledGain(gains.manaRegenHundredths, ATTRIBUTE_GAIN_SCALE)}`
        + ' more mana per second.';
  }
}

export interface XpResult { levelsGained: number; pointsGained: number }

export function xpToNextLevel(level: number): number {
  return 100 + (Math.max(1, level) - 1) * 50;
}

/**
 * What the attributes add to a weapon, per style.
 *
 * The world's damage model is "the tool is the base, the attribute is the
 * bonus": a Bow set to 10 deals 10 plus Dexterity's per-point Global Value for
 * every point in it. These three are that bonus, and they are the only place it
 * is computed — the overworld swing (`attributeStrikeBonus`), the arrow
 * (`playerShotDamage`), and the character sheet all read them, so a retuned
 * per-point value moves the promise and the hit together.
 */
export function meleeDamageBonus(state: GameState): number {
  return state.player.attributes.strength * state.gameBalance.attributeGains.strengthMeleeDamage;
}
export function rangedDamageBonus(state: GameState): number {
  return state.player.attributes.dexterity * state.gameBalance.attributeGains.dexterityRangedDamage;
}
export function magicDamageBonus(state: GameState): number {
  return state.player.attributes.magic * state.gameBalance.attributeGains.magicDamage;
}

export function attackPower(state: GameState, style: 'melee' | 'ranged' | 'magic' = 'melee'): number {
  const gains = state.gameBalance.attributeGains;
  const attribute = style === 'melee' ? 'strength' : style === 'ranged' ? 'dexterity' : 'magic';
  const perPoint = style === 'melee'
    ? gains.strengthMeleeDamage
    : style === 'ranged' ? gains.dexterityRangedDamage : gains.magicDamage;
  const base = 10 + state.player.attributes[attribute] * perPoint;
  return style === 'magic' ? base + magicStaffPowerBonus(state) : base;
}

/** Extra spell power granted by a usable Magic Staff currently in hand. */
export function magicStaffPowerBonus(state: GameState): number {
  const staff = state.tools.find((tool) => tool.instanceId === state.equippedToolId);
  if (!staff || staff.definitionId !== 'magic-staff' || staff.durability <= 0) return 0;
  const definition = gameToolDefinition(state, staff.definitionId);
  return (definition.baseDamageByTarget.raider ?? definition.damage) + staff.powerRank * TOOL_POWER_PER_RANK;
}
/**
 * Recovery per second in hundredths of a point — the authoritative form, since
 * a rate the player reads as 0.25 has to stay a whole number in state.
 */
export function healthRegenerationHundredths(state: GameState): number {
  return state.gameBalance.characterDefaults.hpRegenBaseHundredths
    + state.player.attributes.healthRegen * state.gameBalance.attributeGains.healthRegenHundredths;
}
export function staminaRegenerationHundredths(state: GameState): number {
  return state.gameBalance.characterDefaults.staminaRegenBaseHundredths
    + state.player.attributes.staminaRegen * state.gameBalance.attributeGains.staminaRegenHundredths;
}
export function manaRegenerationHundredths(state: GameState): number {
  return state.gameBalance.characterDefaults.manaRegenBaseHundredths
    + state.player.attributes.manaRegen * state.gameBalance.attributeGains.manaRegenHundredths;
}

/** The same rates as the player reads them: points per second, with decimals. */
export function healthRegeneration(state: GameState): number {
  return healthRegenerationHundredths(state) / ATTRIBUTE_GAIN_SCALE;
}
export function staminaRegeneration(state: GameState): number {
  return staminaRegenerationHundredths(state) / ATTRIBUTE_GAIN_SCALE;
}
export function manaRegeneration(state: GameState): number {
  return manaRegenerationHundredths(state) / ATTRIBUTE_GAIN_SCALE;
}

/**
 * Whole points a fractional rate grants on the pulse numbered `pulseIndex`.
 *
 * The accumulator is the pulse number itself rather than a remainder carried
 * in the save: vitals are whole numbers and so is every number in GameState,
 * and a stored remainder would be one more thing a migration could get wrong.
 * Reading the running total at both ends of the second means 0.25/s is exactly
 * one point on every fourth second, whenever the game was loaded.
 */
export function regenPulseAmount(ratePerSecondHundredths: number, pulseIndex: number): number {
  if (ratePerSecondHundredths <= 0 || pulseIndex < 0) return 0;
  const total = (elapsed: number): number => Math.floor(elapsed * ratePerSecondHundredths / ATTRIBUTE_GAIN_SCALE);
  return total(pulseIndex + 1) - total(pulseIndex);
}
export function defensePower(_state: GameState): number { return 1; }
export function gatheringPowerBonus(state: GameState): number {
  return state.player.attributes.strength * state.gameBalance.attributeGains.strengthGatherDamage;
}
export function movementSpeed(state: GameState, sprinting = false): number {
  // At double the bag limit nothing else matters: no attribute, follower or
  // sprint can lift the player above the crawl.
  if (isBagOverburdened(state)) return OVERBURDENED_SPEED_PX_PER_S;
  const travelMultiplier = state.ownedCreatures.reduce((strongest, creature) => {
    if (creature.role !== 'follow') return strongest;
    return Math.max(strongest, creatureDefinition(creature.speciesId).travelSpeedMultiplier);
  }, 1);
  return (state.gameBalance.characterDefaults.walkSpeed
    + state.player.attributes.speed * state.gameBalance.attributeGains.speedWalkPxPerSecond)
    * travelMultiplier
    * (isBagOverweight(state) ? 0.5 : 1)
    * (sprinting ? sprintSpeedMultiplier(state) : 1);
}

/** The published sprint multiplier, stored in tenths of the walking speed. */
export function sprintSpeedMultiplier(state: GameState): number {
  return state.gameBalance.characterDefaults.sprintSpeedTenths / 10;
}

/** Stamina charged for each full second held at a sprint. */
export function sprintStaminaPerSecond(state: GameState): number {
  return state.gameBalance.characterDefaults.sprintStaminaPerSecond;
}

/**
 * Sprinting needs stamina left to spend; the toggle stays on but the player
 * drops back to a walk the moment the bar empties, and resumes once one
 * second's worth has recovered.
 */
export function canSprint(state: GameState): boolean {
  return state.player.stamina >= sprintStaminaPerSecond(state);
}
export function actionCooldown(_state: GameState, ticks: number): number { return Math.max(1, Math.round(ticks)); }
export function inventoryCapacity(_state: GameState): number { return INVENTORY_SLOTS; }
export function hitChanceBonusBps(state: GameState): number {
  const gains = state.gameBalance.attributeGains;
  return Math.min(gains.luckHitChanceMaxBps, state.player.attributes.luck * gains.luckHitChanceBps);
}
export function dodgeChanceBps(state: GameState): number {
  const gains = state.gameBalance.attributeGains;
  return Math.min(gains.luckDodgeChanceMaxBps, state.player.attributes.luck * gains.luckDodgeChanceBps);
}
export function tamingChanceBonusBps(state: GameState): number {
  const gains = state.gameBalance.attributeGains;
  return Math.min(gains.luckTamingChanceMaxBps, state.player.attributes.luck * gains.luckTamingChanceBps);
}
export function doubleDropChanceBps(state: GameState): number {
  const gains = state.gameBalance.attributeGains;
  return Math.min(gains.luckDoubleDropChanceMaxBps, state.player.attributes.luck * gains.luckDoubleDropChanceBps);
}
export function battleMoveDistance(state: GameState, baseDistance: number): number {
  const gains = state.gameBalance.attributeGains;
  return baseDistance + Math.min(gains.speedBattleTilesMax, state.player.attributes.speed * gains.speedBattleTiles);
}

export function grantXp(state: GameState, amount: number): XpResult {
  if (!Number.isInteger(amount) || amount <= 0) return { levelsGained: 0, pointsGained: 0 };
  state.player.xp += amount;
  let levelsGained = 0;
  let pointsGained = 0;
  while (state.player.xp >= xpToNextLevel(state.player.level)) {
    state.player.xp -= xpToNextLevel(state.player.level);
    state.player.level += 1;
    for (const attribute of ATTRIBUTE_IDS) {
      increaseAttributeBy(state, attribute, state.gameBalance.levelUp.attributePointsPerStat);
    }
    state.player.attributePoints += state.gameBalance.levelUp.spendableAttributePoints;
    pointsGained += state.gameBalance.levelUp.spendableAttributePoints;
    state.coins += state.gameBalance.levelUp.coins;
    // Earned, not yet known: the player collects these from the banner, which
    // is where the `????` in the Blueprints tab turns into a name.
    queueLevelBlueprints(state, state.player.level);
    levelsGained += 1;
  }
  return { levelsGained, pointsGained };
}

export function spendAttributePoint(state: GameState, attribute: AttributeId): boolean {
  return spendAttributePoints(state, { [attribute]: 1 });
}

/**
 * Commit a staged character-sheet allocation as one transaction. Every value
 * is validated before player state changes, so Apply can never spend only part
 * of a draft when one of its rows is invalid.
 */
export function spendAttributePoints(
  state: GameState,
  allocation: Readonly<Partial<Record<AttributeId, number>>>,
): boolean {
  let total = 0;
  for (const attribute of ATTRIBUTE_IDS) {
    const amount = allocation[attribute] ?? 0;
    if (!Number.isSafeInteger(amount) || amount < 0) return false;
    if (!canIncreaseAttributeBy(state, attribute, amount)) return false;
    total += amount;
    if (!Number.isSafeInteger(total)) return false;
  }
  if (total <= 0 || total > state.player.attributePoints) return false;

  state.player.attributePoints -= total;
  for (const attribute of ATTRIBUTE_IDS) {
    increaseAttributeBy(state, attribute, allocation[attribute] ?? 0);
  }
  return true;
}

/** Guards both the attribute and any derived maximum against numeric overflow. */
export function canIncreaseAttribute(state: GameState, attribute: AttributeId): boolean {
  return canIncreaseAttributeBy(state, attribute, 1);
}

function canIncreaseAttributeBy(state: GameState, attribute: AttributeId, amount: number): boolean {
  if (!ATTRIBUTE_IDS.includes(attribute) || !Number.isSafeInteger(amount) || amount < 0) return false;
  if (!Number.isSafeInteger(state.player.attributes[attribute] + amount)) return false;
  const gains = state.gameBalance.attributeGains;
  if (attribute === 'health') return Number.isSafeInteger(state.player.maxHp + amount * gains.healthMaxHp);
  if (attribute === 'stamina') return Number.isSafeInteger(state.player.maxStamina + amount * gains.staminaMaxStamina);
  if (attribute === 'mana') return Number.isSafeInteger(state.player.maxMana + amount * gains.manaMaxMana);
  if (attribute === 'carryWeight') {
    const attributeCapacity = (state.player.attributes.carryWeight + amount) * gains.carryWeightHundredths;
    const packCapacity = (state.packRanks ?? 0) * PACK_RANK_CAPACITY_HUNDREDTHS;
    return Number.isSafeInteger(attributeCapacity)
      && Number.isSafeInteger(packCapacity)
      && Number.isSafeInteger(state.gameBalance.bagWeight.capacityHundredths + packCapacity + attributeCapacity);
  }
  return true;
}

/** Apply one validated point regardless of whether it came from leveling or a town trainer. */
export function increaseAttribute(state: GameState, attribute: AttributeId): void {
  increaseAttributeBy(state, attribute, 1);
}

/** Apply a level-up batch while preserving the refill granted by max-stat gains. */
function increaseAttributeBy(state: GameState, attribute: AttributeId, amount: number): void {
  if (amount === 0) return;
  const oldMaxHp = state.player.maxHp;
  const oldMaxStamina = state.player.maxStamina;
  const oldMaxMana = state.player.maxMana;
  const gains = state.gameBalance.attributeGains;
  state.player.attributes[attribute] += amount;
  if (attribute === 'health') state.player.maxHp += amount * gains.healthMaxHp;
  if (attribute === 'stamina') state.player.maxStamina += amount * gains.staminaMaxStamina;
  if (attribute === 'mana') state.player.maxMana += amount * gains.manaMaxMana;
  state.player.hp = Math.min(state.player.maxHp, state.player.hp + state.player.maxHp - oldMaxHp);
  state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + state.player.maxStamina - oldMaxStamina);
  state.player.mana = Math.min(state.player.maxMana, state.player.mana + state.player.maxMana - oldMaxMana);
}

/**
 * Once-per-second recovery. Returns whether durable state changed. Stamina is
 * the one vital a sprint suspends — walking or standing still recharges it as
 * usual, which is what makes sprinting a choice rather than a default.
 */
export function recoverPlayer(state: GameState, sprinting = false): boolean {
  if (state.tick % TICKS_PER_SECOND !== 0 || state.activeEncounter) return false;
  return applyPlayerRegen(state, sprinting);
}

/**
 * Apply one deterministic recovery pulse. Battle calls this at turn start and
 * passes the round as the pulse, since a turn — not a second — is the unit a
 * fractional rate accrues against once the world is paused behind an encounter.
 */
export function applyPlayerRegen(
  state: GameState,
  sprinting = false,
  pulseIndex = Math.floor(state.tick / TICKS_PER_SECOND),
): boolean {
  let changed = false;
  const recover = (current: number, max: number, rateHundredths: number): number => (
    Math.min(max, current + regenPulseAmount(rateHundredths, pulseIndex))
  );
  const hp = recover(state.player.hp, state.player.maxHp, healthRegenerationHundredths(state));
  const stamina = sprinting
    ? state.player.stamina
    : recover(state.player.stamina, state.player.maxStamina, staminaRegenerationHundredths(state));
  const mana = recover(state.player.mana, state.player.maxMana, manaRegenerationHundredths(state));
  if (hp !== state.player.hp) { state.player.hp = hp; changed = true; }
  if (stamina !== state.player.stamina) { state.player.stamina = stamina; changed = true; }
  if (mana !== state.player.mana) { state.player.mana = mana; changed = true; }
  return changed;
}
