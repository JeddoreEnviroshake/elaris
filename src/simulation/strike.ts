import {
  gameToolDefinition,
  type StrikeTarget,
  type ToolDefinition,
  type ToolUseCost,
} from '../config/balance';
import { TOOL_POWER_PER_RANK } from '../content/economy';
import { actionCooldown, magicDamageBonus, meleeDamageBonus } from './characterProgression';
import { effectiveToolActionTicks } from './economy';
import { activeFollowerActionSpeedBps } from './creatureRoles';
import type { GameState, ToolInstance } from './state';

/**
 * The single chokepoint for "the player swung at something".
 *
 * Before this existed, gathering, wall-breaking, and shooting each computed
 * their own damage, wear, cooldown, and stamina cost. They drifted: a wall read
 * a tool's headline `damage` while a tree read its per-target table, and one of
 * them silently ignored the wear multiplier. Everything a swing costs and
 * everything it deals is decided here, exactly once, for every target kind —
 * the same role `damageStructure` plays for anything the player built.
 *
 * What is deliberately *not* here: what a target does when it dies. Yield
 * rolls, XP, bounties, and rubble belong to the systems that own those targets;
 * this module only ever answers "did it connect, and for how much".
 */

/** What a bare-handed swing costs. Tools pay their own cast value instead. */
export const STRIKE_STAMINA_COST = 2;

/** The bare-handed cast value, and the fallback for a use that has no pool of its own. */
const HANDS_USE_COST: ToolUseCost = { resource: 'stamina', amount: STRIKE_STAMINA_COST };

/** Hardness multiplies wear. Only resource nodes vary; everything else is 1. */
const DEFAULT_HARDNESS = 1;

export interface StrikeProfile {
  /** Null when swinging bare-handed. */
  readonly tool: ToolInstance | null;
  readonly definition: ToolDefinition | null;
  /** Final damage, including tool power rank and any caller-supplied bonus. */
  readonly damage: number;
  /** Durability spent on a connected hit; zero bare-handed. */
  readonly wear: number;
  /** Ticks until the next action is allowed. */
  readonly cooldownTicks: number;
  /** The pool and amount this swing spends — the loadout's cast value. */
  readonly cost: ToolUseCost;
}

/** Why a swing cannot land, as a player-facing sentence, or null when it can. */
export type StrikeBlock =
  | { readonly reason: string }
  | null;

/**
 * What one swing with the current loadout costs.
 *
 * A bow is the one tool whose cast value does not describe its swing: an arrow
 * is spent by the shot (`firePlayerShot`, `fireCreatureShot`), and the bash a
 * player falls back on when the quiver is empty must stay available, so it is
 * priced as the bare hands it effectively is.
 */
export function strikeUseCost(state: GameState): ToolUseCost {
  const tool = equippedStrikeTool(state);
  if (!tool) return HANDS_USE_COST;
  const { useCost } = gameToolDefinition(state, tool.definitionId);
  return useCost.resource === 'arrow' ? HANDS_USE_COST : useCost;
}

/** How much of `cost`'s pool the player currently holds. */
function poolBalance(state: GameState, cost: ToolUseCost): number {
  switch (cost.resource) {
    case 'stamina': return state.player.stamina;
    case 'mana': return state.player.mana;
    case 'arrow': return state.inventory.arrow;
  }
}

/** Why this cast value cannot be paid, named for the pool that is short. */
export function useCostShortfall(state: GameState, cost: ToolUseCost): string | null {
  if (poolBalance(state, cost) >= cost.amount) return null;
  switch (cost.resource) {
    case 'stamina': return 'Not enough stamina';
    case 'mana': return 'Not enough MP';
    case 'arrow': return 'Out of arrows';
  }
}

/** Why the loadout cannot pay for a swing right now, or null when it can. */
export function strikeCostShortfall(state: GameState): string | null {
  return useCostShortfall(state, strikeUseCost(state));
}

/**
 * Shared gates every swing passes, in the order the player experiences them:
 * cooldown, then the cast value, then a broken tool. Callers add their own
 * target-specific gates (reach, tier, ammunition) around this.
 */
export function strikeBlockedReason(state: GameState): string | null {
  if (state.tick < state.actionCooldownUntilTick) return 'Not ready yet';
  return strikeCostShortfall(state);
}

/**
 * What the attributes add to a swing at a living target.
 *
 * The tool is the base and the attribute is the bonus: a Stone Sword's `18`
 * against a raider is what the weapon is worth, and Strength adds its per-point
 * Global Value on top of that. Which attribute pays out follows what is in hand,
 * because a staff is swung with Magic the way a sword is swung with Strength —
 * Dexterity is the bow's, and it is paid at the arrow (see `playerShotDamage`)
 * rather than here, since a bow used as a club is not a ranged attack.
 *
 * Only creatures and raiders qualify. Resource nodes have their own Strength
 * payout, folded in by gathering as `bonusDamage`, and a structure is neither:
 * no attribute has ever promised to help knock down a wall.
 */
