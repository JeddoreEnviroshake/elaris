/**
 * Work passives: what a creature does on shift that is not production.
 *
 * The original Work role had exactly one shape — stand at a worksite and fill a
 * bin — which is why every early species was a gatherer. A homestead that could
 * be *built* still could not be *kept*: walls stayed broken until the player
 * walked over with materials, turrets ran dry mid-wave, and a fog night was
 * survivable only inside a sealed room. These five passives are the answer, and
 * they are deliberately durable-automation shaped: fixed interval, fixed
 * amount, fixed reach from the worksite, no rolls anywhere.
 *
 * Every value here is a whole number. Passive effects write creature and
 * building fields that feed the canonical state hash, so a fractional heal or a
 * half-pixel reach would break deterministic replay.
 */
export type CreatureWorkPassiveId =
  | 'rebuild-walls'
  | 'defend-base'
  | 'restock-turrets'
  | 'purified-zone'
  | 'throw-rocks';

export interface CreatureWorkPassiveDefinition {
  id: CreatureWorkPassiveId;
  /** Player-facing sentence, shown on the Work assignment button. */
  description: string;
  /** Ticks between applications; 60 ticks is one second. */
  intervalTicks: number;
  /**
   * Reach from the worksite's centre, in whole tiles. A passive is anchored to
   * the building the creature was assigned to, never to the player — the whole
   * point is that it keeps working while the player is somewhere else.
   */
  rangeTiles: number;
  /**
   * Hit points repaired, damage dealt, arrows moved, or tiles purified per
   * application. Read per passive; see advanceCreatureWorkPassives.
   */
  amount: number;
}

export const CREATURE_WORK_PASSIVES: Readonly<Record<CreatureWorkPassiveId, CreatureWorkPassiveDefinition>> = {
  /**
   * Slow and free. Charging materials for it would have made the passive a
   * second inventory chore rather than a reason to keep a creature housed, and
   * the rate is set well under a raider's damage output so a Masonmole extends
   * a wall's life without ever making one unbreakable.
   */
  'rebuild-walls': {
    id: 'rebuild-walls',
    description: 'Repairs damaged walls and facilities around its worksite.',
    intervalTicks: 300,
    rangeTiles: 10,
    amount: 4,
  },
  /**
   * Short reach on purpose: this is a creature that meets what has already
   * arrived at the base, not a second turret. It hits hard for the trade.
   */
  'defend-base': {
    id: 'defend-base',
    description: 'Attacks raiders that reach its worksite.',
    intervalTicks: 90,
    rangeTiles: 4,
    amount: 9,
  },
  /**
   * Moves the player's own arrows out of nearby storage and into turrets, which
   * is the whole job: a loaded turret was previously something only a player
   * standing there could produce, so a raid answered while away was decided
   * entirely by what happened to be loaded before they left.
   */
  'restock-turrets': {
    id: 'restock-turrets',
    description: 'Carries arrows from nearby storage into turrets that are low.',
    intervalTicks: 180,
    rangeTiles: 8,
    amount: 3,
  },
  /**
   * Two tiles square, anchored on the worksite. Deliberately smaller than an
   * Air Purifier's room and not roofed: it is a place to stand out a fog night
   * away from home, not a replacement for building one.
   */
  'purified-zone': {
    id: 'purified-zone',
    description: 'Keeps a 2x2 square of clean air around its worksite during poison fog.',
    intervalTicks: 60,
    rangeTiles: 2,
    amount: 4,
  },
  /**
   * The long-range chip. Small per hit and slow, but it reaches past the walls
   * and, unlike a turret, costs nothing to run.
   */
  'throw-rocks': {
    id: 'throw-rocks',
    description: 'Throws stones at hostiles that come within sight of its worksite.',
    intervalTicks: 150,
    rangeTiles: 12,
    amount: 4,
  },
};

export function creatureWorkPassive(id: CreatureWorkPassiveId): CreatureWorkPassiveDefinition {
  return CREATURE_WORK_PASSIVES[id];
}
