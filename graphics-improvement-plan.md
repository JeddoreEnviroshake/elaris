# Elaris Graphics Improvement Plan

## Purpose

This document is an implementation plan for upgrading Elaris from readable
procedural placeholder art into a cohesive, production-quality pixel-art game.
It is written so that Codex, Claude Code, or another implementation agent can
execute it in phases without changing gameplay rules or save-state behavior.

The first objective is a polished vertical slice, not immediate replacement of
every asset. Prove the art direction and rendering pipeline in the starter town,
nearby grassland, one creature encounter, and the primary mobile HUD before
expanding the treatment across the whole game.

## Current State

- Phaser 3 renders the overworld using `pixelArt: true`, `roundPixels: true`,
  antialiasing disabled, and integer camera zoom tiers. Preserve these settings.
- The logical tile size is 16 pixels. Preserve the 16-pixel gameplay grid unless
  a separately approved gameplay migration changes it.
- Most world textures are generated at boot from Phaser graphics primitives in
  `src/art/proceduralTextures.ts`.
- World rendering, camera setup, depth sorting, and feedback effects live mainly
  in `src/scenes/WorldScene.ts`.
- Buildings, resources, creatures, drops, and placed structures already use
  stable texture keys. This provides a clean migration seam from generated
  textures to loaded sprite sheets.
- The battle screen is DOM-based and uses inline SVG fighters in
  `src/ui/encounterPanel.ts`. Its smooth vector style does not match the pixel-art
  overworld.
- Most HUD surfaces use system fonts, translucent rounded HTML panels, and emoji
  icons. They are usable but visually disconnected from the world.
- Desktop readability is acceptable. On a 390x844 phone viewport, 7x6 and 9x6
  tile town buildings dominate the view while the player, resources, and other
  interactive objects feel comparatively small.

## Design Direction

Use a **cozy frontier fantasy** pixel-art style:

- Earthy, slightly muted environments with warm gold highlights.
- Brighter, more saturated creatures so they remain readable against terrain.
- A consistent upper-left light source.
- Compact color ramps rather than unrestricted gradients.
- Selective dark outlines on interactive entities; avoid outlining every terrain
  tile.
- Consistent grounding shadows for characters, creatures, resources, and props.
- Readable silhouettes at the smallest supported phone viewport.
- Controlled texture density: detailed points of interest surrounded by quieter
  terrain.

Keep the logical 16x16 tile grid, but do not force all artwork into one tile:

- Player: approximately 24x32 source pixels on a transparent canvas.
- Small creatures: approximately 24x24 to 32x32.
- Large creatures or mounts: approximately 32x32 to 48x40.
- Resources and props: one to three tiles depending on silhouette.
- Buildings: multi-tile sprites aligned to their existing footprints.

All dimensions are starting guidelines. Final frame sizes must be consistent
within each sprite sheet.

## Non-Goals

- Do not change combat formulas, economy, movement speed, collision rules,
  persistence schemas, world generation rules, or deterministic simulation.
- Do not migrate the project away from Phaser.
- Do not introduce fractional camera scaling that blurs pixel art.
- Do not replace accessible text with image-only text.
- Do not require a network connection to load art or fonts.
- Do not attempt the entire asset catalog before the vertical slice is approved.

## Phase 0: Baseline and Art Bible

Create a compact art bible before altering production assets.

### Deliverables

1. Add `docs/art-direction.md` containing:
   - Core palette and material-specific color ramps.
   - Outline rules.
   - Light direction and shadow rules.
   - Sprite canvas sizes and anchor/origin conventions.
   - Animation frame timing conventions.
   - Terrain-detail density rules.
   - UI spacing, border, icon, and typography rules.
2. Capture baseline screenshots at:
   - 390x844 portrait.
   - 844x390 landscape.
   - 1280x720 desktop.
3. Identify a vertical-slice scene containing:
   - The player.
   - Blacksmith exterior.
   - Nearby grassland and forest transition.
   - Tree, rock, fiber plant, and berry bush.
   - Tuftle overworld sprite.
   - Core HUD and hotbar.
   - Tuftle battle screen.

### Acceptance Criteria

- The art bible is specific enough that two implementers would produce visually
  compatible assets.
- Palette entries and sprite conventions are expressed as exact values, not only
  prose descriptions.
- Baseline screenshots can be reproduced by an automated or documented manual
  process.

## Phase 1: Production Asset Pipeline

Introduce an authored asset pipeline while retaining procedural fallbacks until
the migration is complete.

### Proposed Structure

