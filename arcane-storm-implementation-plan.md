# Arcane Storm Implementation Plan

## Status — 2026-08-02

Implemented end to end: all eleven sections below are in the tree, with unit
coverage in `tests/unit/arcaneStorm.test.ts` and `tests/unit/arcaneStormRigs.test.ts`
and browser coverage in `tests/e2e/arcane-storm.spec.ts`. Three deviations from
the plan as written:

- The save schema had moved on: the migration is **v65 → v66**, not v56 → v57.
- `underThreat()` no longer exists. Vital bars are driven by the activity rule in
  `src/ui/vitalBars.ts`, which deliberately does not treat danger as an override,
  so there was nothing to make threat-aware.
- The 3D marker geometry lives in `src/three/arcaneStormRigs.ts` rather than
  inside the renderer, matching how raider rigs and raid arrows are split out —
  which is what makes the frame maths testable without a WebGL context.

## Outcome

Add **Arcane Storm** as Elaris's third danger event. Poison Fog tests shelter,
Night Raid tests combat and base defence, and Arcane Storm tests movement under
pressure while offering a small, time-limited resource reward.

The feature is complete when the same deterministic storm is represented in the
simulation, save data, HUD, Phaser renderer, Three.js renderer, Admin controls,
and automated tests.

## Product decisions

### Core event

- The internal threat id is `storm`; the player-facing name is **Arcane Storm**.
- A storm uses the existing 60-second danger phase. It never overlaps Poison Fog
  or a Night Raid.
- During the storm, a strike marker snapshots the player's current tile. The
  player then has 3 seconds to leave a 2-tile-radius impact zone.
- Impacts deal 35 HP to a player still inside the radius.
- A healthy starting character cannot be killed by one impact, but repeatedly
  ignoring markers is lethal.
- Air Purifiers, Cloth Masks, and turrets do not protect against a storm. Outside,
  the event's only answer is movement.
- An enclosed room does protect the player, purified or not — the same walls that
  survive a raid night. Elaris's permanent sanctuary protects them too.
- Cover suppresses markers rather than pausing the storm: strike slots are
  consumed on schedule while the player is inside, and the danger-phase countdown
  runs to its end, so stepping outside is met by the next strike and never by a
  backlog of them.
- Arcane impacts do **not** damage player construction in the first version.
  Randomly losing permanent progress would weaken the otherwise readable dodge
  test. Structure interaction can be reconsidered after playtesting.

### Strike cadence

Use a fixed schedule within the danger phase:

| Impact | Telegraph begins | Impact lands | Reward |
| ---: | ---: | ---: | --- |
| 1 | 0:05 | 0:08 | None |
| 2 | 0:13 | 0:16 | None |
| 3 | 0:21 | 0:24 | 1 iron ore |
| 4 | 0:29 | 0:32 | None |
| 5 | 0:37 | 0:40 | None |
| 6 | 0:45 | 0:48 | 1 iron ore |
| 7 | 0:53 | 0:56 | None |

This gives a four-second opening read, seven total movement checks, and no marker
that survives beyond the danger phase.

Reward impacts should have a distinct gold core from the moment they are
telegraphed. Their iron-ore ground drops expire at the end of the storm, making
collection a visible risk/reward decision instead of free loot gathered later.
The maximum reward is deliberately only two ore per storm so the event does not
replace mining or bypass iron progression.

### Unlock and rotation

Preserve the current onboarding sequence for two complete Fog/Raid pairs, then
introduce the storm:

| Cycle | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Threat | Fog | Raid | Fog | Raid | Storm | Fog | Raid | Storm | Fog | Raid |

From cycle 4 onward, repeat `storm -> fog -> raid`. This lets new saves learn the
two existing preparation loops before the movement event appears.

Raid scaling must count actual raid nights, not all danger cycles. Refactor
`raidNumberFor` so the raid sequence remains raid 0 on cycle 1, raid 1 on cycle
3, raid 2 on cycle 6, and so on. Fog and storm cycles must not increase wave size
or settle absent bases.

### Encounters, travel, and defeat

