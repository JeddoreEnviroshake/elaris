# Outlands and Bases Plan

Status: planned, nothing built. Written 2026-11-15 as a handoff brief for an
implementing model. The user was unavailable while this was written, so every
open question has been decided here. The decisions are listed first so they can
be overturned in one place.

## Goal

Make Elaris play like a cross between Ark: Survival Evolved and Arc Raiders:

- **You have to go outside.** The materials that upgrade anything come only
  from the field, from places that are guarded and that refill.
- **Going outside is a run.** You leave with a purpose, carry something worth
  losing, and get home before the danger phase.
- **What you bring back becomes a base.** Salvage is spent on facility levels,
  better walls, gear and tools, and the base gets visibly more elaborate.
- **More things upgrade.** Facilities, building parts, tools, worn gear and
  creatures all gain upgrade tracks.

First person is the view the field loop is designed for. Building stays in the
overhead view, which build mode already forces.

## What each game contributes

This review is from knowledge of both games, not from fresh research.

**Ark: Survival Evolved.** The lasting pull is watching a base climb through
material tiers (thatch, wood, stone, metal), a station chain where each bench
unlocks the next, tamed creatures that are tools (haulers, gatherers), and
resource geography that forces trips to dangerous biomes. What drags it down is
upkeep: feeding troughs, decay timers, hunger and thirst meters, and random
item-quality rolls that make most loot junk.

**Arc Raiders.** The pull is the run: choose a destination because your
workshop needs a specific part, search containers while machines patrol, and
feel the weight of the bag on the way to the exit. Workshop benches level up
with found parts, weapons upgrade in tiers, traders hand out go-there missions,
a safe pocket keeps a little on death, and map conditions pay better loot for
more danger. What does not fit here is PvP and losing your whole kit.

**What Elaris already has.** A 10-minute safe phase and a danger phase (fog,
raid or arcane storm) that already works as a run timer. A death cache with a
map beacon and a 10-minute recovery window. Blueprints that must be carried to
a workbench. Four building materials, rooms, turrets and raids on the base.
Tool tiers, three blueprint-only grades above iron, and three upgrade axes.
Tamed creatures with work roles. A first-person prototype.

**What is missing.** Everything a base needs can be produced at the base
(garden bed, woodlot, stone yard, creature expeditions), so nothing requires
leaving. World containers are one-shot. Quests are passive achievements, not
errands. Buildings never upgrade. There is no worn gear. This plan fills those
gaps and adds nothing else.

## Decisions of record

| Question | Decision | Why |
| --- | --- | --- |
| Instanced raid maps or open world | Open, persistent world. The danger clock is the run timer | Instancing fights the area-snapshot model and the multiplayer plan |
| Do loot sites refill | Yes, every 2 survival cycles, on a counter. One-shot containers stay as they are | A run needs somewhere to go tomorrow; discoveries stay discoveries |
| Death penalty | Unchanged death cache. Add a small secure pocket from the Pack | Stakes without gear fear |
| Does worn gear drop on death | No, and gear has no durability | Losing armour makes players stop going out |
| PvP | None | Already decided in `online-multiplayer-plan.md` |
| Hunger, thirst, temperature | None | The fog, raid and storm cycle is the survival pressure; meters add chores |
| Multi-storey building | No | The sim is one tile layer; "elaborate" means sprawl, tiers, levels, defences and roofs |
| Random stat rolls on items | None | The game promises nothing fails randomly; upgrades are deterministic steps |
| What pays for upgrades | Salvage at your own benches. Coins stay for NPC services | Spending what you hauled home is the loop the user asked for |
| Can salvage be produced at base | Never. No facility, worker or creature expedition may yield it | It is the reason to leave |
| Stealth, hold-breath, noise | Not in this plan | Needs intent in sim state; revisit after Phase 1 is played |
| Default view | First person becomes the default on fresh devices in Phase 7, as a one-line change | The user said to plan for first person; the comfort verdict is still theirs |
| New weapon types | None | Scope; the upgrade tracks carry "more upgradable items" |

## Vocabulary

- **Salvage**: the new material family found only in the field.
- **Site**: a guarded ruin with several searchable containers that refill.
- **Strongbox**: the last container of a site. It holds the best loot.
- **Restock index**: `floor(survivalCycleIndex / restockCycles)`. Sites refill
  and the mission board turns when it changes. One rhythm for the player to learn.
- **Ring**: `max(|area.x|, |area.y|)`, the distance of an area from Elaris.
- **Mission**: an errand accepted at a board and turned in there.
- **Standing**: reputation earned from missions; it gates mission difficulty
  and some NPC stock.
- **Gear**: three worn upgrade tracks (Armour, Pack, Respirator).

## How to work in this repository

Read these before writing code. Each one has cost real debugging time.

1. **The working tree holds about 100 uncommitted files**, including the whole
   first-person prototype. Never run `git stash`, `git checkout --` or
   `git reset --hard`. Another agent (codex) may be editing `src/simulation`,
   `src/config` and `src/persistence` in this same tree. Re-read a file
   immediately before editing it. Commit only if the user asks.
