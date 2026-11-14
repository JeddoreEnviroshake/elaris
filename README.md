# Elaris

A top-down creature-taming survival-builder, delivered as an installable,
local-first Progressive Web App (PWA) that runs from one codebase on phones,
tablets, and computers. Single-player in Phase 1.

**Core loop:** explore → gather → craft/repair/upgrade → build larger
environments → place efficiency infrastructure → tame or order working
creatures → gather faster.

> **Status: Milestone 2 in progress.** The platform foundation and vertical
> slice are complete. The efficiency economy now includes the Iron chain and
> the first complete worker/housing loop, alongside a distinct
> grassland clearing and wood-rich forest, renewable trees/stone/plants,
> gathering; inventory; Wooden/Stone tools; early
> building; persistent Tuftle taming/assignment; and save/reload. See
> [Roadmap](#roadmap).

---

## Quick start

Requires **Node 22+** (see `.nvmrc`).

```bash
npm ci            # install exact, pinned dependencies
npm run dev       # start the dev server (http://localhost:5173)
npm run build     # type-check + production build to dist/
npm run preview   # serve the production build (PWA/offline active here)
npm test          # unit tests (Vitest)
npm run typecheck # strict TypeScript, no emit
npm run test:e2e  # browser tests (Playwright)
```

The service worker is disabled under `npm run dev` so hot-reload isn't fighting a
cache. To exercise install/offline/update behavior, use `npm run preview` (or a
real deploy).

---

## Primary 3D presentation

Elaris is now a fixed-camera 3D game. The authoritative deterministic
simulation, saves, input, collision, and accessible UI remain renderer-neutral.
The older 2D renderer is retained as an Admin/testing fallback, not the primary
player experience. Use the **3D WORLD / 2D WORLD** toggle in the **Admin** menu
to switch at runtime, or append `?render=2d` / `?render=3d` for testing.

The 3D scene uses a curated CC0 subset of Kenney's Nature, Fantasy Town,
Survival, and Mini Characters kits plus original swappable low-poly assemblies
for Elaris buildings and creatures. Model provenance and exact filenames are
recorded in [`docs/3d-asset-sources.md`](docs/3d-asset-sources.md), with runtime
semantic mappings in `src/three/assetRegistry.ts`.

Quaternius' textured nature and medieval village models now extend from the
western entrance across town, field settlements, regional resources, planted
scenery, interiors, construction and combat dioramas. The original articulated
characters gain expressive faces, with distinct rigs for all nine creatures.
Repeated scenery is instanced, nearby vegetation streams as the player travels,
and resource updates preserve unrelated models. All curated models and their
licenses ship locally for offline play; provenance and the import workflow are
recorded in the asset-source document above.

The full graphics pass gives the game a painted woodland-fantasy direction:
painted sage terrain, depth-blended teal water, individually colored roofs,
dormers and pointed towers, rounded character details, cutaway interiors with
woven rugs, and expanded battle scenery. Soft contact shadows and a restrained
color grade finish the scene; the HUD uses forest ink, leather and brass.
The hidden 2D camera stops drawing in 3D mode, ambient creature traces stay near
the player, and phone-sized displays use a smaller rendering budget. See
[`docs/art-direction.md`](docs/art-direction.md) for the visual guidelines.

The player and all nine creatures now use original vertex-painted woodland
sculpts: a hooded warden with layered travel gear, individual animal anatomy,
leaf ears, amber crystals, branching antlers, patterned wings and curved tails.
Details merge into the animated joints, with compact background people for
busy rooms. Tools, riding seats, followers and combat retain their existing
contracts; taller silhouettes receive clear overhead labels.

Character motion now includes bending knees and elbows, planted foot phases,
blended transitions, species-specific gaits and idle habits, and secondary
cloth, leaf, tail and wing movement. Gathering tools and combat actions use
distinct local timelines; riders can gather, shoot and cast while seated.
Wild 3D creatures follow their simulated movement and turn toward travel.
Animation affects presentation only, with stable reduced-motion poses and
matching animated shadows.

Wild encounters remain deterministic but render as a dedicated 3D arena with
articulated combatants, movement, melee/ranged/magic attacks, companion support,
damage reactions, captures, and terminal poses. The accessible battle controls
remain the authoritative input surface.

Farm Counters, Small Pens, and Barns have dedicated 3D structures. Click the
Farm Counter to order a previously tamed species, assign the creature from the
roster, then click its Pen or Barn to collect finite passive output.

Species roles now extend that loop: Craghoppers deliver stone at Stone Yards
and speed mining without duplicate stacking; mounted Glade Stags retain their
1.7Ã— travel speed while stationed Stags unload raw-resource stacks through a
linked Cart Dock; working Snarlfoxes reduce hostile detection around their yard.

The construction ladder now reaches Stone and Metal, with their full set of
surfaces and boundaries represented distinctly in 3D. Warehouses provide 24
shared storage spaces, while Logistics Hubs route completed creature output
through explicit, ordered storage destinations without losing blocked output.

---

## Controls

New games begin with a roadside Tuftle southeast of the starting position.
Approach it and choose **Help Tuftle** (or press `E` / `Space`) to earn its trust.
The guided interaction shows Calm, Fear, and each action's effect; berries come
from the roadside basket. **Continue later** or `Escape` leaves the interaction
ready to resume, including after a reload. Once befriended, the Tuftle joins the
normal roster, follows immediately, and can be named. Existing saves keep their
original progression and do not receive another starter creature. Take your
following Tuftle through the west gate to the resource grove: it provides 25%
extra fiber from plants within three tiles of you. Fractional gains carry across
harvests and saves, and only the strongest eligible helper applies. Its first
whole bonus fiber completes the cooperation lesson and automatically teaches
the shelter recipes, including the Air Purifier and Storage Box. The **Shelter**
tab then offers a movable four-by-two footprint, a live room/protection checklist,
and staged previews with full material costs. A one-time bundle supplies 16 fiber,
4 wood, and 2 stone; an extra gathering patch supplements the nearby grove.
Custom qualifying rooms count equally. In Build, **Floor area** and **Wall line**
let you select a start and end, preview the full group, and explicitly confirm;
**Undo** refunds the latest group once. In new games, the first scheduled threat
waits for a working shelter, then announces 45 seconds of preparation followed by
45 seconds of fog. The Shelter guide explains real protection boundaries,
storage use, and the Elaris sanctuary fallback. Surviving with time in purified
air records the lesson and shows a dismissible aftermath; the ordinary rotation
then continues with a safe phase before the first raid. Failed attempts can be
completed during a later fog. Leaving Elaris early permanently ends guided
protection and begins the ordinary cycle, with a warning at the region edge.
The simulation clock keeps running; reloads retain the schedule and closed-game
time cannot finish the lesson. Existing saves keep their original threat timing
and property. After the fog, the **Paddock** tab teaches an eight-tile work yard
with a Small Pen. Its optional movable layout costs 19 fiber and 10 wood, keeps
a gate clear, and reserves grassland for a future Garden Bed. Required recipes
are taught automatically, with an optional one-time supply bundle. The same
Tuftle can be housed and assigned to Work through its assignment card: it makes
two fiber every fifteen seconds into the normal twelve-item Pen bin. The guide
shows the next delivery, full-bin pauses, and enclosure repairs. Collect output
near the Pen, then choose Follow again; the housing reservation remains and
home production stops. Progress, partial cycles, and collection credit survive
reloads. **Supply Run** then points to a lost cart along Elaris's west road,
with walking directions, a map marker, and cyan route beacons. An optional log
holds berries and a Cloth Mask. At the cart, **Practice Shell Guard** explicitly
opens the existing arena with your following Tuftle and Shell Guard selected.
Read enemy Intent before acting; actual prevented damage is shown. Retreat is
guaranteed during this practice and preserves progress. Winning is optional:
recovering supplies separately grants 4 wood, 2 fiber, and one carried Garden Bed
blueprint. A full bag leaves the paper pending at the cart or public workbench.
The unique discovery remains recoverable after a drop or defeat and must be
registered before it can be sold or scrapped. Follow the return route to Elaris's
public workbench at X 84, Y 83. **Garden** guides registration through the same
permanent recipe system and suggests a movable two-by-one bed beside the Pen,
leaving the gate clear. Placement previews use normal reach, collision, and
material checks; custom gardens in Elaris count equally. No property is cleared
or moved. Garden Beds grow five fiber every sixty simulation seconds without a
worker, hold fifteen fiber, and pause when full. The first actual collection
completes the chapter and shows a saved recap of the partnership, shelter, fog,
production, discovery, and harvest. Choose to expand your home, explore a
neighboring region, befriend another creature, or keep playing freely. The
direction can be changed from the recap, and ordinary threats keep running.
Reloads preserve partial growth, uncollected output, completed lessons, and
the chosen direction. Upgraded saves retain existing recipes, gardens, and
resources; legacy saves do not receive this guided chapter.

Input modes coexist — keyboard, mouse, and touch all work in the same session
and are never locked by a one-time device check.

### Desktop

| Action | Keys |
| --- | --- |
| Move | `W A S D` or arrow keys |
| Slow walk | hold `Shift` |
| Gather / pick up / context action | `E`, `Space`, or primary click |
| Craft menu | `C` |
| Build menu | `B` |
| Inventory panel | `I` |
| Equip hotbar tool / bare hands | `1`–`5` / `0` |
| Place structure (in build mode) | `E`, `Space`, **Gather**, or **Place** |
| Cancel / close menus | `Esc` |

While placing, the ghost follows the mouse and tints green/red for
valid/invalid spots. The bottom-center hotbar mirrors your first five tool
slots (durability bars included) and hides while a placement ghost is out.

### Touch

- **Left joystick** — move. Partial deflection is a slow walk.
- **Gather** — harvest the nearest highlighted resource in range, or pick up a
  nearby dropped bundle.
- **Craft** — open the handcraft panel: first recipe plus per-tool **Equip**.
- **Build** — open the structure palette. Tap the ground to position the ghost,
  then tap **Place** or **Gather**, or press `E`/`Space`, to confirm. A stray
  touch never commits a structure.
- **Menu** — open the tabbed gameplay menu; its Bag tab shows resource stacks and per-tool
  durability. Tap a tool cell for its card: **Repair** (priced from the bag) or
  **Drop**, which puts the tool on the ground for ten minutes, wear and ranks
  intact.
- **Hotbar** — the bottom-center strip mirrors your first five tool slots;
  tap a tool to equip it, or tap an empty slot to switch to bare hands.
- **Creatures** — offer three fiber to the nearby wild Tuftle, then open the
  roster rail button to choose **Follow**, **Work**, or **Rest**. Work selects
  the nearest eligible Woodlot Planter or Storage Box (small) and deposits its
  deterministic plant-material harvest into the Storage Box (small).

Planned: secondary action, configurable control size/opacity, and a
left-handed layout.

### Orientation

Portrait is the primary, fully-supported layout. Landscape is playable using the
same HUD with overlay controls. **Rotation is never forced** and never reloads or
loses state.

### Town buildings and NPC services

Town services are playable rooms in both the primary 3D presentation and the
2D/Admin fallback. Stand at a named doorway and use the context action (`E`,
`Space`, primary click, or the touch action button) to enter; walking across a
door does not open a menu automatically.

Inside a building:

- Move with the normal keyboard or touch controls.
- Approach the named NPC and use the context action to talk.
- Choose a dialogue response before opening the NPC's focused service overlay.
- Every service the NPC offers is listed on that one overlay; there is no staged
  ritual in front of it.
- Press `Escape` to close dialogue, return from a service, or leave the room.
  The named **Leave** action at the doorway works with click or touch.

Each building has its own low-volume ambient soundscape. Sound fades cleanly
between the exterior and room, pauses while the app is in the background, and
respects browser/device audio controls. Reduced-motion mode removes decorative
room motion and particles without hiding interaction state.

---

## Saves

Saves are **local-first**, stored in your browser's **IndexedDB**. Cross-device
cloud sync via Firebase arrives in Milestone 2; until then, **Export / Import** is
the portability path (and remains a permanent fallback).

Open the status pill (top-left) → **Diagnostics** to reach save management:

- **Export save** — downloads a versioned JSON file (uses the native share sheet
  where available, otherwise a normal download).
- **Import save** — validates and migrates a save file, backing up your current
  save first.
- **Reset save** — clears local progress after an explicit confirmation.

### Where your save lives (important)

Local browser storage is specific to the **origin** (URL), **browser profile /
storage container**, **installation context** (browser tab vs. installed app),
and **device**. Consequences:

- The **installed app** and a **normal browser tab** at the same URL may hold
  **separate** saves. Use Export/Import to move between them.
- **Firebase Hosting preview channels have their own URLs**, so each preview has
  its **own separate save**.
- **Private / incognito** windows are **not durable** — their storage is cleared
  when the window closes.
- **Clearing site data or uninstalling** the app can **remove local progress**.
- Cloud sync (Milestone 2) will require signing in to the **same account** on
  each device; until then use Export/Import when switching devices or contexts.

### Durability guarantees

- Only one **writer** is active per origin/profile at a time. Opening the game in
  a second live tab is **read-only** ("Game already open"); a fencing token
  prevents a stale writer from ever overwriting current data.
- Reloading your own game re-acquires the writer immediately (a liveness probe
  distinguishes a genuinely-open second tab from a dead predecessor).
- Ordinary movement autosaves on a short debounce; the current save rotates into
  a **last-known-good** backup, and invalid/failed migrations never overwrite
  current, last-known-good, or the raw pre-migration backup.

---

## Install, offline, and updates

- **Install:** where the browser supports it (Android Chrome is the Phase 1
  target), install from the browser menu. The app also remains fully playable in
  a normal browser tab everywhere.
- **Offline:** after the first successful load, the status pill shows **Ready
  offline** once the service worker has finished precaching. From then on the app
  cold-launches offline.
- **Updates:** a new build shows a non-blocking **Update ready** banner. Choosing
  **Save & update** flushes your save, releases the writer lease, activates the
  new version, and reloads — code is never swapped beneath a running session, and
  a failed save cancels the update rather than risking progress.

---

## Deployment

Hosting is **Firebase Hosting**, deployed from **GitHub Actions** (project
`elaris-abb6d`, configured locally in `firebase.json` / `.firebaserc`).

- Production `main` deploys to one stable origin (`elaris-abb6d.web.app`) only
  after `npm ci`, typecheck, unit tests, a production build, and PWA/browser
  tests against that exact `dist` pass.
- Every pull request / non-release branch gets a phone-accessible preview-channel
  URL.

> **Not yet wired:** the GitHub repository and the Actions workflow. Once the repo
> exists, `firebase init hosting:github` provisions a least-privilege service
> account + secret, and the CI workflow lands. Manual deploy (for maintainers with
> Firebase access): `npm run deploy`.

---

## Project structure

```
src/
  audio/             Semantic interior soundscape routing and Web Audio lifecycle
  main.ts            Boot: build save layer, load, then start the Phaser game
  scenes/            Phaser scenes (render state, translate input to intents)
  simulation/        Phaser-independent core: state, commands, fixedStep, rng, clock
  config/            Tunable values: platform, versions (balance lands in M1)
  platform/          PWA registration/updates, build info, responsive layout
  persistence/       SaveRepository, IndexedDbSaveRepository, migrations, export/import
  art/               Procedural placeholder textures (generated at boot)
  ui/                App chrome (status/diagnostics), touch controls
scripts/             Build-time asset generation (PWA icons)
tests/unit/          Deterministic unit tests
public/icons/        Generated original PWA icons
```

Design principle: the simulation, content definitions, persistence interfaces,
and formulas stay **independent of Phaser**. Scenes render state and turn input
into validated commands. All tunable values live in typed config modules — no
scattered magic numbers.

---

## Roadmap

- **Milestone 0 — platform foundation** *(complete)*: toolchain, responsive
  movement/camera, installable offline PWA shell + safe updates, IndexedDB saves
  with lease/backup/export/import/migration, and GitHub CI/CD. A broader
  real-device lifecycle pass remains part of hardening.
- **Milestone 1 — vertical slice** *(complete)*: persistent resources,
  gathering, inventory, Wooden/Stone tools, durability, early building, exact
  area gates, and the first Tuftle tame/follow/work/rest loop are playable.
  A data-driven nine-quest onboarding chain now guides the full first-session
  loop through Tuftle work. The starter region now has deterministic grassland
  and forest zones plus persisted resource-regrowth timers. Wild Tuftles now
  enter deterministic, turn-based encounters with attack, snare, berry, and
  flee actions that resume exactly after reload. The Garden Bed — discovered
  permanently at the 8-tile Shelter milestone and placed on grassland soil
  inside a currently qualifying 8-tile work yard — now grows fiber on a
  deterministic timer: harvest it with the context action, a full bed pauses
  (never discards) growth, and breaking the enclosure suspends it in place
  until the yard is repaired. The 16-tile Woodlot Planter now provides the
  next environment utility step: on forest soil it grows harvestable wood,
  pauses at capacity, and suspends safely if its work yard is broken.
  Mara the Smith, Orin the Stockkeeper, and Tavi the Trader now inhabit the
  starter region as protected, stationary service NPCs. Their conversations
  preview the Weaponsmith, Farm, and Market systems planned for Milestone 2.
- **Milestone 2 — efficiency economy** *(in progress)*: the iron chain,
  Furnace, Farm Counter, Small Pen/Barn housing, trained Tuftle orders, and
  capped online/offline worker production are complete. Craghopper, Glade Stag,
  and Snarlfox overworld roles, Stone/Metal construction, Warehouses, and
  Logistics Hubs are also complete. Next: cloud sync.
- **Milestone 3 — breadth & hardening:** area gates 128/256, all four species,
  full upgrade ranks, performance/accessibility/lifecycle passes.

---

## Known gaps

- Deterministic encounters, snares, and all four wild species are playable;
  Tuftle housing and every original species role are playable. Garden Bed and
  Woodlot Planter utilities are playable; Compost Bin, Sharpening Wheel,
  and other later-tier placeables remain future work.
- The update-prompt flow is wired but not yet exercised end-to-end against real
  successive deploys.
- Interior ambience is implemented; broader overworld music, effects, and an
  in-game volume mixer remain future work.
- iOS/iPadOS is out of the Phase 1 support matrix (loads in Safari where possible
  but is not tested or guaranteed).
