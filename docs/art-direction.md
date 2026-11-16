# Elaris Art Direction

## Primary 3D presentation: painted woodland fantasy

The main game combines Quaternius' textured medieval architecture and nature
models with original articulated characters. Aim for an inviting woodland town:
quiet sage meadows, dark forest silhouettes, worn timber, warm windows and brass
details. Buildings have distinct roof pigments: copper at the forge, slate at
the chapel and armoury, moss at the market, wine at the tavern, violet at the
Arcanum and straw at the farm. Dormers, porches, arches and pointed tower caps
add variety without moving saved doors or building footprints.

- Terrain uses a locally bundled painted meadow map with broad seeded color
  variation. Keep its contrast below the buildings and characters. Roads sample
  continuously in world space and fade at their edges. Water blends shallow
  sage and deep teal, with restrained moving shoreline highlights.
- Warm sunlight, cool ambient fill and soft contact shadows ground the scene.
  The final image receives a subtle color grade, vignette and antialiasing;
  interface text stays outside the postprocessing pass. Time of day and danger
  lighting remain legible. Reduced motion freezes ambient water and foliage
  animation and disables character blinks.
- The player is a hooded woodland warden in teal cloth, worn leather, linen and
  brass, with a bedroll, satchel and folded embroidered cloak. Shape the torso,
  shoulders, hands and boots rather than stacking generic blocks. NPC palettes
  reuse the same outfit; background people use fewer surface subdivisions.
- Wildlife has coherent animal anatomy and a distinct silhouette for each
  species. Tuftle is a cotton-leaf grazer; Craghopper a stone frog with amber
  crystals; Glade Stag has dappling and branching antlers; Snarlfox has a long
  muzzle and cream-tipped brush. Masonmole has spade paws, Slingtail a curling
  ringed tail, Bulwark Boar bark plates and curved tusks, Quillfinch layered
  feathers and Mistmoth four moon-patterned wings. Use restrained vertex-painted
  variation, almond eyes and merged detail geometry. Keep each creature under
  8,000 triangles and twelve moving surface meshes.
- Preserve tool pivots, rig joints, animation states and saddle coordinates.
  Curved leather seats and woven blankets should fit beneath the seated player.
  Antlers and long tails need clear overhead labels. Reduced-motion poses must
  remain stable at different timestamps.
- Interiors use cutaway walls, worn wood and stone, woven rugs and open exits.
  Battle scenery extends behind the combatants while keeping the fighting lane
  clear and both actors in frame.
- Combat uses teal arcane threads with ivory cores, gold rune circles and
  crisp weapon crescents. Critical hits fracture into amber shards; misses
  dissolve beyond the target. Enemy Mistmoth spells use lavender, Snarlfox
  spells use ember, and Slingtail/Quillfinch replies use physical projectiles.
  Companion effects follow their ability: woven shields, rising healing leaves,
  canopy breezes or earthen shockwaves. Snares become three rotating rings and
  quiet leaf motes when a bond succeeds. Keep silhouettes and health text clear.
- Charge, release, impact and reply share a 1.15-second visual timeline.
  Projectile endpoints sample the same motion as the fighters; health and
  floating captions follow impact. Effects use two reusable instanced batches
  per stage with a hard limit of 24 cues, 192 glyphs and 512 shards, without
  new textures, dynamic lights or postprocessing passes. Reduced motion replaces
  travel and bursts with stationary low-opacity symbols and stable captions.
- The interface uses dark forest ink, parchment text, warm leather actions,
  fine brass borders and serif headings. Preserve readable labels, keyboard
  focus, contrast preferences and the existing accessible controls.
- Menus form a field journal: a leaf crest, serif chapter titles, brass frame,
  pine navigation and linen inventory tiles. Core sections come before the
  opening field guides. Desktop uses a scrolling side rail; phones use a
  horizontal chapter strip, with a compact side rail in short landscape views.
  Content scrolls independently inside a frame that fits the viewport.
- Resource silhouettes are local SVGs. Player and companion portraits are
  transparent renders of the original game rigs in one 1280×512 PNG atlas,
  bundled with a content hash and included offline. Regenerate it with
  `node scripts/render-ui-portraits.mjs` alongside the Vite server. Menus create
  no WebGL contexts and do not animate thumbnails.
