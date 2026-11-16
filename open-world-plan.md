# Open World Plan

Status: Phase 0 (measure) done on desktop on 2026-11-16, and the phone reading
is still pending. Nothing else is built. Written 2026-11-16. The decisions are listed
first so they can be overturned in one place.

## Goal

Walking across the map never shows a load. The 7×7 grid of areas stays as the
world's **regions** (names, themes, regional identities, raid bookkeeping,
field sites, the atlas), but stops being the **unit of loading**. You can see
across a border, a creature or raider can follow you over it, and crossing it
costs no more than taking a step.

Two things must not get worse:

- **Frame time on the phone.** Standing at a corner where four areas meet must
  cost within 10% of standing in the middle of one area today.
- **Running cost.** Firebase cost is unchanged. The future Cloud Run game server
  must only simulate the world near players, never all 49 areas.

## How it works today

- `WORLD_BOUNDS` in [world.ts](src/content/world.ts) is a 7×7 grid of areas, each
  `WORLD_TILES` = 160 tiles square (2,560 px at `TILE_SIZE` 16).
- Exactly one area is live. `state.currentArea` plus the flat arrays
  `resourceNodes`, `wildCreatures`, `groundDrops`, `containers`, `buildings`,
  `raiders` are that area. Every other visited area is frozen in
  `state.visitedAreas` ([areas.ts](src/simulation/areas.ts)).
- Walking off an edge calls `tryEnterAdjacentArea` →
  `enterAdjacentArea` ([commands.ts:454](src/simulation/commands.ts:454)), which
  snapshots the old area, activates the new one, clears raiders and any
  encounter, and puts the player at the opposite edge.
- The renderer sees the area key change and runs `rebuildWorld()`
  ([Elaris3DRenderer.ts:802](src/three/Elaris3DRenderer.ts:802)), which tears
  down the whole scene and builds the new area from scratch. This is the hitch
  and the reveal.
- **Terrain is already seamless.** `terrainAt` samples rivers and lakes in
  global tiles (`globalTile`, [landscape.ts:36](src/simulation/landscape.ts:36)),
  so water lines up at borders whichever side is generated first. No terrain
  rework is needed.
- The view never reaches past half an area. Overhead fog ends at
  `BASE_FOG_FAR` = 76 tiles; first person's view radius is 48 tiles
  ([firstPersonView.ts:30](src/three/firstPersonView.ts:30)). Half an area is
  80 tiles, so **at most four areas (a 2×2 block) are ever in view.**
- The renderer already has a 32-tile entity chunk index
  ([entityChunks.ts](src/scenes/entityChunks.ts)).

## Decisions of record

| Question | Decision | Why |
| --- | --- | --- |
| Global coordinates, or area-local? | **Stay area-local.** Every entity keeps whole-pixel coordinates inside its own area. A helper converts (area, local) to world space for rendering and distance | Avoids migrating every save and every system that reads `x`/`y`. 49 × 2,560 px still fits integers if we ever switch |
| What is live? | The **home area** (where the player stands) stays in the flat arrays exactly as today. The **warm set** is the home area plus every neighbour whose 32-tile chunks fall inside the view radius, at most 3 neighbours | Keeps `state.resourceNodes` etc. meaning what every system already assumes; neighbours are read from `visitedAreas` |
| When does home switch? | When the player's centre is **4 tiles past** a border (hysteresis). Local coordinates may run from −64 to 2,623 px in that margin | Pacing back and forth on a border must not flip home every step |
| What does a home switch do? | `saveCurrentArea` + activate the neighbour, **without** clearing raiders or the encounter and **without** a renderer rebuild. Live raiders and chasing creatures are re-homed with their coordinates shifted by ±2,560 px | Today's crossing is a teardown; open world makes it bookkeeping |
| Do raiders follow across borders? | Yes, up to a **leash**: a raid settles when the player is more than 96 tiles from its anchor, not when an area key changes | "Walk out of the area to end the raid" is a load-boundary exploit once there is no boundary |
| Do neighbour areas tick? | Only their chunks inside the view radius, and only wild-creature wander and live mobiles. Producers, workers and offline settlement stay exactly as now | Matches today's sim cost (≈25 chunks) at ≈36 chunks worst case |
| Teleports (waystones, respawn) | Stay as a full load with the reveal | Jumping across the map is a load in every open-world game; it is rare |
| World edge | The outer border of the 7×7 becomes visible terrain (rock wall / deep water band), not an invisible stop | No invisible walls in an open world |
| Area name on crossing | A short label as you cross, no reveal fade | Keeps the sense of place without implying a load |
| Render unit | 32-tile chunks, the same size as the entity chunk index. An area is 5×5 chunks | One chunk grid for terrain, vegetation and entities; time-sliceable |

