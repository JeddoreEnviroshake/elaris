# WILDSTEAD — Cross-Platform Phase 1 MVP Build Specification
*(Working title. A top-down creature-taming survival-builder with original GBA-era-inspired pixel art.)*

## Role and delivery goal

Act as a senior gameplay engineer and technical game designer. Build a **hosted, installable, local-first Progressive Web App (PWA)** that runs from the same codebase on phones, tablets, and computers.

The core loop is:

**explore → gather → craft, repair, and upgrade → create larger environments → place efficiency infrastructure → tame or order working creatures → gather faster**

Phase 1 remains single-player. Hosting the static web app does **not** mean moving the simulation to a server; the simulation always runs locally. Saves are local-first in IndexedDB and additionally sync to Firebase for cross-device continuity (Milestone 2). A push to the release branch must produce a phone-accessible HTTPS build without a cable, sideloading, or an App Store/Play Store update.

The old scope was too large to call a single vertical slice. Treat the whole document as a **Phase 1 MVP**, delivered as several independently playable, deployed milestones. Milestone 1 is the true vertical slice.

## Working product decisions

These decisions are confirmed by the owner (recorded in full under **Confirmed owner decisions** at the end):

- Ship one PWA build now; native store packages are a later option.
- Saves are local-first in IndexedDB and sync across devices through Firebase (Milestone 2); manual export/import remains the Milestone 1 portability path and a permanent fallback.
- Portrait is the designed, fully supported orientation. Landscape is playable using translucent overlay controls rather than a separate HUD layout; phone rotation is never forced.
- A qualifying environment is player-created, bounded, connected usable space; natural terrain does not count.
- Separate harvest targets from combat targets. People are never resources; `hostileNpc` is reserved for future humanoid combat and PvP, unused in Phase 1.
- Broken tools remain owned and repairable.
- Use a single coin currency for Farm, Blacksmith, and Market services. Coins are earned only by selling gathered/processed resources; there is no real-money or premium currency.
- Reuse discovered/tamed species as orderable trained animals in Phase 1 rather than adding a separate livestock roster.
- Homestead Rating is secondary feedback and an unlock signal, not the main reward or a spendable currency.
- Support and test every area threshold in Phase 1, while normal first-session pacing may end around 64 tiles. Provide deterministic test saves for 128 and 256.
- Provide a lightweight Quests/objectives tracker that surfaces the next progression goals; quests are guidance, not a separate reward economy.
- Audio stays out of Phase 1; retain a working mute/settings stub only.

## Product pillars

1. **Access anywhere.** One stable URL works on desktop and phone, can be installed, and works offline after its first successful load.
2. **Efficiency is progression.** Every required tool, upgrade, creature, facility, and milestone improves at least one collection bottleneck.
3. **Built space has utility.** Larger player-created environments unlock storage, repair, processing, renewable resources, workers, and logistics.
4. **Creatures have jobs.** A creature is useful as a follower, mount, defender, or stationed worker; it is not merely collectible.
5. **Losses create decisions, not restarts.** Durability and combat create upkeep, but upgraded tools and creatures are not silently deleted.
6. **Readable and original.** Placeholder visuals are clear on a small phone and do not imitate an existing franchise.

Every non-cosmetic reward must declare one or more efficiency axes:

`locate | travel | break | yield | pickup | carry | process | renew | uptime | safety`

Tool, upgrade, recipe output, placeable, creature follow/work role, producer, and Farm/Blacksmith contract definitions each carry `efficiencyAxes`. Only content explicitly marked `cosmetic: true` may use an empty list; a content-validation test fails the build otherwise.

The designer metric is:

`effectiveCollectionRate = expectedUnits / (searchTime + availabilityWaitTime + travelTime + interruptionTime + breakTime + pickupTime + depositTime + repairTime + processingTime)`

No single upgrade needs to improve every axis. The whole progression must remove bottlenecks in sequence so faster harvesting is not immediately cancelled by tiny storage, slow travel, constant repair, or backed-up processing.

## Delivery milestones

Each milestone ends with a production build deployed to the stable HTTPS URL and smoke-tested on a real phone. Do not build all systems in parallel.

### Milestone 0 — platform foundation

- Vite, strict TypeScript, Phaser, test runner, browser tests, pinned dependencies, and committed lockfile.
- Responsive player movement and camera in portrait, landscape, tablet, and desktop layouts.
- Installable PWA shell, offline app cache, visible build identifier, safe update prompt, and automated deployment.
- IndexedDB save repository, one-writer coordination, last-known-good backup, save export/import, and one migration fixture.

### Milestone 1 — true vertical slice

- Grassland/forest starter region; trees, plants, and boulders.
- Bare hands plus Wooden and Stone axe, pick, and sickle with power, speed, durability, breakage, and repair.
- Inventory, atomic crafting, building layers, environments, and exact 4/8/16 area gates.
- Field Cache, Workbench, and a functioning Woodlot Planter at area 16.
- Thatch and Wood building materials, Homestead Rating, one wild species, one encounter/taming path, and save/reload.
- Lightweight Quests/objectives tracker surfacing the next few goals through the onboarding arc.
- Onboarding through the first visibly faster collection loop.

### Milestone 2 — efficiency economy

- Iron/metal resource chain, Furnace, Iron tools, the first two upgrade ranks, Blacksmith coin-based services, and processing queues.
- Coin currency, the world Market (sell resources for coins), and coin-priced Farm/Blacksmith services.
- Firebase cloud save sync with last-writer-wins-by-revision reconciliation and preserved losing-snapshot backups.
- Exact 32/64 area gates, Farm Counter, Small Pen, Barn, worker assignments, and capped passive production.
- Remaining common biomes and at least two more species roles.
- Stone and Metal construction, expanded storage/logistics, and pacing through a 64-tile environment.

### Milestone 3 — Phase 1 breadth and hardening

- Exact 128/256 gates, rank-three Advanced Forge upgrades, and at least one functioning efficiency placeable at each.
- All four original species, mount, battle companion, roster/stationing, and complete iron progression.
- Automated tests for every formula and threshold; real-device lifecycle, update, offline, accessibility, and performance passes.
- Deterministic test seed/save that reaches all high-area systems without hours of manual gathering.

## Technology and repository constraints

- Use **Vite + TypeScript (`strict: true`) + Phaser 3**. Select stable versions at project creation, pin exact versions, commit the npm lockfile, and pin the Node major version. Use `npm ci` in CI.
- Required commands: `npm run dev`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
- Keep gameplay simulation, content definitions, persistence interfaces, and formulas independent of Phaser. Scenes render state and translate input into intentions/commands.
- Generate temporary 16×16 pixel-art game textures procedurally at boot and render at an integer 2–3× zoom where practical. Distinct silhouettes and palettes must remain readable on a phone.
- “No external assets” means no downloaded or third-party game art. Original PWA icons must exist before boot, so generate them at build time or commit original 192×192, 512×512, maskable, and Apple touch icons under `public/`.
- Put all tunable values in typed modules under `src/config/` or `src/content/`, with `balance.ts` exporting the combined balance configuration. Do not scatter magic numbers through systems.
- Add an `.editorconfig` declaring UTF-8. The design document itself is UTF-8.
- Target 60 fps on the named baseline mid-range phone. Pool/cull offscreen entities, cap render resolution/device pixel ratio, and optimize only after profiling rather than relying on absolute “no allocation” rules.

## Platform, installation, and deployment

Phase 1 is a static PWA served from a **stable HTTPS origin**. The same production build must run in a normal browser tab and installed standalone mode.

