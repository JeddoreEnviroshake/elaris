import { INTERACTION_RANGE_PX, leveledCreatureDefinition } from '../config/balance';
import { TILE_SIZE } from '../config/platform';
import { raiderDefinition } from '../content/raiders';
import { baseStrikeDamage, strikeReachPx } from '../simulation/strike';
import { playerShotRangePx } from '../simulation/raids';
import { isEngaged, isHuntable } from '../simulation/creatureStrike';
import { equippedBow } from '../simulation/gameplayCommands';
import type { GameState, RaiderState, ResourceNodeState, WildCreatureState } from '../simulation/state';

/**
 * Pure half of the overworld combat presentation, split from the Phaser layer
 * exactly as `dangerPresentation` is split from `dangerAtmosphere`. Nothing here
 * touches the renderer or the clock, so the sticky-target rules and the bar
 * timings are unit-testable without a canvas.
 *
 * None of this belongs in GameState. A target lock is a per-client viewing
 * preference — two players looking at the same raider have different locks —
 * and canonicalizeGameState would reject the floating alphas outright.
 */

export type StrikeStyle = 'melee' | 'ranged' | 'magic';
export type CombatTargetKind = 'resource' | 'raider' | 'creature';

/** The lock itself: an id plus what kind of thing it points at. */
export interface CombatTarget {
  readonly kind: CombatTargetKind;
  readonly id: string;
}

/** A lock resolved against live state, ready to draw and to act on. */
export interface ResolvedCombatTarget {
  readonly kind: CombatTargetKind;
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly distancePx: number;
  /** Whether the equipped style can actually reach it from here. */
  readonly inRange: boolean;
}

/**
 * How far a lock survives before it drops on its own. Deliberately larger than
 * any attack range: walking one step too far must not silently clear the
 * target the player deliberately chose, or every approach would need re-tapping.
 */
export const LOCK_LEASH_PX = TILE_SIZE * 14;

/**
 * Shipped reach per style, kept for the fallbacks below. Live reach is a Global
 * Value on the tool in hand, so the ring the player sees is the reach the
 * simulation will actually use.
 */
export const MELEE_RANGE_PX = INTERACTION_RANGE_PX;
export const MAGIC_RANGE_PX = TILE_SIZE * 7;

/**
 * The style the loadout in hand would use against `target`.
 *
 * The tool is the mode, and this is the one place that says so: a bow with
 * arrows shoots anything that bleeds, and everything else — including a bow
 * with an empty quiver, and any swing at a resource node — is melee. Shared by
 * the scene (which picks the command and the damage-number ink) and the HUD
 * (which picks the verb), because a button reading "Shoot" over a swing is
 * exactly the kind of drift that made this a function.
 */
export function loadoutStrikeStyle(state: GameState, target: CombatTarget | ResolvedCombatTarget | null): StrikeStyle {
  if (target?.kind === 'resource') return 'melee';
  return equippedBow(state) && state.inventory.arrow > 0 ? 'ranged' : 'melee';
}

/** Reach for a style, reading the equipped tool's Admin-editable Range. */
export function styleRangePx(state: GameState, style: StrikeStyle): number {
  return style === 'ranged' ? playerShotRangePx(state) : strikeReachPx(state);
}

/** Display name for a node, matching the wording the HUD already uses. */
export function resourceNodeLabel(node: ResourceNodeState): string {
  if (node.kind === 'berry-bush') return 'Berry bush';
  return node.kind[0]!.toUpperCase() + node.kind.slice(1);
}

function findResource(state: GameState, id: string): ResourceNodeState | null {
  return state.resourceNodes.find((node) => node.id === id) ?? null;
}

function findRaider(state: GameState, id: string): RaiderState | null {
  return state.raiders.find((raider) => raider.id === id) ?? null;
}

function findCreature(state: GameState, id: string): WildCreatureState | null {
  return state.wildCreatures.find((creature) => creature.id === id) ?? null;
}

/**
 * Resolve a lock against live state, or null when the lock has expired.
 *
 * A lock expires when its subject leaves the world (killed raider, area change),
 * when a node is depleted, or when the player walks past the leash. Everything
 * else — including standing out of attack range — keeps the lock alive and
 * simply reports `inRange: false`, so the action button can say "too far" about
 * the thing the player actually picked rather than silently retargeting.
 */