2. **GameState holds integers only.** `canonicalizeGameState` in
   `src/simulation/determinism.ts` throws on a fraction. Use whole pixels,
   ticks, basis points, tenths or hundredths. Add a determinism test that
   hashes state mid-activity for every new system.
3. **Counters, not rolls.** Never call `Math.random` and never draw loot from
   `state.rngState`. Loot is a pure function of stable ids plus an index.
   `coordinateHash` returns a signed value; fold it with `foldedRoll` from
   `src/simulation/blueprintFinds.ts` before using it.
4. **Migrations.** `SAVE_SCHEMA_VERSION` is 89 in `src/config/versions.ts`.
   Check the top free slot in `src/persistence/migrations.ts` immediately
   before adding one, and bump the version in the same edit. Bump
   `CONTENT_VERSION` when definitions that saves reference change.
5. **Adding a bag item touches seven places**: `InventoryState` and the id
   unions in `state.ts`, `createInitialState` (inventory and stacks),
   `BAG_ITEM_IDS` / `BAG_ITEM_LABELS` / `DEFAULT_ITEM_WEIGHT_HUNDREDTHS` in
   `src/config/balance.ts`, `SELL_PRICES` in `src/content/economy.ts`,
   `src/simulation/inventoryStacks.ts`, storage defaults in
   `gameplayCommands.ts` and `storageBox.ts`, and the id lists plus validation
   in `migrations.ts`. Grep an existing item such as `mistmoth-scale` to find
   every site. This plan adds all nine new items in Phase 1 to pay that cost once.
6. **Adding a balance section touches six places**: the type in `state.ts`,
   `createDefaultGameBalance`, `validateGameBalance` in
   `src/simulation/admin.ts`, the validator and a migration in
   `migrations.ts`, the `parseGlobalBalanceSnapshot` backfill in
   `src/platform/globalBalance.ts`, and `src/ui/adminPanel.ts`. Records of
   records (`raiders`, `creatures`) need a per-entry merge in the backfill.
7. **Adding a buildable** needs: the `BuildingDefinitionId` union, `BUILDABLES`
   in `src/content/buildingParts.ts`, `BLUEPRINT_ITEM_IDS` in
   `blueprintKnowledge.ts`, a tile in `src/ui/blueprintCatalog.ts`, an
   `unlock-<id>` quest (see item 9), a mesh and a signature entry in
   `buildPlacedStructure` / `buildingVisualSignature` in
   `src/three/Elaris3DRenderer.ts`, and, for a facility, `PLACEABLES` in
   `src/config/areaGates.ts`, `FACILITY_MAX_HP`, `STRUCTURE_FACILITY_IDS` and
   `gameBalance.structures.facilityHp`.
8. **Adding a raider kind** needs: the `RaiderKindId` union,
   `RAIDER_DEFINITIONS`, a `gameBalance.raiders` entry with a migration and
   backfill, a rig in `src/three/raiderRigs.ts`, a chest-height entry, and an
   explicit exclusion from `raidWaveFor` if it must not join raid waves.
9. **The quest catalog is asserted.** `tests/unit/questCatalog.test.ts` expects
   exactly 220 quests and one `unlock-<id>` quest for every blueprint id that
   is not in its excluded sets. Read that test before adding any blueprint id,
   then either add the quest and update the count or add the id to an excluded
   set, whichever matches how the blueprint is obtained.
10. **Quest and mission rewards are claimed, never auto-credited.** Nothing
    pays out from a sim tick.
11. **Every priced button** shows carried over required (`12/8 Scrap Iron`)
    through `src/ui/costs.ts` and disables when short.
12. **Extend, do not rewrite.** `src/ui/gameplayHud.ts` is co-edited; make
    surgical edits. Extend `src/presentation/npcServiceModel.ts` by adding an
    offer builder and spreading it into `serviceOffers`.
13. **The camera never moves on its own.** The user gets motion sick. No bob,
    sway, shake, tween, easing or FOV change. Teleports are fade cuts. Things
    in the world may animate; the camera may not.
14. **Use `effectiveBagCapacityHundredths(state)`** (`src/simulation/npcStock.ts`)
    wherever the carry limit is read, and `isElarisSanctuary(state)` for any
    safety question.
15. **Verification.** Run `npm run typecheck` and `npm test` after every step.
    Run `npm run build` before any Playwright run, because the preview serves
    `dist`. Run e2e with `npx playwright test -c tmp/fp/playwright.gpu.config.ts`;
    software GL is too slow and fails specs for unrelated reasons. About 26 e2e
    specs already fail on this tree; record the failing set before starting and
    compare against it. The in-app browser pane freezes the game loop, so it
    cannot verify movement or ticks. In e2e, poll IndexedDB, never toasts, and
    select the action button by `[data-action-button]`.

Where this plan names a function or line, verify it still exists before relying
on it. The code moves.

## Phase order

Each phase ships on its own, with its own migration and tests. Phase 1 is the
go/no-go: if walking to a site, searching it and carrying the haul home is not
fun, stop and tune before building anything that spends salvage.

