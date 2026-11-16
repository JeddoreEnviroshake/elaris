# First-Person View and Free Movement Plan

Status: planned, nothing built. Written 2026-11-15 as a handoff brief.

## Goal

Two changes, shipped as one prototype:

1. **Free movement.** The player walks in any direction at any angle, in the
   existing overhead view and in the new first-person view. The one-tile,
   four-direction grid step is retired for the overworld player.
2. **First-person view.** An opt-in view mode. The left thumb walks forward,
   back and strafes with the existing movement pad. The right thumb drags to
   turn the view. Turning is smooth.

The prototype exists to answer two questions before any polish is spent:
does first person make the user motion sick, and does the world hold up at eye
level.

## Decisions of record

| Question | Decision |
| --- | --- |
| Movement model | Free analog movement in both views. Grid steps retired for the overworld player |
| Turning | Smooth, continuous, driven by a right-thumb drag |
| Comfort | No head bob, no sway, no shake, no camera lag on rotation, no FOV change on sprint |
| Camera | First person uses a perspective camera; overhead keeps the orthographic one |
| World taps in first person | Off. Everything a tap did is done by the action button |
| Second action button | Allowed if one button cannot cover the cases (see Phase 4) |
| View mode storage | Per device, local only. Never written to GameState or published balance |
| Default | Overhead. First person is opt-in so the e2e suite keeps its current view |

Hard constraint from the user: the existing 20° camera lean already causes
motion sickness. Any camera motion that the player's thumb did not directly
ask for is a defect in this feature, however good it looks.

## What the code looks like today

Verified on 2026-11-15. Re-read before editing; codex edits the simulation in
this same working tree.

- **Movement is a grid step.** `stepMovement` in
  `src/simulation/commands.ts:105` runs `beginTileMovement` (`:234`), which
  reduces the intent to one cardinal axis via `cardinalDirection` (`:78`),
  validates the destination tile, then travels exactly `TILE_SIZE` (16 px).
  A started move always finishes. `GridMovementState` is transient and not
  saved.
- **Collision is per-tile.** `beginTileMovement` checks, in order: building
  boundary edges (`isBuildingBoundaryCrossingBlocked`,
  `src/simulation/buildingCollision.ts:14`, cardinal-only), world bounds and
  area transition (`tryEnterAdjacentArea`), terrain walkability of the
  destination tile (`terrainAtWithBuildings` + `terrainAllows`), and town
  blocking (`resolveTownMovement`, `src/simulation/town.ts:93`).
  `resolveTownMovement` already takes arbitrary positions and slides per axis,
  so it is free-movement-shaped. Resource nodes do not block the player.
- **Facing is four-way.** `player.facing` is `'up' | 'down' | 'left' | 'right'`,
  set only by movement. About a dozen consumers read it: wall attacks
  (`nearestFacedWall`, `gameplayCommands.ts:578`), the rowboat
  (`:1140`, `:1153`), default boundary edge for placement
  (`defaultBoundaryEdgeFromFacing`), build mode, follower placement
  (`src/presentation/followerCreatures.ts:19`) and the renderer
  (`Elaris3DRenderer.ts:2926`).
- **Input.** `WorldScene.gatherRawInput` (`:2212`) reads the joystick, keys, or
  a queued d-pad tap, then `alignIntentToPresentation` (`:2239`) rotates it by
  the published camera yaw using `screenToCameraWorldIntent`
  (`src/three/cameraControls.ts:108`). That function already accepts any yaw.
  The pad (`src/ui/touchControls.ts`) taps for a one-tile step and drags for
  analog walking.
- **Renderer.** `Elaris3DRenderer.ts:276` owns one `OrthographicCamera`, passed
  to `SceneFinish` at construction (`:412`). One world unit is one tile. The
  follow camera lerps position and target (`:2796`–`:2810`). Fog is 34–76 units
  from a camera that sits roughly 28 units from the player. World pointer input
  raycasts the ground plane (`:578`) and emits tap, long-press, hover and paint
  intents. An occluder pass fades things between camera and player (`:3012`).
- **State must be integers.** `canonicalizeGameState`
  (`src/simulation/determinism.ts:17`) throws on any non-integer number.
- **Multiplayer.** `online-multiplayer-plan.md` assumes "tile-locked grid
  movement" for its 12 Hz snapshot interpolation and client prediction.