- Do not allow a new turn-based creature encounter to start during an active
  Arcane Storm. Return a clear message such as `The Arcane Storm makes an
  encounter unsafe`.
- If a pre-existing encounter crosses into the storm, consume scheduled strike
  slots without spawning them until the encounter ends. An immobilized battle
  player must never receive an unavoidable overworld hit.
- Each marker remains bound to the area in which it was created. Crossing an
  area boundary dodges that impact but leaves any reward at the original impact
  site. The next scheduled marker targets the player's new area.
- Resolve markers against either the active area's collections or its
  `visitedAreas` snapshot so leaving an area cannot duplicate or erase a strike.
- Add `arcane-storm` to `PlayerDefeatCause`. A lethal impact uses the existing
  durable respawn flow and carried-inventory loss exactly once.
- Respawn protection blocks storm damage. Pending respawn state suspends new
  markers.
- Offline settlement does not advance the survival clock today, so it must not
  create or resolve storm strikes.

## Technical design

### 1. Threat schedule and shared metadata

**Edit:** `src/simulation/survivalCycle.ts`

- Extend `DangerThreat` to `'fog' | 'raid' | 'storm'`.
- Replace the two-way modulo in `dangerThreatFor` with the onboarding schedule
  above.
- Refactor `raidNumberFor` to count only preceding raid threats. Prefer a small
  pure helper over another saved counter so existing saves retain their schedule
  solely from `tick`.
- Keep `survivalTimerAtTick` and `startDangerPhaseNow` derived from the existing
  shared safe/danger durations.
- Ensure Fog exposure is cleared and remains inactive during Storm cycles.

**Add:** `src/content/dangerThreats.ts`

Create one exhaustive metadata table keyed by `DangerThreat` with player-facing
name, uppercase timer label, preparation copy, active copy, and ARIA name. Use it
to replace nested `fog ? ... : raid` expressions. A `Record<DangerThreat, ...>`
will make future threat additions fail type-checking until every label exists.

### 2. Save-backed storm model

**Edit:** `src/simulation/state.ts`

Add integer-only state:

```ts
export interface ArcaneStrikeState {
  id: string;
  cycleIndex: number;
  strikeIndex: number;
  areaKey: string;
  x: number;
  y: number;
  telegraphAtTick: number;
  impactAtTick: number;
  rewardIronOre: number;
  resolvedAtTick: number | null;
}

export interface ArcaneStormState {
  cycleIndex: number | null;
  nextStrikeIndex: number;
  strikes: ArcaneStrikeState[];
}
```

Add `arcaneStorm` to `GameState` and initialize it with no cycle, index zero, and
an empty strike list. Snap target positions to tile centres so serialized
coordinates are integers and deterministic.

`nextStrikeIndex` prevents reloads from recreating consumed strike slots.
`resolvedAtTick` prevents double damage or duplicate rewards and lets both
renderers show a brief impact effect before the record is pruned.

### 3. Balance and Admin controls

**Edit:** `src/config/balance.ts`, `src/simulation/state.ts`,
`src/simulation/admin.ts`, and `src/ui/adminPanel.ts`

Add a separate `EditableArcaneStormBalance` under `gameBalance.storm`:

```ts
interface EditableArcaneStormBalance {
  firstImpactSeconds: number;       // 8
  intervalSeconds: number;          // 8
  telegraphSeconds: number;         // 3
  impactRadiusTiles: number;        // 2
  playerDamage: number;             // 35
  rewardEveryStrikes: number;       // 3
  rewardIronOre: number;            // 1
}
```

Validation rules:

- all fields are non-negative integers and cadence/radius fields are positive;
- `telegraphSeconds < firstImpactSeconds`;
- `firstImpactSeconds < raid.dangerPhaseSeconds`;
- `intervalSeconds > telegraphSeconds` so markers do not overlap by default;
- `playerDamage` may not exceed a conservative Admin ceiling;
- changing values cannot make a computed impact land at or beyond the danger
  phase boundary.

Show these values in an **Arcane Storm** Admin section. The existing **Start
Danger Now** action should start whichever threat the current cycle predicts;
it must not force a storm specifically.