| Phase | Delivers | Depends on |
| --- | --- | --- |
| 1 | Salvage items, sites, searching, guards, compass | none |
| 2 | Facility levels, in-place part upgrades, tool tempering at the bench | 1 |
| 3 | Missions, standing, the War Table board | 1 |
| 4 | Gear tracks, the Armourer's Bench, secure pocket, saddlebags | 1 |
| 5 | Roofs, defences, decor, the build camera | 2 |
| 6 | Constructs, vaults, keys, the Recall Flare | 1, 3 |
| 7 | First-person field polish and the default-view switch | 1 |

Phases 2, 3 and 4 are independent of each other once Phase 1 has landed.

---

## Phase 1: Salvage and sites

### 1.1 The nine items

Add all nine in one migration. Three stay unused until their phase.

| Id | Label | Weight (hundredths) | Sell | First used |
| --- | --- | --- | --- | --- |
| `scrap-iron` | Scrap Iron | 200 | 4 | Phase 1 |
| `clockwork` | Clockwork | 150 | 12 | Phase 1 |
| `lens` | Glass Lens | 100 | 14 | Phase 1 |
| `arcane-dust` | Arcane Dust | 50 | 10 | Phase 1 |
| `construct-core` | Construct Core | 400 | 60 | Phase 1 (rare), Phase 6 |
| `ancient-alloy` | Ancient Alloy | 500 | 90 | Phase 1 (rare), Phase 6 |
| `sealed-satchel` | Sealed Satchel | 300 | 0 | Phase 3 |
| `vault-key` | Vault Key | 25 | 0 | Phase 6 |
| `recall-flare` | Recall Flare | 100 | 0 | Phase 6 |

Add a `SalvageId` union to `state.ts` and include it in `ResourceId`. Storage
Boxes and Warehouses must accept all nine.

The three zero-priced items must not be sellable. `sellResource` in
`src/simulation/economy.ts` has no guard today and would destroy the item for
no coins, so add a refusal when the price is 0 and keep those items out of the
market offers in `npcServiceModel.ts`.

### 1.2 Balance section

Add `gameBalance.outlands` following checklist item 6. Later phases add fields
to it with their own migrations.

| Field | Start | Meaning |
| --- | --- | --- |
| `restockCycles` | 2 | Survival cycles between refills |
| `sitesPerArea` | 2 | Ordinary sites generated per area |
| `searchTicks` | 120 | Ticks to search a container (2 s) |
| `strongboxSearchTicks` | 180 | Ticks to search a strongbox |
| `guardsPerSite` | 2 | Guards at an ordinary site |
| `guardLeashTiles` | 8 | How far a guard chases from its site |
| `strongboxBlueprintBps` | 3500 | Chance a strongbox carries a blueprint |
| `dangerBonusRolls` | 1 | Extra uncommon loot entries when searched in a danger phase |

### 1.3 Site definitions

New `src/content/sites.ts`:

- `SiteKindId = 'ruined-homestead' | 'collapsed-workshop' | 'drowned-shrine'`
  (Phase 6 adds `'warden-vault'`).
- Per kind: label, the area themes it may appear in, container count (3 to 5,
  the last being the strongbox), a common loot table, an uncommon loot table and
  a strongbox table. Entries are `{ resource, min, max, weight }`.

| Kind | Themes | Common | Uncommon | Strongbox adds |
| --- | --- | --- | --- | --- |
| Ruined Homestead | meadow, forest, thicket | scrap-iron 2–4, fiber, arrow, berry | clockwork 1 | coins, cloth-mask |
| Collapsed Workshop | mountain, thicket, forest | scrap-iron 3–5, iron-ore | clockwork 1–3 | iron-ingot, coins |
| Drowned Shrine | marsh, meadow, mountain | arcane-dust 1–3, fiber | lens 1–2 | draft-parchment 1, coins |

In areas of ring 2 or more, a strongbox also yields one `construct-core` or one
`ancient-alloy` on every third restock of that site (use
`restockIndex % 3 === siteOrdinal % 3`, not a roll). Phase 6 gives both a main
source.

Loot quantity scales with the area's level from `spawnLevel` in
`src/simulation/enemyLevels.ts`: add one unit to each common entry per three
levels. Keep every result a whole number.

### 1.4 Site simulation

New `src/simulation/sites.ts`. Sites are **derived, never stored**:

- `areaSites(worldSeed, area)` is a pure function returning each site's id
  (`${area.key}:site-${n}`), kind, anchor tile, container positions and guard
  posts. Place anchors with the same filter chain `generateAreaContainers` uses
  in `src/simulation/worldGeneration.ts` (not in water, not in a town precinct,
  not on a landmark, not within the Elaris walls), using a different seed salt.
  A site needs a clear 7×7-tile patch: test the anchor and the four corners.
  Elaris (`0,0`) has no sites. Memoise per area key in a module-level map; that
  cache is not game state.
- Because sites are derived, no `WORLD_GEN_VERSION` bump and no change to
  `AreaSnapshot` is needed, and areas visited before this phase gain sites.
- A site whose footprint overlaps any building in that area is suppressed. In
  `validatePlacement` (`gameplayCommands.ts`), reject placement inside a live
  site's footprint with "Ruins are in the way".

Stored state is sparse and small:

