import {
  BLUEPRINT_QUALITIES, blueprintQuality, type BlueprintQuality,
} from '../content/blueprintQuality';
import {
  ceilingBlueprintPool, sourceBlueprintPool, type BlueprintSourceKind,
} from '../content/blueprintPools';
import { coordinateHash } from './biomes';
import { tryCarryBlueprint } from './carriedBlueprints';
import { survivalSchedule } from './survivalCycle';
import type {
  AreaThemeId, BlueprintProgress, EditableBlueprintBalance, GameState, RaiderState,
  ResourceNodeState, ResourceNodeKind, SpeciesId,
} from './state';

/**
 * Where blueprints come from.
 *
 * Every source keeps a counter, and every counter pays. The work owes you a
 * blueprint — what is random is which swing settles the debt and which recipe
 * comes out of it.
 *
 * This replaced a flat per-node percentage. The odds were tuned to roughly the
 * same generosity, but a percentage cannot promise anything: a player who
 * cleared a marsh and found nothing had been treated exactly as designed, and
 * no explanation of that makes it feel like less of a swindle. A counter can be
 * unlucky about *when*. It can never be unlucky about *whether*.
 *
 * What the counter must not become is a countdown. A player who knows the next
 * tree is the twentieth stops playing the game and starts paying off a meter,
 * so each payout re-rolls its own target inside a band — see `sourceTarget`.
 */

/**
 * `coordinateHash` ends on an XOR, which in JavaScript yields a signed 32-bit
 * value — so its result can be negative. Every roll folds it into [0,1) before
 * being used as a probability or an index, or half the world would find a
 * blueprint under every rock.
 */
export function foldedRoll(hash: number): number {
  // Same fold worldContainers and describeArea use. `Math.abs` would look
  // equivalent and is not: it reflects the negative half onto the positive one,
  // halving the range and doubling the density at the bottom of it.
  return ((hash % 1) + 1) % 1;
}

/**
 * Which counter a piece of work belongs to.
 *
 * Node counters are scoped per kind *per region theme*: marsh trees and forest
 * trees are separate debts. Anything else would let a player build a counter to
 * nineteen somewhere safe and walk into the marsh to cash it out at the better
 * rarity. Raiders and creatures are global — a raider is a raider wherever it
 * catches you, and a species is itself in every region it lives in.
 */
export function nodeProgressKey(theme: AreaThemeId, kind: ResourceNodeKind): string {
  return `${theme}:${kind}`;
}

export const RAIDER_PROGRESS_KEY = 'raider';

export function creatureProgressKey(speciesId: SpeciesId): string {
  return `creature:${speciesId}`;
}

function progressFor(state: GameState, key: string): BlueprintProgress {
  const existing = state.blueprintProgress[key];
  if (existing) return existing;
  const created: BlueprintProgress = { struck: 0, cycle: 0 };
  state.blueprintProgress[key] = created;
  return created;
}

/**
 * The number of strikes *this* payout wants, jittered around the base target.
 *
 * Seeded from the world seed, the counter, and how many times that counter has
 * already paid — never from the clock or the running RNG. So the target is
 * fixed the moment the previous find lands: it cannot be rerolled by reloading,
 * two clients on one world agree on it, and a player still cannot know it,
 * because nothing ever shows them the number.
 *
 * The band is symmetric and inclusive of the base, which keeps the long-run
 * average on the tuned target rather than quietly drifting off it.
 */
export function sourceTarget(state: GameState, key: string, base: number, cycle: number): number {
  const spread = Math.floor((base * state.gameBalance.blueprints.jitterBps) / 10_000);
  if (spread <= 0) return Math.max(1, base);
  const roll = foldedRoll(coordinateHash(
    state.seed ^ 0x4a49_5454,
    stableKeyHash(key),
    cycle,
  ));
  // 2 * spread + 1 outcomes: base - spread through base + spread.
  const offset = Math.floor(roll * (2 * spread + 1)) - spread;
  return Math.max(1, base + offset);
}

/**
 * A stable integer for a counter key. Deliberately not the array index of some
 * list of themes and kinds: a list someone reorders later would silently move
 * every player's pending target, and this way the key's own text is the seed.
 */
function stableKeyHash(key: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x0100_0193);
  }
  return hash >>> 0;
}

/**
 * Record one unit of work against a counter, and report whether it just paid.
 *
 * Paying resets the counter and advances its cycle, which is what re-rolls the
 * next target. A base target of zero or less switches a source off entirely —
 * useful from the Admin panel, and the only way a counter never pays.
 */