- **Tests.** `tests/unit/movement.test.ts` (480 lines) is written against grid
  steps. Many e2e specs walk with d-pad taps and expect tile-exact positions.

## Phase 1 — Free movement in the simulation

Simulation lane. Coordinate with codex before starting; sweep all references in
one pass rather than leaving half-renamed symbols for codex to "fix".

**Verify first.** `player.x += directionX * distance` already produces
fractional positions mid-tile, yet canonicalization rejects fractions. Find out
how that survives today (whole-pixel speeds, rounding at save, or saves only
between tiles) before designing the replacement. The answer decides how much of
the next item is new.

**Position stays whole pixels.** Keep `player.x` / `player.y` as integers.
Carry the sub-pixel remainder in the transient movement state as fixed-point
integers, so the saved and hashed state never holds a fraction and a slow walk
still accumulates.

**Deterministic direction.** Quantise the intent to an integer vector at the
input boundary and do the per-tick displacement in integer math. The same
intent stream must hash identically on a client and on the headless server
harness; floating-point trig inside the sim is the risk to avoid.

**Movement step.** Replace `beginTileMovement` and the travel loop with:

1. Displacement this tick from the quantised direction, `movementSpeed`, the
   slow-walk factor and `stepMs`. Diagonals are normalised and never faster.
2. Resolve X, then Y, so the player slides along obstacles instead of stopping.
3. Per axis, reject the move if it would: leave the world (attempt the area
   transition instead), put the collision box on a tile the traversal mode
   cannot use, cross a tile edge holding a blocking wall/fence/closed gate, or
   fail `resolveTownMovement`.

**Collision box.** Smaller than a tile (start at 10 px wide) so one-tile
doorways and gaps stay passable without pixel-perfect alignment. Terrain is
tested at the box corners, not just the centre.

**Building edges.** Generalise `isBuildingBoundaryCrossingBlocked` from "one
cardinal step from this tile" to "this axis move crosses the edge between tile
A and tile B". Keep the door/gate-owns-the-junction rule.

**Area transitions.** Fire when the player pushes outward against a world edge.
`enterAdjacentArea` keeps the perpendicular coordinate, which already works for
off-centre positions. The destination-tile walkability check stays.

**Facing.** Keep the four-way `facing` field so its consumers and the save
schema are untouched. Derive it from the dominant axis of the last movement.
Add an optional integer `heading` to `MoveIntent`; when present, `facing` is
taken from the heading's quadrant instead. First person sets it from the look
direction so strafing does not turn the character. No save migration.

**D-pad taps.** Keep a tap as "move exactly 16 px along that axis". It
preserves the documented pad behaviour and most e2e walking helpers. The move
is no longer snapped to tile centres.

**Sprint and stamina.** Unchanged in rule: bill whole seconds while the toggle
is on and the player is actually travelling.

**Out of scope for the prototype.** Interior movement
(`src/presentation/interiorMovement.ts`) stays on its own grid. Hostile and
creature movement is untouched.

**Tests.** Rewrite `tests/unit/movement.test.ts` for: diagonal speed, sliding
along walls and water, doorway passage, no tunnelling through boundary edges at
sprint speed, area transitions from off-centre positions, integer-only state
after every tick, and determinism of a recorded intent stream.

**Multiplayer.** Update the wire-protocol section of
`online-multiplayer-plan.md`: interpolation becomes position-to-position rather
than along a tile move, and reconciliation must carry the sub-pixel remainder.
Check how many of that plan's phases have shipped before touching anything
live.

## Phase 2 — Overhead view on free movement

Presentation lane.

- The stick walks at any angle. The pad's analog drag already produces a full
  vector; only the sim was discarding it.
- The player rig turns toward its direction of travel from the render-pose
  delta, not from the four-way `facing`.
- Followers trail behind the travel direction rather than a cardinal offset.
- Build mode is unchanged: taps aim, the pad nudges the ghost, Place commits.
- Fix every e2e helper that asserts tile-exact player positions.

This phase ships on its own and is worth having even if first person is
abandoned.

## Phase 3 — First-person camera

Presentation lane. The prototype's core.

**View mode.** `'overhead' | 'first-person'`, stored locally per device. A
toggle on the menu rail. Forced back to overhead while build mode, an interior,
or the taming stage is active, and restored afterwards.

