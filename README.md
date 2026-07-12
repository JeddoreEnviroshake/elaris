# Elaris

A top-down creature-taming survival-builder, delivered as an installable,
local-first Progressive Web App (PWA) that runs from one codebase on phones,
tablets, and computers. Single-player in Phase 1.

**Core loop:** explore → gather → craft/repair/upgrade → build larger
environments → place efficiency infrastructure → tame or order working
creatures → gather faster.

> **Status: Milestone 0 (platform foundation).** The local foundation is
> complete — responsive movement, an installable offline PWA shell, and a
> local-first IndexedDB save system. Gathering, crafting, building, and
> creatures arrive in Milestone 1+. See [Roadmap](#roadmap).

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

## Controls

Input modes coexist — keyboard, mouse, and touch all work in the same session
and are never locked by a one-time device check.

### Desktop

| Action | Keys |
| --- | --- |
| Move | `W A S D` or arrow keys |
| Slow walk | hold `Shift` |

Planned for later milestones: `E` interact, `Space`/primary-click gather/attack,
`1`–`5` hotbar, `B` build, `C` craft, `I` inventory, `Esc` cancel/menu.

### Touch

- **Left joystick** — move. Partial deflection is a slow walk.

Planned: right-side primary/secondary action buttons, hotbar, and build/craft/
menu buttons, with configurable size/opacity and left-handed layout.

### Orientation

Portrait is the primary, fully-supported layout. Landscape is playable using the
same HUD with overlay controls. **Rotation is never forced** and never reloads or
loses state.

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

- **Milestone 0 — platform foundation** *(local half complete)*: toolchain,
  responsive movement/camera, installable offline PWA shell + safe updates,
  IndexedDB saves with lease/backup/export/import/migration. Remaining: GitHub
  CI/CD deploy + real-device smoke test.
- **Milestone 1 — vertical slice:** grassland/forest region; trees/plants/
  boulders; bare hands + Wooden/Stone tools with durability & repair; inventory,
  crafting, building, area gates (4/8/16); Field Cache, Workbench, Woodlot
  Planter; first wild species + taming; quests.
- **Milestone 2 — efficiency economy:** iron chain + Furnace, Blacksmith/Market
  coin services, Firebase cloud save sync, area gates 32/64, workers/logistics,
  more biomes and species.
- **Milestone 3 — breadth & hardening:** area gates 128/256, all four species,
  full upgrade ranks, performance/accessibility/lifecycle passes.

---

## Known gaps (Milestone 0)

- Gameplay beyond movement (gathering, tools, crafting, building, creatures) is
  not implemented yet — this is the platform foundation.
- GitHub repository and the CI/CD deploy pipeline are not set up yet; the app runs
  locally and builds a deployable `dist`.
- The update-prompt flow is wired but not yet exercised end-to-end against real
  successive deploys.
- Audio is intentionally out of scope in Phase 1 (a mute/settings stub is planned).
- iOS/iPadOS is out of the Phase 1 support matrix (loads in Safari where possible
  but is not tested or guaranteed).
