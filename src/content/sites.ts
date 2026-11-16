import type { AreaThemeId, ResourceId } from '../simulation/state';

/**
 * Field sites: guarded ruins with a handful of searchable containers that
 * refill every few survival cycles. They are the only source of salvage.
 *
 * Sites are never stored. Where they stand is derived from the world seed in
 * simulation/sites, and only a sparse per-site record of what has been searched
 * this refill is saved. These tables are the content half: what each kind
 * looks like, where it may appear, and what it holds.
 */
export type SiteKindId = 'ruined-homestead' | 'collapsed-workshop' | 'drowned-shrine';

export interface SiteLootEntry {
  readonly resource: ResourceId;
  readonly min: number;
  readonly max: number;
  /** Relative chance of being picked from its table. Ignored for strongbox entries, which are all granted. */
  readonly weight: number;
}

export interface SiteKindDefinition {
  readonly id: SiteKindId;
  readonly label: string;
  /** Area themes this kind may be generated in. */
  readonly themes: readonly AreaThemeId[];
  /** Searchable containers, 3 to 5. The last one is always the strongbox. */
  readonly containerCount: number;
  /** Banner and map colour, so a site reads from a distance. */
  readonly color: string;
  /** Two picks per container, plus one unit per three area levels on each. */
  readonly common: readonly SiteLootEntry[];
  /** One pick in a strongbox, sometimes in an ordinary container, more in a danger phase. */
  readonly uncommon: readonly SiteLootEntry[];
  /** Granted in full on top of a strongbox's common and uncommon picks. */
  readonly strongbox: readonly SiteLootEntry[];
  readonly strongboxCoins: { readonly min: number; readonly max: number };
}

export const SITE_KIND_IDS: readonly SiteKindId[] = ['ruined-homestead', 'collapsed-workshop', 'drowned-shrine'];

export const SITE_KINDS: Readonly<Record<SiteKindId, SiteKindDefinition>> = {
  'ruined-homestead': {
    id: 'ruined-homestead',
    label: 'Ruined Homestead',
    themes: ['meadow', 'forest', 'thicket'],
    containerCount: 4,
    color: '#d98b4a',
    common: [
      { resource: 'scrap-iron', min: 2, max: 4, weight: 5 },
      { resource: 'fiber', min: 3, max: 6, weight: 2 },
      { resource: 'arrow', min: 3, max: 6, weight: 2 },
      { resource: 'berry', min: 2, max: 4, weight: 2 },
    ],
    uncommon: [{ resource: 'clockwork', min: 1, max: 1, weight: 1 }],
    strongbox: [{ resource: 'cloth-mask', min: 1, max: 2, weight: 1 }],
    strongboxCoins: { min: 20, max: 50 },
  },
  'collapsed-workshop': {
    id: 'collapsed-workshop',
    label: 'Collapsed Workshop',
    themes: ['mountain', 'thicket', 'forest'],
    containerCount: 5,
    color: '#9fb2c4',
    common: [
      { resource: 'scrap-iron', min: 3, max: 5, weight: 5 },
      { resource: 'iron-ore', min: 2, max: 4, weight: 3 },
    ],
    uncommon: [{ resource: 'clockwork', min: 1, max: 3, weight: 1 }],
    strongbox: [{ resource: 'iron-ingot', min: 2, max: 3, weight: 1 }],
    strongboxCoins: { min: 30, max: 60 },
  },
  'drowned-shrine': {
    id: 'drowned-shrine',
    label: 'Drowned Shrine',
    themes: ['marsh', 'meadow', 'mountain'],
    containerCount: 3,
    color: '#7fd6d0',
    common: [
      { resource: 'arcane-dust', min: 1, max: 3, weight: 5 },
      { resource: 'fiber', min: 3, max: 5, weight: 3 },
    ],
    uncommon: [{ resource: 'lens', min: 1, max: 2, weight: 1 }],
    strongbox: [{ resource: 'draft-parchment', min: 1, max: 1, weight: 1 }],
    strongboxCoins: { min: 25, max: 55 },
  },
};

export function siteKind(id: SiteKindId): SiteKindDefinition {
  return SITE_KINDS[id];
}

/** Basis-point chance an ordinary (non-strongbox) container also holds one uncommon pick. */
export const ORDINARY_UNCOMMON_BPS = 4000;

/**
 * The rare salvage a far site's strongbox carries on every third refill. Phase 6
 * gives both a main source; until then this is the only one.
 */
export const RARE_STRONGBOX_SALVAGE: readonly ResourceId[] = ['construct-core', 'ancient-alloy'];
/** Area ring (Chebyshev distance from Elaris) from which strongboxes carry rare salvage. */
export const RARE_STRONGBOX_MIN_RING = 2;
