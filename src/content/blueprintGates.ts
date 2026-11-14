import {
  BLUEPRINT_ITEM_IDS, VARIANT_BLUEPRINT_IDS, type BlueprintItemId,
} from '../simulation/blueprintKnowledge';

import { BUILDABLES } from './buildingParts';

const VARIANT_BLUEPRINT_ID_SET: ReadonlySet<string> = new Set(VARIANT_BLUEPRINT_IDS);

/**
 * Which blueprints a character is handed for reaching a level.
 *
 * These are the *core* blueprints: they arrive by growing, they are never an
 * item, and nothing can take them away. Everything not named here is
 * supplementary — found in the field, dropped by raiders, bought, or traded —
 * and can be lost with the bag that carried it.
 *
 * Grants are resolved item-first, sweep-second. A level names exact ids, and a
 * sweep then picks up whatever is left in a material tier, so the Bed and the
 * Storage Box can arrive early by name without the level-10 wood sweep handing
 * them over a second time.
 */

export interface BlueprintGate {
  readonly level: number;
  /** Named blueprints, granted exactly at this level. */
  readonly items: readonly BlueprintItemId[];
  /**
   * Id prefixes swept up at this level: every blueprint starting with one of
   * these that no earlier gate already named. Keeps "all stone items" from
   * having to list twelve ids that the build catalog already knows.
   */
  readonly sweeps?: readonly string[];
}

/**
 * Every facility, by id.
 *
 * Facilities are not needed to progress, so they are earned the same way the
 * Magic and Utility recipes are: quests, raiders during a danger phase, and
 * field finds. A material sweep must therefore step over them — `stone-yard`
 * begins with `stone-` and would otherwise be swallowed by the level-15 gate
 * despite never having been meant as a stone building part.
 *
 * Derived rather than listed so a new facility joins the found pool by
 * existing, without anyone having to remember this file.
 */
export const FACILITY_BLUEPRINT_IDS: ReadonlySet<string> = new Set(
  BUILDABLES.filter((def) => def.footprintKind === 'facility').map((def) => def.id),
);

export const BLUEPRINT_GATES: readonly BlueprintGate[] = [
  // Level 1 is everything a character needs to work at all: the three gathering
  // tools and a roof. The Door ships with the Wall because a floor ringed in
  // walls is a room you cannot enter — shelter is only shelter once you can get
  // inside it. None of it is ever earned, so the opening minutes are never
  // spent waiting on a gate.
  {
    level: 1,
    items: [
      'thatch-floor', 'thatch-wall', 'thatch-door',
      'wooden-axe', 'wooden-sickle', 'wooden-pick',
    ],
  },
  // The first real gate is survival gear rather than more reach: danger phases
  // start early, and these are the only two answers to poison fog.
  { level: 2, items: ['cloth-mask', 'air-purifier'] },
  { level: 3, items: [], sweeps: ['thatch-'] },
  // The Workbench is named rather than left to be found because it is where
  // blueprints are registered. Everything else you build to run a homestead is
  // supplementary — see FACILITY_BLUEPRINT_IDS below.
  { level: 4, items: ['wooden-sword', 'field-cache', 'workbench', 'bow', 'arrow'] },
  { level: 7, items: ['bed', 'taming-snare'] },
  { level: 10, items: [], sweeps: ['wood-', 'wooden-'] },
  { level: 15, items: [], sweeps: ['stone-'] },
  { level: 20, items: [], sweeps: ['metal-', 'iron-'] },
];

/** Every id any gate hands out, so callers can tell core from supplementary. */
export const CORE_BLUEPRINT_IDS: ReadonlySet<string> = new Set(
  BLUEPRINT_GATES.flatMap((gate) => blueprintsGrantedAtLevel(gate.level)),
);

/**
 * The blueprints earned by reaching exactly `level`. Sweeps exclude anything a
 * lower gate already named, so no id is ever granted by two different levels.
 */
export function blueprintsGrantedAtLevel(level: number): readonly BlueprintItemId[] {
  const gate = BLUEPRINT_GATES.find((candidate) => candidate.level === level);
  if (!gate) return [];
  const claimedEarlier = new Set<string>(
    BLUEPRINT_GATES
      .filter((candidate) => candidate.level < level)
      .flatMap((candidate) => candidate.items),
  );
  const swept = (gate.sweeps ?? []).flatMap((prefix) => BLUEPRINT_ITEM_IDS.filter(
    (id) => id.startsWith(prefix)
      && !claimedEarlier.has(id)
      && !FACILITY_BLUEPRINT_IDS.has(id)
      // Variants are found, never granted. Without this the level-15 "all
      // stone" sweep would hand over nothing, but a future `reinforced-` style
      // prefix would silently make a Legendary tool a level reward.
      && !VARIANT_BLUEPRINT_ID_SET.has(id),
  ));
  return [...new Set([...gate.items, ...swept])];
}

/** Everything a character of this level should know, for grants and migration. */
export function blueprintsGrantedUpToLevel(level: number): readonly BlueprintItemId[] {
  const granted = new Set<BlueprintItemId>();
  for (const gate of BLUEPRINT_GATES) {
    if (gate.level > level) continue;
    for (const id of blueprintsGrantedAtLevel(gate.level)) granted.add(id);
  }
  return [...granted];
}