export function resolveCombatTarget(
  state: GameState,
  target: CombatTarget | null,
  style: StrikeStyle,
): ResolvedCombatTarget | null {
  if (!target) return null;
  const range = styleRangePx(state, style);

  if (target.kind === 'resource') {
    const node = findResource(state, target.id);
    // A depleted node is not a target: its sprite is gone and its hp is 0 until
    // the respawn tick, so holding the lock would draw a ring over bare ground.
    if (!node || node.hp <= 0) return null;
    const distance = Math.hypot(node.x - state.player.x, node.y - state.player.y);
    if (distance > LOCK_LEASH_PX) return null;
    return {
      kind: 'resource',
      id: node.id,
      x: node.x,
      y: node.y,
      label: resourceNodeLabel(node),
      hp: node.hp,
      maxHp: node.maxHp,
      distancePx: distance,
      inRange: distance <= range,
    };
  }

  if (target.kind === 'creature') {
    const creature = findCreature(state, target.id);
    if (!creature || creature.hp <= 0) return null;
    const distance = Math.hypot(creature.x - state.player.x, creature.y - state.player.y);
    if (distance > LOCK_LEASH_PX) return null;
    return {
      kind: 'creature',
      id: creature.id,
      x: creature.x,
      y: creature.y,
      label: leveledCreatureDefinition(state, creature).displayName,
      hp: creature.hp,
      maxHp: creature.maxHp,
      distancePx: distance,
      inRange: distance <= range,
    };
  }

  const raider = findRaider(state, target.id);
  if (!raider) return null;
  const distance = Math.hypot(raider.x - state.player.x, raider.y - state.player.y);
  if (distance > LOCK_LEASH_PX) return null;
  return {
    kind: 'raider',
    id: raider.id,
    x: raider.x,
    y: raider.y,
    label: raiderDefinition(raider.kindId).displayName,
    hp: raider.hp,
    maxHp: raider.maxHp,
    distancePx: distance,
    inRange: distance <= range,
  };
}

/* -------------------------------------------------------------------------- */
/* Automatic target acquisition                                               */
/* -------------------------------------------------------------------------- */

/**
 * How far auto-acquire looks. Deliberately close to reach: auto-targeting
 * should feel like "the thing in front of me", not like a scan of the field.
 * A deliberate tap still reaches out to LOCK_LEASH_PX.
 */
export const AUTO_ACQUIRE_PX = INTERACTION_RANGE_PX * 2;

/**
 * Pick a target automatically, with no mode for the player to get wrong.
 *
 * The rules, in order:
 *
 * 1. **Anything already fighting you wins.** A raider mid-swing or an aggroed
 *    Snarlfox is never ambiguous — it is the target, whatever is in hand.
 * 2. **Otherwise the equipped tool decides**, ranked by the damage it deals to
 *    each candidate. The tool is the mode: it is visible in the hotbar at all
 *    times and the player changes it for other reasons anyway, so an axe near a
 *    tree and a deer takes the tree and a sword takes the deer.
 * 3. **Ties break by distance**, so the nearer thing wins when the tool has no
 *    opinion.
 *
 * A creature that is not already hostile is never auto-acquired (see
 * `isHuntable`). Killing the deer you meant to snare is the one failure this
 * whole rule set exists to prevent.
 */
export function acquireTarget(
  state: GameState,
  style: StrikeStyle,
  range = 0,
): CombatTarget | null {
  // A bow should notice what it can actually shoot, so acquisition reaches as
  // far as the equipped style does — but never less than the melee default, or
  // a sword would stop seeing the tree it is standing next to.
  const reach = range > 0 ? range : Math.max(AUTO_ACQUIRE_PX, styleRangePx(state, style));
  const candidates: Array<{ target: CombatTarget; priority: number; distance: number; hostile: boolean }> = [];

  for (const node of state.resourceNodes) {
    if (node.hp <= 0) continue;
    const distance = Math.hypot(node.x - state.player.x, node.y - state.player.y);
    if (distance > reach) continue;
    candidates.push({
      target: { kind: 'resource', id: node.id },
      priority: baseStrikeDamage(state, node.kind),
      distance,
      hostile: false,
    });
  }

  for (const raider of state.raiders) {
    const distance = Math.hypot(raider.x - state.player.x, raider.y - state.player.y);
    if (distance > reach) continue;
    candidates.push({
      target: { kind: 'raider', id: raider.id },
      priority: baseStrikeDamage(state, 'raider'),
      distance,
      // Raiders are hostile by definition; that is the whole of what they are.
      hostile: true,
    });
  }

  for (const creature of state.wildCreatures) {
    if (creature.hp <= 0 || !isHuntable(state, creature)) continue;
    const distance = Math.hypot(creature.x - state.player.x, creature.y - state.player.y);
    if (distance > reach) continue;
    candidates.push({
      target: { kind: 'creature', id: creature.id },
      priority: baseStrikeDamage(state, 'creature'),
      distance,
      // Eligible (isHuntable) is not the same as engaged. An aggressive species
      // that has not noticed the player is a legal target but must not
      // interrupt the tree they are mid-swing on; only something actually
      // coming for them gets to outrank the tool's preference.
      hostile: isEngaged(state, creature),
    });
  }

  // A candidate the equipped loadout cannot affect at all is not a target.
  const usable = candidates.filter((candidate) => candidate.priority > 0);
  if (usable.length === 0) return null;

  usable.sort((a, b) => {
    if (a.hostile !== b.hostile) return a.hostile ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.distance - b.distance;
  });
  return usable[0]!.target;
}

