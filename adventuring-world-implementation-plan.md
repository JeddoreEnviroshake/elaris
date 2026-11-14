# Elaris Adventuring World Implementation Plan

This document tracks the implementation of a finite, purposeful overworld for
Elaris. The guiding loop is:

> destination → preparation → route decisions → discovery → meaningful reward → reason to return

The large map is the interface that makes the world understandable. The
adventure systems, destinations, and repeatable activities are what make
travelling through it worthwhile.

## Product goals

- Make Elaris feel like a home that players deliberately leave and return to.
- Replace the effectively infinite area grid with a finite, authored
  macro-world that has natural borders and memorable geography.
- Make towns, player-built beds, quests, caves, waterways, and landmarks easy
  to understand from a large world map.
- Give every substantial journey a destination, decisions along the route, and
  a reward that changes future play.
- Make death recoverable and strategic by allowing players to choose Elaris or
  any surviving bed as their respawn point.
- Give every region both a one-time discovery identity and repeatable reasons
  to revisit it.

## World structure

The target surface world is a 7×7 macro-grid centered on Elaris. Each macro
cell is one existing 160×160-tile area. Approximately 15–20 cells should
eventually be traversable land; oceans, cliffs, mountain walls, islands, and
other impassable geography shape the remainder.

The macro geography is authored. Deterministic terrain generation continues to
provide the local terrain and renewable contents inside wilderness cells.
This preserves replayability and save stability while allowing roads, towns,
passes, waterways, caves, and landmarks to occupy intentional locations.

### Planned settlements

| Destination | Identity | Primary reasons to visit |
| --- | --- | --- |
| Elaris | Human crossroads and safe capital | Market, tavern, church, arena, onboarding, sanctuary respawn |
| Verdant Reach | Farming district and village | Farm, crops, Tuftle work, food and delivery contracts |
| Sylvaren | Elven city in an enchanted forest | Magic Shop, magic progression, Glade Stags, arcane quests |
| Ironspine Hold | Mountain mining settlement | Armoury, advanced smithing, iron, Craghoppers, caves |
| Reedwater | Marsh and river port | Ferries, boat upgrades, herbs, marsh contracts |
| Shattered Isles | Remote island chain | Treasure, ruins, rare creatures, advanced expeditions |

Elaris keeps enough core services to remain a convenient home. Buildings should
move only when the new location gives them a strong thematic and mechanical
identity. The Farm and Magic Shop are the first relocation candidates.

## Large world map

- [x] Add a subtle large-map button attached to the visible mini-map.
- [x] Open the large map in a dedicated, responsive, modal interface.
- [x] Draw a finite world frame and prevent the map from panning beyond it.
- [x] Make Elaris, the player, and all player-built beds visually distinct.
- [x] Show discovered and undiscovered regions differently.
- [x] Show authoritative rivers, lakes, bridges, and rock walls in discovered
      regions.
- [ ] Add pan and zoom controls when the map grows beyond the initial grid.
- [ ] Add selectable region summary cards with theme, danger, services,
      resources, quests, and beds.
- [x] Add live regional identity cards for Verdant Reach and Sylvaren with
      signature resources, creatures, landmarks, and cycle-contract progress.
- [ ] Add filters for quests, beds, towns, caves, resources, and danger.
- [x] Add exact atlas destinations to the first multi-town quest definitions.
- [ ] Add approximate-to-exact quest-marker disclosure states.
- [ ] Add player-created labels or notes.
- [ ] Add surface and underground map layers.

Fast travel is deliberately not part of the initial map. Roads, ferries,
caravans, cave passages, and elven waystones can become earned shortcuts after
their destinations have been reached normally.

## Finite world and geography

- [x] Define explicit 7×7 world bounds.
- [x] Block travel beyond those bounds.
- [x] Allow a legacy save already outside the bounds to travel inward without
      allowing it to move farther away.
- [x] Create the authored macro-world registry.
- [ ] Shape the outer boundary with deep ocean, cliffs, mountain ranges, and
      other natural barriers instead of relying on an invisible square wall.
- [ ] Validate that every required destination is reachable from Elaris at the
      appropriate traversal tier.
- [x] Author the seam-safe eastern road and river bridges connecting Elaris,
      Verdant Reach, and Sylvaren.
- [ ] Author the remaining roads, paths, ferries, passes, ports, and landmark
      locations.
- [ ] Add environmental boundary feedback such as “Beyond lies the Shattered
      Sea.”

## Respawn selection

- [x] Add a persisted `pendingRespawn` state instead of relocating the player
      immediately when health reaches zero.
- [x] Pause simulation and close active encounters while respawn selection is
      open.
- [x] Add a permanent, always-available sanctuary respawn in Elaris.
- [x] List every surviving player-built bed across active and inactive area
      snapshots.
- [x] Show each bed’s name, region, shelter status, and purifier status.
- [ ] Add nearby storage and services to each respawn-point summary.
- [ ] Allow beds to be renamed, with a useful region-based default.
- [x] Add an explicit `chooseRespawn` simulation command.
- [x] Restore enough health and temporary protection to prevent an exposed-bed
      death loop.