**Camera.** Add a `PerspectiveCamera` beside the orthographic one and route
every user of `this.camera` through an active-camera accessor: `SceneFinish`,
`raycastGround`, the danger overlay's `project` call, and resize.
Starting values: vertical FOV 70°, near 0.05, far 120, eye height about 1.5
tiles above the player's render pose. Tune against the rig height.

**Comfort rules, all mandatory.**
- Rotation is applied directly from input. No smoothing, no inertia.
- Position is the interpolated render pose with no extra lag or lerp.
- No bob, no sway, no roll, no shake, no sprint FOV kick.
- The area-reveal zoom cue is skipped in first person.
- A small fixed crosshair dot stays on screen as a stable reference.
- Pitch is clamped to ±60° and never moves on its own.

**Look input.** In first person, a drag on the world canvas turns the view;
taps on the canvas do nothing. HUD buttons sit above the canvas and keep
working. The movement pad and the look drag each capture their own pointer so
both thumbs work at once. Sensitivity is a per-device setting with a sensible
default. Desktop gets mouse-drag look, and Q/E as a keyboard fallback.

**Movement mapping.** Pass the local look yaw into the existing
`screenToCameraWorldIntent` instead of the published camera yaw, and set
`MoveIntent.heading` from it. Check the sign convention: that function assumes
the camera sits behind the player at the given yaw.

**Scene changes while in first person.**
- Hide the local player rig. Keep its ground shadow.
- Disable the camera-to-player occluder fade.
- Retune fog for a camera at the player (start near 10, far 45) so the edge of
  the loaded area is never visible. Make sure the clear colour matches the fog.
- Entity and terrain chunk visibility must cover a radius around the player out
  to the fog distance, not the orthographic view rectangle
  (`src/scenes/entityChunks.ts`).
- The sun's shadow frustum keeps following the player position.

**Known ugliness to record, not fix, in the prototype.** Model undersides and
backs, roofs seen from below, no sky dome, no first-person hands.

## Phase 4 — Actions without world taps

In first person the action button does what taps did.

- **Target under the crosshair.** Each frame, pick the nearest interactable
  inside reach and inside a forward cone of the look direction (start at ±35°),
  tested on the ground plane against entity positions. No mesh raycasting.
  Highlight it and show its name by the crosshair.
- **Action button.** Acts on that target: gather a node, strike a creature or
  raider (setting the sticky target), use a facility, pick up a drop, open a
  cache. With nothing in the cone it falls back to today's nearest-target
  behaviour.
- **Snare.** The existing Snare button uses the same crosshair target.
- **Second action button.** Add it only for the case one button cannot express:
  the long-press building menu (inspect, repair, demolish). Label it by what it
  does on the current target and hide it when there is nothing to inspect.
- **Wall attacks and the rowboat** read `facing`, which now follows the look
  quadrant, so they keep working unchanged.

## Phase 5 — After the prototype, only if it survives

Compass strip and off-screen threat indicators (raiders, death-cache beacon),
first-person hands and weapon swings, a sky dome, model and roof fixes for
eye-level viewing, draw-distance and performance work for phones, look
settings (sensitivity, invert, FOV), free movement in interiors, and remote
players' headings in multiplayer.

## Verification

- `npm run build` before any Playwright run; the preview serves `dist`.
- The in-app browser pane suspends `requestAnimationFrame`, so it cannot show
  movement. Use Playwright e2e for movement and the headless swiftshader
  screenshot script for camera framing.
- Unit tests cover Phase 1. Add an e2e that walks a diagonal and one that
  enters first person, turns, walks forward and confirms the position moved
  along the look direction.
- Poll IndexedDB in e2e, never toasts.
- Motion comfort cannot be automated. The user plays the prototype on a phone
  for ten minutes: walk, turn continuously, sprint, fight one creature, enter
  and leave a building.

## Working-tree rules

- The tree has a large set of uncommitted changes. Never `git stash`; it would
  revert codex's in-progress work.
- Simulation, config and persistence are codex's lane; ui, scenes and three are
  Claude's. Phase 1 crosses lanes and needs the user's go-ahead on who does it.
- `gameplayHud.ts` is co-edited: re-read before every edit and edit surgically.

## Open questions

1. Who implements Phase 1, codex or the Claude session?
2. Should stick deflection scale walking speed, or stay direction-only with the
   existing slow-walk flag? The plan assumes direction-only.
3. Should the look drag control pitch as well as yaw, or yaw only for the first
   comfort test? The plan assumes both, with pitch clamped.
