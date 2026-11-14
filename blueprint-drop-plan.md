# Blueprint drop overhaul

Replaces the flat per-node percentage roll with **counters you can feel**, and
replaces the single global "any unknown blueprint" pool with **pools scoped to
where the blueprint came from**.

Two promises drive every decision below:

1. *Predictable* — a blueprint is owed to work done, not to luck. Every source
   counts, and every counter pays.
2. *Random* — you cannot say which strike pays, or exactly which recipe lands.

## What exists today (for reference)

| | Today | After |
|---|---|---|
| Node find | flat % per depleted node, by biome only | counter per node kind, per biome |
| Which recipe | uniform over *every* unknown blueprint | pool by source, tier-capped |
| Quality tiers | used only by the drafting table | drive every drop |
| Raider drop | flat 12% per defeat | counter per defeat |
| Creature drop | none | counter per species |
| Storm / fog | no blueprint role | storm caches; fog raises tiers |

## 1. Counters

State gains one field:

```ts
// GameState
blueprintProgress: Record<string, { struck: number; cycle: number }>;
// key: `${areaTheme}:${nodeKind}`, plus `raider` and `creature:${speciesId}`
```

Integers only, so `canonicalizeGameState` stays happy. Defaults to `{}`; the
migration adds nothing else.

**Base targets** (flat across biomes — the biome changes *rarity*, not speed):

| Source | Target | Jittered range |
|---|---|---|
| tree | 20 | 16–24 |
| berry-bush | 30 | 24–36 |
| plant | 30 | 24–36 |
| stone | 15 | 12–18 |
| metal | 15 | 12–18 |
| raider defeated | 8 | 7–10 |
| creature defeated (per species) | 10 | 8–12 |

**Jitter** is ±20%, seeded — not rolled at runtime:

```ts
target(key, cycle) = base + round(base * 0.2 * (2 * foldedRoll(
  coordinateHash(worldSeed ^ 0x4a495454, sourceIndex(key), cycle)) - 1))
```

The key's own text is hashed (FNV-1a) rather than looked up in an ordered list:
a list someone reorders later would silently move every player's pending target.
Stable across clients and reloads either way. When `struck >= target`, the drop fires, `struck`
resets to 0 and `cycle` increments — so the *next* target is a different number
in the band. A player feels "trees are about twenty" and can never count to it.

Scope is **per node kind × per area theme**: marsh trees and forest trees are
separate counters. Raider and creature counters are global (a raider is a
raider; a species is a species).

The current per-node `nodeHidesBlueprint` roll is **deleted**, not kept
alongside. One mechanism, one explanation.

Nothing is shown in the UI — the rhythm is felt, not read.

## 2. Tier ceilings by source

The `BlueprintQuality` tiers in `src/content/blueprintQuality.ts` finally do
work. Each source has a ceiling; within the ceiling, tier weights decide, and
members of a tier split its share evenly (same shape as `pickDraftedBlueprint`).

| Source | Ceiling | Notes |
|---|---|---|
| Resource nodes | Rare | biome sets the common:rare mix |
| Raiders | Epic | they only exist on danger nights |
| Creatures | Epic | pool is tiny and thematic |
| Storm caches | Legendary | the only routine legendary source |
| Caves (future) | Ancient | reserved — see below |

**Biome rare share**, in basis points, replacing `BLUEPRINT_FIND_BPS_BY_THEME`:

| Theme | Rare share |
|---|---|
| elaris | — (no nodes, no drops; unchanged) |
| meadow | 500 |
| forest | 1 000 |
| thicket | 1 500 |
| mountain | 2 200 |
| marsh | 3 000 |

**Fog nights** double the rare share of any node find, capped at 6 000. Working
outside in poison fog is the risk; better paper is the reward. Fog adds no new
drop source of its own.

**Ancient tier is removed from every pool.** The five `ancient-*` tools are
reserved for caves and are deliberately unobtainable until caves ship. The
drafting table is the one exception — it already rolls the full unknown set and
stays as it is.

## 3. Pools by source

A source's pool is `theme pool ∩ rolled tier`. Resolution order:

1. An **unknown** blueprint in the source pool.
2. Failing that, any unknown blueprint at or below the source's ceiling.
3. Failing that, a **duplicate** from the source pool — duplicates are
   legitimate loot. They register as "filed a duplicate", scrap to parchment,
   and trade, all of which already work in `carriedBlueprints.ts`. No new
   plumbing.