### 4. Authoritative storm simulation

**Add:** `src/simulation/arcaneStorm.ts`

Export pure views plus one mutating step:

- `stormStrikeSchedule(balance, dangerDuration)` returns the scheduled impact
  offsets and reward flags.
- `activeStormStrikes(state)` returns unresolved/recently resolved markers for
  the current area in stable order.
- `nextStormImpactView(state)` supplies the HUD countdown.
- `advanceArcaneStorm(state): ArcaneStormAdvanceResult` performs cycle
  bookkeeping, creates due markers, resolves due impacts, emits rewards, prunes
  old visuals, and returns `changed` plus an optional defeat.

Creation rules:

1. Exit after cleanup unless the timer is an active `storm` danger phase.
2. On a new storm cycle, reset `nextStrikeIndex` and stale strike records.
3. For every newly due telegraph slot, increment `nextStrikeIndex` even when the
   slot is suppressed by sanctuary, pending respawn, or an active encounter.
4. Otherwise snapshot the player's current tile centre and `currentArea.key`.
5. Give reward strikes `rewardIronOre` from balance and all other strikes zero.

Impact rules:

1. Ignore an already resolved strike.
2. Mark it resolved before applying side effects.
3. If the target area is active, damage the player only when all are true: the
   player is still in that area, inside the configured radius, outside Elaris
   sanctuary, not respawn-protected, and not already defeated.
4. Deposit reward ore at the impact centre using the existing ground-drop
   representation, with `expiresAtTick` set to the danger-phase end tick.
5. If the target area is inactive, add the reward to that area's saved
   `groundDrops`; never damage an absent player or any structure.
6. If HP reaches zero, call `beginPlayerDefeat(state, 'arcane-storm')`.

Retain resolved strikes for roughly 30 ticks for impact presentation, then prune
them. At the phase boundary, resolve anything already due, discard future
records, and leave no storm state that can affect the next event.

### 5. Fixed-step integration

**Edit:** `src/simulation/commands.ts`

Call `advanceArcaneStorm` once per fixed step after `state.tick` advances and
before player movement is applied. This ordering gives the player every movement
step before the exact impact tick, while an impact on that tick evaluates the
position reached during prior ticks.

Route storm defeat through the same `onPlayerDefeated` callback used by raids and
exposure, stop movement, and include storm state changes in the method's durable
change result.

Keep `advanceRaid` callable every tick for its cycle cleanup, but confirm it only
spawns/settles waves on `raid` threats. `advanceSurvivalCycle` remains responsible
only for Fog exposure.

### 6. Area snapshots and rewards

**Edit:** `src/simulation/areas.ts` only if a small shared area-collection helper
is needed.

Do not copy storm markers into `AreaSnapshot`; they are global scheduled events
that already carry an `areaKey`. Add a helper that safely returns the mutable
ground-drop collection for either the current area or a visited snapshot. This
keeps travel resolution explicit without swapping the whole active area.

Use existing `iron-ore` ground drops. Do not add `arcane-shard` in this version:
that would also expand inventory stacks, storage, logistics, bag weights, sell
prices, migrations, and crafting before the resource has a real long-term use.

### 7. 2D presentation

**Edit:** `src/scenes/dangerPresentation.ts`, `src/scenes/dangerFog.ts`, and
`src/scenes/WorldScene.ts`

- Add a violet/navy storm atmosphere to `DANGER_PRESENTATION`.
- For Storm, `dangerSafeCells` should include only Elaris sanctuary cells. Rooms
  and purifier coverage must not be punched out.
- Rename `DangerFogOverlay` to `DangerAtmosphereOverlay`; it already renders Fog
  and Raid, and the third threat makes the old name actively misleading.
- Add `ArcaneStormOverlay` as a separate presentation-only class. It reads the
  authoritative strike records and renders:
  - a violet outer radius showing the exact damage area;
  - a contracting inner ring communicating time-to-impact;
  - a gold centre for reward-bearing strikes;
  - a short white-violet flash and radial shards for resolved impacts.