export function attributeStrikeBonus(state: GameState, target: StrikeTarget): number {
  if (target !== 'creature' && target !== 'raider') return 0;
  const tool = equippedStrikeTool(state);
  const kind = tool ? gameToolDefinition(state, tool.definitionId).kind : null;
  return kind === 'staff' ? magicDamageBonus(state) : meleeDamageBonus(state);
}

/** Base damage a loadout deals to a target kind; zero means ineligible. */
export function baseStrikeDamage(state: GameState, target: StrikeTarget): number {
  const tool = equippedStrikeTool(state);
  if (!tool) return state.gameBalance.hands.damageByTarget[target] ?? 0;
  return gameToolDefinition(state, tool.definitionId).baseDamageByTarget[target] ?? 0;
}

/**
 * How far the current loadout reaches when it swings, in world pixels.
 *
 * Reach is a per-tool Global Value, so a spear-length weapon is a balance edit
 * rather than a code change. The Bow is the deliberate exception: its Range is
 * the range of its *shot* (see `playerShotRangePx`), and swinging it as a club
 * reaches no further than a fist would.
 */
export function strikeReachPx(state: GameState): number {
  const tool = equippedStrikeTool(state);
  if (!tool) return state.gameBalance.hands.rangePx;
  const definition = gameToolDefinition(state, tool.definitionId);
  return definition.kind === 'bow' ? state.gameBalance.hands.rangePx : definition.rangePx;
}

/** The equipped tool, or null when the player is bare-handed. */
export function equippedStrikeTool(state: GameState): ToolInstance | null {
  return state.tools.find((tool) => tool.instanceId === state.equippedToolId) ?? null;
}

/**
 * Resolve what one swing at `target` costs and deals.
 *
 * `bonusDamage` is how gathering folds in its own progression bonus without
 * that bonus leaking into combat, where it was never meant to apply.
 */
export function strikeProfile(
  state: GameState,
  target: StrikeTarget,
  options: { readonly hardness?: number; readonly bonusDamage?: number } = {},
): StrikeProfile {
  const tool = equippedStrikeTool(state);
  const definition = tool ? gameToolDefinition(state, tool.definitionId) : null;
  const hardness = options.hardness ?? DEFAULT_HARDNESS;

  const base = definition
    ? definition.baseDamageByTarget[target] ?? 0
    : state.gameBalance.hands.damageByTarget[target] ?? 0;
  const damage = base > 0
    ? base + (tool ? tool.powerRank * TOOL_POWER_PER_RANK : 0)
      + attributeStrikeBonus(state, target) + (options.bonusDamage ?? 0)
    : 0;

  // Only a connected, eligible hit wears a tool: hardness × per-target wear,
  // never less than one so an off-primary swing always costs something.
  const wear = tool && definition && base > 0
    ? Math.max(1, definition.wearPerHit * hardness * (definition.wearMultiplierByTarget[target] ?? 0))
    : 0;

  const baseCooldownTicks = tool
    ? effectiveToolActionTicks(state, tool)
    : state.gameBalance.hands.actionTicks;
  const speedBonusBps = tool ? activeFollowerActionSpeedBps(state, target) : 0;
  const cooldownTicks = Math.max(1, Math.round(baseCooldownTicks * 10_000 / (10_000 + speedBonusBps)));

  return { tool, definition, damage, wear, cooldownTicks, cost: strikeUseCost(state) };
}

/** Spend a cast value out of its pool. Callers gate on `useCostShortfall` first. */
export function payUseCost(state: GameState, cost: ToolUseCost): void {
  switch (cost.resource) {
    case 'stamina': state.player.stamina = Math.max(0, state.player.stamina - cost.amount); break;
    case 'mana': state.player.mana = Math.max(0, state.player.mana - cost.amount); break;
    case 'arrow': state.inventory.arrow = Math.max(0, state.inventory.arrow - cost.amount); break;
  }
}

/**
 * Pay for a swing that connected: the cast value, the action cooldown, and
 * durability. Returns whether the tool broke on this hit, which unequips it — a
 * broken tool must never stay in hand, or the next swing silently deals hand
 * damage.
 */
export function payStrikeCost(state: GameState, profile: StrikeProfile): boolean {
  payUseCost(state, profile.cost);
  state.actionCooldownUntilTick = state.tick + actionCooldown(state, profile.cooldownTicks);

  if (!profile.tool || profile.wear <= 0) return false;
  profile.tool.durability = Math.max(0, profile.tool.durability - profile.wear);
  if (profile.tool.durability > 0) return false;
  state.equippedToolId = null;
  return true;
}
