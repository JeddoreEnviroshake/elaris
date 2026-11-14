import type { RaiderKindId, ResourceId } from '../simulation/state';

/**
 * Raid-night raider catalog. Raiders are hostile, real-time, and never enter
 * the turn-based encounter system, so they carry a much smaller profile than a
 * CreatureDefinition: walk, break what blocks them, hit what they reach.
 *
 * `speedPxPerTick` is deliberately a whole number. Raider positions live in
 * GameState, and canonicalizeGameState rejects non-integer numbers, so a
 * fractional speed would break the state hash the moment a raid started.
 */
export interface RaiderDefinition {
  kindId: RaiderKindId;
  displayName: string;
  maxHp: number;
  speedPxPerTick: number;
  /**
   * Damage per landed hit against a wall or facility. Deliberately low: a
   * player who sits out the raid behind a sealed wall should lose some
   * structure health, not their base. Fighting is meant to be worth doing, not
   * mandatory — see `raiderBounty` for the other half of that trade.
   */
  damage: number;
  /**
   * Damage per landed hit against the player, kept independent of `damage` so
   * softening what raiders do to buildings never quietly makes them harmless in
   * a fight. This is the number that makes stepping outside a real decision.
   */
  playerDamage: number;
  attackCooldownTicks: number;
  /**
   * Whole percent applied to damage against boundary parts; 100 leaves it
   * unchanged. A percent rather than a multiplier so the Admin panel can tune
   * it without ever producing a fractional damage number.
   */
  wallDamagePercent: number;
  /** First raid night this kind can appear in, counting raids rather than cycles. */
  unlockCycle: number;
  /**
   * How close this kind notices an unsheltered player and gives chase, in world
   * pixels; 0 means never. Roamers use it in the overworld; wave raiders are
   * already committed to the base and divert by the separate raid rule.
   */
  aggroRangePx: number;
  /**
   * How much of the base stats each level past the first adds, in basis points.
   * Health and damage only — see leveledRaiderDefinition.
   */
  levelMultiplierBps: number;
  /**
   * A hostile that lives in the world instead of arriving with a wave. Roamers
   * never join a raid roster and never target buildings; they notice a passing
   * player, chase within a leash, and go home. They are what gives a sword and
   * a bow something to do on the other twenty-three hours of the cycle.
   */
  roaming?: boolean;
  /**
   * What the body leaves behind, on top of the coin bounty. Fighting should
   * feed the supply line rather than only the purse.
   */
  loot?: Readonly<Partial<Record<ResourceId, number>>>;
}

export const RAIDER_DEFINITIONS: readonly RaiderDefinition[] = [
  {
    // The baseline body of a wave: cheap, slow, dangerous only in numbers.
    kindId: 'scavenger',
    displayName: 'Scavenger',
    maxHp: 30,
    speedPxPerTick: 1,
    damage: 2,
    playerDamage: 6,
    attackCooldownTicks: 45,
    wallDamagePercent: 100,
    unlockCycle: 0,
    aggroRangePx: 96,
    levelMultiplierBps: 2_500,
  },
  {
    // Slow and tough, but tears through walls — the reason a base needs turrets
    // covering its perimeter rather than just thicker boundaries.
    kindId: 'breaker',
    displayName: 'Breaker',
    maxHp: 90,
    speedPxPerTick: 1,
    damage: 3,
    playerDamage: 10,
    attackCooldownTicks: 60,
    wallDamagePercent: 300,
    unlockCycle: 3,
    aggroRangePx: 80,
    levelMultiplierBps: 2_500,
  },
  {
    // Fast and fragile: reaches the facilities first if the outer ring is thin.
    kindId: 'stalker',
    displayName: 'Stalker',
    maxHp: 45,
    speedPxPerTick: 2,
    damage: 4,
    playerDamage: 12,
    attackCooldownTicks: 30,
    wallDamagePercent: 100,
    unlockCycle: 6,
    aggroRangePx: 128,
    levelMultiplierBps: 2_500,
  },
  {
    // The first thing that ever fights back. Weak, slow, and common enough that
    // an early player meets one long before their first raid night.
    kindId: 'drifter',
    displayName: 'Drifter',
    maxHp: 24,
    speedPxPerTick: 1,
    damage: 0,
    playerDamage: 4,
    attackCooldownTicks: 60,
    wallDamagePercent: 0,
    unlockCycle: 0,
    // Short zone: a Drifter is something a new player can walk past and choose
    // to fight, which is the whole point of the kind.
    aggroRangePx: 96,
    levelMultiplierBps: 2_500,
    roaming: true,
    loot: { fiber: 4, wood: 2 },
  },
  {
    // Faster and meaner, and carries arrows — killing one is how a bow keeps
    // firing without a trip back to the workbench.
    kindId: 'poacher',
    displayName: 'Poacher',
    maxHp: 40,
    speedPxPerTick: 2,
    damage: 0,
    playerDamage: 7,
    attackCooldownTicks: 45,
    wallDamagePercent: 0,
    unlockCycle: 0,
    // Wider than a Drifter's, and it moves twice as fast: a Poacher is the one
    // roamer that picks the fight rather than waiting to be picked.
    aggroRangePx: 144,
    levelMultiplierBps: 2_500,
    roaming: true,
    loot: { arrow: 6, fiber: 2, 'cloth-mask': 1 },
  },
];

/**
 * Coins paid for putting a raider down, as half its health rounded down.
 *
 * Coins are also the run's score (see coinScore), so a bounty is not a resource
 * trickle — it moves the number that measures the whole save. That is what pays
 * for the risk of unsealing the door, and pricing it off health means a tougher
 * raider is automatically worth more without a second table to keep in sync.
 *
 * Takes the effective definition rather than a kind id so an Admin-edited maxHp
 * moves the bounty with it.
 */
export function raiderBounty(definition: Pick<RaiderDefinition, 'maxHp'>): number {
  return Math.max(0, Math.floor(definition.maxHp / 2));
}

export function raiderDefinition(kindId: RaiderKindId): RaiderDefinition {
  const definition = RAIDER_DEFINITIONS.find((candidate) => candidate.kindId === kindId);
  if (!definition) throw new Error(`unknown raider ${kindId}`);
  return definition;
}

export const RAIDER_KIND_IDS: readonly RaiderKindId[] = RAIDER_DEFINITIONS.map(
  (definition) => definition.kindId,
);

export function isRaiderKindId(value: unknown): value is RaiderKindId {
  return typeof value === 'string' && (RAIDER_KIND_IDS as readonly string[]).includes(value);
}