- Keep markers above terrain and structures but below HUD/menus. They must remain
  legible under the ambient danger wash.
- With reduced motion, replace pulsing/rotation with a static ring whose opacity
  steps up near impact.
- Clear and rebuild visuals safely on area changes and scene teardown.

### 8. Three.js presentation

**Edit:** `src/three/Elaris3DRenderer.ts`

- Add the same violet ambient palette through shared danger presentation data.
- Render each telegraph as a projected ground ring at its authoritative world
  coordinate, with the same radius and countdown proportion as Phaser.
- Render a brief vertical energy column and shard burst after impact.
- Reward markers use the same gold centre as 2D.
- Exclude storm ambience and markers while the battle overlay is active, matching
  the current danger-overlay policy.
- Dispose marker geometry/materials when records expire, areas change, the mode
  changes, or the renderer is destroyed.
- Add storm marker/impact counts to `ThreeRendererSnapshot` for deterministic
  presentation tests.

### 9. HUD, accessibility, and player teaching

**Edit:** `src/ui/gameplayHud.ts`, `src/ui/vitalBars.ts`, and
`src/ui/respawnPanel.ts`

- Replace binary threat-name and safety ternaries with the shared threat
  metadata.
- Safe phase: `ARCANE STORM IN  9:59`.
- Active phase: `ARCANE STORM  0:59` plus `SANCTUARY` only when protected by
  Elaris. Do not label a room as safe.
- Reuse the secondary danger badge for the nearest marker targeting the current
  area: `IMPACT  0:03 · MOVE OUT OF THE RING`.
- A reward marker may append `CHARGED ORE` without obscuring the countdown.
- Update `underThreat()` so Storm keeps HP/SP/MP bars visible outside sanctuary.
  While touching this code, make threat safety explicit instead of treating
  Fog shelter as the universal rule for all danger events.
- War Table status during Storm should say that turrets and purifiers do not
  help, show the movement instruction, and advertise up to two iron ore. It must
  not preview a raid wave on a Storm cycle.
- Respawn copy: `The Arcane Storm struck you down`.
- Add exact ARIA labels for storm countdowns, sanctuary state, incoming impact,
  and reward-bearing markers. Color must not be the only reward cue.

Do not add a quest in the first pass. The safe-phase timer, War Table copy, and
first telegraph should teach the mechanic without adding quest-state tracking.

### 10. Persistence and migration

**Edit:** `src/config/versions.ts`, `src/persistence/migrations.ts`, and migration
fixtures/tests.

The working tree is currently at save schema 56. Add v56 -> v57:

- initialize `state.arcaneStorm` with empty default state;
- merge default `gameBalance.storm` into existing per-save balance;
- preserve all existing Fog/Raid state and tuning;
- accept `arcane-storm` as a pending respawn cause;
- validate every storm/strike field, integer coordinates, stable ids, valid area
  keys, `telegraphAtTick <= impactAtTick`, and nullable `resolvedAtTick`;
- reject a resolved tick earlier than its impact tick or a strike cycle that is
  inconsistent with non-negative state.

No world-generation bump is needed. No content-version bump is needed because
the plan adds no new saved content id. If another in-progress feature claims
schema 57 first, renumber this migration to the next free version without
combining unrelated migration logic.

### 11. Tests

**Edit/add unit tests:**

- `tests/unit/survivalCycle.test.ts`
  - first four cycles remain Fog/Raid;
  - cycle 4 introduces Storm and the three-event rotation repeats;
  - safe-phase labels predict the correct upcoming threat;
  - raid numbering and absent-base scaling count only raids;
  - Fog exposure never runs during Storm.
- `tests/unit/arcaneStorm.test.ts`
  - exact seven-strike schedule and 3-second telegraphs;
  - player-tile snapshotting and integer coordinates;
  - moving outside the radius dodges damage;
  - radius boundary behavior is defined and tested;
  - one hit deals exactly configured damage;
  - repeated hits can enter durable respawn once, with the right cause;
  - sanctuary, respawn protection, pending respawn, and active encounters consume
    slots without unsafe impacts;
  - ordinary enclosed/purified rooms do not protect the player;
  - reward strikes create exactly two expiring iron-ore drops;
  - area travel leaves the marker/reward in its origin area;
  - reload before and after an impact cannot duplicate damage or rewards;
  - phase end and cycle change clean up state.
