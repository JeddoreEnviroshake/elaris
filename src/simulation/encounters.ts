import { WORLD_PX } from '../config/platform';
import { MAX_CREATURE_ROSTER, creatureDefinition, type CombatStyle } from '../content/creatures';
import { nearestWildCreature, tryAddResource, type CommandResult } from './gameplayCommands';
import type { EncounterState, GameState, ResourceId, WildCreatureState } from './state';
import { attackPower, criticalChanceBps, defensePower, fleeChanceBonusBps, grantXp, tamingChanceBonusBps } from './characterProgression';

export type EncounterAction = CombatStyle | 'snare' | 'feed' | 'berry' | 'flee';

/** One resolved swing, structured so the battle screen can animate it. */
export interface StrikeOutcome {
  outcome: 'hit' | 'crit' | 'miss' | 'dodge';
  damage: number;
  style?: CombatStyle;
}

export interface EncounterCommandResult extends CommandResult {
  ended?: boolean;
  tamed?: boolean;
  /** The creature was defeated at 0 HP and its loot granted. */
  defeated?: boolean;
  playerDefeated?: boolean;
  fled?: boolean;
  playerStrike?: StrikeOutcome;
  creatureStrike?: StrikeOutcome;
  /** Capture meter progress gained by this action, in basis points. */
  captureGainBps?: number;
}

export const MELEE_STAMINA_COST = 8;
export const MAGIC_MANA_COST = 10;
export const CAPTURE_FULL_BPS = 10000;
const FEED_CAPTURE_GAIN_BPS = 1500;
const FLEE_CHANCE_BPS = 7500;
const FLEE_COOLDOWN_TICKS = 300;
/** Share of each carried resource dropped where you fell when defeated. */
const DEFEAT_DROP_PERCENT_BPS = 3000;

/** Per-style combat profile: reliability trades off against raw power. */
export const STYLE_PROFILES: Readonly<Record<CombatStyle, { label: string; hitBps: number; powerPercent: number }>> = {
  melee: { label: 'Melee', hitBps: 8500, powerPercent: 100 },
  ranged: { label: 'Ranged', hitBps: 9500, powerPercent: 90 },
  magic: { label: 'Magic', hitBps: 8000, powerPercent: 130 },
};

export function craftTamingSnare(state: GameState): CommandResult {
  if (state.inventory.wood < 1) return { ok: false, message: 'Need 1 more wood' };
  if (state.inventory.fiber < 2) return { ok: false, message: `Need ${2 - state.inventory.fiber} more fiber` };
  state.inventory.wood -= 1; state.inventory.fiber -= 2; state.consumables.tamingSnares += 1;
  grantXp(state, 10);
  return { ok: true, message: 'Crafted Taming Snare' };
}

export function craftArrows(state: GameState): CommandResult {
  if (state.inventory.wood < 1) return { ok: false, message: 'Need 1 more wood' };
  if (state.inventory.stone < 1) return { ok: false, message: 'Need 1 more stone' };
  state.inventory.wood -= 1; state.inventory.stone -= 1; state.consumables.arrows += 3;
  grantXp(state, 5);
  return { ok: true, message: 'Crafted 3 Arrows' };
}

export function startNearestEncounter(state: GameState): EncounterCommandResult {
  if (state.activeEncounter) return { ok: false, message: 'An encounter is already active' };
  const wild = nearestWildCreature(state);
  if (!wild) return { ok: false, message: 'Move closer to a wild creature' };
  if (wild.encounterCooldownUntilTick > state.tick) return { ok: false, message: 'This creature is keeping its distance' };
  const definition = creatureDefinition(wild.speciesId);
  state.activeEncounter = {
    wildCreatureId: wild.id,
    creatureHp: definition.encounter.maxHp,
    creatureMaxHp: definition.encounter.maxHp,
    round: 1,
    captureBps: 0,
    message: `A wild ${definition.displayName} approaches. Your turn.`,
  };
  return { ok: true, message: state.activeEncounter.message };
}

/** Null when the action is currently usable, otherwise the disabling reason. */
export function encounterAvailability(state: GameState, action: EncounterAction): string | null {
  const encounter = state.activeEncounter;
  if (!encounter) return 'No active encounter';
  if (action === 'melee' && state.player.stamina < MELEE_STAMINA_COST) return 'Not enough stamina';
  if (action === 'ranged' && state.consumables.arrows <= 0) return 'Craft arrows first';
  if (action === 'magic' && state.player.mana < MAGIC_MANA_COST) return 'Not enough mana';
  if (action === 'snare') {
    if (state.consumables.tamingSnares <= 0) return 'Craft a Taming Snare first';
    return captureBlockedReason(state);
  }
  if (action === 'feed') {
    if (state.consumables.berries <= 0) return 'No berries available';
    return captureBlockedReason(state);
  }
  if (action === 'berry') {
    if (state.consumables.berries <= 0) return 'No berries available';
    if (state.player.hp >= state.player.maxHp) return 'Health is already full';
  }
  return null;
}