```text
public/assets/
  atlases/
  fonts/
  sprites/
    characters/
    creatures/
    buildings/
    resources/
    effects/
  tilesets/
src/art/
  assetManifest.ts
  animations.ts
  proceduralTextures.ts
  textureKeys.ts
```

The exact structure may be adjusted to match the bundler, but texture keys must
remain centralized and typed.

### Tasks

1. Extract `TextureKeys`, `creatureTextureKey`, and town-building key helpers from
   `proceduralTextures.ts` into a stable texture-key module.
2. Add a Phaser preload stage or boot scene that loads local PNG sprite sheets,
   tilesets, and atlases before `WorldScene` creates objects.
3. Add a typed asset manifest that records paths, frame dimensions, and animation
   metadata.
4. Preserve the existing procedural generator as a development fallback for any
   missing production texture.
5. Add validation for:
   - Missing files.
   - Duplicate texture keys.
   - Incorrect sprite-sheet dimensions.
   - Invalid animation frame ranges.
   - Non-integer frame sizes.
6. Ensure textures always use nearest-neighbor sampling.
7. Prefer atlas batching or a small number of sprite sheets over many individual
   runtime requests.

### Acceptance Criteria

- `WorldScene` can render a mixture of authored and procedural textures.
- Missing optional art produces an explicit development warning and a fallback,
  not a blank sprite or crash.
- Production assets work offline and are included in the PWA build.
- Pixel edges remain crisp at every existing zoom tier.

## Phase 2: Vertical-Slice World Art

Apply the new art direction only to the selected starter-area slice.

### Terrain

1. Replace the single repeated grass texture with a controlled variant system:
   - At least four quiet grass variants.
   - Sparse flowers, pebbles, tufts, and bare-soil decals.
   - A visible but soft grassland-to-forest transition.
2. Add authored path tiles leading to town-building entrances.
3. Avoid obvious square biome blocks. Use edge masks, transition tiles, or
   deterministic clustered decals while preserving the existing biome logic.
4. Keep collision and simulation independent of decorative tiles.

### Resources

Create upgraded sprites for tree, rock, iron vein, fiber plant, berry bush, and
their depleted states.

- Each resource needs a distinct silhouette before color is considered.
- Create two or more visual variants for common trees and rocks.
- Preserve the current texture/state mapping and interaction footprint.
- Add authored pickup/drop icons that are distinguishable at phone scale.
- Add a subtle highlight treatment for the current interaction target.

### Town Exterior

Redesign the Blacksmith first, then use it to validate building rules.

- Preserve its existing footprint and door tile.
- Make the forge identity legible through architecture and props, not just its
  label: chimney, soot, warm window, anvil/tool silhouette, wood/stone material.
- Add a short entrance path and nearby contextual props.
- Add chimney smoke and a restrained forge glow.
- Implement roof fade, cutaway, or foreground transparency when the building
  obstructs the player.
- Review facade height on portrait mobile so the player remains visually
  important.

### Acceptance Criteria

- A screenshot without labels still clearly distinguishes the Blacksmith and
  each resource type.
- Terrain repetition is not obvious within a normal phone viewport.
- Interactive objects remain readable without relying on saturated highlight
  colors at all times.
- Town decoration never changes collision or blocks required paths.

## Phase 3: Player and Creature Animation

### Player

Add sprite-sheet animations for:

- Four-direction idle.
- Four-direction walk.
- Gathering/tool swing.
- Damage/hurt reaction.
- Optional short interaction or pickup pose.

Use the actual movement intent to choose facing and animation. Stop on an idle
frame instead of leaving the walk cycle mid-step. Keep the existing rounded
world positions and depth sorting.

### Creatures

For Tuftle in the vertical slice, add:

- Idle loop.
- Locomotion loop.
- Attack anticipation and impact.
- Hurt reaction.
- Defeat/faint.
- Taming/capture response.

After Tuftle is approved, extend the same animation contract to Craghopper,
Glade Stag, and Snarlfox.

### Mounts and Followers

- Preserve the current role and travel logic.
- Render followers with an offset/formation that avoids overlap with the player.
- Mount visuals must correctly layer the player above the mount.
- Do not change travel-speed multipliers as part of the graphics pass.

### Acceptance Criteria

- Movement direction, facing, animation, and depth remain synchronized.
- Animations are readable at 2x zoom on a 390-pixel-wide viewport.
- Animation timing does not alter fixed-step simulation or command timing.
- Idle loops are subtle enough not to make the scene visually noisy.

## Phase 4: Environmental Motion and Action Feedback

Add small, reusable effects that make interactions feel physical.

### Effects