## Cost budget

**Rendering.** A view radius of 80 tiles covers at most 6×6 = 36 chunks,
against today's 25 for a whole area. Peak terrain instances rise about 1.4×, but
chunks outside the radius are never built, so in the middle of an area the cost
drops below today's. Chunk builds are time-sliced to a few milliseconds per frame
so nothing hitches.

**Simulation.** Today the whole current area ticks. With the warm set, only
chunks inside the radius tick: about the same work, spread over up to four
areas.

**Firebase / Cloud Run.** Firebase today is hosting plus one global-balance read;
open world adds nothing. For the multiplayer server, Firestore cost depends on
save cadence, not on the map, so it is unchanged. Cloud Run CPU scales with the
union of members' warm sets, which is a few dozen chunks per player. The server
never ticks an area nobody is near.

## Phases

Each phase ships on its own and leaves the game playable. Phases 1–3 are
presentation (Claude's lane). Phases 4–6 change the simulation and touch files
codex also edits. Coordinate with codex before starting them, and never
`git stash` in this tree.

### Phase 0: Measure

Add a DEV-only timer around `rebuildWorld()` and a frame-time sampler. Record,
on the hardware-GPU Playwright config (`tmp/fp/playwright.gpu.config.ts`) and on
the user's phone:

- `rebuildWorld()` duration for Elaris, a forest area and a meadow area.
- Median and p95 frame time standing mid-area in overhead and first person.

**Done when:** the numbers are written into this file as the baseline for the
10% budget.

#### Phase 0 results (2026-11-16)

Status: done on desktop hardware GPU; **the user's real phone is still to
measure** (see below).

How it was measured:

- The renderer now keeps two rolling timers, shown in Admin → Diagnostics as
  **3D frame work** (CPU time inside each drawn frame, independent of vsync)
  and **3D area rebuild** (`rebuildWorld()` duration).
- `tests/perf/area-baseline.perf.ts` visits five areas through the walking
  transition path. In each it samples 4 s mid-area overhead, 4 s mid-area first
  person, and 4 s overhead at tile (3, 3), a corner.
- `tests/perf/transition-breakdown.perf.ts` splits one area change into its
  parts.
- Run both with `npx playwright test -c tests/perf/playwright.perf.config.ts`.
  The config uses the hardware-GPU flags and its own dev server on port 5191.
  JSON lands in `tmp/perf/`.
- "phone-viewport" is a Pixel 7 viewport emulated on the desktop GPU. It shows
  the effect of the smaller canvas, not phone hardware.

**Steady frames, desktop** (3D frame work in ms, p50 / p95):

| Area | Overhead mid | First person mid | Overhead corner | FPS overhead / FP | Draws overhead / FP | Tris overhead / FP |
|---|---|---|---|---|---|---|
| Elaris | 15.2 / 18.7 | 12.3 / 16.0 | 4.4 / 7.6 | 58 / 60 | 1042 / 891 | 424k / 679k |
| Verdant Reach (meadow) | 6.5 / 10.5 | 7.4 / 11.4 | 3.2 / 6.1 | 60 / 60 | 315 / 489 | 181k / 269k |
| Sylvaren (forest) | 7.9 / 11.7 | 10.3 / 14.4 | 4.3 / 7.0 | 51 / 60 | 409 / 631 | 356k / 722k |
| Dusky Forest (forest) | 4.9 / 8.0 | 7.5 / 11.6 | 3.9 / 7.2 | 60 / 60 | 246 / 428 | 403k / 685k |
| Iron Highlands (mountain) | 3.5 / 6.2 | 4.4 / 7.7 | 2.5 / 5.1 | 60 / 60 | 211 / 289 | 158k / 162k |

The phone viewport runs 10–40% lower on the same GPU (Elaris overhead 9.1 /
13.0, draws 674). Full tables are in `tmp/perf/area-baseline-*.json`.

**One area change, desktop** (ms):

| Destination | Phaser `rebuildAreaWorld` | 3D `rebuildWorld` | Worst 3D frame in the 2 s after | Cover on screen |
|---|---|---|---|---|
| Verdant Reach, first visit | 14 | 155 | **1,833** | 2,807 |
| Sylvaren, first visit | 12 | 134 | **2,048** | 3,264 |
| Verdant Reach, revisit | 5 | 125 | 226 | 1,027 |
| Elaris, revisit | 23 | 264 | 571 | 1,019 |
| Dusky Forest, first visit | 3 | 107 | 320 | 1,040 |

What this means for the plan:

1. **Most of a load is not the rebuild.** The first frames drawn after
   `rebuildWorld()` cost up to ~2 s on a first visit and 0.2–0.6 s on a
   revisit. That is GPU upload and shader compilation for freshly created
   geometry and materials. The 1 s travel cover hides it today. Phase 2 must
   pre-warm (`renderer.compileAsync` on a chunk before it is shown), share
   materials across chunks instead of creating them per rebuild, and limit
   uploads per frame. Time-slicing the construction alone will not remove the
   hitch.
2. **Elaris is already over budget.** Its overhead p95 (18.7 ms, 1,042 draws)
   is past a 60 fps frame before any neighbour is drawn. Phase 1 must not draw
   Elaris's neighbourhood at full detail, or Elaris's draw count comes down
   first.
3. **Corners are cheap today** (2.5–4.4 ms p50) because the area edge cuts the
   view in half. The Phase 1 budget is therefore measured against **mid-area**
   numbers: a four-area corner after Phase 1 must stay within 10% of the same
   area's mid-area p95.
4. **The Phaser 2D side is negligible** (3–23 ms) and needs no work.

**Still to measure on the user's phone.** Open Admin → Diagnostics:

- Stand mid-area in Elaris and in Iron Highlands for ~5 s each, and note
  **3D frame work** and **Frame time**.
- Walk into Verdant Reach and read **3D area rebuild** and the **3D frame work**
  max straight after the cover clears.

### Phase 1: Draw across borders (visual only)

Draw the neighbour areas' terrain, roads, water and static scenery (trees,
rocks, buildings) inside the view radius, read-only from `visitedAreas`, or from
deterministic generation for areas not yet visited. The sim is unchanged:
crossing still loads, but you can now see what's ahead of you.