- `tests/unit/dangerPresentation.test.ts`
  - distinct Storm palette;
  - Storm punches out Elaris but not player-built rooms;
  - telegraph view exposes radius, progress, and reward state.
- `tests/unit/gameplayHud.test.ts`
  - safe/active labels, impact badge, War Table copy, sanctuary, and ARIA labels.
- `tests/unit/admin.test.ts`
  - storm defaults and every cross-field validation rule.
- `tests/unit/migrations.test.ts`
  - v56 save receives defaults;
  - custom existing balance remains intact;
  - malformed strike state and invalid defeat cause are rejected;
  - current v57 saves load idempotently.
- Three renderer tests
  - marker count, reward distinction, resolved effect lifetime, area cleanup, and
    disposal parity.

**Add E2E coverage:** `tests/e2e/arcane-storm.spec.ts`

1. Load a deterministic save at cycle 4 just before the danger boundary.
2. Confirm the HUD predicts Arcane Storm and no raid wave is present.
3. Start the phase, observe the marker in both 2D and 3D modes, move outside it,
   and confirm no HP loss.
4. Remain inside a later marker and confirm exact HP loss plus accessible impact
   messaging.
5. Reload during a telegraph and confirm the same centre/deadline remains.
6. Collect one charged ore drop before expiry and confirm inventory increases
   once.
7. Verify Elaris sanctuary remains visually clear and receives no damaging
   marker while nearby unsafe land retains the storm atmosphere.

## Implementation order

1. Threat schedule, raid-number refactor, and shared metadata.
2. Balance model, GameState model, save migration, and validation.
3. `arcaneStorm.ts` simulation with unit tests.
4. Fixed-step, defeat, encounter, travel, and reward integration.
5. HUD and War Table behavior.
6. Phaser atmosphere and strike visuals.
7. Three.js parity and renderer cleanup.
8. E2E coverage, accessibility pass, and full regression run.

Keep each step buildable. Land migration/state work before any renderer reads the
new fields, and land the authoritative simulation before presentation so visuals
never become their own source of truth.

## Verification commands

Run after each relevant phase, then run the full set before completion:

```powershell
npm.cmd run typecheck
npm.cmd test -- tests/unit/survivalCycle.test.ts tests/unit/arcaneStorm.test.ts
npm.cmd test
npm.cmd run build
npx playwright test tests/e2e/arcane-storm.spec.ts
```

## Acceptance criteria

- Arcane Storm first appears only after two Fog/Raid pairs, then joins a stable
  three-threat rotation.
- Every strike location, deadline, hit, and reward is deterministic and survives
  reload without duplication.
- A clearly visible 3-second marker always precedes player damage.
- One impact deals 35 HP and cannot one-shot a healthy starter character.
- Dodging is based on authoritative simulation distance, not rendered position.
- Elaris sanctuary protects; ordinary rooms, purifiers, masks, and turrets do not.
- Storm never damages buildings in this version.
- Exactly two short-lived iron-ore opportunities exist per default storm.
- No raid spawns or Fog exposure occurs during a Storm cycle.
- A storm death uses the normal durable respawn and inventory-loss flow once.
- Phaser and Three.js communicate the same radius, timing, reward markers, and
  impact state, including reduced-motion behavior.
- Existing Fog/Raid, save migration, offline settlement, area travel, and combat
  tests remain green.

## Explicitly deferred

- Lightning Rod or ward building.
- Structure damage, power outages, or facility disabling.
- A new Arcane Shard resource and its crafting economy.
- Storm-specific enemies or simultaneous raid waves.
- Escalating storm tiers and biome-specific strike patterns.
- A dedicated storm quest or achievement.

Those are useful expansion points only after the movement event is proven fun,
readable, and fair in both renderers.
