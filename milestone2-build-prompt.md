# Elaris — Milestone 2 (Efficiency Economy) Build Handoff

You are a senior gameplay engineer working in the **Elaris** repo (a local-first, single-player
top-down creature-taming survival-builder PWA: Vite + strict TypeScript + Phaser 3). Milestone 1
(the vertical slice) has shipped. Your job is to build **Milestone 2 features 1–5** below.

Read `wildstead-phase1-build-prompt.md` in the repo root first — it is the authoritative design
spec. The section names referenced below (e.g. "Capped offline work", "Farm, Blacksmith, and
working creatures", "Deterministic yield") point at exact formulas and rules you must follow
verbatim. Where this prompt and the spec agree, the spec's formulas win; where this prompt narrows
scope (e.g. gating), this prompt wins.

## Ground rules (non-negotiable — the existing codebase already follows these)

- **Simulation stays Phaser-independent.** All gameplay logic lives in `src/simulation/**` and
  operates on one serializable `GameState` (`src/simulation/state.ts`). Scenes render state and
  translate input into validated commands; they never contain rules. Content/tunables live in
  `src/content/**` and `src/config/**` — **no magic numbers scattered through systems.**
- **Determinism.** No `Math.random()` or wall-clock reads in simulation. Use the injected seeded
  RNG and injected clock. Node HP, tool damage, coins, and modifier basis points are fixed-point
  integers. The determinism test hashes a canonical snapshot — anything new that is authoritative
  gameplay state must be included; anything recomputable, or cloud/lease/`savedAt`/build metadata,
  must be excluded. Run `npm test` and confirm the determinism hash test still passes.
- **Commands revalidate atomically at resolution.** Crafting, smelting, selling, ordering,
  placement, and demolition validate all inputs and output capacity *before* consuming anything;
  a failed transaction consumes nothing.
- **Gating uses the UNLOCK-POINTS system, not tile/area pacing.** Access to every new placeable and
  the Iron tools is purchased through `src/simulation/unlockPoints.ts` (spend `state.unlockPoints`,
  push the id into `state.unlockedItemIds`). **Do NOT add `highestAreaTierEver` / tile-area pacing
  gates for new content, and do not reference tile thresholds in UI copy.** Register each new
  placeable and Iron tool id in `UNLOCK_COSTS` with a sensible point cost.
  - The predicate system in `src/simulation/unlocks.ts` (`UnlockRequirement`/`UnlockPredicate`)
    remains for **functional** prerequisites only — e.g. `materialDiscovered` (iron),
    `workstationAvailable` (Furnace/Workbench), `firstTamedSpecies`, `highestRatingEver` for
    Blacksmith/Farm contract ranks. Keep using it for those; just don't gate *pacing* by area.
  - Environment/terrain fit (`environmentKind`, `requiredTerrain`) still gates where a facility may
    physically operate — keep that.
- **Persistence + migrations.** Every new `GameState` field needs a migration in
  `src/persistence/migrations.ts` with a bumped `saveVersion`, plus a migration unit test. Never let
  an invalid/failed migration overwrite current, last-known-good, or the raw pre-migration backup.
- **Content validation.** Every non-cosmetic tool, placeable, producer, and contract must declare
  `efficiencyAxes` (`src/content/efficiency.ts` / `validation.ts`). The validation test must fail
  the build if any new reward omits them.
- **Tests are part of "done."** Add deterministic **unit tests** (Vitest) for every formula/threshold
  and **Playwright e2e** for each player-facing loop. Note from repo memory: e2e serves the built
  `dist` on port 4173 — run `npm run build` before `npm run test:e2e`, and the Phaser loop is frozen
  in the in-app browser pane, so verify movement/ticks via Playwright, not the pane. Everything must
  pass `npm run typecheck`, `npm test`, and `npm run test:e2e`.
- Keep sim edits and presentation edits cleanly separable; wire new UI through the existing
  `gameplayHud` / menu / command seams rather than reaching into simulation internals.

---

## Feature 1 — Iron / metal processing chain

Goal: iron ore → ingots → Iron (tier-2) tools, via a placeable Furnace with a processing queue.

- **Iron ore node.** Add an `metal` harvest node (iron vein in the hills biome) to world generation
  and the node content. It requires a **Stone pick or better** (`minimumToolTier`), drops iron ore
  on a deterministic single roll (reuse the "Deterministic yield" rule), and persists depletion +
  respawn timer like existing nodes.
- **Furnace placeable.** Add a `furnace` facility (indoor `environmentKind`). It smelts iron ore →
  iron ingot using **wood as fuel**, via a **processing queue** that stores `recipe`,
  `remainingWorkMs`, reserved inputs, completed output, and a `blocked` flag. A blocked/full output
  pauses work without deleting inputs or creating an invisible backlog. Queues persist and decrement
  by capped forward elapsed on load (see "Capped offline work" — queues use the
  `remainingWorkMs` decrement rule, NOT the cycle/remainder rule).
- **Iron tools (tier 2).** Add Iron axe / pick / sickle (and Iron combat gear if trivial to include)
  using the **same** `ToolDefinition` target/stat/repair data model as Wooden/Stone — no special-case
  tier code. Rank-0 Iron tools require iron ingots + Workbench and the `materialDiscovered: iron`
  predicate. Reuse the existing upgrade/repair/durability formulas from the spec ("Gathering, tools,
  durability, and upgrades"); do not fork them.
- **Gating:** register `furnace` and the Iron tool ids in `unlockPoints.ts` `UNLOCK_COSTS`. Smelting
  recipes and Iron tool crafts additionally require `workstationAvailable` (Furnace/Workbench) and
  `materialDiscovered: iron` via the predicate system.
- **Tests:** smelt-queue progress + blocking + offline decrement determinism; Iron tool eligibility,
  effective damage, break time, wear, nodes-per-tool-life (no divide-by-zero); a Wooden→Stone→Iron
  craft/repair path; migration of the new queue/ore state.

## Feature 2 — Firebase cloud save sync

Goal: cross-device save continuity, local-first, last-writer-wins by `revision`, losing snapshot
preserved. See spec "Local-first persistence and save portability" (cloud paragraph) and the
determinism exclusion list.

- Define a **`CloudSaveGateway` interface** (put it beside `SaveRepository` in `src/persistence/`).
  Implement a Firestore-backed gateway (anonymous Firebase Auth, optionally linkable to Google) that
  writes/reads the save document in the background. **Also ship an in-memory mock** implementation so
  all sync logic is unit-testable without a network or real Firebase.
- The local IndexedDB save stays **authoritative for live play**; cloud is a background reconciler.
- **Reconciliation:** last-writer-wins on the monotonic `revision`. Never field-merge. Always
  preserve the **losing** snapshot as a recoverable backup. Cloud metadata (account id, server
  timestamps) is excluded from the canonical determinism hash and from portable GameState.
- Handle offline, denied sign-in, and quota gracefully — treat all as normal, never block or corrupt
  local play.
- **Do not commit Firebase credentials/secrets.** Read config from env/`firebase` platform module and
  document the wiring step (project config, security rules) in the README as a maintainer task. The
  actual Firebase project setup / credential entry is left to the repo owner — build the code and
  tests against the interface + mock, and stub the real config.
- **Tests:** two-client divergence resolves by higher `revision` with the loser preserved; a stale
  writer cannot clobber; round-trip through the mock gateway restores all authoritative state.

## Feature 3 — Worker / housing loop (Farm Counter, Small Pen, Barn, producers)

Goal: order trained creatures from home, house them, and collect capped passive production. See spec
"Farm, Blacksmith, and working creatures" and "Capped offline work".

- **Placeables:** Farm Counter, Small Pen (contributes 1 housing slot), Barn (contributes 3). For one
  paddock, `buildingHousingSlots` = sum of valid housing facilities; capacity =
  `min(buildingHousingSlots, floor(paddockArea / 8))`. Register all three in `unlockPoints.ts`.
  (Housing still requires a valid paddock/`workYard` environment to *operate* — that's functional,
  not pacing.)
- **Farm orders:** the `FARM_ORDER_CONTRACTS` and `FARM_ORDER_COSTS` in `src/content/economy.ts`
  already exist — wire the Farm Counter UI + command to actually place orders. An order requires
  `firstTamedSpecies`, `highestRatingEver >= FARM_ORDER_RATING`, atomic coin cost, and both roster +
  valid housing capacity. Release/resale refunds ≤ 25% of coin cost.
- **Assignment states:** each owned creature is `follow` | `work` | `rest` — never follow+work at
  once. Invalid housing moves assigned creatures to safe `rest` and pauses work; nothing is deleted
  or duplicated. Max 3 active followers; roster cap 20.
- **Producers:** each worker job is a typed producer definition (`cycleMs`, optional `inputPerCycle`,
  `outputPerCycle`, required facility/storage bin, `efficiencyAxes`). A finite collection bin: full
  storage stops work, blocked cycles are lost (not banked). Passive output ≈ 20–30% of same-tier
  active collection.
- **Offline settlement:** worker cycles use the **cycle/remainder** rule from "Capped offline work"
  (`completedCycles = floor(availableMs / cycleMs)`, persist `nextEligibleRemainderMs < cycleMs`,
  default 8h cap, backward clock yields zero, a formerly-full bin never bursts). Follow the existing
  pattern in `src/simulation/offline.ts` and extend it — do not write a parallel settlement path.
- **Tests:** Pen/Barn slot math; invalid-housing rest transition + reassignment; roster cap; producer
  input/storage/8h-cap behavior; 24h-absence settles once, repeated reload gives zero, sub-cycle
  sessions accumulate to exactly one cycle, backward clock gives zero; order/release atomicity.

## Feature 4 — Species work roles wired into the overworld

> **Implementation status (2026-07-31): complete.** Stone Yard production,
> strongest-per-group Craghopper mining speed, Glade Stag mounting and Cart
> Dock entry transfers, Snarlfox worksite safety, migration, dedicated 3D
> facilities, and desktop/mobile browser coverage are implemented locally.

Goal: make Craghopper / Glade Stag / Snarlfox functional, not just defined in `content/creatures.ts`.
See spec "Creature roles" table and the Cart Dock / Logistics / Snarlfox rules.

- **Craghopper → Stone Yard:** stationed worker producing slow stone delivery into a collection bin
  (a producer per Feature 3). As a follower, its mining action-speed bonus must be the sole winner in
  its stacking group (no duplicate-multiplier stacking from multiple copies).
- **Glade Stag → mount + Cart Dock:** as a follower it is a 1.7× travel mount occupying one active
  follower slot. Assigned to a **Cart Dock** (linked by stable ID to one chosen container), on player
  entry it transfers eligible raw-resource stacks in inventory-slot order until the container is full,
  leaving the remainder with clear feedback. Invalid/missing link does nothing safely.
- **Snarlfox → worksite safety:** while inside its assigned worksite environment + a 6-tile
  perimeter, multiplies aggressive wild-creature detection radius by 0.75 for the player and simulated
  workers; no effect once an encounter has begun.
- Add the Stone Yard and Cart Dock placeables to `unlockPoints.ts`. Reuse the existing modifier
  stacking-group machinery for follower bonuses — configured caps, strongest-per-group, sum across
  groups.
- **Tests:** Stone Yard producer cycles; Cart Dock link + slot-order transfer + full/invalid
  destination + no-loss; Snarlfox radius multiplier scope; stacking-group cap prevents duplicate
  follower multipliers; mount slot occupancy + fourth-assignment rejection.

## Feature 5 — Stone / Metal construction + expanded storage & logistics

> **Implementation status (2026-07-31): complete.** Stone/Metal surfaces and
> boundaries, canonical Rating values, 50%-rounded demolition/rebuild flow,
> 24-space Warehouses, ordered stable-ID Logistics Hub routes, migration,
> dedicated 3D presentation, 2D fallback, and lossless routing tests are
> implemented locally.

Goal: finish the material ladder and the logistics tail. See spec "Building and Homestead Rating" and
"Player-created environments and area-gated placeables".

- **Stone and Metal building variants** for surfaces and boundary parts (wall, door, fence, gate),
  each with typed resource costs and `materialValue` (Stone 8, Metal 20). Register them in
  `unlockPoints.ts`. There is no in-place material upgrade — changing material is an atomic
  demolish/refund + separately validated rebuild. Demolition refunds 50% of original inputs
  (rounded down per material, never exceeding original inputs). These must flow through the existing
  Homestead Rating canonical component graph/formula (`structureScore = totalMaterialValue × N^0.4`)
  — verify Rating at epsilon `1e-9` across place / bridge-merge / articulation-split / material
  fixtures / reload.
- **Expanded storage + logistics:** larger/bulk storage containers and a **Logistics Hub** that
  stores an ordered list of stable source-worker + destination-container IDs, routing completed
  output to the first valid destination with space (else retains at source and pauses that job).
  Relinking is explicit and atomic. Register new storage/logistics placeables in `unlockPoints.ts`.
- **Tests:** Stone/Metal place/demolish/rebuild/refund/score fixtures; demolition rounding never
  exceeds inputs; Logistics Hub routing priority, full/invalid destinations, pause, relink,
  save/reload with no loss/duplication.

---

## Sequencing suggestion

Build in this order — each is independently testable and later features depend on earlier producer
infrastructure: **1 (iron chain) → 3 (workers/housing) → 4 (species roles) → 5 (construction &
logistics) → 2 (cloud sync)**. Cloud sync is orthogonal and can land last (or in parallel), since it
touches persistence rather than gameplay.

**Current position (2026-07-31):** Features 1, 3, 4, and 5 are complete.
Proceed with **Feature 2 — cloud sync** next. The 3D presentation remains the
primary implementation target; keep the 2D renderer functional as a fallback.

## Definition of done (per feature and overall)

- New content declares `efficiencyAxes`; content-validation test enforces it.
- New authoritative state is migrated (bumped `saveVersion` + migration test) and correctly
  included in / excluded from the canonical determinism hash.
- Unit tests cover every new formula, threshold, and edge case listed above; e2e covers each
  player-facing loop.
- `npm run typecheck`, `npm test`, and `npm run test:e2e` all pass (build `dist` before e2e).
- No tile-area pacing gates on new content; all access runs through the unlock-points system.
- README updated for any new player systems and the Firebase wiring/maintainer step.

Do not build all five in parallel in one giant commit. Land each feature as a focused, reviewable
change set with its tests green before moving on.
