# Workbench facility interaction — simulation-lane work

## Context

We're replacing the workbench's invisible "valid enclosed indoor room" operational
gate (which produced opaque `Locked — needs a working workbench` failures with no
spatial feedback) with a tangible model:

- **Placement:** a facility declares the player-built floor type it must sit on
  (workbench → floor). No enclosure, no area tier, no indoor check.
- **Interaction:** when the player is within ~4 tiles of a facility on its required
  floor, a named button ("Workbench") appears; tapping opens a focused panel of that
  facility's recipes.

The **presentation side is already built and merged in the working tree** (Claude's lane):
- `src/scenes/WorldScene.ts` — `nearestFacilityInRange()` (proximity geometry, `BUILD_RANGE_PX`),
  threaded into both `hud.refresh(...)` calls.
- `src/ui/gameplayHud.ts` — the named facility button + focused `facilityPanel`
  (`FACILITY_RECIPES` maps `workbench` → iron tools), shown/hidden by `refreshFacility`.
- `tests/e2e/facilityInteract.spec.ts` — verifies the button appears in range and opens
  the panel (passes desktop + mobile).

The button/panel are live, but **crafting still fails at the bench** because the iron-tool
recipes still evaluate the old enclosure gate. This prompt covers the remaining
**simulation-lane** changes that make crafting actually work under the new model.

## Tasks

### 1. Facility surface requirement — `src/config/areaGates.ts`
Add to `PlaceableDefinition`, mirroring the existing `requiredTerrain` field:
```ts
/** Player-built surface required beneath the footprint (e.g. workbench → floor). */
requiredSurface?: SurfaceKind;
```
On the `workbench` entry: add `requiredSurface: 'floor'` and **remove** `minEnvironmentArea: 8`
and `environmentKind: 'indoor'`. (Leave the `requirement: highestAreaTierEver >= 8` blueprint
unlock as-is — that's separate from the operational gate. Flag if you think it should relax too.)

### 2. Honor it in the facility gate — `src/simulation/environmentProgress.ts`
In `evaluateFacilityGate` (~line 230):
- Check `requiredSurface` against `surfaceKindAt` for every footprint tile; fail with a clear
  reason (e.g. `Place it on a wood floor`) when it doesn't match.
- Make the **enclosure / `valid` / area** checks conditional on the placeable declaring
  `environmentKind` or `minEnvironmentArea`, so the workbench no longer requires enclosure
  while the furnace (which keeps `environmentKind: 'indoor'`) still does.

### 3. Proximity helper — `src/simulation/gameplayCommands.ts`
Next to `nearestLiveNode` / `nearestWildCreature` (~line 260):
```ts
export function nearestUsableFacility(state: GameState, range = BUILD_RANGE_PX): BuildingState | null
```
Nearest placed facility within `range` whose `requiredSurface` is satisfied (footprint on the
required floor). Presentation will swap its local `nearestFacilityInRange()` for this so the
floor check is enforced (see the comment on that method in `WorldScene.ts`).

### 4. Gate change — `src/simulation/gameplayCommands.ts` `toolUnlockReason` (~line 516)
Replace the iron-tool `workstationAvailable: workbench` predicate with:
- iron discovered (`materialDiscovered: iron`) → recipe is *known*, AND
- a usable workbench in range (via `nearestUsableFacility`) → craftable *now*.

Messages: away from a bench → `Craft at a workbench`; no valid bench built →
`Build a workbench on a floor`.

## Already applied (Claude) — keep
`src/simulation/unlocks.ts` gained `workstationBlockedReason` + a branch in
`unlockBlockedReason` that expands a failed `workstationAvailable` into the specific
`evaluateFacilityGate` reason. This stays useful for the **furnace** and any station that
keeps the enclosure gate.

## Verification
- `npx tsc --noEmit`
- `npx vitest run` (add/adjust unit tests for the new surface gate + `nearestUsableFacility`)
- `npm run build` then `npx playwright test facilityInteract --project=desktop-chrome --project=mobile-chrome`
  — after this lands, extend the e2e to assert an iron recipe becomes **craftable** (not locked)
  when standing at a workbench on a floor.

## Design note
Keep the enclosure/area-tier system intact for other facilities; only the workbench is being
moved off it. Any facility can opt into `requiredSurface` and expose recipes via the
presentation `FACILITY_RECIPES` map.