```ts
// GameState
siteProgress: Record<string, SiteProgress>;   // keyed by site id
activeSearch: ActiveSearch | null;

interface SiteProgress {
  restockIndex: number;      // the refill this record describes
  searched: number[];        // container indices searched this refill
  guardsDefeated: number;    // guards killed this refill
}
interface ActiveSearch {
  siteId: string; containerIndex: number;
  startX: number; startY: number;   // whole pixels
  hpAtStart: number;
  completesAtTick: number;
}
```

A record is created the first time the player comes within 20 tiles of a site,
which is also what marks the site as discovered for the map. A record whose
`restockIndex` is behind the current one is treated as empty and overwritten on
the next interaction.

Functions:

- `siteRestockIndex(state)` from `survivalCycleIndex` in `survivalCycle.ts`.
- `siteContainerLoot(worldSeed, siteId, containerIndex, restockIndex, level, inDanger)`:
  pure, seeded from those inputs only.
- `beginSiteSearch(state, siteId, containerIndex)`: refuses if already
  searched, out of `INTERACTION_RANGE_PX`, on cooldown, or during a pending
  respawn or encounter. Sets `activeSearch`.
- `advanceSiteSearch(state)`: called from `stepMovement` in
  `src/simulation/commands.ts` after hostiles advance. Cancels the search if
  the player has moved more than 4 px from the start point or has less HP than
  `hpAtStart`. On completion it grants loot with `tryAddResource`, spills what
  does not fit with `addGroundDrop`, marks the container searched, and returns a
  result the HUD can show.
- Strongbox blueprints go through `resolveBlueprintFind` with a new
  `BlueprintSourceKind` `'site'` whose quality ceiling is Rare, and enter the
  bag with `tryCarryBlueprint`, so they are carried, losable and draw raiders
  like any other found blueprint. Add a site pool in
  `src/content/blueprintPools.ts`.

### 1.5 Guards

Guards reuse the roaming-hostile machinery in `src/simulation/raids.ts`.

- Add optional `siteId?: string` to `RaiderState`. A guard is a `roaming`
  raider with `homeX` / `homeY` at its post.
- In Phase 1 guards are existing kinds: a Poacher and a Drifter per site, at
  the area's spawn level plus one.
- Spawn on the existing roamer cadence: for each site in the current area, if
  `guardsPerSite - guardsDefeated` exceeds the live raiders carrying that
  `siteId`, spawn the difference at their posts.
- Guards do not count toward `roamersPerArea`; filter them out of the quota in
  `spawnRoamersIfShort`.
- Guards leash at `guardLeashTiles`, not `roamerLeashTiles`.
- In `damageRaider`, a defeated raider with a `siteId` increments that site's
  `guardsDefeated`. Guards therefore return with the loot, not before.

### 1.6 Presentation

- **Site meshes.** Add site views to `src/three/presentationState.ts` and build
  them in `Elaris3DRenderer.ts` from procedural geometry, the way the regional
  landmarks are built: a broken ring of low walls, one crate or urn per
  container with distinct closed and searched states, and a tall banner pole in
  the kind's colour so a site reads from a distance in first person. Site walls
  are decoration and do not block movement in this phase. Make sure the
  first-person entity radius in `src/scenes/entityChunks.ts` covers them.
- **Targeting.** Add `'site-container'` to `CrosshairTargetKind` in
  `src/presentation/crosshairTarget.ts` and feed candidates from `WorldScene`.
  In first person the action button reads "Search Crate" or "Search Strongbox".
  In overhead view a tap on the container or the nearest-context action does
  the same.
- **Search feedback.** A progress ring at the crosshair (first person) or over
  the container (overhead), and a "Search interrupted" line when it cancels.
  Loot arrives through the existing resource flash.
- **Compass strip.** New `src/ui/compassStrip.ts`, with the pure pip maths in
  `src/presentation/compass.ts` and unit tests. A fixed strip at the top of the
  first-person view showing bearing pips for discovered sites in the current
  area, the death cache and the nearest owned bed. Pips slide only as a direct
  result of the player turning.
- **Maps.** Show discovered sites in `src/ui/worldMapPanel.ts` and
  `src/ui/worldNavigator.ts` with a state label: "Ready", "Searched 2/4" or
  "Refills next turn".
- **Rumour.** Extend Bram's Rumour offer so it can also point at the nearest
  site with unsearched containers.

### 1.7 Tests and done

Unit tests in `tests/unit/sites.test.ts`: generation is stable for a seed;
sites avoid town, water and landmarks; loot is identical for identical inputs
and differs across restock indices; a search cancels on movement and on damage;
overflow spills to the ground; guards return only on restock; a site under a
building is suppressed. Extend `determinism.test.ts` to hash mid-search and
`migrations.test.ts` for the new version.

One e2e spec: seed a fixture beside a site, search a container, and poll
IndexedDB for the salvage.

Done when a player can leave a base, see a site on the compass, fight or avoid
its guards, search it, and find it refilled two cycles later.

---

## Phase 2: Spending salvage on the base

### 2.1 Facility levels

Add optional `level?: number` to `BuildingState`. Absent means level 1, the
same convention `hp?` uses, so existing buildings need no rewrite.