- World signs and conversation nameplates use matching ink, brass and serif
  lettering. NPC nameplates retain the texture's aspect ratio so letters stay
  proportional and the label clears the character's face.
- Tabs have linked panels, arrow/Home/End navigation and a single tab stop.
  Modal focus stays inside the active item card or journal; Escape closes the
  item card first and returns to Menu when the journal closes. Preserve item
  cells and quest entries when their data has not changed. The last rendered
  world image serves as the journal backdrop, leaving rendering time for input
  and scrolling; deterministic simulation continues normally.
- Repeat scenery through instances; stream nearby planting in nine cells.
  Limit ambient creature traces to the player's surroundings and cap their
  accumulation. Shared maps remain alive across room and region changes.
  The hidden 2D camera stops drawing while its simulation continues to run.

The following sprite rules document the retained 2D fallback. They do not
override the primary 3D material, lighting or interface treatment above.

## Character motion

- The warden uses a coherent hip/torso/head hierarchy, bending elbows and knees,
  a two-bone foot solve, stance and swing intervals, and smooth pose transitions.
  Stride phase advances with travel. Fast travel uses a running cycle instead
  of speeding a short walking cycle beyond a readable cadence. Cloak sections
  lag behind the torso. Breathing, weight shifts, glances and blinks stay subtle.
- Axe chops, two-handed pick swings, sickle sweeps and berry picking have
  different body mechanics. The action's local progress drives the pose.
  Melee, a visible left-handed bow, spell casting and snare throws have authored
  wind-up, release and recovery phases. Hit and dodge reactions use the body
  and limbs rather than scaling the entire character.
- Tuftle compresses, hops and settles with delayed leaf motion. Craghopper
  crouches and pushes into a heavy springing leap. Stag uses long, phased steps;
  Snarlfox trots and bounds; Masonmole shuffles; Slingtail carries a delayed
  curling tail; Boar has short, heavy steps. Finch pecks and flicks its feathers;
  Moth hovers with cupped, lagging wing surfaces. Forelegs and hindlegs bend in
  opposite anatomical directions.
- A rider follows the mount's vertical motion and uses the same stride phase.
  Gathering, archery and casting layer over the seated legs. Saddle blankets
  follow the moving back instead of remaining fixed at the spawn height.
- Wild models follow the simulation's coordinates and turn toward travel or a
  selected target. Stationary animals use idle habits rather than fake walking.
  Animation never writes simulation coordinates, resolves damage, or delays an
  authoritative action. Battle presentation sequences player release, impact,
  enemy reply and terminal poses using the existing round duration.
- Soft limb, leaf, cloth and wing bends run on the existing merged surfaces;
  they add no geometry or extra surface draws. Matching depth and distance
  materials keep animated shadows accurate and are disposed with their models.
  Reduced motion freezes all ambient movement and keeps terminal outcomes clear.

## Core palette

| Use | Shadow | Dark | Mid | Light | Highlight |
| --- | --- | --- | --- | --- | --- |
| Ink/outline | `#0B120E` | `#17231C` | `#2A3B2F` | `#B9C7BA` | `#F5ECD6` |
| Grass | `#24352D` | `#36543B` | `#557A45` | `#73945A` | `#A7B96A` |
| Forest | `#16291F` | `#244331` | `#356246` | `#4E7955` | `#78A365` |
| Soil/wood | `#2B2119` | `#513A29` | `#7A5435` | `#A9794A` | `#D0A466` |
| Stone/iron | `#24292B` | `#454E50` | `#697375` | `#929B96` | `#CBD0C6` |
| Forge gold | `#53251B` | `#8F3F25` | `#D66A32` | `#E6B85C` | `#FFF0A6` |
| Tuftle | `#24392D` | `#397052` | `#5FB98A` | `#8DD0A2` | `#D9F0C7` |

## Sprite rules

- Light comes from upper-left. Top and left planes use the light ramp; lower-right edges use the shadow ramp.
- Interactive silhouettes use a one-source-pixel `#17231C` outline on their lower and right edges. Terrain tiles never receive full outlines.
- Grounding shadows are opaque pixel clusters at 18–28% black, no blur. Their center sits at the entity foot point.
- Player canvases are 24×32 with origin `(0.5, 0.875)`; feet land at source y=28. Creatures use 32×32 with origin `(0.5, 0.875)`. Resources use 24×32 with the same foot convention. Buildings align at top-left to their existing footprint.
- Never move a gameplay coordinate to compensate for a larger canvas. Resize the transparent canvas and use the category origin.

