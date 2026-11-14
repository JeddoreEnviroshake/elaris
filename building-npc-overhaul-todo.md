# Building and NPC Interaction Overhaul

Working plan for replacing Elaris' generic full-screen town-service menu with
small, characterful, explorable interiors. Keep this file current as work lands:
check a box only after its tests and relevant visual QA pass.

## Product target

Entering a service building should feel like entering a place, not opening a
menu. The player can move through a compact interior, see its NPC doing
recognizable work, talk through a short contextual dialogue, and then open a
focused service surface. The underlying economy remains deterministic and
renderer-neutral.

The implementation rule is **shared technology, bespoke composition**. All
interiors use the same session, interaction, dialogue, accessibility, and
service foundations. Layout, props, ambience, NPC behavior, and the interaction
ritual make each building distinct.

## Non-goals for the first release

- Do not turn interiors into new resource-generation areas.
- Do not add free-roaming schedules across the overworld yet.
- Do not rewrite working economy commands as part of presentation work.
- Do not require relationship grinding or large dialogue trees.
- Do not block the retained 2D/Admin renderer on bespoke 2D art for every room.

## Experience contract

- [x] Approaching a door shows a named `Enter` interaction prompt.
- [x] Entry requires the normal context action or a direct touch/click; walking
      over a door never unexpectedly opens a modal.
- [x] A short transition hides the exterior/interior renderer swap.
- [x] The player can move inside each room with keyboard and touch controls.
- [x] A nearby NPC acknowledges the player without taking input focus.
- [x] Interacting with the NPC opens compact dialogue before any service UI.
- [x] Service actions remain keyboard, touch, and screen-reader operable.
- [x] Walking to the exit returns the player to the correct exterior door.
- [x] Save/reload cannot strand the player in an interior or duplicate a
      transaction.

## Phase 0 — Protect existing service behavior

- [x] Define a DOM-free service presentation model with stable offer/action IDs.
- [x] Move service-specific labels, availability, and command binding out of the
      DOM renderer.
- [x] Make the current `NpcServiceActions` render the shared service model.
- [x] Preserve existing economy commands as the only transaction authority.
- [x] Add focused tests for service discovery, disabled actions, and execution.
- [x] Confirm the existing town/NPC unit tests still pass.
- [x] Confirm the production build passes.

Acceptance criteria:

- Every `NpcService` produces at least one useful offer.
- A future 3D hotspot or alternative UI can invoke an action without importing
  or constructing DOM elements.
- Existing accessible action names and transaction results do not change.

## Phase 1 — Interior session and explicit gameplay modes

- [x] Add a `GameplayMode` discriminated union:
  `world | interior | dialogue | service`.
- [x] Replace scattered `townInterior.isOpen` input gates with mode-aware input
      ownership helpers.
- [x] Add a renderer-neutral `InteriorSessionController` containing the current
      building, local player pose, focused hotspot, and transition state.
- [x] Keep transient interior position outside `GameState` unless playtesting
      proves that resuming at the exact indoor position is valuable.
- [x] Define deterministic recovery behavior: loading an old or interrupted save
      places the player safely outside the relevant building.
- [x] Add unit tests for entry, exit, input ownership, and recovery.

Acceptance criteria:

- World and interior modes allow movement; dialogue and service modes own input.
- Waystones, combat, construction, gathering, and area transitions cannot start
  while an incompatible mode owns input.
- No interior is stored as a macro-world area or included in biome generation.

## Phase 2 — Data-driven interior registry

- [x] Add `interiorId` to each town-building definition.
- [x] Create `InteriorDefinition` data for dimensions, entry/exit anchors,
      collision, props, hotspots, NPC spawns, ambience, lighting, and camera.
- [x] Add registry validation for unique IDs and valid building references.
- [x] Validate that the player spawn, every required NPC, every service hotspot,
      and the exit are mutually reachable.
- [x] Define reusable prop/prefab keys rather than embedding renderer objects in
      content data.
- [x] Add validation tests for all eight registered interiors.

Suggested shape:

```ts
interface InteriorDefinition {
  id: InteriorId;
  dimensions: { width: number; height: number };
  playerSpawn: InteriorPoint;
  exit: InteriorHotspot;
  collision: readonly InteriorCollider[];
  props: readonly InteriorProp[];
  hotspots: readonly InteriorHotspot[];
  npcSpawns: readonly InteriorNpcSpawn[];
  ambience: InteriorAmbience;
  camera: InteriorCameraConfig;
}
```

## Phase 3 — Weaponsmith vertical slice