function captureBlockedReason(state: GameState): string | null {
  const encounter = state.activeEncounter;
  const wild = encounter ? findWild(state, encounter) : undefined;
  if (!wild) return null;
  const definition = creatureDefinition(wild.speciesId);
  if (state.ownedCreatures.length >= MAX_CREATURE_ROSTER) return 'Creature roster is full';
  if (state.ownedCreatures.filter((owned) => owned.speciesId === wild.speciesId).length >= definition.rosterLimit) {
    return `${definition.displayName} is already in your roster`;
  }
  return null;
}

export function resolveEncounterAction(state: GameState, action: EncounterAction): EncounterCommandResult {
  const disabled = encounterAvailability(state, action);
  if (disabled) return { ok: false, message: disabled };
  const encounter = state.activeEncounter!;
  const wild = findWild(state, encounter);
  if (!wild) { state.activeEncounter = null; return { ok: false, ended: true, message: 'The creature is no longer here' }; }
  const definition = creatureDefinition(wild.speciesId);

  let playerMessage = '';
  let creatureCalmed = false;
  const result: EncounterCommandResult = { ok: true, message: '' };

  if (action === 'melee' || action === 'ranged' || action === 'magic') {
    payStyleCost(state, action);
    const strike = rollPlayerStrike(state, action, definition.encounter);
    result.playerStrike = strike;
    if (strike.outcome === 'miss') {
      playerMessage = `Your ${STYLE_PROFILES[action].label.toLowerCase()} attack misses.`;
    } else if (strike.outcome === 'dodge') {
      playerMessage = `${definition.displayName} dodges!`;
    } else {
      encounter.creatureHp = Math.max(0, encounter.creatureHp - strike.damage);
      playerMessage = `${STYLE_PROFILES[action].label} hits for ${strike.damage}${strike.outcome === 'crit' ? ' — critical!' : '.'}`;
      if (encounter.creatureHp === 0) return defeatCreature(state, wild, result, playerMessage);
      const gain = captureBlockedReason(state) === null
        ? addCapture(encounter, Math.floor(strike.damage * 4000 / encounter.creatureMaxHp))
        : 0;
      result.captureGainBps = gain;
      if (encounter.captureBps >= CAPTURE_FULL_BPS) return tame(state, wild, result, `${definition.displayName} is exhausted and gives in — captured!`);
    }
  } else if (action === 'snare') {
    state.consumables.tamingSnares -= 1;
    const hpPercentBps = Math.floor(encounter.creatureHp * 10000 / encounter.creatureMaxHp);
    const gain = addCapture(encounter, Math.floor(definition.encounter.tameEaseBps * (20000 - hpPercentBps) / 20000) + tamingChanceBonusBps(state));
    result.captureGainBps = gain;
    if (encounter.captureBps >= CAPTURE_FULL_BPS) return tame(state, wild, result, `The snare holds — ${definition.displayName} is captured!`);
    playerMessage = `The snare tightens (+${Math.round(gain / 100)}% capture).`;
  } else if (action === 'feed') {
    state.consumables.berries -= 1;
    const gain = addCapture(encounter, FEED_CAPTURE_GAIN_BPS);
    result.captureGainBps = gain;
    creatureCalmed = true;
    if (encounter.captureBps >= CAPTURE_FULL_BPS) return tame(state, wild, result, `${definition.displayName} trusts you — captured!`);
    playerMessage = `${definition.displayName} eats the berry and calms down (+${Math.round(gain / 100)}% capture).`;
  } else if (action === 'berry') {
    state.consumables.berries -= 1;
    const healed = Math.min(Math.floor(state.player.maxHp * 0.3), state.player.maxHp - state.player.hp);
    state.player.hp += healed;
    playerMessage = `Berry restores ${healed} HP.`;
  } else {
    if (rollBps(state) < FLEE_CHANCE_BPS + fleeChanceBonusBps(state)) {
      wild.encounterCooldownUntilTick = state.tick + FLEE_COOLDOWN_TICKS;
      state.activeEncounter = null;
      return { ...result, ended: true, fled: true, message: 'You got away safely.' };
    }
    playerMessage = 'You fail to get away.';
  }

  if (creatureCalmed) {
    encounter.round += 1;
    encounter.message = `${playerMessage} It stays calm. Your turn.`;
    return { ...result, message: encounter.message };
  }

  const counter = rollCreatureStrike(state, definition.encounter.attackPower);
  result.creatureStrike = counter;
  if (counter.outcome === 'dodge') {
    encounter.round += 1;
    encounter.message = `${playerMessage} You dodge ${definition.displayName}'s attack. Your turn.`;
    return { ...result, message: encounter.message };
  }
  state.player.hp = Math.max(0, state.player.hp - counter.damage);
  if (state.player.hp === 0) return defeatPlayer(state, wild, result, playerMessage);
  encounter.round += 1;
  encounter.message = `${playerMessage} ${definition.displayName} deals ${counter.damage} damage. Your turn.`;
  return { ...result, message: encounter.message };
}