## Animation contract

- Walk: 4 frames at 8 fps (`step-left`, `contact`, `step-right`, `contact`). Idle: 2 frames at 2 fps maximum.
- Gather anticipation/impact/recover: 3 frames at 7 fps. Hurt: 2 frames at 8 fps. Defeat: 4 frames at 6 fps and hold the final frame.
- Locomotion changes only presentation. Simulation remains fixed-step and action resolution remains atomic.
- All animation frames in one sheet have identical integer dimensions. Horizontal flips are allowed for left/right only.

## Terrain density

- Quiet grass covers at least 75% of a normal viewport. Detail decals occupy at most one in eight tiles.
- Never repeat the same detail in adjacent tiles. Flower clusters are limited to one bright pixel group per 8×8-tile region.
- Forest transitions vary over a 2–4-tile band using deterministic edge noise. Decorative pixels never affect collision.
- Paths are 2–3 tiles wide, with irregular one-pixel edges and entrances kept clear.

## UI system

- Spacing scale: 4, 8, 12, 16, 24 px. Touch targets are at least 44×44 CSS px.
- Panels use square 2px borders (`#6F8A61`), a 2px outer dark keyline (`#0B120E`), and 4px corners. Selected borders use `#D5AE58`.
- Icons occupy a 20×20 box and share dark lower/right pixels. Essential state always retains a text or ARIA label.
- Display headings use bundled/system-safe `Trebuchet MS` at 700–800 weight; body copy uses the system UI stack. Pixel text is reserved for short labels at 12px or larger.
- HUD depth: world `0–899999`, world feedback `999000`, fixed HUD `10–29`, battle/modal `30+`, diagnostics `1000000`.

## Vertical-slice fixture

The reproducible slice starts from the default save at world tile 80,80 and contains the player, Blacksmith, Farm edge, Market edge, nearby resources, the core HUD/hotbar, and the nearest Tuftle encounter. Baseline screenshots live in `docs/screenshots/baseline/`; comparison captures use `390×844`, `844×390`, and `1280×720`.

## Object-state language

- Live resource nodes use a tall 24×32 silhouette; depleted nodes collapse into a low footprint at the same ground-contact point.
- Stone rubble stays neutral gray, iron tailings retain dark rock plus rust fragments, cut fiber leaves straight stalks, and picked berry bushes retain a thorny branch frame.
- Ore drops remain jagged rocks while processed ingots are stacked bars. Wood, stone, and fiber drops keep bundle-specific silhouettes.
- A Storage Box (small) raises its lid when it contains resources. Furnaces show idle, active flame, ready ingot, or blocked crossed-door states.
- Garden Beds and Woodlot Planters progress through planted, growing, and harvest-ready silhouettes.
- Wood construction uses board, plank, and brace patterns. Thatch construction uses cross-weave and bundled-straw patterns so material is not communicated by hue alone.

## Rocky highlands slice

- Mountain ground uses three deterministic elevation bands, broken ledge lines, slate scree, and sparse rust mineral seams. These marks are visual only and never add collision.
- Craghopper reads as a squat, spring-legged slate creature. Its three-point rust-gold crystal crest distinguishes it from loose stone and ore nodes at overworld scale.
- Hills encounters use the authored rocky-pass arena while preserving a clear central combat floor and the same upper-left lighting direction as the overworld sprites.

## Ancient forest slice

- Forest ground uses deterministic moss islands, exposed root runs, and restrained warm leaf litter. The marks stay decorative, sparse, and collision-free; the Elaris border retains its existing noisy transition band.
- Glade Stag reads as a slender pale-gold runner. Long legs, lifted neck, white face blaze, green tail accent, and a broad branching antler crown distinguish it from trees and round grazers.
- Forest encounters use an authored ancient-glade arena with deep canopy layers and upper-left dappled light. Roots and ferns frame the sides while the central combat floor stays open.
- Ambient leaves are capped, deterministic per scene, paused while hidden, and disabled when reduced motion is requested.