New `src/content/facilityLevels.ts` holds costs and effects. New
`src/simulation/facilityLevels.ts` holds `facilityLevel(building)`,
`facilityUpgradeCost`, `facilityUpgradeBlockedReason` and
`upgradeFacility(state, buildingId)`. Upgrading requires being within
`BUILD_RANGE_PX`, pays the cost, raises the level and deletes `hp` so the
facility is restored to full.

| Facility | Level 2 cost | Level 2 effect | Level 3 cost | Level 3 effect |
| --- | --- | --- | --- | --- |
| Workbench | 12 scrap-iron, 4 clockwork | Tempers tools to rank 3 | 8 clockwork, 4 lens, 1 construct-core | Tempers to rank 4 |
| Furnace | 10 scrap-iron, 2 clockwork | Queue 4→6, smelt time −25% | 6 clockwork, 1 construct-core | Queue 8, smelt time −50% |
| Storage Box | 6 scrap-iron | 6→9 slots | 4 clockwork | 12 slots |
| Warehouse | 16 scrap-iron, 4 clockwork | 24→32 slots | 8 clockwork, 2 ancient-alloy | 40 slots |
| Air Purifier | 8 scrap-iron, 2 lens | Outdoor radius 1→2 tiles | 6 lens, 4 arcane-dust, 1 construct-core | Radius 3 tiles |
| Turret | 8 scrap-iron, 2 clockwork | Damage +50% | 4 clockwork, 2 lens, 1 construct-core | Range +2 tiles, cooldown −25% |
| War Table | 6 scrap-iron, 2 lens | 2 active missions (Phase 3) | 4 lens, 4 arcane-dust | 3 active missions |

Every level also adds 50% of the base maximum HP. Route each effect through one
helper so no caller re-derives it:

- HP: `structureMaxHp` in `gameplayCommands.ts`.
- Slots: `storageContainerSlots` in `src/simulation/storageBox.ts`.
- Furnace: queue capacity and work time in `src/simulation/processing.ts`. The
  offline path settles through the same functions; confirm it does.
- Purifier: `airPurifierProtectedCells` in `survivalCycle.ts`, which uses
  `OUTDOOR_PURIFIER_RADIUS_TILES`. Check that the danger fog mask in the
  renderer reads the same helper.
- Turret: where `raids.ts` reads `gameBalance.defense.turret*`, including the
  absent-base path that uses `turretAbsentRoundShots`.

Compute percentages in integer maths and floor the result.

Presentation: the facility panel in `gameplayHud.ts` gains a level line and an
Upgrade button with carried-over-required cost. Give each level a visible mesh
difference (trim colour, an added part) and include the level in
`buildingVisualSignature` so the mesh rebuilds.

### 2.2 Upgrading building parts in place

`upgradeBuildingMaterial(state, buildingId)` in `gameplayCommands.ts`:

- Applies to surfaces and boundary parts that have a `material`.
- The target is the same part in the next material: thatch → wood → stone →
  metal, keeping `surfaceKind` or `boundaryClass`.
- Requires `knowsBlueprint` for the target id.
- Cost is the target's cost minus what `demolitionRefund` returns for the
  current part, floored at zero per resource.
- Keeps the building's id, tile, edge and rotation, swaps `definitionId`,
  deletes `hp`, then calls the same progress updates placement does.

Add `upgradeBuildingBatch(state, ids)`, all-or-nothing, capped at
`MAX_BATCH_PARTS`, modelled on `src/simulation/batchBuilding.ts`.

Presentation: an **Upgrade Mode** button beside Delete Mode in the build
palette (`src/ui/buildMenu.ts`, `src/scenes/buildMode.ts`), with the same
grammar. The d-pad hops the cursor between upgradable parts, the cost shows in
the action bar, and a thumb Upgrade button is the only commit. Add an "Upgrade
room" action that batches every wall and door of the enclosure under the
cursor. Reuse the geometry in `src/scenes/deleteSelection.ts`.

### 2.3 Tempering tools at your own bench

Tools already carry `powerRank`, `speedRank` and `durabilityRank` (0 to 4),
bought from Mara for coins through `upgradeTool` in `src/simulation/economy.ts`.
Keep that path unchanged. Add a second way to buy the same ranks:

- `temperTool(state, toolId, axis)` and `temperToolBlockedReason` beside
  `upgradeTool`.
- Requires a usable Workbench in range (`nearestUsableFacility`) whose level
  allows the target rank: level 1 allows rank 1, level 2 allows ranks 2 and 3,
  level 3 allows rank 4.
- Costs, in `src/content/economy.ts`: rank 1 is 4 scrap-iron; rank 2 is 8
  scrap-iron and 2 clockwork; rank 3 is 6 clockwork and 2 lens; rank 4 is
  1 construct-core and 1 ancient-alloy.

Also add `scrapTool(state, toolId)` at a Workbench, which destroys a tool for
scrap-iron: stone tier 1, iron tier 2, Reinforced 4, Masterwork 6, Ancient 8,
multiplied by remaining durability over maximum and floored. Wooden tools
cannot be scrapped.

The Workbench panel gains a Temper section (tools by axis, with costs) and a
Scrap action behind a confirmation.