export function advanceBlueprintProgress(state: GameState, key: string, base: number): boolean {
  if (base <= 0) return false;
  const progress = progressFor(state, key);
  progress.struck += 1;
  if (progress.struck < sourceTarget(state, key, base, progress.cycle)) return false;
  progress.struck = 0;
  progress.cycle += 1;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Choosing the recipe                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Pick one blueprint from a pool, weighted by tier.
 *
 * Tiers are weighted rather than individual recipes, so adding five Common
 * building parts never quietly makes the Rare tier rarer — a tier's share is
 * fixed and its members split it. Empty tiers are dropped before the roll
 * rather than rolled and rerolled, which keeps the published weights honest as
 * a player's collection fills in.
 */
export function pickWeightedFromPool(
  pool: readonly string[],
  weights: Readonly<Partial<Record<BlueprintQuality, number>>>,
  roll: number,
): string | null {
  const tiers = BLUEPRINT_QUALITIES
    .map((quality) => ({
      weight: weights[quality] ?? 0,
      ids: pool.filter((id) => blueprintQuality(id) === quality),
    }))
    .filter((tier) => tier.weight > 0 && tier.ids.length > 0);
  if (tiers.length === 0) return null;

  const total = tiers.reduce((sum, tier) => sum + tier.weight, 0);
  let cursor = Math.min(Math.max(roll, 0), 0.999_999) * total;
  for (const tier of tiers) {
    if (cursor < tier.weight) {
      const index = Math.floor((cursor / tier.weight) * tier.ids.length);
      return tier.ids[Math.max(0, Math.min(tier.ids.length - 1, index))]!;
    }
    cursor -= tier.weight;
  }
  return tiers[tiers.length - 1]!.ids[0]!;
}

/**
 * Resolve a find into an actual recipe.
 *
 * Three passes, in this order, and the order is the whole policy:
 *
 * 1. Something new from the source's own pool — the case that gives a region,
 *    a raider or a species an identity worth seeking out.
 * 2. Failing that, anything new at or below the source's ceiling. A player who
 *    has finished the marsh has not finished the game, and the counter they
 *    just filled still owes them something they cannot make yet.
 * 3. Failing that, a duplicate from the source's pool. Duplicates are real
 *    loot: they file at a bench, scrap into parchment for the drafting table,
 *    and trade. A counter that paid nothing at all would be the one outcome
 *    this system exists to prevent.
 *
 * That third pass is for finds that arrive as *paper*. A container teaches its
 * blueprint outright, so a duplicate from one would be nothing at all — those
 * callers pass `allowDuplicate: false` and pay coins instead.
 */
export function resolveBlueprintFind(
  unlockedItemIds: readonly string[],
  kind: BlueprintSourceKind,
  weights: Readonly<Partial<Record<BlueprintQuality, number>>>,
  roll: number,
  context: { theme?: AreaThemeId; speciesId?: SpeciesId; allowDuplicate?: boolean } = {},
): string | null {
  const known = new Set(unlockedItemIds);
  const pool = sourceBlueprintPool(kind, context);
  const fromPool = pickWeightedFromPool(pool.filter((id) => !known.has(id)), weights, roll);
  if (fromPool) return fromPool;

  const unknownAnywhere = ceilingBlueprintPool(kind).filter((id) => !known.has(id));
  const fromCeiling = pickWeightedFromPool(unknownAnywhere, weights, roll);
  if (fromCeiling) return fromCeiling;

  if (context.allowDuplicate === false) return null;
  return pickWeightedFromPool(pool, weights, roll);
}

export interface BlueprintFind {
  blueprintId: string;
  /**
   * True when the bag had no room and the find was left behind. Blueprints on
   * the ground arrive with the trading and death-drop rules, so until then a
   * full bag simply costs the player the find — and the message says so, rather
   * than letting one vanish silently.
   */
  spilled: boolean;
}

function carry(state: GameState, blueprintId: string | null): BlueprintFind | null {
  if (!blueprintId) return null;
  return { blueprintId, spilled: tryCarryBlueprint(state, blueprintId) === null };
}

/** A roll seeded from a counter's own identity and payout number. */
function payoutRoll(state: GameState, key: string, salt: number): number {
  const cycle = state.blueprintProgress[key]?.cycle ?? 0;
  return foldedRoll(coordinateHash(state.seed ^ salt, stableKeyHash(key), cycle));
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How likely a node find is to come out Rare rather than Common, in basis
 * points. The region sets it, and poison fog multiplies it: working outside on
 * a fog night is the risk, and better paper is exactly what it buys.
 *
 * Capped, because a Rare that arrives reliably stops being one.
 */
export function nodeRareShareBps(state: GameState): number {
  const blueprints = state.gameBalance.blueprints;
  const base = blueprints.rareShareBpsByTheme[state.currentArea.theme] ?? 0;
  const timer = survivalSchedule(state);
  const foggy = timer.phase === 'danger' && timer.threat === 'fog';
  const raised = foggy
    ? Math.floor((base * blueprints.fogRareMultiplierBps) / 10_000)
    : base;
  return Math.min(raised, blueprints.rareShareMaxBps);
}

/**
 * Count one depleted node, and hand over a blueprint when its counter is due.
 *
 * Elaris has no node counters worth running — the town generates nothing inside
 * its walls — but the guard here is the rare share rather than the theme: a
 * region tuned to zero rarity is a region an admin has switched off, and it
 * should switch off in one place rather than two.
 */
export function rollNodeBlueprint(state: GameState, node: ResourceNodeState): BlueprintFind | null {
  const theme = state.currentArea.theme;
  const key = nodeProgressKey(theme, node.kind);
  const base = state.gameBalance.blueprints.nodeTargets[node.kind] ?? 0;
  if (!advanceBlueprintProgress(state, key, base)) return null;

  const rareShare = nodeRareShareBps(state);
  return carry(state, resolveBlueprintFind(
    state.unlockedItemIds,
    'node',
    { common: 10_000 - rareShare, rare: rareShare },
    payoutRoll(state, key, 0x5049_434b),
    { theme },
  ));
}

/**
 * Count one defeated raider. Raiders hunt blueprint carriers, so this is the
 * loop closing on itself: the more paper you are carrying, the more of them
 * come, and the more of them there are to take it from.
 */
export function rollRaiderBlueprint(state: GameState, _raider: RaiderState): BlueprintFind | null {
  const blueprints = state.gameBalance.blueprints;
  if (!advanceBlueprintProgress(state, RAIDER_PROGRESS_KEY, blueprints.raiderTarget)) return null;
  return carry(state, resolveBlueprintFind(
    state.unlockedItemIds,
    'raider',
    blueprints.raiderTierWeights,
    payoutRoll(state, RAIDER_PROGRESS_KEY, 0x5241_4944),
  ));
}

/**
 * Count one defeated creature of a species. The pool is the worksites that
 * species can be put to work at, so hunting the thing that runs a Stone Yard is
 * how you learn to build one.
 */
export function rollCreatureBlueprint(state: GameState, speciesId: SpeciesId): BlueprintFind | null {
  const blueprints = state.gameBalance.blueprints;
  const key = creatureProgressKey(speciesId);
  if (!advanceBlueprintProgress(state, key, blueprints.creatureTarget)) return null;
  return carry(state, resolveBlueprintFind(
    state.unlockedItemIds,
    'creature',
    blueprints.raiderTierWeights,
    payoutRoll(state, key, 0x4352_5452),
    { speciesId },
  ));
}

/**
 * What an arcane storm cache is holding, if anything.
 *
 * Not a counter: a cache is a place rather than a piece of work, and its own
 * roll is what makes crossing a storm to reach one a gamble instead of an
 * errand. Pure, and seeded by the caller from the cache's stable id, so the
 * same cache always holds the same thing however many times it is looked at.
 */
export function stormCacheBlueprint(
  blueprints: EditableBlueprintBalance,
  unlockedItemIds: readonly string[],
  roll: number,
  pickRoll: number,
): string | null {
  if (roll * 10_000 >= blueprints.stormCacheBlueprintBps) return null;
  return resolveBlueprintFind(
    unlockedItemIds, 'storm-cache', blueprints.stormCacheTierWeights, pickRoll,
    // A cache teaches what it holds, so an already-known recipe is not a
    // consolation — the coin payout in openNearestContainer is.
    { allowDuplicate: false },
  );
}

/** One phrasing for every source, so a find always reads the same way. */
export function describeFind(find: BlueprintFind): string {
  const name = find.blueprintId.replace(/-/g, ' ');
  return find.spilled
    ? `Blueprint: ${name} — no bag space, left behind`
    : `Blueprint: ${name} — register it at a workbench`;
}