- Footstep dust or displaced grass, based on surface.
- Leaves or wood chips when gathering trees.
- Stone fragments and a small impact flash when mining.
- Fiber fragments when harvesting plants.
- Pickup arc or sparkle for collected drops.
- Chimney smoke, furnace sparks, and occasional drifting leaves.
- Improved damage flash and context-sensitive camera shake.

Use pixel-art particles or crisp geometric particles. Avoid blurred modern VFX
that conflict with the art direction.

### Engineering Requirements

- Pool frequently spawned particles where practical.
- Cap concurrent decorative particles.
- Pause or reduce ambient effects when the document is hidden.
- Provide a reduced-effects option or honor `prefers-reduced-motion` for DOM
  animations and nonessential visual motion.
- Keep effect spawning presentation-only and nondeterministic only when it does
  not affect saved state or simulation results.

### Acceptance Criteria

- Every core gather action has a visible anticipation/impact/result sequence.
- Effects never hide the player, target, damage text, or interaction prompt.
- Extended play does not grow the number of active game objects indefinitely.

## Phase 5: Battle-Screen Unification

Replace the mismatched inline SVG fighters with pixel-art presentation derived
from the overworld designs.

### Tasks

1. Use authored battle sprite sheets for the player and each creature.
2. Preserve all existing battle simulation, action availability, distance, and
   replay timing.
3. Build layered pixel-art arena backgrounds by habitat:
   - Grassland.
   - Hills.
   - Forest.
4. Add foreground, arena floor, midground, and distant-background layers with
   restrained parallax.
5. Redesign the distance indicator as a readable track that shows:
   - Player and creature positions.
   - Current distance.
   - Melee and ranged reach.
6. Add animation beats for:
   - Forward/backward movement.
   - Rest.
   - Melee, ranged, and magic attacks.
   - Creature chase and retreat.
   - Miss, dodge, critical hit, defeat, and capture.
7. Replace emoji attack icons with icons from the shared UI atlas.
8. Preserve accessible labels and text alternatives for all controls.

### Acceptance Criteria

- Overworld and battle versions of every character are recognizably the same
  design.
- The player can understand range state without depending on button tooltips.
- Battle buttons remain usable at 390x844 and 844x390 without horizontal page
  scrolling.
- Results and controls remain readable during animation.

## Phase 6: Cohesive UI System

Create shared UI primitives rather than continuing to style each panel with
independent inline values.

### Tasks

1. Add centralized design tokens for:
   - Colors.
   - Spacing.
   - Corner shapes.
   - Borders.
   - Shadows.
   - Z-index layers.
   - Typography.
2. Add a bundled, offline-safe display font for headings and retain a highly
   readable body font. A pixel display font may be used selectively; do not use
   tiny pixel text for paragraphs.
3. Add a consistent icon atlas for inventory items, tools, resources, combat
   actions, navigation, build categories, and status indicators.
4. Replace emoji with shared icons wherever emoji appearance currently varies by
   operating system.
5. Create reusable nine-slice or CSS-based pixel-panel treatments for modal,
   menu, tooltip, button, selected, disabled, warning, and success states.
6. Restyle hotbar, inventory, build menu, gameplay HUD, world navigator, town
   interiors, encounter panel, and app chrome from the shared system.
7. Reduce persistent mobile obstruction:
   - Keep the context action prominent.
   - Allow the minimap/status region to collapse or simplify.
   - Move Admin access out of the normal player-facing control stack in
     production.
   - Avoid overlapping the player with fixed controls when possible.
8. Continue to meet minimum touch-target requirements and safe-area insets.

### Acceptance Criteria

- The same icon, color, and panel state means the same thing everywhere.
- No essential state is communicated by color alone.
- Text maintains acceptable contrast over every gameplay background.
- UI remains operable with keyboard, touch, and screen-reader labels.

## Phase 7: Expand the Approved Style

After the vertical slice is approved, expand in this order:

1. Remaining starter-town buildings and exterior props.
2. Remaining resources, drops, facilities, and building parts.
3. Craghopper and hills biome.
4. Glade Stag and forest biome.
5. Snarlfox and dangerous-forest treatment.
6. Player equipment and tool variants.
7. Town interior scenes and NPC portraits/poses.
8. Secondary menus, admin surfaces, and diagnostics.

Do not expand a category until its vertical-slice equivalent has passed visual,
mobile, and performance review.

## Rendering and Performance Requirements