### 2.4 Tests and done

Unit tests for each level effect, upgrade cost arithmetic, the bench-level rank
gate, batch atomicity, and that an upgraded Storage Box never loses items.
Add the migration and its test.

Done when a haul from two sites buys a level-2 Workbench and that bench tempers
a tool past rank 1.

---

## Phase 3: Missions and standing

### 3.1 Model

New `src/content/missions.ts` (templates, reward tables, standing thresholds)
and `src/simulation/missions.ts`.

The board offers three missions per restock index. Offers are derived from
`(worldSeed, restockIndex, slot, standingTier)` and never stored. Slot 0 is
Recover, slot 1 is Cull, slot 2 alternates Deliver and Survey by restock index.

| Type | Objective | Completes when |
| --- | --- | --- |
| Recover | Search the strongbox at a named site | The search grants a `sealed-satchel`; hand it in at a board |
| Cull | Defeat N guards at a named site, or N roamers in a named area | The counter fills; report to a board |
| Deliver | Hand in N of one salvage type | Handed in at a board |
| Survey | Reach a named site and survey its banner (a search-length channel) | Channel completes; report to a board |

Target areas come from areas the player has visited and their neighbours, with
ring no greater than `standingTier + 1`. `areaSites` is pure, so a mission can
name a site in an area not yet visited, which is the point: it sends the player
somewhere new.

The satchel is a real bag item. It drops into the death cache like anything
else, and if the cache expires the mission fails. That is the tension a Recover
mission exists for.

```ts
// GameState
missions: {
  standing: number;
  rotationIndex: number;          // restock index the resolved list belongs to
  resolvedOfferKeys: string[];    // offers finished or abandoned this rotation
  active: ActiveMission[];
};
interface ActiveMission {
  key: string;                    // `${restockIndex}:${slot}`
  type: 'recover' | 'cull' | 'deliver' | 'survey';
  areaKey: string; siteId: string | null;
  resource: ResourceId | null;
  target: number; progress: number;
  ready: number;                  // 0 or 1; 1 means report to a board
  rewardCoins: number; rewardStanding: number;
  rewardResource: ResourceId | null; rewardAmount: number;
}
```

Store the resolved parameters at accept time so later content changes cannot
alter a mission in progress. Missions do not expire. A player may abandon one.

Commands: `missionOffers(state)`, `acceptMission`, `abandonMission`,
`reportMission` (pays the reward; this is the explicit claim) and
`recordMissionEvent`, called from the guard-defeat and search-complete paths.

### 3.2 Boards and limits

- **Bram's tavern** offers the board with a limit of one active mission. Add
  an offer builder to `npcServiceModel.ts`.
- **Your own War Table** is a board. Its level sets the limit: 1, 2 or 3 active
  missions. The War Table already unlocks the Turret blueprint, reports the
  coming raid, and is the worksite for two defender creatures. The board is an
  added role in its facility panel; leave the existing ones as they are.

### 3.3 Standing

Thresholds 5, 15, 30 and 50 give tiers 1 to 4. A mission pays 1 to 3 standing
by ring. Tiers unlock:

- Tier 1: missions in ring 2.
- Tier 2: missions in ring 3; Garrick sells the tier-2 gear blueprints (Phase 4).
- Tier 3: Recover missions add a `vault-key` to every third reward (Phase 6).
- Tier 4: mission coin rewards +50%.

### 3.4 Presentation

A Missions section at the top of the Quests tab; a board panel for the War
Table and Bram; mission targets as a distinct marker on both maps and as a
compass pip; a one-line tracker in the HUD status stack. Do not add missions to
`QUEST_DEFINITIONS`.

### 3.5 Tests and done

Unit tests: offers are stable for a seed and rotation and change with the next;
the active limit follows the board; each type completes only by its own rule; a
lost satchel fails its mission; reporting pays exactly once. Hash state with a
mission active in `determinism.test.ts`.

Done when a mission accepted at a War Table sends the player to a site they
have not visited and pays out on return.

---

## Phase 4: Gear

### 4.1 Model

Gear is three upgrade tracks, not inventory items. That keeps it out of the
bag, the death cache and the drop system, and makes every step an upgrade.

```ts
// GameState
gear: Record<GearSlot, { tier: number; rank: number }>;  // tier 0 = none
securedResources: ResourceId[];                           // length <= pack slots
type GearSlot = 'armour' | 'pack' | 'respirator';
```

Three tiers per slot, each with ranks 0 to 3. Crafting tier N requires owning
tier N−1 and resets rank to 0.

| Slot | Tiers | Effect |
| --- | --- | --- |
| Armour | Padded, Scale, Warden Plate | Reduces hits from raiders, creatures and storm strikes by `tier × 1000 + rank × 250` basis points, never below 1 damage. Does not reduce exposure |
| Pack | Field, Ranger, Hauler | Secure slots equal to the tier. Carry capacity `+ tier × 500 + rank × 250` hundredths |
| Respirator | Cloth, Filter, Warden | Adds `tier × 8 + rank × 2` seconds to the fog grace period. Cloth Masks still stack on top |