- [x] Restore the respawn selection after a save is closed and reopened.
- [ ] Later: replace total carried-item deletion with a recoverable expedition
      pack marked at the death location.

## Regional content contract

Every important region should ship with:

- [ ] One signature resource or ingredient.
- [ ] One characteristic creature or enemy group.
- [ ] One landmark, environmental puzzle, or piece of world history.
- [ ] One traversal feature or hazard.
- [ ] One authored local quest chain.
- [ ] One repeatable activity.
- [ ] One discovery reward.
- [ ] One route or shortcut that can eventually be unlocked.

Travel pacing should aim to present a decision, discovery, encounter, or useful
activity every 30–60 seconds. Long stretches of uninterrupted walking are a
content bug, not a sign of world scale.

## Repeatable adventure systems

- [ ] Add deterministic rotating contracts tied to the survival cycle.
- [ ] Support creature bounties, lost caravans, surveys, escorts, deliveries,
      rare-resource outbreaks, cave clearances, and settlement defence.
- [x] Add initial regional mastery: Unknown → Surveyed → Familiar → Mastered.
- [x] Use mastery to unlock the Elaris sanctuary and regional landmark
      waystone network.
- [ ] Expand mastery rewards to reveal resources, improve local trade, or
      grant regional cosmetics.
- [ ] Add elite creature variants and rare regional events.
- [ ] Make town economies request goods from other regions so gathering,
      crafting, and travel reinforce one another.

## Quest direction

Replace pure region-count objectives with authored journeys. A first multi-town
arc could be:

1. Missing farm shipments lead the player from Elaris to Verdant Reach.
2. The farmer identifies a magical blight and directs the player to Sylvaren.
3. Sylvaren’s arcanist requires a crystal from an Ironspine cave.
4. Returning the crystal opens a waystone route and a new magic upgrade.

- [x] Add location and map-marker data to authored journey quests.
- [ ] Add prerequisite and repeat-policy data to quests.
- [ ] Support broad search regions that become exact markers after
      investigation.
- [ ] Add settlement story arcs and recurring town contracts.
- [ ] Add journey rewards that alter future travel, not only currency.

## Caves and underground areas

Caves are separate interior areas connected to persistent surface entrances.
Their entrances appear on the surface map; an underground layer can be added
later.

- [ ] Define cave entrance and interior-area data.
- [ ] Support deterministic cave resets or variations per survival cycle.
- [ ] Add minerals, puzzles, bosses, exits, and mountain shortcuts.
- [ ] Add cave-specific quests and repeatable expeditions.

## Delivery milestones

### Milestone A — World-map foundation

- [x] Track the implementation in this document.
- [x] Establish finite bounds and compatibility behaviour.
- [x] Ship the initial large-map modal with Elaris, player, bed, terrain, fog,
      and border presentation.
- [x] Perform desktop, landscape-phone, and portrait-phone visual QA.

### Milestone B — Strategic respawning

- [x] Implement persisted pending defeat.
- [x] Add Elaris sanctuary and selectable bed anchors.
- [x] Ship the map-based respawn interface and safety rules.

### Milestone C — First expedition

- [x] Build the baseline authored regions for Verdant Reach and Sylvaren.
- [x] Move the Farm and Magic Shop.
- [x] Activate the Magic Staff as a shop-exclusive spell focus with bonus
      magic power, durability wear, repair support, and equipped visuals.
- [x] Preserve their NPC and service interactions in their new settlements.
- [x] Add their landmarks, characteristic creatures, regional resources, and
      repeatable activities.
- [x] Add one-time landmark discovery rewards and save-backed, survival-cycle
      gathering contracts for both expedition regions.
- [x] Ship one complete Elaris → Verdant Reach → Sylvaren travel quest chain.
- [x] Perform live desktop and responsive atlas QA and enter both relocated
      service interiors.

### Milestone D — Reasons to return

- [x] Add survival-cycle regional gathering contracts.
- [x] Add regional mastery and earned waystone route shortcuts.
- [ ] Add discoveries, elite encounters, and inter-town economy requests.

### Milestone E — World breadth

- [ ] Add Ironspine Hold, Reedwater, the Shattered Isles, and caves.
- [ ] Add ferries, advanced boat travel, passes, and waystones.
- [ ] Complete connectivity, accessibility, performance, and save-migration
      hardening.

## Quality gates

- [x] Large-map controls are keyboard accessible and usable at 390×844,
      844×390, and 1280×720.
- [x] Elaris, the current position, and beds remain distinguishable without
      relying on colour alone.
- [x] Destroyed beds disappear from the map and respawn choices.
- [ ] Unknown regions never disclose unintended quest or resource information.
- [ ] Players cannot cross the world boundary by foot or boat.
- [ ] Rivers and terrain features join consistently across area seams.
- [ ] Every required destination is reachable for its intended progression
      tier.
- [x] Save migration and deterministic-state tests continue to pass.
- [ ] Every released destination has at least two unique one-time reasons and
      one repeatable reason to visit.
