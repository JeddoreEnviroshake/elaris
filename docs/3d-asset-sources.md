# Elaris 3D Asset Sources

The 3D presentation uses semantic model keys so every imported model can be
replaced without changing simulation or gameplay code. The executable registry
is `src/three/assetRegistry.ts`.

## License policy

All currently imported third-party 3D models are by Kenney or Quaternius and released under
Creative Commons Zero 1.0 (CC0). Copies of the license included in each download
are stored beside the runtime models in `public/assets/3d/<pack>/LICENSE.txt`.

Attribution is not required by CC0, but Elaris records it for provenance and to
make later asset swaps auditable.

## Quaternius world art

The entrance art pass now extends across town, field settlements, the six region
themes, construction, interiors, and battle scenery. The original semantic
`entrance.*` keys are retained and point at the following curated Standard-edition
models. Existing gameplay trees and resource nodes retain their saved positions,
health, collision and interaction identity. Scenic planting is low, deterministic
and excluded from roads, water, and buffered service-building footprints.

- Creator: Quaternius
- License: CC0 1.0 Universal, verified against both downloaded `License_Standard.txt` files
- Sources:
  - https://quaternius.com/packs/stylizednaturemegakit.html
  - https://quaternius.com/packs/medievalvillagemegakit.html
- Runtime folders: `public/assets/3d/quaternius-nature/` and
  `public/assets/3d/quaternius-village/`, each with its original license text
- Rebuild: `scripts/import-quaternius.py <nature-standard.zip> <village-standard.zip>`
  using Python and Pillow. The script selects only the assets listed below,
  caps embedded textures at 512 pixels, and writes self-contained GLBs below
  the service worker's 4 MiB per-file cache limit. Authored UVs, normals, alpha
  cutouts and material assignments are preserved. Download archives and helper
  dependencies are development-only and do not ship with the game.

Nature models:

- `CommonTree_1`, `CommonTree_3`, `Pine_1`
- `Fern_1`, `Grass_Common_Short`, `Bush_Common`
- `Flower_3_Group`, `Flower_4_Group`, `Mushroom_Common`
- `Rock_Medium_1`, `Pebble_Round_1`, `RockPath_Round_Small_1`

Village models:

- `Roof_RoundTiles_6x6`
- `Wall_Plaster_Straight`, `Wall_Plaster_Door_Flat`, `Wall_Plaster_Window_Wide_Flat`
- `Door_1_Flat`, `WindowShutters_Wide_Flat_Open`
- `Prop_Chimney`, `Prop_Crate`, `Prop_Wagon`, `Prop_Vine1`
- `Floor_UnevenBrick`, `Floor_WoodDark`, `Prop_WoodenFence_Single`

The full graphics pass additionally curates `Roof_Dormer_RoundTile`,
`Roof_Tower_RoundTiles`, `Roof_Wooden_2x1`, `Prop_Support`, `Wall_Arch`,
`DoorFrame_Round_Brick`, `Door_1_Round`, `Prop_Vine4` and
`Balcony_Cross_Straight` from the same free Standard village pack. Its
`License_Standard.txt` was verified again for these additions. Rebuild with
`scripts/import-architecture-details.py <village-standard.zip>`; embedded maps
are capped at 256 pixels for these small architectural details.

### Original terrain and finishing work

`public/assets/terrain/painted-meadow.png` is an original AI-generated,
tileable diffuse texture created for Elaris on 2026-11-14 with OpenAI image
generation. It is separate from the third-party CC0 model packs; no external
artist or third-party texture library is attributed to it. The source brief
specified a quiet hand-painted sage/olive meadow viewed directly from above.
The texture ships locally and is shared between overworld and battle ground.

Roof recoloring preserves the Quaternius tile wear and normals. The water-depth
blend, woven rug patterns, soft instanced contact shadows, rounded character
details, restrained color grade and leather/ink/brass interface are original
Elaris presentation work. No additional runtime service is needed for them.

Repeated plants, bank stones, deck tiles, paving and matching forge wall modules
use instanced rendering. The bridge deck follows the authoritative bridge mask;
railings face water and leave the road approaches open. Ground color variation,
aggregate road texture, shoreline accents, ripples, gate timbers and forge smoke
are original Elaris presentation work. Reduced motion freezes the new ambient
animation. The forge retains the existing explicit interior entry and ruin state.