Level-gate blueprints stay in the pools. A drop handing over something you'd
have got at level 10 anyway is fine — it got there first.

### Theme pools

| Theme | Owns |
|---|---|
| meadow | thatch tier, starter wooden tools, arrow, cloth-mask, taming-snare, garden-bed |
| forest | wood tier, woodlot-planter, farm-counter, field-cache, bed, small-pen |
| thicket | taming and creature gear — reinforced-snare, barn, small-pen, bow, sickles |
| mountain | stone and metal tiers, furnace, stone-yard, cart-dock, stone-bridge |
| marsh | `reinforced-*` and `masterwork-*` tools, air-purifier, water, bridges |
| elaris | nothing — town stays barren by design |

### Raiders

Combat and defence: `war-table`, `turret`, `metal-*` parts, swords, bow,
`reinforced-*` and `masterwork-*` weapon variants.

### Creatures

**Derived, not tabled**: a species' pool is its own `work.eligibleWorksites`
from `src/content/creatures.ts`, so it drops the blueprints for the utilities it
can actually work at. A new species joins the system by existing.

| Species | Pool |
|---|---|
| Tuftle, Snarlfox, Mistmoth | small-pen, barn |
| Craghopper, Slingtail | stone-yard |
| Glade Stag | cart-dock |
| Masonmole, Bulwark Boar | war-table |
| Quillfinch | turret |

### Storm caches

Arcane storms get their own one-shot findable caches, built on the existing
`worldContainers` system: a seeded handful spawn in the current area when a
storm phase begins and vanish when it ends. Contents roll rare/epic/legendary —
the only routine legendary source in the game, and the reason to go outside
during the one night that has no raiders to fight.

## Files

| File | Change |
|---|---|
| `src/simulation/blueprintFinds.ts` | counters replace `nodeHidesBlueprint`; pool + tier resolution |
| `src/content/blueprintPools.ts` | **new** — theme/raider/storm pools, creature pool derivation |
| `src/config/balance.ts` | counter targets, jitter, biome rare shares; drop `BLUEPRINT_FIND_BPS_BY_THEME`, `RAIDER_BLUEPRINT_DROP_BPS` |
| `src/simulation/state.ts` | `blueprintProgress` |
| `src/persistence/migrations.ts` | version bump, defaults `{}` |
| `src/simulation/gameplayCommands.ts` | gather path increments the node counter |
| `src/simulation/raids.ts` | defeat path increments the raider counter |
| `src/simulation/creatureDefeat.ts` | the shared defeat payout increments the species counter, so both kill paths agree |
| `src/simulation/worldContainers.ts` | storm caches |
| `tests/unit/blueprintFinds.test.ts` | rewritten around counters |

## Settled during implementation

- **Counters follow the theme**, not the map instance: walking out of a forest
  and back does not reset it.
- **Storm caches respawn every storm**, and each one only *may* hold a
  blueprint — `stormCacheBlueprintBps`, shipped at 50%.
- **Containers never hand over duplicates.** A cellar or cache teaches its
  blueprint outright, so a duplicate from one would be nothing at all; those
  pay `EXHAUSTED_BLUEPRINT_COINS` instead. Duplicates are for finds that arrive
  as paper — nodes, raiders, creatures — where they can be filed, scrapped for
  parchment, or traded.
- **Collapsed Cellars got a source of their own** (`cellar`, ceiling Epic,
  pool = everything below Legendary). They predate this system and had to keep
  being the unthemed generalist, or a player who never fought a raider would
  have been locked out of the metal tier.
- **Every number is in Admin → Global Values**, under "Blueprint finds":
  per-kind counters, the raider and creature counters, jitter, per-region rare
  shares, the fog multiplier and its cap, both sets of tier weights, and the
  storm cache count and odds. The card prints the derived band ("16–24") and
  the fog-night rare share, because the raw fields do not say what they mean.

## Shipped

All of the above is implemented and covered: `npm run build` passes and the
1022-test unit suite is green, including counter distribution, region scoping,
seeded-target stability, the Ancient exclusion, storm cache spawn/sweep, the
v78 migration, and Admin validation.