- [x] Require explicit interaction at the Weaponsmith door.
- [x] Build a compact 3D forge interior using the existing semantic asset system.
- [x] Add walls, floor, exit, forge, anvil, workbench, tool rack, warm lighting,
      sparks, and restrained forge ambience.
- [x] Add Mara's model with idle and hammering states.
- [x] Add proximity focus/highlight and `Talk to Mara` prompt.
- [x] Add a short entry/exit fade and camera transition.
- [x] Provide a functional 2D/Admin fallback using the same interior definition.
- [x] Verify portrait mobile framing and touch movement.

Acceptance criteria:

- A screenshot without labels is immediately recognizable as a forge.
- The player, Mara, the anvil/service point, and exit remain readable on phone.
- The player can always reach Mara and leave.
- Reduced-motion mode removes nonessential camera and particle motion.

## Phase 4 — Dialogue and NPC presence

- [x] Extend NPC content with appearance, interaction radius, idle behavior,
      dialogue ID, and bark sets.
- [x] Add data-driven dialogue nodes, choices, conditions, and service handoffs.
- [x] Add first-visit, repeat-visit, progression, equipment, and recent-purchase
      dialogue conditions.
- [x] Add a compact lower-screen dialogue surface with portrait/name, choices,
      skip/advance behavior, and full keyboard/touch accessibility.
- [x] Keep incidental barks non-modal and rate-limited.
- [x] Add minimal durable NPC memory only where dialogue cannot be derived from
      existing state: visits, explicitly seen moments, or one-time outcomes.
- [x] Add save migration and determinism tests for any durable NPC state.

Initial Mara conversation choices:

- `Let me see your tools` → Weaponsmith service.
- `Train me` → Strength training offer.
- `What are you working on?` → contextual dialogue.
- `Goodbye` → return to interior movement.

## Phase 5 — Service-specific interaction rituals

- [x] Weaponsmith: select a carried tool and present it at the anvil.
- [x] Farm: inspect an animal/pen preview, then order through Orin's ledger.
- [x] Market: choose goods at a counter and show a clear sale summary.
- [x] Church: choose reflection or restorative practice before training.
- [x] Armoury: use racks/dummy framing for Dexterity drills.
- [x] Magic Shop: inspect the staff and channel a rune before buying/training.
- [x] Tavern: choose stories, rumours, or Intelligence training at Bram's table.
- [x] Arena: select physical drills or bouts instead of a bare stat purchase.

Acceptance criteria:

- Services continue to call the same atomic economy commands.
- No animation or dialogue can charge twice or grant an outcome before command
  success.
- The generic service model remains available as an accessibility/fallback view.

## Phase 6 — Remaining interiors

- [x] Verdant Reach Farm: barn, feed storage, pens, ledger, creature activity.
- [x] Market: stalls, scales, crates, stock piles, settlement chatter.
- [x] Church: pews, candles, stained light, quiet responsive ambience.
- [x] Armoury: racks, shields, practice dummy, drill space.
- [x] Sylvaren Arcanum: runes, animated books, floating objects, staff display.
- [x] Tavern: hearth, tables, patrons, rumours, local-story hooks.
- [x] Arena: ring, training equipment, spectators, drill staging.
- [x] Give every NPC at least one activity idle, one acknowledgment, one service
      handoff, and one state-reactive line.

## Phase 7 — Polish, performance, and release

- [x] Add interior audio routing and clean crossfades at entry/exit.
- [x] Pool or dispose Three.js interior objects without leaking resources.
- [x] Confirm culling and animation budgets on representative phones.
- [x] Add screenshot coverage for each room at desktop and portrait sizes.
- [x] Add end-to-end coverage for enter → talk → transact → leave.
- [x] Test keyboard, touch, screen-reader labels, high contrast, and reduced motion.
- [x] Update README controls and player-facing town documentation.
- [x] Remove the legacy full-screen `TownInterior` only after both renderers and
      all services use the new path.

## Building identity checklist

Use this during review. A room is not complete merely because its palette is
different.

- [x] Unique silhouette/layout
- [x] Unique work activity
- [x] Unique ambient motion and sound
- [x] Unique service interaction ritual
- [x] At least one state-reactive NPC line
- [x] A readable entrance, NPC, service point, and exit
- [x] No essential information conveyed through color alone
- [x] Phone-safe camera and 44px minimum touch targets

## Current implementation notes

- Town footprints, doors, services, NPC ownership, and exterior themes already
  live in `src/content/townBuildings.ts`.
- Static NPC identity currently lives in `src/content/npcs.ts`.
- Atomic transactions live in `src/simulation/economy.ts` and should remain the
  source of truth.