Resource damage and construction changes reconcile individual visual objects;
they no longer rebuild the entire resource/creature/building presentation.
Cached model geometry and textures remain owned by the model library until
renderer teardown, preventing shared textures from being disposed on depletion.

### Shared world composition

`src/three/quaterniusArt.ts` composes the remaining service buildings from the
same modular walls, shutters, doors and roof. Door panels stay centred on the
saved doorway, including the north-facing Market and Tavern. Chapel and Arcanum
towers, trade props, wagons, banners and workshop details retain the identity of
each service. Their field copies use the same architecture. Original arena
geometry and construction surfaces borrow the matching stone and timber maps;
Pens use the authored railing and Barns use the tiled roof.

All live trees, stone and iron nodes, fiber plants, berry bushes, and planted
crops use the shared nature palette. Low decorative planting streams through
nine nearby 12-by-12-tile cells, with different densities for forest, thicket,
meadow, mountain and marsh. Cells unload their instance resources as the player
moves; asynchronous loads are retired on cell/room/region changes. No decorative
tree is added over a gameplay resource. Roads and water retain their simulation
masks. Road texture sampling is continuous in world space, bridges gain authored
decking, and water uses a restrained animated surface that freezes with reduced
motion. Imported rigid model transforms are computed once.

Interior floors, walls, timber furniture, stone hearths, and imported crates
follow the same material language. Their layout, service hotspots, exits and
accessible controls are unchanged. Combat dioramas gain habitat-specific nature
framing while retaining an open fighting lane and authoritative combat controls.
These stages share the central model library and explicitly retain its borrowed
texture/geometry ownership when rooms and encounters are cleared.

### Original articulated characters

The player, NPCs and all nine creatures are original Elaris models, rebuilt for
the woodland art direction. `src/three/playerModel.ts` authors the hooded warden:
a shaped tunic and vest, scarf, piped leather, boots, gloves, satchel, bedroll and
folded embroidered cloak. Existing NPC palettes reuse this outfit. Background
room characters use a compact version to preserve the 32,000-triangle interior
composition budget.

`src/three/creatureModels.ts` authors a distinct body, head, feet and moving
appendages for every species: cotton and leaves for Tuftle, layered stone and
amber for Craghopper, dappled fur and branching antlers for Glade Stag, a tapered
muzzle and full brush for Snarlfox, spade paws for Masonmole, a ringed curved tail
for Slingtail, bark plates and swept tusks for Bulwark Boar, layered feathers for
Quillfinch and four painted wings for Mistmoth. Eyes blink independently of the
moving head. Reduced motion freezes the ambient poses and blinks.

`src/three/characterSculpt.ts` constructs continuous variable-section surfaces,
curved tubes, leaves and vertex-painted details. Geometry is merged per moving
joint instead of issuing a draw for every small feature. Each creature uses
5–9 meshes and remains below 8,000 triangles. No character texture downloads or
third-party character licenses are introduced. Their generated runtime geometry
and materials are owned by the existing renderer/stage cleanup paths.

Curved leather saddles and draped woven blankets retain the established seat
coordinates. Tools, follower and worker identities, animation states, creature
abilities and combat rules remain renderer-neutral. World and battle labels
clear the new antlers and tails; selected creature labels follow their position.

The animation pass is also original Elaris work. `playerAnimation.ts`,
`creatureAnimation.ts`, `animationMotion.ts` and `softJoints.ts` author travel-driven
gaits, two-bone foot placement, blended transitions, species idle habits,
local action timelines and layered riding. Soft deformations preserve the
merged surfaces, vertex paint and geometry budgets. Their matching shadow
materials share pose uniforms and are retired with each model. The visible bow
is authored locally and created only when first used. No animation pack,
third-party motion capture, remote texture or additional runtime dependency is
introduced. Reduced-motion behavior and gameplay timing remain authoritative.

Validation includes desktop and phone screenshots, asset/offline-budget checks,
road and water exclusions, model identity across resource damage/depletion, and
the existing 3D gameplay and forge-interior browser checks. Browser screenshots
do not establish a frame-rate guarantee on physical phones.