New `src/content/gear.ts` and `src/simulation/gear.ts`. Suggested costs: tier 1
is basic materials plus 6 scrap-iron; tier 2 adds clockwork (armour, pack) or
lens (respirator); tier 3 needs 2 construct-core and 1 ancient-alloy. Ranks
cost scrap-iron, then clockwork or lens, then arcane-dust.

Wire the effects at single points:

- Armour: add `mitigatedPlayerDamage(state, amount)` and call it where the
  player loses HP to a hit: `raids.ts` (raider hit), `creatureCombat.ts`
  (creature hit) and `arcaneStorm.ts` (strike). Leave the exposure drain in
  `survivalCycle.ts` and the taming scene in `encounters.ts` alone.
- Pack capacity: inside `effectiveBagCapacityHundredths`.
- Secure pocket: the player locks up to N resource stacks. `stashDeathCache`
  in `src/simulation/deathCache.ts` leaves those in the bag. Carried
  blueprints, tools and the `sealed-satchel` can never be secured.
- Respirator: `graceSeconds` is read twice in `survivalCycle.ts`, once for the
  on-screen grace timer and once where the drain is applied. Put the bonus in
  one helper used by both so the countdown and the damage agree, and apply it
  for the fog threat only.

### 4.2 Armourer's Bench

New facility `gear-bench` ("Armourer's Bench"), 2×1, requires a floor like the
Workbench. Cost: 10 wood, 6 fiber, 8 scrap-iron. Follow checklist item 7. All
gear crafting and ranking happens in its facility panel.

Gear recipes are blueprints. Tier 1 of each slot arrives by level gate in
`src/content/blueprintGates.ts`. Tier 2 comes from site strongboxes (Rare) or
Garrick at standing tier 2. Tier 3 comes from vaults (Epic, Phase 6). Add the
nine ids to the blueprint id types, `src/content/blueprintQuality.ts` and the
site pool, then resolve the quest catalog per checklist item 9.

### 4.3 Saddlebags

Add optional `saddlebagRank?: number` (0 to 3) to `OwnedCreatureState`. While a
creature's role is `follow` and it is not away on an expedition, each rank adds
1000 hundredths (10 weight) to bag capacity. Crafted at the Armourer's Bench
for two of that species' trophy and `4 × rank` scrap-iron. This makes a
follower the pack animal of a salvage run.

### 4.4 Presentation

A Gear card on the Character tab showing each slot's tier name, rank pips and
effect in plain numbers. A lock toggle on bag stacks in
`src/ui/inventoryPanel.ts`, showing used over available secure slots. A
saddlebag row on the creature panel.

### 4.5 Tests and done

Unit tests: mitigation never reduces a hit below 1; exposure is unaffected;
secured stacks survive a defeat and unsecured ones do not; capacity changes
with a follower's role; the respirator extends fog grace only. Add migration
and determinism coverage.

Done when the player can build a bench, craft all three tier-1 pieces, and
survive a death with a secured stack still in the bag.

---

## Phase 5: Elaborate bases

### 5.1 Roofs

Presentation only. For every enclosed floor environment (`environments` in
`src/simulation/environmentProgress.ts`), render a roof at wall height in the
majority wall material. Show roofs in first person, where they make a room feel
like indoors. Hide them in the overhead view so the inside stays visible, as it
is today. No sim change and no save change.

### 5.2 Defences and decor

- **Spike Trap** (`spike-trap`): a 1×1 facility with HP that can be placed
  outside an enclosure. A raider inside its tile takes 8 damage per second and
  the trap loses 2 HP per trigger. Hook this into raider stepping in
  `raids.ts`, route the trap's wear through `damageStructure`, and credit kills
  through `damageRaider` so bounties and counters still apply.
- **Decor**: `lantern`, `banner` and `planter-box`, each 1×1, cheap, with no HP
  and no Homestead Rating value. Rating feeds raid wave size
  (`waveRatingTenths`), so decoration must never make raids harder. Raiders
  ignore decor. Lanterns carry a small point light in first person.

Follow checklist item 7 for each. Check how `buildOccupancy` and raid
targeting treat a footprint that has no HP before adding the decor kind.

### 5.3 The build camera

Build mode is the bird's-eye mode. Make it work for a large base:

- While a ghost is out, the overhead camera frames the ghost, not the player.
  The ghost only moves when the thumb moves it, so this respects the comfort
  rule. Do not tween the change of target; cut.
- Add a zoom toggle to the build action bar with two fixed steps (normal and
  wide). The switch is instant.
- Raise `BUILD_RANGE_PX` in `gameplayCommands.ts` from 7 tiles to 14 and update
  the range ring in the renderer and any test that asserts 7.
- Entering build mode from first person already switches to overhead and
  leaving restores it; confirm that still holds with the new camera target.

### 5.4 Tests and done

Unit tests for the trap and for decor being ignored by raids and rating. A
screenshot check of a roofed room in first person using the headless capture
workflow in `tmp/`.

Done when a compound of several rooms can be laid out, upgraded and decorated
without the player walking to each wall, and standing inside it in first person
shows a ceiling.

---

## Phase 6: Constructs, vaults and extraction

### 6.1 Constructs