- Focused services render over the playable room through
  `src/ui/npcServiceOverlay.ts`; the legacy full-screen DOM interior is removed.
- The reusable DOM service renderer is `src/ui/npcServiceActions.ts`.
- Door entry and input suppression currently live in `src/scenes/WorldScene.ts`.
- 3D composition and semantic assets live under `src/three/`.

## Progress log

- 2026-08-01: Completed Phase 7. Added eight semantic procedural soundscapes
  with clean entry/exit crossfades, background-tab muting, and full Web Audio
  cleanup. Added explicit mobile particle, actor, animation, light, triangle,
  and frustum-culling budgets plus unique Three.js resource disposal. Replaced
  the legacy full-screen TownInterior with a compact focus-trapped service
  overlay over the playable room. Added 16 desktop/portrait screenshot
  baselines, high-contrast and forced-colors styling, reduced-motion and touch
  target checks, and a complete enter, talk, transact, return, and leave browser
  flow. Updated the README controls and town documentation. Passed all 609 unit
  tests, strict type-checking, the production/PWA build, and 9 targeted desktop,
  mobile, visual, accessibility, audio, and 3D browser tests.
- 2026-08-01: Completed Phase 6. Generalized the playable interior lifecycle
  beyond the Weaponsmith and added data-driven 3D and 2D composition for all
  eight rooms. The seven remaining interiors now have authored layouts,
  semantic props, themed lighting, NPC work activities, acknowledgments,
  ambient inhabitants or effects where appropriate, distinct first/repeat
  dialogue, and service handoffs. Passed all 20 focused Phase 6 unit tests, the
  live 3D Forge and five-room Elaris entry/exit checks, and the desktop/mobile
  Market ritual flow. The direct Vite/PWA bundle also passed. Repository-wide
  verification currently reports 558 of 562 tests passing and type-check
  failures in concurrent reinforced-snare, trophy-drop, and world-container
  work; the Phase 6 test surface is green.
- 2026-08-01: Completed Phase 0. Added a renderer-neutral service presentation
  model, adapted the existing DOM service surface to consume it, passed all 533
  unit tests, and completed the production build.
- 2026-08-01: Completed Phase 1. Added explicit gameplay modes and a transient
  interior session with local pose, focus, transition state, input ownership,
  and safe doorway recovery. Replaced WorldScene's direct modal checks, passed
  all 538 unit tests and the production build, and passed the Market enter →
  transact → leave browser flow on desktop and mobile.
- 2026-08-01: Completed Phase 2. Authored and linked all eight interior room
  definitions with typed geometry, semantic prefab/effect keys, spawns,
  hotspots, NPC activities, ambience, lighting, and cameras. Added centralized
  structural and four-way reachability validation, passed all 541 unit tests and
  the production build, and re-passed the desktop/mobile Market browser flow.
- 2026-08-01: Completed Phase 3. Replaced automatic door entry with explicit
  prompts, added renderer-neutral local movement and hotspot focus, built the
  playable 3D Weaponsmith forge and shared-definition 2D fallback, wired Mara's
  service handoff and safe exit, and added reduced-motion-aware fades, camera,
  lighting, hammering, and sparks. Verified desktop and portrait composition,
  keyboard and touch-style movement, the Market regression flow, all 546 unit
  tests, and the production build.
- 2026-08-01: Completed Phase 4. Added distinct appearance, idle, interaction,
  dialogue, and bark content for all eight NPCs; introduced renderer-neutral
  dialogue nodes, branching choices, state conditions, service handoffs, and
  rate-limited incidental speech; and shipped Mara's accessible lower-screen
  conversation in the playable forge. Persisted only visit counts and authored
  seen moments via save schema 57, with migration, validation, and deterministic
  hash coverage. Passed all 553 unit tests, the production/PWA build, and the
  live 3D Mara dialogue → service → forge browser flow.
- 2026-08-01: Completed Phase 5. Added renderer-neutral, read-only ritual
  staging for all eight services: anvil presentation, animal/pen inspection,
  market appraisal, sanctuary practices, armoury drills, arcane attunement,
  tavern conversations, and arena circuits. Rituals reveal the existing atomic
  service commands only after their preparation step, while retaining a full
  accessible service-list fallback. Added one-shot confirmation guards, exposed
  repair actions through Mara, and fixed failed critical repairs so they cannot
  record progress. Passed all 559 unit tests, the production/PWA build, the
  desktop/mobile Market ritual, and the 3D Mara → anvil → repair browser flow.