- Add a web app manifest with stable `id`, `name`, `short_name`, `start_url`, `scope`, `display: "standalone"`, theme/background colors, and original install icons.
- Add `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- Add a service worker that precaches the complete app shell and required production assets so the last complete build cold-launches offline after the first online session reaches **Ready offline**.
- Show **Ready offline** only after service-worker installation and precaching have completed successfully; a loaded page alone is not proof of offline readiness.
- Revalidate `index.html`, manifest, service worker, and build metadata. Cache content-hashed JS/CSS/assets as immutable. Never deploy HTML that points to deleted chunks.
- Host: **Firebase Hosting deployed from GitHub Actions**, public `main` production at one stable Firebase Hosting origin and preview-channel deployments for other branches/pull requests. GitHub Actions builds/tests once and deploys that exact `dist` with the pinned Firebase CLI (`firebase deploy --only hosting` for production; `firebase hosting:channel:deploy <name>` for previews) using a least-privilege service-account secret. Firebase is the single vendor for hosting, and Firebase Auth/Firestore back cross-device save sync (Milestone 2). Hosting credentials/project connection are the only deployment step allowed to wait.
- Configure the host so:
  - every pull request or non-release branch gets a phone-accessible Firebase Hosting preview-channel URL;
  - `main` deploys only after `npm ci`, typecheck, unit tests, production build, serving that exact `dist`, and PWA/browser tests against it pass;
  - the exact tested artifact is promoted atomically, or prior hashed chunks remain available for old clients;
  - Vite `base`, manifest `start_url`/`scope`, service-worker URL/scope, and hosting path agree;
  - production uses one stable origin so installed-PWA updates and local saves are not abandoned by routine releases.
- Show the build version/commit identifier in an About/Diagnostics panel.
- Document the stable URL, preview flow, installation steps, offline behavior, update behavior, and origin-specific save behavior in README.
- The game is installable where the browser supports PWA installation and remains fully playable in a normal browser everywhere in the support matrix.

### Safe application updates

- Check for updates after launch, reconnect, and return to foreground; do not delay initial rendering while checking.
- Do not replace code beneath a running session.
- When a new service worker is waiting, show a non-blocking **Update ready** notice.
- **Save and update** must successfully save, activate the waiting worker, wait for the controller change, and then reload.
- Before activation, coordinate all live same-origin clients. Defer activation and ask the player to close/reload the other copy if any client cannot save, release its writer lease, and acknowledge the update.
- Do not unconditionally call `skipWaiting()` or `clients.claim()` during install. Keep the previous build cache until no old-build client remains, or every old client has entered a fully loaded quiescent screen and acknowledged it will request no more old assets. A save-writer fence alone is insufficient for cache deletion.
- If save fails, keep the current session and offer retry/export; never reload and risk progress.
- An offline player continues using the previous complete cached build and is prompted after reconnecting.
- Also support the cold-start path: when Build A is closed before Build B deploys, B activates normally and migrates A's save before play.
- Use a programmatic install prompt where supported; Android Chrome is the Phase 1 install target. iOS/iPadOS is not a supported Phase 1 platform: the app should still load in Safari where possible, but is not tested or guaranteed there.

## Responsive display, input, and lifecycle

- Support phone portrait (minimum test viewport 320×568), phone landscape (568×320), tablet, 1366×768 desktop, and 1920×1080 desktop.
- Do not rely on one fixed canvas using only Phaser `FIT`. Use `EXPAND` or a bounded `RESIZE` strategy plus responsive camera zoom. Portrait uses the primary HUD; landscape reuses it with translucent overlay controls rather than a separate layout.
- Handle dynamic viewport resize, browser chrome, notches, rounded corners, and home indicators with CSS safe-area insets. Rotation must not reload or lose state.
- Let keyboard, mouse, and touch coexist. Do not permanently select an input mode from a one-time touch-device check. A setting may force touch controls on/off.
- Touch controls use Pointer Events, visible pressed states, configurable size/opacity, optional left-handed swapping, and hit regions at least 48×48 CSS pixels.
- Prevent page scroll, overscroll, pull-to-refresh, and accidental gestures on the game surface without breaking surrounding menu accessibility.
- Desktop: WASD/arrows move, Shift slow-walk, E context/interact, primary mouse/Space gather or attack, 1–5 hotbar, B build, C craft, I inventory, Esc cancel/menu.
- Touch: left joystick (partial magnitude slow-walk), right primary/context action, secondary/interact, hotbar, build/craft/menu buttons. Menus pause direct world actions.
- On `visibilitychange`/background: immediately attempt to flush pending state, clear held input, and pause active simulation. These lifecycle events are best-effort; only show **Saved** after the IndexedDB transaction commits.
- Before a backgrounded client performs offline settlement, resumes simulation, or accepts input, atomically renew/reacquire the writer lease. If its fencing token changed, discard stale in-memory state and reload the latest snapshot instead of continuing read-write play.
- Survive screen lock/unlock, page hide/show, WebGL context loss/recovery, reconnect, and installed/browser mode without duplicate timers or stuck controls.

## Simulation architecture and determinism

- Use one serializable `GameState` containing stable entity IDs and all authoritative gameplay state.
- Store at least `saveVersion`, `worldGenVersion`, `contentVersion`, `appVersion`, `savedAt`, world seed, and seeded RNG state.
- Use injected seeded randomness and an injected clock. Simulation systems must not call `Math.random()` or the wall clock directly.
- Use fixed-point integers for node HP, tool damage, and modifier basis points so small upgrades cannot vanish through floating-point or display rounding.
- Advance gameplay in a fixed simulation step; render/interpolate separately.
- Model player actions as validated commands. At resolution, atomically revalidate range, line of sight, cooldown, equipped instance, durability, and target state.
- Generate the base world from seed and persist sparse deltas: depleted node IDs/timers, placed parts, facilities, dropped items, creature state, and player changes.
- Derived values such as environment graphs, active modifiers, and score breakdowns must be reproducible from saved source state and recomputed on load.
- Determinism tests hash a canonical authoritative snapshot: recursively sort object/map keys and collections explicitly declared unordered; preserve queue, inventory-slot, hotbar, party, and other semantic order (or serialize explicit indices); encode only integers/booleans/strings/null; and exclude the local `SaveEnvelope` (revision/lease/fence/backup metadata), cloud sync metadata (account id, server timestamps), `savedAt`, app/build metadata, cached UI, rendered state, and recomputable score/environment/modifier breakdowns. Hash the canonical UTF-8 JSON with SHA-256.
- Gameplay-created stable IDs come from persisted monotonic counters or deterministic seeded world IDs, never wall-clock timestamps, unseeded randomness, or random UUID generation.
- Start with correct event-driven recomputation after a building edit. Optimize connected-component or environment updates only if profiling shows a need.
- Prepare only inexpensive future seams: pure simulation, serializable state, command validation, seeded RNG, and a `SaveRepository`. Do not implement speculative networking abstractions.

## Local-first persistence and save portability

- Define a `SaveRepository` interface. Implement `IndexedDbSaveRepository`; reserve `localStorage` for small preferences only.
- Allow one active save writer per origin/profile/save slot. Coordinate clients with a BroadcastChannel plus an IndexedDB lease containing a heartbeat, expiry, and monotonic fencing token. Secondary clients show **Game already open** and remain read-only until a safe takeover.
- Keep monotonic `revision`, lease epoch, and writer fencing token in a local persistence envelope outside portable GameState. Reject a stale client transaction even if its lease expired after the transaction began.
- Close old IndexedDB connections on `versionchange` and show a reload/takeover message rather than blocking schema migration.
- Rotate current and last-known-good snapshots in one IndexedDB transaction only after validation. Preserve the raw pre-migration backup until the migrated snapshot loads successfully.
- Critical irreversible mutations—taming, Farm/Blacksmith orders, unique tool upgrades, facility placement/demolition, and save import—must durably commit before success feedback. Ordinary movement/gathering saves after a short debounce with a maximum five-second rollback window; 30 seconds is only a dirty-state fallback.
- On hidden/`pagehide`, immediately attempt to flush pending state. Do not rely on `beforeunload` and do not promise persistence until **Saved** is shown.
- Handle quota, transaction, serialization, and migration failures visibly without erasing the in-memory or last-known-good game.
- Request persistent browser storage when available, but treat denial as normal.
- **Export Save** creates a versioned JSON Blob download and, when feature-detected, a share payload, with a download fallback. **Import Save** uses a standard file input, validates/migrates, and backs up the current save before overwrite. Do not require the File System Access API. **Reset Save** requires explicit confirmation.
- Export never includes local lease/revision/fence metadata. Import ignores any such untrusted fields, rebases the game onto a new local revision/fencing transaction, and cannot lower the monotonic fence counter. Reset also never resets that counter.
- Cross-device synchronization is provided through Firebase from Milestone 2. The local-first IndexedDB save remains authoritative for live play; a background task writes and reads the save document in Firestore under an anonymous account (optionally linked to Google sign-in). When two devices diverge, reconcile by **last-writer-wins on the monotonic `revision`** and always preserve the losing snapshot as a recoverable backup rather than discarding it; never attempt a field-level merge. Export/import remains available in all milestones.
- README must explain that local browser data is specific to origin, browser profile/storage container, installation context, and device; that cloud sync requires signing in to the same account on each device; that private browsing is not durable; that default preview channels have separate saves; and that clearing site data or uninstalling can remove local progress. Recommend signing in for sync, and export/import when switching between browser and installed contexts.

Save/load restores player state, inventory/hotbar, every tool instance and upgrade, structures, environments, facilities and queues, world deltas/respawn timers, Homestead Rating/unlocks, creature roster/assignments, encounter state, RNG state, and offline-production timestamps.

## World and resource nodes

- Fixed-seed island, approximately 160×160 tiles with size in balance config.
- Biomes: grassland, forest, rocky hills, and sand/water border. Water and rock faces collide.
- Guarantee an indestructible Starter Camp/home return point, safe spawn, reachable starter trees/plants/stone, an unobstructed first building plot, and reachable hills/iron. World generation must retry or repair invalid seeds deterministically.
- Place the Farm and Blacksmith service points near the starter region, while player-built Farm Counter and work facilities later reduce return trips.
- Harvest targets:
  - `tree` → wood;
  - `plant` → fiber and berries;
  - `stone` → stone;
  - `metal` → iron ore from hill veins.
- Each node definition has stable ID, target tag, HP, hardness, minimum tool tier, deterministic drop table, and respawn delay.
- Nodes shake/flash on a valid hit, display progress without requiring damage numbers, persist depletion across save/reload, and respawn from stored timers.
- Bare hands can affect trees/plants slowly and cannot affect stone/metal. Iron veins require a Stone pick or better.
- Resource renewal must scale enough that upgraded players do not permanently exhaust all nearby productive options.
- Wild spawn points also have stable seeded IDs, species tables, occupancy state, and respawn timers. Every required species must always have at least one reachable spawn path after despawn/failed encounters.

## Gathering, tools, durability, and upgrades

Harvesting and combat share target-aware action infrastructure but not resource semantics.

~~~ts
type HarvestTarget = 'tree' | 'stone' | 'metal' | 'plant';
type CombatTarget = 'wildCreature' | 'hostileNpc';
type TargetTag = HarvestTarget | CombatTarget;
type EfficiencyAxis = 'locate' | 'travel' | 'break' | 'yield' | 'pickup' | 'carry' | 'process' | 'renew' | 'uptime' | 'safety';

interface ResourceNodeDefinition {
  id: string;
  target: HarvestTarget;
  hp: number;
  hardness: number;
  minimumToolTier: 0 | 1 | 2 | 3;
  drops: DropDefinition[];
  respawnMs: number;
}

interface ToolDefinition {
  id: string;
  family: 'hands' | 'axe' | 'pick' | 'sickle' | 'weapon';
  tier: 0 | 1 | 2 | 3;
  baseActionMs: number;
  baseDurability: number | null;
  baseDamageByTarget: Partial<Record<TargetTag, number>>;
  wearMultiplierByTarget: Partial<Record<TargetTag, number>>;
  repairBasisCost: Readonly<Record<string, number>>;
  efficiencyAxes: EfficiencyAxis[];
}

interface ToolInstance {
  instanceId: string;
  definitionId: string;
  durability: number | null;
  upgrades: { power: 0 | 1 | 2 | 3; speed: 0 | 1 | 2 | 3; durability: 0 | 1 | 2 | 3 };
}

interface Modifier {
  sourceId: string;
  stat: 'damage' | 'actionSpeed' | 'wearReduction' | 'yield' | 'carry' | 'renewal' | 'processing';
  target?: TargetTag;
  amountBps: number;
  stackingGroup: string;
}
~~~

Tool families:

- Hands: emergency tree/plant gathering only; never breaks.
- Axe: primary tree damage; poor or zero elsewhere.
- Pick: primary stone/metal damage with hardness/tier gates.
- Sickle: primary plant collection and yield.
- Club/sword: `wildCreature` combat. `hostileNpc` remains reserved and unused in Phase 1.

Axe, pick, and sickle each progress Wooden → Stone → Iron. Combat equipment progresses Wooden Club → Stone Sword → Iron Sword and Fiber Vest → Iron Vest. Every definition uses the same target/stat/repair data model rather than special-case tier code.

Missing target damage means zero, not a default of one. Every eligible target on a breakable tool must pair a positive damage entry with a positive wear multiplier; hands are the explicit unbreakable exception. Friendly NPCs, tamed creatures, and Farm animals are protected from the normal context action.

Use these initial upgrade formulas, with constants in balance config:

For each modifier channel, select the strongest `amountBps` per stacking group, sum winners, clamp to that channel's cap, and divide by 10,000 to obtain the decimal `allowed...Buffs` used below.

~~~text
baseDamage       = tool.baseDamageByTarget[target] ?? 0
baseWearFactor   = tool.wearMultiplierByTarget[target] ?? 0
powerBonus       = min(0.75, 0.15 × powerRank + allowedPowerBuffs)
speedBonus       = min(1.00, 0.10 × speedRank + allowedSpeedBuffs)
durabilityBonus  = min(0.75, 0.25 × durabilityRank)
wearReduction    = min(0.50, allowedWearReductionBuffs)

effectiveDamage  = floor(baseDamage × (1 + powerBonus))
actionCooldownMs = max(250, round(tool.baseActionMs / (1 + speedBonus)))
maxDurability    = tool.baseDurability == null ? null : round(tool.baseDurability × (1 + durabilityBonus))
baseWear         = targetHardness × baseWearFactor
wear             = committedValidatedHit ? max(1, ceil(baseWear × (1 - wearReduction))) : 0
hitsToDeplete    = ceil(nodeHp / effectiveDamage)
breakTime        = hitsToDeplete × actionCooldownMs
nodesPerToolLife = floor(maxDurability / (wear × hitsToDeplete))
~~~

- `committedValidatedHit` means the command revalidated range, line of sight, cooldown, tool instance, positive damage and (for breakable tools) wear entries, tier, durability, and live target, then committed atomically.
- If `effectiveDamage <= 0`, return ineligible before calculating hits. Otherwise calculate hits/break time. If durability is null, report unbreakable and `nodesPerToolLife = Infinity`; if a breakable eligible tool has `wear <= 0`, fail content validation. Never divide by zero.
- Use fixed-point damage directly against fixed-point HP. Content validation must prove each Power rank lowers break time on at least one representative primary target for its intended tier; preferably every primary tier/target fixture.
- Below-minimum-tier and invalid-target actions deal zero damage, consume zero durability, and show the exact requirement.
- Only a connected, validated hit consumes durability. Empty swings, misses, cancelled actions, and rejected hits do not.
- A valid but mismatched tool may use a configured weak multiplier and about 2× wear; never hide the penalty.
- At zero durability, mark the instance broken, safely unequip it, retain all upgrades, and require repair. Never delete it.
- Repair uses the canonical `repairBasisCost` on ToolDefinition regardless of whether the instance was crafted directly, tiered up, or ordered. A repair action restores at least 25% of maximum durability (or the full missing amount when smaller). For each basis material:

  `repairCost = missingDurability > 0 ? max(1, ceil(repairBasisAmount × 0.50 × restoredDurability / maxDurability)) : 0`

- Increasing max durability preserves current durability percentage, preventing a free repair.
- Only permanent tier/rank changes maximum durability. Temporary durability effects reduce wear; applying/removing them never changes current/max durability or creates repair value.
- Upgrade material cost starts from a per-track base and scales as `ceil(baseUpgradeCost × 1.75^currentRank)`.
- Tier-up may consume the previous tool while preserving ranks; also allow a rank-zero direct craft for spare tools.
- Each higher matching material tier should reduce node break time by about 25–40% and provide about 1.75–2.25× matching nodes per repair cycle.
- Target repair cadence: Wooden 8–12 active gathering minutes, Stone 20–30, Iron 45–60.
- One tool life must collect at least three times its replacement/repair resource cost under intended use.

Modifier sources use typed stacking groups. Keep only the strongest modifier in the same group; add different groups, then apply configured global caps. The inventory/tool panel must show target power, action time, current/max durability, expected hits for the aimed node, and active bonuses.

### Deterministic yield

Roll a node's base drop once, with the injected RNG, only in the same atomic transaction that marks it depleted. A save/reload must never reroll a node. Apply capped yield modifiers per resource with a persisted fixed-point remainder:

~~~text
scaled = baseUnits × (10000 + yieldBonusBps) + yieldRemainderByResource[resourceId]
awardedUnits = floor(scaled / 10000)
yieldRemainderByResource[resourceId] = scaled % 10000
~~~

This makes small yield upgrades pay out over time without nondeterministic rounding. Persist remainders in GameState. If inventory is full, awarded units become one stable-ID ground drop; they are not discarded or rerolled.

## Inventory, crafting, repair, and processing

- Inventory starts at 20 slots; stack sizes and container capacities are typed balance values. Hotbar slots reference inventory instances rather than duplicating them.
- Full-inventory pickup remains on the ground with clear feedback. Crafting, repair, purchase, placement, and demolition are atomic transactions: validate all inputs and output capacity before consuming anything.
- Handcraft: basic Wooden tools, Taming Snare, Environment Marker, starter floors/boundaries, Field Cache kit, and Workbench kit.
- Workbench: Stone tools, sickles, weapons/armor, repair, building parts, and facility kits.
- Furnace: iron ore → ingots using wood as fuel. Queues store recipe, remaining work, reserved inputs, completed output, and blocked state.
- Rank-zero Iron tools/weapons require ingots and Workbench; ranks 1–2 require the world Blacksmith contract predicates, and rank 3 requires Advanced Forge.
- Recipe UI shows costs, output, workstation, unlock source, tool/facility efficiency axes, and placement requirement before crafting.
- A facility kit may be crafted and stored before a qualifying environment exists. **Craft eligibility and place eligibility are separate.**
- Unaffordable recipes are disabled with exact missing quantities. Batch crafting is bounded by ingredients, queue, and output space.
- A blocked output slot pauses processing without deleting inputs or creating an invisible backlog.

## Unlock ownership and prerequisites

Every recipe, contract, tool rank, and placeable has one typed, inspectable requirement. Do not distribute unlock logic across UI and systems.

~~~ts
type UnlockPredicate =
  | { kind: 'highestAreaTierEver'; atLeast: 0 | 4 | 8 | 16 | 32 | 64 | 128 | 256 }
  | { kind: 'materialDiscovered'; materialId: string }
  | { kind: 'highestRatingEver'; atLeast: number }
  | { kind: 'firstTamedSpecies'; speciesId: string }
  | { kind: 'workstationAvailable'; workstationId: string };

interface UnlockRequirement {
  allOf?: UnlockPredicate[];
  anyOf?: UnlockPredicate[];
}
~~~

Evaluation is exactly `predicateCount > 0 && every(allOf ?? []) && (anyOf == null ? true : anyOf.length > 0 && some(anyOf))`. Thus both groups combine with AND, no-predicate and explicitly empty-`anyOf` requirements fail. Truly free content is explicitly marked always-unlocked instead of using an empty requirement.

Normative ownership:

- `highestAreaTierEver` permanently discovers the placeable/producer blueprint family for that area. Current environment geometry separately gates placement and operation.
- `materialDiscovered` unlocks matching tool/building material recipes: Wood starter recipes, Stone after collecting stone, and Iron after producing the first ingot.
- `highestRatingEver` gates only explicitly named Farm/Blacksmith contract ranks; it does not duplicate area or material recipe ownership.
- `firstTamedSpecies`—not merely seeing a species—unlocks its Farm order.
- `workstationAvailable` is an execution requirement, not permanent ownership. Losing a workstation pauses that craft but does not erase a discovered recipe.
- Wooden rank-zero tools are handcraftable; Workbench crafts/repairs rank-zero Stone/Iron tools once their material predicate is met; the indestructible world Blacksmith orders rank-zero replacements and applies ranks 1–2 after their configured Rating predicates; the 256-area Advanced Forge applies rank 3 and bulk repair.
- Initial sticky Rating predicates are 100 for Blacksmith rank 1, 250 for trained-species Farm orders, and 500 for Blacksmith rank 2. Keep them in balance data and change them only with the versioned pacing fixture.
- Upgrade tracks are sequential: rank 2 requires rank 1 on that tool/track and rank 3 requires rank 2.
- Evaluate requirements in the pure simulation layer and return exact failed predicates to every UI. Demolishing a structure never lowers any “highest ever” field.

## Player-created environments and area-gated placeables

### Normative environment definition

An environment is a named, player-created usable region anchored by one basic Environment Marker:

- The starter Environment Marker is handcraftable and exempt from environment placement gates. Place it on a player-created surface; its cell counts toward area. Its stable entity ID is the environment ID.
- The marker declares one kind: `indoor` (floor) or `paddock`/`workYard` (prepared ground). Starting at it, flood four-way across only the matching surface kind when the shared edge has no logical boundary; floor and prepared-ground cells never mix in one environment. A wall, fence, door, or gate blocks this environment flood even while an open door/gate remains traversable by actors.
- A candidate indoor region is valid only when every perimeter edge is closed by a player-built wall/door. A candidate paddock/work yard uses prepared ground and must be closed by fences/gates.
- Valid regions contain exactly one marker. A second marker placement, or an edit that would merge two marked regions, is rejected atomically before changing state.
- Natural ground, water, cliffs, map edges, walls, boundaries, machines, and decorations do not add area or complete a perimeter.
- Area is the number of unique cells returned by the valid flood. One cell belongs to at most one environment; adjacent rooms/paddocks do not sum across logical boundaries.
- Facility footprints do not subtract area, but every footprint cell must lie on valid cells inside the same environment.
- The marker may move within its current valid region while retaining its ID. It cannot be removed while a facility is assigned to it.
- On a split, the component containing the marker retains the environment ID. A detached facility retains that ID but suspends until the original environment reconnects and qualifies; markerless cells are unclaimed and cannot operate facilities.
- Reject a new marker inside a detached component that still contains facilities assigned to the original marker. The player must reconnect it or dismantle/reassign those facilities through an explicit valid transaction first.
- Area, enclosure, filled-core shape, and environment tags are derived from source tiles/boundaries and revalidated after every relevant edit and on load/migration.

Prevent corridor-only exploits with an exact filled-core rule. In addition to total area, the region must contain at least one completely filled axis-aligned square of the required size; holes, facilities, and boundaries do not fill missing surface cells:

| Tier | Minimum area | Required filled core | Label |
|---:|---:|---:|---|
| 1 | 4 | 2×2 | Nook |
| 2 | 8 | 2×2 | Shelter |
| 3 | 16 | 4×4 | Workshop |
| 4 | 32 | 4×4 | Yard |
| 5 | 64 | 8×8 | Homestead |
| 6 | 128 | 8×8 | Compound |
| 7 | 256 | 16×16 | Estate |

Store `[4, 8, 16, 32, 64, 128, 256]`, geometry rules, and every placeable's `minEnvironmentArea`, required tags, footprint, limit, and efficiency axes in data. Do not write seven threshold-specific code paths.

### Area-gated efficiency progression

Bold items are the minimum representative content required for the Phase 1 release; other listed items are the first breadth additions.

| Minimum area | Example placeables | Collection purpose |
|---:|---|---|
| 4 | **Field Cache**, Tool Rack | More carry/deposit capacity; faster loadout swaps and uptime |
| 8 | **Workbench**, Garden Bed | Stronger/repaired tools; renewable nearby plants |
| 16 | **Woodlot Planter**, **Furnace** (Milestone 2), Sharpening Wheel | Renewable nearby wood; later metal processing and temporary tool speed |
| 32 | **Farm Counter**, **Small Pen**, Compost Bin | Order/house one worker; improve plant renewal |
| 64 | **Barn**, **Cart Dock**, **Stone Yard** | More worker slots; carrying/auto-deposit; closer stone supply |
| 128 | **Warehouse**, Minehead, Ore Washer | Shared bulk storage; better metal access/yield and processing |
| 256 | **Logistics Hub**, **Advanced Forge** | Route worker output; bulk repair/crafting; capstone upgrades |

Secondary environment tags prevent magical placement: Garden/Woodlot require suitable outdoor soil; Minehead requires hills/ore seam; indoor machinery requires a room; animals require a paddock/barn. Area grants capacity, not arbitrary resource generation. A placeable definition separates its player-made `supportFootprint` from optional `requiredAdjacentTerrain`/`naturalAnchorCells`; natural anchors may satisfy terrain proximity but never add area. Use this for Minehead, Stone Yard, and Woodlot.

- Reaching a tier for the first time permanently records `highestAreaTierEver` and discovers its configured blueprint family. Placement and operation always require the **current** environment to qualify.
- Placement preview is green/red plus an icon/pattern and text such as “Workshop 12/16; needs 4 more tiles” or “requires outdoor soil.”
- Failed placement never consumes the kit.
- Removing a floor/boundary that invalidates a placed facility leaves it and its contents in place but suspends operation with the exact reason. Repairing the environment reactivates it.
- Do not allow removal of a surface beneath a facility until the facility is safely moved/demolished.
- Splitting/merging environments cannot repeat unlock rewards, duplicate inventories, or create currency.
- Include a developer overlay showing environment ID, kind, boundary, area, largest qualifying filled core, tags, placed limits, and active/invalid facilities.

## Building and Homestead Rating

Use separate occupancy layers:

- terrain;
- player surface/floor cell;
- boundary edge (wall, door, fence, gate);
- facility/object footprint.

Building placement is grid-snapped with a ghost preview. Validity uses color plus icon/text. Demolition refunds 50% of original building-material inputs, rounded down per material, after contents/occupants are safely handled. Refunds never include animal order cost or stored contents and never exceed original inputs.

Building materials and `materialValue`:

- Thatch 1
- Wood 3
- Stone 8
- Metal 20

Player surfaces and boundary parts (wall, door, fence, gate) have Thatch, Wood, Stone, and Metal variants with typed resource costs. Starter progression may expose them by milestone, but Phase 1 final acceptance covers all four.

Canonical score graph:

- Scored anchor nodes are player surface/floor cells. Their connected components use four-way cell adjacency, regardless of environment doors/boundaries.
- Each player boundary edge (wall, door, fence, or gate) is assigned to the one surface component touching either side and is counted once. Because opposite surface cells are cardinal neighbors, an edge can never join two otherwise separate surface components.
- An unattached boundary edge with no adjacent player surface, Environment Markers, facilities, decorations, and stored items do not score.
- `N` is the component's surface-cell count plus its assigned scored-boundary count. `totalMaterialValue` sums the current material value of those same parts.
- A placed bridge surface merges components; removing an articulation surface may split them. Phase 1 has no in-place building-material upgrade: changing material means an atomic demolish/refund followed by a separately validated rebuild.

For each canonical component:

`structureScore = totalMaterialValue × N^0.4`

Total Homestead Rating is the sum across structures. Use IEEE-754 double precision internally, compare test fixtures at epsilon `1e-9`, and display the total/breakdown rounded to one decimal place.

Keep this code comment:

> This curve rewards consolidation and materials: one 48-block wood build scores about 2× six separate 8-block wood builds, and upgrading thatch to metal is 20× per scored block.

Homestead Rating:

- shows live total and per-structure breakdown;
- unlocks only explicitly configured Farm/Blacksmith contract ranks at configured milestones;
- records the highest reached milestone so a temporary demolition does not revoke unlocked contract ranks;
- is never spent and never grants repeatable rewards when structures split/merge.

Do not add a separate enclosure score bonus in Phase 1. Qualifying environments already give enclosure a functional reward.

## Farm, Blacksmith, and working creatures

Phase 1 includes thin **coin-priced services** — Farm, Blacksmith, and Market — backed by a single coin currency earned by selling resources.

### Market and coins

- Coins are the single Phase 1 currency. The only faucet is **selling** gathered or processed resources to the world Farm, Blacksmith, or Market; there is no combat, quest, or idle coin drop.
- Each sellable resource has a typed base sell price in balance data. Selling is an atomic transaction that removes items and credits coins, and the resulting balance change is shown.
- Coins are spent only on Blacksmith upgrades/orders and Farm orders in Phase 1. There is no rotating/daily stock, no real-money or premium currency, and no player-to-player trading.
- Persist the coin balance in GameState as a fixed-point integer; it is authoritative gameplay state included in save/load and in the canonical determinism hash.
- Sell prices and service costs are tuned together so services are meaningful sinks (see pacing targets); a resource's sell price stays well below the cost of anything crafted from it, so selling never dominates crafting.

### Blacksmith

- All mandatory progression tools remain craftable so vendor access cannot soft-lock the player.
- Workbench crafts and repairs unlocked rank-zero tools. The indestructible/reachable world Blacksmith orders rank-zero replacements and applies Power, Speed, and Durability ranks 1–2 in exchange for coins (plus any required material inputs) after their material and `highestRatingEver` contract predicates pass.
- The 256-area Advanced Forge applies rank 3 and batch repair from linked storage; it does not replace the accessible world Blacksmith for lower ranks.
- The Blacksmith UI compares before/after target damage, action time, max durability, repair cadence, and cost.
- Order/upgrade validates rank, coin balance, any material inputs, tool ownership, output capacity, and durable save in one transaction. Max-rank, missing-space, insufficient-coin, and missing-resource failures consume nothing.
- No rotating daily stock, premium currency, real-time wait, or random upgrade failure.

### Farm

- The world Farm introduces animal jobs. A 32-area Farm Counter lets the player place orders from home.
- To order another trained copy of a species, its ID must exist in `firstTamedSpeciesIds`, `highestRatingEver >= 250`, the player must pay its coin cost, and the roster plus a valid housing assignment must both have capacity. Sighting alone is insufficient.
- Small Pen is placed in a qualifying area-32 paddock and contributes one slot; Barn is placed in a qualifying area-64 paddock and contributes three. For one paddock, `buildingHousingSlots` is the sum of valid housing facilities and capacity is `min(buildingHousingSlots, floor(paddockArea / 8))`.
- An owned creature is assigned to **follow**, **work**, or **rest**—never follow and work simultaneously.
- Invalid housing moves its assigned creatures to safe `rest` state in the roster and pauses work; reassign when capacity returns. Animals and stored output are never deleted.
- A collection bin has finite capacity. Full storage stops work; blocked cycles are lost rather than banked for a later burst.
- Each worker job is a typed producer definition with `cycleMs`, optional `inputPerCycle`, `outputPerCycle`, required facility/storage, and `efficiencyAxes`. Input-free jobs use infinite `inputAllowedCycles`; there is no undocumented hunger/death system.
- Passive output should be about 20–30% of same-tier active collection. The first order should cost coins equivalent to about 15–25 minutes of current-tier gathering (at Market sell prices) and repay over roughly 45–90 active minutes.
- Release/resale is confirmed and refunds no more than 25% of the original coin cost.
- No breeding, genetics, hunger/death, randomized real-money-like shop, or unlimited duplicate-bonus stacking.

Creature roles:

| Species | Follow role | Stationed work role |
|---|---|---|
| **Tuftle** | Small plant-yield bonus | Slow configured fiber/berry cycles into a Pen/Barn collection bin |
| **Craghopper** | Mining action-speed bonus | Slow stone delivery at a Stone Yard |
| **Glade Stag** | Mount at 1.7× travel speed | While assigned to a Cart Dock, transfers carried raw resources to linked storage when the player enters that environment |
| **Snarlfox** | Reduces combat interruption and improves safety | While assigned to a worksite, reduces aggressive wild-creature detection radius there by a configured 25% |

If Craghopper remains +50% mining speed, make it the sole winner in its companion mining-speed stacking group. Multiple copies increase worker coverage/capacity, not the same follower multiplier.

- Cart Dock links by stable ID to one valid container chosen in its UI. On player entry, transfer eligible raw-resource stacks in inventory-slot order; stop when full and leave the remainder in inventory with clear feedback. An invalid/missing link does nothing safely.
- Logistics Hub stores an ordered list of stable source-worker and destination-container IDs. Route completed output to the first valid destination with space; if none exists, retain it at the source and pause that job. Relinking is explicit and atomic.
- A working Snarlfox affects the player and simulated workers while inside its assigned worksite environment plus a six-tile perimeter. It multiplies aggressive wild-creature detection radius there by 0.75 and has no effect once an encounter begins.

### Capped offline work

Use the injected clock and default eight-hour cap (`OFFLINE_CAP_MS`), tuned in balance data:

~~~text
forwardElapsed = now >= lastProcessedAt ? min(now - lastProcessedAt, OFFLINE_CAP_MS) : 0
availableMs = eligibleRemainderMs + forwardElapsed
completedCycles = floor(availableMs / cycleMs)
actualCycles = min(completedCycles, inputAllowedCycles, freeStorageAllowedCycles)
nextEligibleRemainderMs = jobStillEligibleAndUnblocked ? availableMs % cycleMs : 0
~~~

For a valid forward clock, set `lastProcessedAt = now` after settlement even when elapsed exceeded the cap or inputs/storage blocked work. If `now < lastProcessedAt`, process zero and keep the previous timestamp so moving the clock backward cannot create a later duplicate window. Persist only `nextEligibleRemainderMs < cycleMs`; discard time beyond the cap and blocked complete cycles. Reopening without clock advance produces zero, several eligible sub-cycle sessions can complete exactly one cycle, and emptying a formerly full bin never releases historical output.

Worker jobs use the cycle/remainder rule above. Node respawns and Furnace queues instead persist `remainingRespawnMs`/`remainingWorkMs` and decrement them by capped forward elapsed, advancing subsequent queued work only while inputs/output permit. They share the same forward/backward timestamp rule; player movement, battles, and encounter AI never advance while closed. Show one offline summary. Local clock manipulation cannot be secured in a local-only game; a future server may replace the clock authority.

## Wild creatures, encounters, and taming

Four original species:

| Species | Biome / temperament | Collection value |
|---|---|---|
| **Tuftle** | Grassland, passive | Renewable plant materials |
| **Craghopper** | Hills, neutral and fights back | Faster stone/metal gathering |
| **Glade Stag** | Forest, skittish and flees | Faster travel/mount |
| **Snarlfox** | Forest, aggressive and chases | Safer access to dangerous resources |

- Overworld creatures wander with simple steering. Aggressive creatures chase in a configured radius; skittish creatures flee. Shift or partial joystick movement enables slow approach.
- Contact/interaction starts a thumb-friendly turn-based encounter: **Attack / Throw Snare / Eat Berry / Flee**.
- The player acts first each round. After a player action resolves, an untamed creature that has not fled and remains above 0 HP takes one AI action; then the complete encounter state is durably saved.
- Attack damage is `max(1, floor(attackerPower × targetMultiplierBps / 10000) - defenderDefense)`; multiplier `10000` means 1.0×. Weapon power and armor defense are fixed-point integer values.
- Aggressive/neutral/passive species use their configured attack when present. A skittish creature at or below 25% HP instead attempts a configured 50% flee; a failed attempt ends its AI action.
- **Eat Berry** consumes one berry, heals 30% of player maximum HP up to the cap, and consumes the player's turn. Disable it with an exact reason when none are owned or health is full.
- **Flee** uses a configured base 75% seeded chance. Success returns to the same overworld position and gives that creature a short encounter cooldown; failure allows its AI action.
- Weapons use `wildCreature` target power. Armor/weapon values are data-driven. Friendly and owned creatures are not valid encounter targets.
- Taming Snare costs fiber + wood; a later Iron Snare has a better tier multiplier.
- Success:

  `chance = clamp(speciesEase × snareTier × (1.5 - hpPercent), 0.05, 0.90)`

- Disable **Throw Snare** before item consumption or RNG when the creature is at 0 HP or the roster is full. Otherwise throwing consumes the item and player's turn. On failure the creature takes its AI action.
- Successful taming transfers that wild entity into the roster with a stable owned ID, vacates its spawn, and starts the spawn's configured replenishment timer. A successful creature-AI flee also vacates the spawn and starts that timer. At 0 HP, the wild creature flees/despawns the same way and cannot be snared; there is no death or harvested animal resource.
- Maintain a persistent roster (default cap 20), separate from the maximum three active followers. A mounted Glade Stag occupies one active follower slot. A fourth follow/mount assignment is rejected with a choose-replacement UI; never silently dismiss another follower. Non-active creatures may rest or work in valid housing.
- On player defeat, atomically end the encounter and return to the Starter Camp with full health. Retain only explicitly `bound` unique equipment/upgrades, owned creatures, and key items. Put 100% of portable resources, processed materials, consumables, and placeable kits into a recoverable satchel at the encounter's reachable overworld tile.
- Allow one active death satchel. If the player falls again before recovery, the previous satchel and contents are lost and replaced by the new one; this prevents unlimited caches or intentional haul teleportation. Satchels accept no manual deposit.
- Save at encounter start and after every resolved round. Reload resumes the exact turn boundary with saved RNG state; it cannot reroll a snare, flee, damage, or drop result.

## HUD, UX, onboarding, and accessibility

- HUD: health, five-slot hotbar, aimed target/HP feedback, current tool power/action time/durability, inventory capacity, coin balance, Homestead Rating, active creature role, current quest objective, and build/update/save status.
- Menus: 20-slot inventory, crafting/repair/upgrade comparison, building catalog, environment panel, Farm/Blacksmith/Market services, quest log, creature roster/assignments, score breakdown, settings, diagnostics, and save management.
- Context action priority must be deterministic and shown: UI/menu → placed facility → friendly interactable → resource gather → wild encounter → empty swing.
- Onboarding sequence:
  1. punch a tree/plant;
  2. craft the matching Wooden tool and see faster break time;
  3. observe durability and repair guidance before the first break;
  4. create a four-tile environment and place a Field Cache;
  5. expand to eight and place a Workbench;
  6. reach 16, place a Woodlot Planter, and verify nearer renewable wood plus Rating feedback;
  7. weaken and tame a Tuftle;
  8. assign it to follow and verify its plant-yield gain;
  9. after reaching 32, place Farm Counter + Small Pen, switch Tuftle to work, and collect its first bin output.
- Never rely on red/green alone. Use icon, pattern, and text for placement and status.
- Provide readable text sizing, high contrast, visible keyboard focus, reduced motion/screen shake, UI scale, control opacity/size, and left-handed touch layout.
- Menus and critical actions must remain usable at browser text zoom and in both orientations.

## Quests and objectives

Provide a lightweight, data-driven quest tracker that turns implicit progression into visible goals. Quests are guidance and pacing, not a separate reward economy; completing one may grant a small coin or resource stipend but never a unique upgrade unavailable through normal play.

- Each quest is a typed definition with an ID, a short title, a completion predicate that reuses existing `UnlockPredicate`/state checks (area tier reached, material discovered, workstation available, first tame, Rating milestone, coin threshold), and an optional small reward.
- The HUD shows the current active objective; a quest log lists active and completed quests. Completion is derived from authoritative state and revalidated on load, so quests cannot be double-completed after save/reload.
- Quests activate in a configured sequence but never block play; a player may progress past a quest's target and have it auto-complete.
- Example Phase 1 quests: "Craft your first Wooden tool", "Reach Shelter (area 8)", "Build a Workbench", "Smelt your first iron ingot", "Tame a Tuftle", "Sell resources at the Market", "Reach Homestead (area 64)", "Build a metal-tier structure".
- Quest definitions live in `content/quests`; do not hard-code quest logic in UI or systems.

## Balance and pacing targets

Treat these as first-pass targets, then tune using playtests and the effective collection rate:

| Milestone | Target fresh-save time |
|---|---:|
| First Wooden tool | 3–5 min |
| Area 4 | 5–8 min |
| Area 8 | 10–15 min |
| Area 16 | 20–30 min |
| Farm / area 32 | 40–60 min |
| Area 64 | 75–100 min |
| Area 128 | 2.5–3.5 hr |
| Area 256 | 4.5–6 hr |

These times are measured with the **cheapest qualifying building materials** (thatch/wood). Reaching a given *area* is deliberately decoupled from **material value**: a premium stone or metal build of the same footprint is a much longer, optional endgame goal driven by Homestead Rating rather than the area gates, and is expected to take far longer than the area-256 time above. Do not slow the area curve to account for premium materials; let Rating milestones carry the long tail.

- Each major tier improves a current bottleneck by at least 20%.
- No single unlock more than doubles total effective collection rate.
- Late Phase 1 throughput target is roughly 8–12× bare hands after travel, deposit, repair, and processing are included.
- If the intended normal Phase 1 session is only 60–90 minutes, organic content ends at 64; validate 128/256 through a supplied test save instead of forcing grind.
- Measure times with one versioned deterministic route fixture that includes every required marker, surface, boundary, facility, prior tame, contract input, housing step, travel, deposit, and repair. Record the seed, command route, loadout, and balance version.
- Producer/renewal rates compare ten simulated minutes of their full cycle/input/storage behavior against ten minutes of same-tier active gathering including availability waits, travel, interruptions/combat recovery, deposit, repair, and processing.

## Performance and test strategy

- Unit-test pure systems with deterministic seeds: world generation guarantees, inventory transactions, recipes, tool math, upgrade rounding, durability/repair, modifier stacking, score merge/split, environment detection and exact thresholds, Farm capacity/production, battle/taming, and save migrations.
- The same seed, initial state, clock values, RNG state, and command sequence must produce the same canonical state hash.
- Browser tests cover one full desktop loop and one mobile-emulated loop, install/update behavior where automatable, save export/import, and offline app load.
- Keep real-device smoke tests on the Android Chrome baseline (**Samsung Galaxy S25 Ultra**); DevTools emulation is not sufficient by itself. iOS/iPadOS is out of the Phase 1 support matrix and is not required to pass.
- Support/performance baselines are the **Samsung Galaxy S25 Ultra (Android Chrome)** for mobile, plus current and previous major desktop Chrome, Edge, and Firefox. Because the S25 Ultra is a flagship that will hide performance problems a weaker phone would surface, also run at least one 4× CPU-throttled profiling pass to approximate a mid-range phone.
- The stress fixture contains at least 150 visible resource nodes, 20 visible creatures, 1,000 scored building parts, 20 active facilities/workers, particles, and the full HUD.
- Profile for five minutes on the named baseline phone (Samsung Galaxy S25 Ultra) and once more under 4× CPU throttling. Target 60 fps, p95 frame time ≤16.7 ms, p99 ≤33.3 ms, and no unexplained main-thread task over 100 ms.
- Include debug/test controls behind a non-production flag: grant materials, set tool ranks/durability, build exact environment sizes, advance queues, spawn/tame species, and load 128/256 fixtures.

## Suggested source structure

~~~text
src/
  main.ts
  scenes/              Boot, World, Battle, UI
  simulation/          commands, fixedStep, state, rng, clock
  systems/             worldgen, gathering, inventory, crafting, tools,
                       building, environments, scoring, facilities,
                       creatures, farm, market, quests, battle
  content/             resources, tools, recipes, placeables, creatures, quests
  config/              balance, platform, accessibility
  persistence/         SaveRepository, IndexedDbSaveRepository, cloudSync, migrations
  platform/            pwa, updates, buildInfo, lifecycle, responsiveLayout, firebase
  art/                 proceduralTextures
  ui/                  hud, menus, touchControls, accessibility
tests/
public/
  icons/
  manifest.webmanifest
~~~

## Explicitly out of scope for Phase 1

- Multiplayer, shared world, netcode, matchmaking, authoritative server, state replication, rollback/prediction, PvP.
- Real-time multiplayer state, remote config, analytics, or telemetry upload. (Firebase Auth for anonymous/Google sign-in and Firestore-backed save sync are in scope from Milestone 2; reconciliation is limited to last-writer-wins with preserved backups.)
- Native Android/iOS/desktop wrappers, store submission, platform billing, or push notifications.
- Rotating/daily shops, real-money or premium purchases, player-to-player trading, breeding, genetics, or animal death. (A single coin currency earned by selling resources is in scope.)
- Friendly-NPC attacks, humanoid combat, PvP, or treating people/animals as harvest resources. (`hostileNpc` and PvP are reserved for a future phase.)
- Deep autonomous factory chains beyond the bounded Phase 1 worker/logistics examples.
- Production audio (keep a working mute/settings stub), day/night, weather, seasons, roofs/multiple floors, and decorative-only content.
- Third-party or franchise-derived names, creature designs, sprites, sounds, or visual imitation.

## Acceptance checklist

### Delivery, install, and updates

- [ ] A `main` push runs `npm ci`, typecheck, unit tests, production build, serves/tests that exact `dist`, and atomically deploys the tested artifact to stable HTTPS.
- [ ] Stable production and Firebase preview-channel URLs open on a phone without a cable, native package, or store update; build ID and environment are visible.
- [ ] Manifest fields/icons/service-worker scope match hosting/Vite base. Android Chrome installation is verified. iOS/iPadOS is out of Phase 1 scope and not required.
- [ ] A full gather/build/tame/save smoke loop passes on the physical Android Chrome baseline (Samsung Galaxy S25 Ultra), in browser and installed mode.
- [ ] After **Ready offline**, airplane mode + cold launch runs the complete cached milestone and can save.
- [ ] Foreground path: Build A → save → deploy B → Save and update loads B with the migrated A save.
- [ ] Cold path: close A → deploy B → cold-launch B migrates and loads A's save safely.
- [ ] Multi-client path: open A twice → deploy B → one client updates; the other cannot block migration, overwrite B, or request deleted A assets.
- [ ] Update activation waits for successful save/client coordination; old caches remain until no old client remains or every old client acknowledges a quiescent no-request state.

### Responsive play and accessibility

- [ ] The complete loop is usable at 320×568 portrait, 568×320 landscape, tablet, 1366×768, and 1920×1080.
- [ ] Rotate/background/lock/resume and pagehide → pageshow/back-forward-cache restoration do not duplicate timers, stick input, hide controls, or corrupt state.
- [ ] Forced WebGL context loss/restoration recreates procedural textures and resumes without a reload or blank entities.
- [ ] Touch and mouse/keyboard can be switched in one session; all required touch targets are at least 48×48 CSS pixels.
- [ ] Every invalid placement/status is understandable without color, and reduced-motion/UI/control settings work.

### Saves and determinism

- [ ] IndexedDB survives reload, browser restart, offline launch, and a PWA code update.
- [ ] A second same-profile client is read-only; lease expiry/takeover and fencing-token tests prove a stale writer cannot commit.
- [ ] A backgrounded former writer must reacquire before resume; takeover forces it to discard stale memory and reload.
- [ ] Importing fake high/low revisions or fence tokens rebases locally, and reset/import never lowers the monotonic fence counter.
- [ ] Critical mutation success is shown only after durable commit; ordinary-state rollback after forced termination never exceeds five seconds.
- [ ] Invalid/future saves and failed migrations never overwrite current, last-known-good, or raw pre-migration backup.
- [ ] A phone export imported on desktop restores all authoritative state.
- [ ] Firebase sync round-trips a save between two signed-in devices; a divergent edit resolves by last-writer-wins on `revision` and preserves the losing snapshot as a recoverable backup.
- [ ] One previous-version fixture migrates in an automated test.
- [ ] Identical seed/state/clock/RNG/commands produce an identical SHA-256 canonical state hash under the specified ordering/exclusion rules.
- [ ] README explains origin/profile/installation-context/device-local saves, preview isolation, export/import, deletion, uninstall, and private-mode risks.

### Gathering and tools

- [ ] Tree, stone, metal, plant, wild-creature, and reserved hostile-NPC targets are separate typed tags.
- [ ] Hands, axes, picks, sickles, and weapons have explicit paired damage/wear target entries or are explicitly ineligible.
- [ ] Deterministic tests calculate eligibility, effective damage, action time, hits-to-deplete, break time, wear, and nodes-per-tool-life without null/divide-by-zero behavior.
- [ ] Every Power rank lowers representative primary-target break time; Speed and Durability ranks meet their configured visible improvements.
- [ ] Only validated hits deal damage/wear. Invalid/under-tier hits give a reason and consume nothing.
- [ ] Base drops roll once; yield caps, stacking, fractional remainder, ground overflow, and save/reload determinism pass.
- [ ] Broken upgraded tools remain repairable; direct craft/tier-up/order share canonical repair basis and no upgrade/buff grants free repair.
- [ ] Complete Wooden → Stone → Iron craft, repair, rank-zero order, Blacksmith ranks 1–2, and Advanced Forge rank 3 work atomically and persist.
- [ ] Max-rank, missing-resource, and full-inventory Blacksmith failures consume nothing.
- [ ] Friendly NPCs and owned creatures cannot be attacked through the normal context action.

### Environments and facilities

- [ ] Area counts the marker cell plus unique flood-connected player-created surfaces; natural tiles, boundaries, facilities, and natural anchors never add area.
- [ ] Exact reject/accept tests pass at 3/4, 7/8, 15/16, 31/32, 63/64, 127/128, and 255/256.
- [ ] Filled-core rules pass square, rectangle, L/U-shape, holed, one-cell-snake, and irregular fixtures.
- [ ] Open/closed doors block logical environment flood; missing perimeter edges invalidate; natural/map boundaries never enclose.
- [ ] Second-marker placement and two-marker merge edits reject atomically; split keeps the marker-side ID and suspends detached facilities until reconnection.
- [ ] Indoor floor and prepared-ground kinds never mix, and a marker is rejected in a detached component that still owns suspended facilities.
- [ ] Full support footprint, terrain anchors, kind/tag, limit, and current-area rules validate in preview, placement, operation, edits, migration, and load.
- [ ] Every bold minimum placeable functions at its threshold; T−1 rejects it and failed placement preserves the kit.
- [ ] Invalid facilities/contents survive and reactivate; split/merge/place/demolish/save/reload cannot repeat unlocks or duplicate value.
- [ ] Unlock evaluation passes predicate, all-only, any-only, and combined groups; no-predicate/empty-any fails unless explicitly always-unlocked.
- [ ] Every unlock predicate passes below/at-boundary tests; highest-area/Rating/material/tame ownership survives demolition while current environment still gates operation.

### Farm, creatures, and efficiency

- [ ] Farm Counter requires 32; each order requires Rating 250, `firstTamedSpeciesIds`, roster capacity, atomic coin cost, and valid Pen/Barn housing.
- [ ] Selling resources credits coins and coin-priced Farm/Blacksmith orders debit atomically; insufficient-coin and full-inventory failures consume nothing.
- [ ] Pen/Barn slot math, invalid-housing rest state, reassignment, and roster cap pass exact tests.
- [ ] Each creature visibly improves a declared efficiency axis and cannot follow/work simultaneously.
- [ ] Tuftle bin cycles, Craghopper Stone Yard, Glade Stag Cart Dock transfer, and Snarlfox worksite safety effect function as specified.
- [ ] Cart Dock/Logistics Hub stable-ID links, inventory/destination priority, full/invalid destinations, pause, relink, save/load, and no-loss behavior are deterministic.
- [ ] Stacking groups/caps prevent duplicate follower multipliers.
- [ ] Producer output respects optional inputs/storage and the eight-hour cap; 24-hour absence settles once, repeated reload gives zero, sub-cycle sessions accumulate once, backward clock gives zero, and a formerly full bin never bursts.
- [ ] Partially completed node respawn and Furnace work persist/decrement across close/reopen with the same cap/forward-clock rule and output blocking.
- [ ] Farm invalidation, assignment, order, release, save/load, and offline settlement never delete or duplicate creatures/resources.
- [ ] All four species can battle, weaken, snare, tame, roster, follow, and station; Glade Stag alone satisfies the mount requirement.
- [ ] Roster-full snare disables before cost/RNG; tame/AI-flee/0-HP spawn transitions, three-slot party, mounted Stag slot, and fourth assignment rejection pass.
- [ ] Turn order, basis-point damage/armor, berry turn, player flee, skittish AI, exact-turn reload, and creature respawn pass seeded tests.
- [ ] Defeat drops every non-bound portable into one reachable satchel; a second defeat replaces the old satchel, and intentional defeat cannot transport a haul home.

### Building, progression, and performance

- [ ] Rating matches the canonical component graph/formula at epsilon `1e-9` through place, floor bridge/merge, articulation removal/split, material fixtures, and reload; UI rounds to one decimal.
- [ ] Thatch, Wood, Stone, and Metal surfaces/boundaries can be placed, demolished/rebuilt, refunded, and scored.
- [ ] Demolition rounding/refunds never exceed original inputs and safely handle contents.
- [ ] Content validation rejects every required non-cosmetic tool/upgrade/output/placeable/role/producer/contract with no efficiency axis.
- [ ] The versioned deterministic route puts first tool, areas 4/8/16/32/64 inside their target bands with every enclosure/service prerequisite included.
- [ ] Ten-minute benchmarks verify producer supplement rate, Farm payback, 20% tier bottleneck gains, and storage/carry/repair/processing/renewal capacity.
- [ ] A deterministic test save exercises 128/256 without manual grind.
- [ ] Quest objectives activate in sequence, auto-complete from authoritative state, survive save/reload without double-completion, and never block play.
- [ ] Five-minute named-phone profiling of the minimum stress fixture meets p95 ≤16.7 ms, p99 ≤33.3 ms, and no unexplained task >100 ms.
- [ ] README documents desktop/touch controls, core loop, balance/content modules, Firebase deployment/install/update flow, local + cloud-sync save behavior and limitations, and known gaps.

## Confirmed owner decisions

The earlier open questions are now resolved. These are binding unless explicitly revised:

1. **Platforms** — Ship one installable PWA now. No native store packages in Phase 1.
2. **Save sync** — Saves sync across devices via Firebase (Milestone 2); local-first with export/import fallback.
3. **Environment definition** — Use the bounded room/paddock enclosure definition.
4. **Area thresholds** — Organic first-playthrough content through 64; 128/256 validated with deterministic test fixtures.
5. **Blueprint discovery** — First-time area milestones permanently discover blueprints; current area still gates placement/operation.
6. **Economy** — A single coin currency, earned only by selling resources to the Farm, Blacksmith, and Market. No real-money or premium currency.
7. **Livestock** — Reuse tamed species as workers; no separate livestock roster.
8. **"People"** — Reserved for future humanoid combat and PvP; never treated as resources; none appear in Phase 1.
9. **Broken tools** — Repairable with upgrades retained.
10. **Orientation** — Portrait fully supported and designed-for; landscape playable with translucent overlay controls.
11. **Offline work** — Capped passive work advances while closed, default eight-hour cap, with configured inputs and storage.
12. **Hosting** — Firebase Hosting (consolidated with Firebase Auth/Firestore for sync); GitHub Actions deploys production plus preview channels.
13. **Device baseline** — Samsung Galaxy S25 Ultra (Android Chrome) plus current/previous desktop Chrome, Edge, Firefox. iOS/iPadOS is out of Phase 1 scope (no test device). A 4× CPU-throttled profiling pass approximates mid-range phones.
14. **Pacing** — Area 256 in ~4.5–6 hr measured with the cheapest qualifying materials; premium-material builds are a much longer optional endgame carried by Homestead Rating.

Additional confirmed scope: audio stays out of Phase 1 (mute/settings stub retained); a data-driven Quests/objectives tracker is added (see **Quests and objectives**).

Remaining non-blocking tuning item: whether to keep a formal mid-range phone in the support matrix or rely on CPU-throttled profiling from the S25 Ultra.