/**
 * Verb the action button shows for a locked target. Naming the target is the
 * whole point of keeping one button: "Chop Tree" and "Strike Scavenger" are
 * unambiguous where a bare "Gather" was not.
 */
export function combatActionLabel(
  target: ResolvedCombatTarget | null,
  fallback: string,
  style: StrikeStyle = 'melee',
): string {
  if (!target) return fallback;
  if (!target.inRange) return `${target.label} — too far`;
  // A bow says Shoot. The verb is the only thing that distinguishes a locked
  // stag six tiles out (a shot) from the same stag underfoot (a swing), and the
  // player picks between them by what they have in hand.
  if (target.kind === 'raider' || target.kind === 'creature') {
    return `${style === 'ranged' ? 'Shoot' : 'Strike'} ${target.label}`;
  }
  if (target.label === 'Tree') return 'Chop Tree';
  if (target.label === 'Stone') return 'Mine Stone';
  if (target.label === 'Metal') return 'Mine Vein';
  return `Gather ${target.label}`;
}

/* -------------------------------------------------------------------------- */
/* Health bar timing                                                           */
/* -------------------------------------------------------------------------- */

/** How long a full-health bar stays up after the last hit before fading. */
export const HEALTH_BAR_LINGER_MS = 4_000;
/** Alpha units per millisecond; the overlay lerps toward the target alpha. */
export const HEALTH_BAR_FADE_RATE = 1 / 220;

/**
 * Target opacity for a damageable's health bar.
 *
 * The rule is the same one the player's own bars adopt: anything below full is
 * always readable, and a bar only disappears once it has been full for a beat.
 * Hiding the instant health tops up would yank the bar away mid-refill, which
 * is exactly when the player is watching it.
 */
export function healthBarAlpha(
  nowMs: number,
  lastDamagedAtMs: number,
  hp: number,
  maxHp: number,
): number {
  if (hp <= 0 || maxHp <= 0) return 0;
  if (hp < maxHp) return 1;
  // Full and never hit: nothing to report.
  if (!Number.isFinite(lastDamagedAtMs)) return 0;
  const since = nowMs - lastDamagedAtMs;
  if (since <= HEALTH_BAR_LINGER_MS) return 1;
  return Math.max(0, 1 - (since - HEALTH_BAR_LINGER_MS) * HEALTH_BAR_FADE_RATE);
}

/** Step a rendered alpha toward its target, framerate-independent. */
export function approachAlpha(current: number, target: number, deltaMs: number): number {
  const step = deltaMs * HEALTH_BAR_FADE_RATE;
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

/** Shared fill color thresholds, matching `durabilityColor` in the DOM layer. */
export function healthBarColor(ratio: number): number {
  return ratio > 0.5 ? 0x4cc07f : ratio > 0.25 ? 0xc9a227 : 0xd9534f;
}

/* -------------------------------------------------------------------------- */
/* Damage numbers                                                              */
/* -------------------------------------------------------------------------- */

export type StrikeOutcome = 'hit' | 'crit' | 'miss';

export interface DamageNumberAppearance {
  readonly text: string;
  readonly color: string;
  readonly fontSizePx: number;
  readonly riseP: number;
}

/** Per-style ink, so a glance at the number says which weapon connected. */
const STYLE_INK: Readonly<Record<StrikeStyle, string>> = {
  melee: '#eef2f5',
  ranged: '#ffc46b',
  magic: '#c9a6ff',
};

const MISS_INK = '#9aa7a0';

/**
 * A damage number's text, ink, and size. Crits are bigger and rise further so
 * they read at a glance without needing a separate animation path.
 */
export function damageNumberAppearance(
  style: StrikeStyle,
  outcome: StrikeOutcome,
  damage: number,
): DamageNumberAppearance {
  if (outcome === 'miss') {
    return { text: 'Miss', color: MISS_INK, fontSizePx: 10, riseP: 14 };
  }
  const crit = outcome === 'crit';
  return {
    text: crit ? `${damage}!` : String(damage),
    color: STYLE_INK[style],
    fontSizePx: crit ? 16 : 12,
    riseP: crit ? 30 : 22,
  };
}

/**
 * Sideways offset for the nth number in a burst. Rapid hits on one target would
 * otherwise stack into an unreadable smear; this fans them out on a short cycle
 * that never drifts far from the target's center.
 */
const STAGGER_PATTERN: readonly number[] = [0, 9, -9, 5, -5, 13, -13];

export function damageNumberOffsetX(sequence: number): number {
  const index = ((sequence % STAGGER_PATTERN.length) + STAGGER_PATTERN.length) % STAGGER_PATTERN.length;
  return STAGGER_PATTERN[index]!;
}

/** Milliseconds a struck sprite holds still, selling the impact. */
export const HIT_STOP_MS = 60;