## Nature Kit 1.0

- Creator: Kenney
- Source: https://kenney.nl/assets/nature-kit
- License: CC0 1.0
- Runtime use: deciduous trees, pine, rocks, stump, grass, bush, flowers,
  rounded wooden bridge, log stack, wayfinding sign, mushrooms
- Imported files:
  - `tree_default.glb`
  - `tree_default_dark.glb`
  - `tree_pineRoundA.glb`
  - `rock_smallA.glb`
  - `rock_smallB.glb`
  - `rock_largeA.glb`
  - `stump_roundDetailed.glb`
  - `grass_large.glb`
  - `plant_bushDetailed.glb`
  - `flower_yellowA.glb`
  - `bridge_woodRound.glb`
  - `log_stackLarge.glb`
  - `sign.glb`
  - `mushroom_redGroup.glb`

## Fantasy Town Kit 2.0

- Creator: Kenney
- Source: https://kenney.nl/assets/fantasy-town-kit
- License: CC0 1.0
- Runtime use: authored service-building roofs, doors and shuttered windows;
  market stalls; chimney; fences; gate; lanterns; banners; cart; stone pillars;
  weaponsmith and armoury blade signs
- Imported files:
  - `stall-green.glb`
  - `stall-red.glb`
  - `chimney.glb`
  - `fence.glb`
  - `fence-gate.glb`
  - `roof-gable-detail.glb`
  - `roof-high-gable-detail.glb`
  - `wall-door.glb`
  - `wall-window-shutters.glb`
  - `wall-wood-door.glb`
  - `wall-wood-window-shutters.glb`
  - `lantern.glb`
  - `cart.glb`
  - `banner-red.glb`
  - `banner-green.glb`
  - `pillar-stone.glb`
  - `blade.glb`
  - `Textures/colormap.png`

Service buildings retain lightweight procedural wall cores sized from their
saved gameplay footprints. Their visible roofs, facade modules, and signature
props now use authored GLBs. Semantic town IDs and model keys remain stable so
individual pieces can still be replaced without changing collision or saves.

## Survival Kit 2.0

- Creator: Kenney
- Source: https://kenney.nl/assets/survival-kit
- License: CC0 1.0
- Runtime use: anvil workbench, storage chest, barrels, tool references, and
  the player's authored upgraded axe and pickaxe
- Imported files:
  - `workbench-anvil.glb`
  - `chest.glb`
  - `barrel.glb`
  - `tool-axe.glb`
  - `tool-pickaxe.glb`
  - `tool-axe-upgraded.glb`
  - `tool-pickaxe-upgraded.glb`
  - `Textures/colormap.png`

## Mini Characters 1.0

- Creator: Kenney
- Source: https://kenney.nl/assets/mini-characters
- License: CC0 1.0
- Runtime use: retained as a replaceable character reference; the default
  player is now the articulated original Elaris rig below
- Imported files:
  - `character-male-a.glb`
  - `Textures/colormap.png`

## Original Elaris 3D assemblies

The following assets are built from Three.js primitives and existing Elaris
content data, with no external art dependency:

- Collision-aligned wall cores for the eight service buildings
- Arena ring
- Encounter battle diorama, stone rim, torches, health plates, projectiles,
  capture snare, and combat effects
- Articulated Tuftle, Craghopper, Glade Stag, and Snarlfox rigs with named
  joints and species-specific idle, alert, and locomotion poses
- Iron crystals and berry clusters
- Resource-depleted markers
- Articulated forest-ranger player rig and cloak; the procedural axe and
  pickaxe remain as load-failure fallbacks and the sickle remains original
- Placed construction surfaces, walls, facilities, furnace, beds, and planters
- Focus rings, paths, terrain patches, lighting, fog, and labels
- The woodland journal's portrait atlas in `src/ui/assets/portraits.png`,
  rendered from the original player and nine creature rigs by
  `scripts/render-ui-portraits.mjs`; it contains no downloaded character art

These code-native rigs are production-safe, carry no external art license, and
establish animation behavior as well as composition, scale, and color. Authored
skinned models can later replace their meshes while keeping the same semantic
motion states.