- Generalise the terrain and vegetation builders to take an `AreaDescriptor` and
  a world offset instead of reading `state.currentArea`.
- Unvisited neighbours render from `createAreaSnapshot`-equivalent generation
  without writing to state, so looking does not count as visiting.

**Done when:** a screenshot at a border shows continuous ground, rivers and
trees on both sides, and frame time at a four-area corner is within the budget.

### Phase 2: Chunk streaming replaces `rebuildWorld`

Build the world as 32-tile chunks under per-area groups. Keep a ring of chunks
around the player, build new ones in a time-sliced queue, and retire ones that
leave the radius plus a one-chunk margin.

- `rebuildWorld()` survives only for teleports and world loads.
- An area key change no longer triggers a rebuild. The things it used to clear
  (raider arrows, follower slots, door pivots, town rooms) are keyed by area and
  retired with their chunks instead.
- Reuse `EntityChunkIndex` for entity activation across the warm set.
- Phase 0 showed the hitch is the first draw, not the build. Compile each chunk
  off-screen (`compileAsync`) before it is shown, reuse shared materials, and
  cap new GPU uploads per frame.

**Done when:** walking across a border in a Playwright run leaves
`worldRevision` unchanged and logs no frame above 50 ms.

### Phase 3: Edges and labels

- Visible rock or deep-water band along the outer world border in `terrainAt`
  for tiles outside `WORLD_BOUNDS`, rendered like any other terrain.