- Preserve `pixelArt`, `roundPixels`, disabled antialiasing, and integer zoom.
- Keep gameplay coordinates independent from sprite canvas dimensions.
- Continue using depth based on entity feet/ground contact, not sprite center.
- Define consistent origins for every asset category.
- Cull or avoid rendering off-camera decorative objects where practical.
- Prefer atlases and batched sprites.
- Avoid allocating new graphics/textures every frame.
- Destroy transient game objects and timers after effects complete.
- Treat Canvas renderer compatibility as a fallback requirement unless the
  project explicitly adopts WebGL-only visuals later.
- Avoid post-processing that makes pixel edges soft. If color grading is added,
  verify it at every supported renderer and viewport.

## Suggested File-Level Changes

The implementer should verify the current repository before editing because the
working tree may contain concurrent feature work.

Likely files to add or change:

- `src/art/proceduralTextures.ts`
- `src/art/textureKeys.ts` (new)
- `src/art/assetManifest.ts` (new)
- `src/art/animations.ts` (new)
- `src/scenes/WorldScene.ts`
- `src/scenes/buildMode.ts`
- `src/ui/encounterPanel.ts`
- `src/ui/gameplayHud.ts`
- `src/ui/hotbar.ts`
- `src/ui/inventoryPanel.ts`
- `src/ui/townInterior.ts`
- `src/ui/appChrome.ts`
- `src/ui/theme.ts` or `src/ui/theme.css` (new)
- `src/config/platform.ts` only if new presentation tunables are needed
- `vite.config.ts` for PWA asset inclusion if required
- `tests/e2e/*` for screenshot and responsive validation
- `tests/unit/*` for asset-manifest or layout helpers

Do not place presentation-only constants into gameplay balance configuration.

## Testing and Verification

Run verification after each phase rather than waiting until the end.

### Automated

```powershell
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

Add targeted tests for:

- Texture manifest completeness.
- Sprite-sheet frame validation.
- Animation-key registration.
- Responsive layout helpers.
- Missing-asset fallback behavior.
- PWA build inclusion of production assets.

Add screenshot coverage for the agreed baseline viewports. Use stable saves or
fixtures so screenshot scenes are deterministic. Mask or disable nondeterministic
ambient effects during screenshot tests.

### Manual Visual QA

At minimum, inspect:

- 390x844 portrait.
- 844x390 landscape.
- 768x1024 tablet.
- 1280x720 desktop.
- 1920x1080 desktop.
- 2x, 3x, and 4x camera zoom tiers.
- Canvas and WebGL renderers where available.
- Normal and reduced-motion settings.
- Offline/PWA-loaded assets.

Check for:

- Blurred or uneven pixels.
- Incorrect origins and depth sorting.
- Sprite clipping at camera edges.
- UI overlap with safe areas and controls.
- Low contrast or color-only state.
- Terrain seams and obvious repetition.
- Animation/state mismatches.
- Missing textures after WebGL context restoration.
- Memory or object-count growth during repeated effects.

## Definition of Done for the Vertical Slice

The vertical slice is complete when:

1. The player, Tuftle, Blacksmith, core resources, grassland terrain, HUD, and
   Tuftle battle all follow one documented art direction.
2. The player and interactive objects remain immediately readable on the
   smallest supported phone viewport.
3. The battle screen no longer appears to belong to a different visual style.
4. Terrain no longer reads as one visibly repeated grass tile or square biome
   blocks.
5. Core actions have animation and feedback without changing simulation.
6. Authored art loads offline and has safe procedural fallback during migration.
7. Existing gameplay tests still pass.
8. New asset, responsive, and screenshot checks pass.
9. No persistent save-schema or gameplay-balance changes were introduced.
10. The approved vertical-slice conventions are documented well enough to scale
    to the remaining content.

## Recommended Execution Order for an Implementation Agent

1. Read this document and inspect the current dirty worktree before editing.
2. Read `README.md`, `src/main.ts`, `src/config/platform.ts`,
   `src/art/proceduralTextures.ts`, `src/scenes/WorldScene.ts`, and
   `src/ui/encounterPanel.ts` completely.
3. Run the existing test suite and capture baseline screenshots.
4. Complete Phase 0 and obtain art-direction approval.
5. Implement the minimum Phase 1 asset pipeline.
6. Produce the Phase 2 vertical-slice terrain, resource, and Blacksmith art.
7. Add the Phase 3 player and Tuftle animation contracts.
8. Add Phase 4 feedback effects.
9. Unify the Tuftle battle in Phase 5.
10. Apply the Phase 6 UI system only to vertical-slice surfaces.
11. Run all automated and manual verification.
12. Present comparison screenshots and obtain approval before Phase 7 expansion.

When working in a dirty tree, preserve unrelated user changes, avoid broad
mechanical rewrites, and keep each phase reviewable as a focused change set.