function payStyleCost(state: GameState, style: CombatStyle): void {
  if (style === 'melee') state.player.stamina -= MELEE_STAMINA_COST;
  else if (style === 'ranged') state.consumables.arrows -= 1;
  else state.player.mana -= MAGIC_MANA_COST;
}

/** Fixed roll order (hit → dodge → crit) keeps replays deterministic. */
function rollPlayerStrike(
  state: GameState,
  style: CombatStyle,
  enemy: { defense: number; weakTo: CombatStyle; resistTo: CombatStyle; dodgeBps: number },
): StrikeOutcome {
  if (rollBps(state) >= STYLE_PROFILES[style].hitBps) return { outcome: 'miss', damage: 0, style };
  if (rollBps(state) < enemy.dodgeBps) return { outcome: 'dodge', damage: 0, style };
  const critical = criticalChanceBps(state) > 0 && rollBps(state) < criticalChanceBps(state);
  let power = Math.floor(attackPower(state) * STYLE_PROFILES[style].powerPercent / 100);
  if (style === enemy.weakTo) power = Math.floor(power * 150 / 100);
  if (style === enemy.resistTo) power = Math.floor(power * 50 / 100);
  if (critical) power *= 2;
  return { outcome: critical ? 'crit' : 'hit', damage: Math.max(1, power - enemy.defense), style };
}

function rollCreatureStrike(state: GameState, power: number): StrikeOutcome {
  const playerDodgeBps = Math.min(2000, state.player.attributes.agility * 150);
  if (playerDodgeBps > 0 && rollBps(state) < playerDodgeBps) return { outcome: 'dodge', damage: 0 };
  return { outcome: 'hit', damage: Math.max(1, power - defensePower(state)) };
}

/** Adds to the capture meter, returning the clamped amount actually gained. */
function addCapture(encounter: EncounterState, amountBps: number): number {
  const gain = Math.max(0, Math.min(amountBps, CAPTURE_FULL_BPS - encounter.captureBps));
  encounter.captureBps += gain;
  return gain;
}

function defeatCreature(state: GameState, wild: WildCreatureState, result: EncounterCommandResult, prefix: string): EncounterCommandResult {
  const definition = creatureDefinition(wild.speciesId);
  const granted: string[] = [];
  for (const [resource, amount] of Object.entries(definition.encounter.loot) as Array<[ResourceId, number]>) {
    if (amount <= 0) continue;
    if (!tryAddResource(state, resource, amount)) addDrop(state, resource, amount, wild.x, wild.y);
    granted.push(`+${amount} ${resource}`);
  }
  state.wildCreatures = state.wildCreatures.filter((item) => item.id !== wild.id);
  state.activeEncounter = null;
  grantXp(state, 40);
  return { ...result, ended: true, defeated: true, message: `${prefix} ${definition.displayName} is defeated! ${granted.join(', ')}` };
}

function defeatPlayer(state: GameState, wild: WildCreatureState, result: EncounterCommandResult, prefix: string): EncounterCommandResult {
  const dropped: string[] = [];
  for (const resource of ['wood', 'stone', 'fiber'] as const) {
    const amount = Math.floor(state.inventory[resource] * DEFEAT_DROP_PERCENT_BPS / 10000);
    if (amount <= 0) continue;
    state.inventory[resource] -= amount;
    addDrop(state, resource, amount, state.player.x, state.player.y);
    dropped.push(`${amount} ${resource}`);
  }
  wild.encounterCooldownUntilTick = state.tick + FLEE_COOLDOWN_TICKS;
  state.player.hp = state.player.maxHp;
  state.player.x = WORLD_PX / 2; state.player.y = WORLD_PX / 2;
  state.activeEncounter = null;
  const lossNote = dropped.length > 0 ? ` You dropped ${dropped.join(', ')} where you fell.` : '';
  return { ...result, ended: true, playerDefeated: true, message: `${prefix} You were defeated and returned to camp.${lossNote}` };
}

function tame(state: GameState, wild: WildCreatureState, result: EncounterCommandResult, message: string): EncounterCommandResult {
  const definition = creatureDefinition(wild.speciesId);
  state.wildCreatures = state.wildCreatures.filter((item) => item.id !== wild.id);
  state.ownedCreatures.push({ id: `creature-${state.nextEntityId}`, speciesId: wild.speciesId, name: definition.displayName, role: 'rest', assignment: null, worksiteId: null, nextWorkTick: state.tick });
  state.nextEntityId += 1;
  state.activeEncounter = null;
  grantXp(state, 50);
  return { ...result, ended: true, tamed: true, message: `${message} ${definition.displayName} joined you.` };
}

function addDrop(state: GameState, resource: ResourceId, amount: number, x: number, y: number): void {
  state.groundDrops.push({ id: `drop-${state.nextEntityId}`, resource, amount, x, y });
  state.nextEntityId += 1;
}

function rollBps(state: GameState): number { let x = state.rngState >>> 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; state.rngState = x >>> 0; return state.rngState % 10000; }
function findWild(state: GameState, encounter: EncounterState): WildCreatureState | undefined { return state.wildCreatures.find((item) => item.id === encounter.wildCreatureId); }
