/**
 * What defeating a wild creature pays out, in one place.
 *
 * This used to live inside the Encounter screen's `defeatCreature`, which was
 * fine while the screen was the only way to kill anything. Now that a creature
 * is an ordinary strike target in the overworld there are two kill paths, and
 * the `TROPHY_DEFEATS_PER_DROP` counter must not be able to drift between them:
 * the third, sixth, and ninth Tuftle a player defeats each owe a Tuftle Down
 * whether they died to a sword in a field or to an arrow in a battle screen.
 *
 * So the payout is extracted rather than reimplemented, and both callers go
 * through it.
 */
import {
  CREATURE_DEFEAT_XP,
  TROPHY_DEFEATS_PER_DROP,
  leveledCreatureDefinition,
} from '../config/balance';
import { scaleByLevel } from './enemyLevels';
import { describeFind, rollCreatureBlueprint, type BlueprintFind } from './blueprintFinds';
import { tryAddResource } from './gameplayCommands';
import { grantXp } from './characterProgression';
import { recordCreatureDefeat } from './questTracking';
import type { GameState, ResourceId, WildCreatureState } from './state';

export interface CreatureDefeatPayout {
  displayName: string;
  level: number;
  /** Player-facing "+5 fiber" strings, in payout order. */
  granted: string[];
  /** True when this defeat hit the trophy counter. */
  trophyDropped: boolean;
  /** Set when this defeat also filled the species' blueprint counter. */
  blueprintFind: BlueprintFind | null;
}

/**
 * Award a creature's loot, remove it from the world, and grant XP.
 *
 * The caller owns everything situational — companion bond, encounter teardown,
 * the message it wants to show — because those differ between the two paths.
 */
export function awardCreatureDefeat(state: GameState, wild: WildCreatureState): CreatureDefeatPayout {
  const definition = leveledCreatureDefinition(state, wild);
  // Counted before the payout so the third, sixth, ninth defeat of a species
  // each yield its trophy. A counter, not a roll: the same defeat sequence
  // always produces the same materials, which is what keeps replay honest.
  recordCreatureDefeat(state, wild.speciesId);
  // Loot scales with the level that made the fight longer. A levelled creature
  // that cost twice the arrows for the same five fibre would just be a tax on
  // travelling, which is the opposite of what the bands are for. The trophy
  // stays at one: it is a counter reward, not a pile.
  const multiplierBps = definition.encounter.levelMultiplierBps;
  const payout: Array<[ResourceId, number]> = Object
    .entries(definition.encounter.loot)
    .filter((entry): entry is [ResourceId, number] => entry[1] > 0)
    .map(([resource, amount]) => [resource, scaleByLevel(amount, wild.level, multiplierBps)]);
  const trophyDropped = state.questProgress.creatureDefeats[wild.speciesId] % TROPHY_DEFEATS_PER_DROP === 0;
  if (trophyDropped) payout.push([definition.encounter.trophy, 1]);

  const granted: string[] = [];
  for (const [resource, amount] of payout) {
    if (!tryAddResource(state, resource, amount)) addDrop(state, resource, amount, wild.x, wild.y);
    granted.push(`+${amount} ${resource}`);
  }
  // Rolled here rather than in either caller for the same reason the trophy
  // counter is: a species owes its blueprint on the same defeat whether it died
  // in a field or anywhere else, and two implementations would drift.
  // After the loot is banked, so a blueprint never costs the player the hide.
  const blueprintFind = rollCreatureBlueprint(state, wild.speciesId);
  if (blueprintFind) granted.push(describeFind(blueprintFind));

  state.wildCreatures = state.wildCreatures.filter((item) => item.id !== wild.id);
  grantXp(state, scaleByLevel(CREATURE_DEFEAT_XP, wild.level, multiplierBps));

  return { displayName: definition.displayName, level: wild.level, granted, trophyDropped, blueprintFind };
}

function addDrop(state: GameState, resource: ResourceId, amount: number, x: number, y: number): void {
  state.groundDrops.push({ id: `drop-${state.nextEntityId}`, resource, amount, x, y, expiresAtTick: null });
  state.nextEntityId += 1;
}