- Replace the area reveal on walking crossings with a short name label.
- The minimap draws across borders. `worldNavigator` and `worldMapPanel` (21
  `WORLD_PX` uses each) convert through the (area, local) → world helper.

**Done when:** no invisible walls remain and the minimap is continuous.

### Phase 4: Seamless home switch in the simulation

- Add `terrainAtWorld(state, areaKey, tileX, tileY)` that resolves tiles past an
  edge into the neighbour area and its buildings. Movement and collision
  (`tileAllows` in [commands.ts](src/simulation/commands.ts)) use it, so the
  player walks into the hysteresis margin without stopping.
- Replace `tryEnterAdjacentArea` with a home switch at the 4-tile margin:
  snapshot, activate, shift the player by ±2,560 px. Raiders, the active
  encounter and followers are carried with the same shift.
- Bump `SAVE_SCHEMA_VERSION` (now 91). A save mid-margin migrates by clamping the
  player back inside the home area.
- All positions stay whole pixels (see `canonicalizeGameState`).

**Done when:** a deterministic sim test walks the player across every border of
Elaris and back, and the state hash matches a replay; a raider chasing the
player follows them across.

### Phase 5: Warm neighbours tick, and area-scoped rules move to regions

- Wild creatures in warm neighbour chunks wander and can aggro across a border.
  Re-home any creature that crosses, the same way as the player.
- Raids: settle by leash distance from the anchor instead of
  `raidSettledAreaKeys` being written on an area change
  ([raids.ts:358](src/simulation/raids.ts:358)). Wave seeds stay keyed by area.
- Tapping a target in a neighbour area resolves its area first. Commands that
  take an entity id gain an optional `areaKey`.
- Rules that keep working because they are about *where something is*, not
  *what is loaded*, and only need checking: death cache
  ([deathCache.ts](src/simulation/deathCache.ts)), arcane storm strikes, field
  sites (`liveAreaSites` already accepts any area key), quest area visits, the
  Elaris fall services, regional identities.

**Done when:** no rule depends on the player having *crossed* a border, only on
which region a thing is in; the existing unit and e2e suites pass (minus the 26
known pre-existing failures).

### Phase 6: Multiplayer interest by warm set

Update [online-multiplayer-plan.md](online-multiplayer-plan.md):

- Interest is each member's warm set, not their current area.
- The server holds live arrays per area, not one flat `resourceNodes`. Members in
  different areas each have their own home area. The shared slice listing in
  that plan currently assumes a single active area, and this resolves it.
- The server ticks the union of members' warm sets; nothing else.

**Done when:** the multiplayer plan's interest section and shared-slice table
reflect this, before its Phase 5 (game server) starts.

## Risks

- **Phone memory at four-area corners.** Mitigation: Phase 0 baseline and the
  Phase 1 budget check before going further.
- **Hidden "current area" assumptions.** About 62 references to `visitedAreas`
  in 15 files, plus many `state.currentArea.key` reads. Phase 5 audits them; most
  are bookkeeping that stays correct with a home area.
- **Co-edited files.** `gameplayHud.ts`, the sim and `buildPlacement.ts` are
  shared with codex. Phases 4–5 need a handoff note before starting.
- **Testing.** The browser pane suspends `requestAnimationFrame`. Border-crossing
  checks run in Playwright on the hardware-GPU config, and screenshots force sim
  state through the DEV-only `__game` handle on the dev server.

## Out of scope

- Making the world bigger or infinite. Bounds stay 7×7.
- Removing area names, themes or the atlas.
- Removing waystone teleports or the respawn load.
- Changing what a save stores. Snapshots stay per area.
