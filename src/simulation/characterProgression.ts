import { INVENTORY_SLOTS } from '../config/balance';
import { PLAYER_SPEED_PX_PER_S } from '../config/platform';
import { creatureDefinition } from '../content/creatures';
import type { AttributeId, GameState, PlayerState } from './state';

export const ATTRIBUTE_IDS: readonly AttributeId[] = [
  'vitality', 'strength', 'endurance', 'agility',
  'dexterity', 'defense', 'capacity', 'handling',
];

export const ATTRIBUTE_LABELS: Readonly<Record<AttributeId, string>> = {
  vitality: 'Vitality', strength: 'Strength', endurance: 'Endurance', agility: 'Agility',
  dexterity: 'Dexterity', defense: 'Defense', capacity: 'Capacity', handling: 'Handling',
};

export const ATTRIBUTE_DESCRIPTIONS: Readonly<Record<AttributeId, string>> = {
  vitality: '+10 max HP. Every 3 points also adds +1 HP recovery per second.',
  strength: '+2 attack power and +1 gathering damage.',
  endurance: '+10 max stamina and +1 stamina recovery per second.',
  agility: '+2% movement speed and +2% flee chance (up to +30% and +20%).',
  dexterity: 'Actions are 3% faster and critical chance increases by 2.5% (up to 40% faster and 25% critical chance).',
  defense: '+1 defense, reducing damage taken from attacks.',
  capacity: '+2 inventory slots.',
  handling: '+2.5% taming chance (up to +25%).',
};

export interface XpResult { levelsGained: number; pointsGained: number }

export function xpToNextLevel(level: number): number {
  return 100 + (Math.max(1, level) - 1) * 50;
}

export function maxHpFor(player: PlayerState): number {
  return 100 + (player.level - 1) * 5 + player.attributes.vitality * 10;
}

export function maxStaminaFor(player: PlayerState): number {
  return 100 + (player.level - 1) * 3 + player.attributes.endurance * 10;
}

export function attackPower(state: GameState): number { return 10 + state.player.attributes.strength * 2; }
export function defensePower(state: GameState): number { return 1 + state.player.attributes.defense; }
export function gatheringPowerBonus(state: GameState): number { return state.player.attributes.strength; }
export function movementSpeed(state: GameState): number {
  const travelMultiplier = state.ownedCreatures.reduce((strongest, creature) => {
    if (creature.role !== 'follow') return strongest;
    return Math.max(strongest, creatureDefinition(creature.speciesId).travelSpeedMultiplier);
  }, 1);
  return PLAYER_SPEED_PX_PER_S
    * (1 + Math.min(0.3, state.player.attributes.agility * 0.02))
    * travelMultiplier;
}
export function actionCooldown(state: GameState, ticks: number): number {
  const multiplier = Math.max(0.6, 1 - state.player.attributes.dexterity * 0.03);
  return Math.max(1, Math.round(ticks * multiplier));
}
export function inventoryCapacity(state: GameState): number {
  return INVENTORY_SLOTS + state.player.attributes.capacity * 2;
}
export function criticalChanceBps(state: GameState): number {
  return Math.min(2500, state.player.attributes.dexterity * 250);
}
export function fleeChanceBonusBps(state: GameState): number {
  return Math.min(2000, state.player.attributes.agility * 200);
}
export function tamingChanceBonusBps(state: GameState): number {
  return Math.min(2500, state.player.attributes.handling * 250);
}

export function grantXp(state: GameState, amount: number): XpResult {
  if (!Number.isInteger(amount) || amount <= 0) return { levelsGained: 0, pointsGained: 0 };
  state.player.xp += amount;
  let levelsGained = 0;
  while (state.player.xp >= xpToNextLevel(state.player.level)) {
    state.player.xp -= xpToNextLevel(state.player.level);
    state.player.level += 1;
    state.player.attributePoints += 1;
    levelsGained += 1;
  }
  if (levelsGained > 0) {
    const oldMaxHp = state.player.maxHp;
    const oldMaxStamina = state.player.maxStamina;
    state.player.maxHp = maxHpFor(state.player);
    state.player.maxStamina = maxStaminaFor(state.player);
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + state.player.maxHp - oldMaxHp);
    state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + state.player.maxStamina - oldMaxStamina);
  }
  return { levelsGained, pointsGained: levelsGained };
}

export function spendAttributePoint(state: GameState, attribute: AttributeId): boolean {
  if (!ATTRIBUTE_IDS.includes(attribute) || state.player.attributePoints <= 0) return false;
  const oldMaxHp = state.player.maxHp;
  const oldMaxStamina = state.player.maxStamina;
  state.player.attributePoints -= 1;
  state.player.attributes[attribute] += 1;
  state.player.maxHp = maxHpFor(state.player);
  state.player.maxStamina = maxStaminaFor(state.player);
  state.player.hp = Math.min(state.player.maxHp, state.player.hp + state.player.maxHp - oldMaxHp);
  state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + state.player.maxStamina - oldMaxStamina);
  return true;
}

/** Once-per-second recovery. Returns whether durable state changed. */
export function recoverPlayer(state: GameState): boolean {
  if (state.tick % 60 !== 0) return false;
  let changed = false;
  if (!state.activeEncounter && state.player.hp < state.player.maxHp) {
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + 1 + Math.floor(state.player.attributes.vitality / 3));
    changed = true;
  }
  if (state.player.stamina < state.player.maxStamina) {
    state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + 3 + state.player.attributes.endurance);
    changed = true;
  }
  if (state.player.mana < state.player.maxMana) {
    state.player.mana = Math.min(state.player.maxMana, state.player.mana + 2);
    changed = true;
  }
  return changed;
}