Two new raider kinds, following checklist item 8. Both are site-only: they
never join the ambient roamer quota or a raid wave.

| Kind | Role | Loot |
| --- | --- | --- |
| `sentinel` | Slow, heavy, hits hard. Roughly 3× a Breaker's HP | 1 construct-core |
| `watcher` | Fast, fragile, long aggro range | 2 clockwork, 1 arcane-dust |

Give them rigs that read as built things, not people: blocky stone-and-brass
forms with a glowing core, in `src/three/raiderRigs.ts`. All speeds are whole
pixels per tick.

### 6.2 Warden Vaults

Add site kind `warden-vault`. At most one per area, only in ring 2 or more,
present in about half of those areas by a hash of the area seed. Guarded by two
Sentinels and two Watchers. It has two ordinary containers and a vault door.

The vault door costs one `vault-key` to search and takes 240 ticks. It yields
1–2 ancient-alloy, 1–2 construct-core, coins, and a blueprint on a
`'vault'` source with an Epic ceiling. Add the tier-3 gear blueprints to that pool.

Keys come from a counter, not a roll: every sixth strongbox searched yields
one, using the jittered-target helper (`sourceTarget` and
`advanceBlueprintProgress` in `blueprintFinds.ts`) under a new progress key.
Recover missions at standing tier 3 also pay keys.

### 6.3 The Recall Flare

The extraction beat. `recall-flare` is crafted at a level-2 Workbench for
2 arcane-dust, 1 lens and 2 fiber, and used from the hotbar (`src/ui/hotbar.ts`).

- Lighting one sets `state.activeRecall = { x, y, completesAtTick }` with a
  600-tick (10 s) channel and consumes the flare.
- Every roamer and guard within 20 tiles turns hostile toward the player for
  the duration.
- The player may move and fight but must stay within 3 tiles of the flare.
  Leaving that radius cancels the recall and the flare is lost.
- On completion the player is moved to their nearest bed, using the same
  destination logic as `respawnDestinations` in `survivalCycle.ts`, or to the
  Elaris sanctuary or a field service site if they have no bed. Present it as a
  fade cut with the existing `src/ui/interiorTransition.ts`.
- It cannot be lit during an encounter, a pending respawn, or inside an
  enclosed room.

Add `recallChannelTicks`, `recallRadiusTiles` and `recallAlertTiles` to
`gameBalance.outlands`.

### 6.4 Tests and done

Unit tests: constructs never appear in raid waves or the roamer quota; a vault
refuses without a key and consumes exactly one; the key counter pays on its
jittered target; a recall cancels on leaving the radius and completes
otherwise; state hashes cleanly mid-recall.

Done when a full run exists: accept a mission, cross two areas, clear a vault,
light a flare, hold the ground and arrive home with alloy.

---

## Phase 7: First-person field polish

This absorbs the parts of Phase 5 in `first-person-view-plan.md` that the field
loop needs. Read that plan's comfort rules first; they are binding.

- **Threat indicators.** Edge arrows for hostiles that are attacking from
  outside the view. Static arrows that appear and disappear; no screen shake or
  red flash that moves.
- **Hands and tool.** The equipped tool held at the lower right, with a swing
  on strike and a reach-out during a search. The model moves; the camera does not.
- **Sky.** A fixed gradient dome tinted by the survival phase. No moving clouds.
- **Compass additions.** Mission targets, the recall flare point and the
  current base.
- **Look settings.** Sensitivity, invert-Y and a field-of-view choice from
  three fixed values, stored per device.
- **Default view.** Change the fallback in `src/three/firstPersonView.ts` so a
  device with no stored preference starts in first person. An existing stored
  preference always wins. Pin the overhead view for e2e by seeding the
  `elaris.viewMode` localStorage key from `openApp` (`tests/e2e/app.ts`) with
  an init script that runs before the app boots; `openApp` does not touch
  localStorage today. Land this as its own small change so it is trivial to revert
  if the user's comfort verdict goes the other way.

Done when a run from base to site and back can be played start to finish in
first person without opening the overhead view.

---

## Multiplayer note

`online-multiplayer-plan.md` splits state into shared world state and
per-member state. When this plan lands, add these rows to that split. Do not
build any networking here.

| New state | Belongs to |
| --- | --- |
| `BuildingState.level`, traps, decor | Shared world |
| `SiteProgress.guardsDefeated`, live guards | Shared world |
| `SiteProgress.searched` | Per member, so co-op partners each get the loot |
| `activeSearch`, `activeRecall`, `missions`, `gear`, `securedResources` | Per member |
| `saddlebagRank` | With the creature |

## Out of scope

Stealth and noise; new weapon types; weapon attachments; gear durability;
hunger, thirst and temperature; structure decay; multi-storey building;
blocking collision for site walls; power or wiring systems; boss fights;
trading between players. Each is a reasonable follow-up once the loop above has
been played.

## Balance numbers

Every number in this plan is a starting value, chosen so that the haul from two
ordinary sites buys one level-2 facility and weighs about 40% of the base carry
limit. Put anything a player can feel into `gameBalance.outlands` or the
content tables so it can be retuned from the Admin panel without a build.
