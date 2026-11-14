# Taming Overhaul — Build Plan

Retire the Encounter screen as a **combat** system and rebuild it as a **taming**
system. Fighting lives entirely in the overworld (see
[combat-overhaul-plan.md](combat-overhaul-plan.md)); the modal screen survives only
to host the one verb the overworld cannot express — the slow, deliberate act of
calming a snared animal into a companion.

This supersedes the line in the combat plan that reads "the creature Encounter
screen stays exactly as it is." It does not.

---

## Why the screen survives at all

A modal cut-away earns its place when four things hold. The current encounter fails
three of them; the taming scene is designed to pass all four.

| | Encounter today | Taming scene |
|---|---|---|
| **Rare** | Triggered by walking near a creature | Costs a crafted snare, thrown deliberately |
| **Short** | Unbounded rounds of move/strike/rest | 4–6 beats, ~20 seconds |
| **Authored** | `snareChanceBps` coin flip ([encounters.ts:620](src/simulation/encounters.ts:620)) | Player choices determine the outcome |
| **Consequential** | Creature joins, identically every time | Creature's **disposition** is written by how it was tamed |

The failure mode to design against is a taming scene that is combat with a capture
button. A different screen is only justified by a different verb.

---

## Design decisions (locked)

**The snare captures; it does not tame.** A successful throw ends the *chase* and
opens the taming session. `snareChanceBps` is demoted from "do you get the creature"
to "how many beats you start with." Chance modifies a skill expression instead of
replacing one.

**You always get the creature.** There is no fail-to-nothing outcome. A botched
session yields a `broken` companion — yours, but flat. This is what makes the
session a *build decision* rather than a gamble, and it is why the player will
engage with the mechanics instead of resenting them.

**No fade, no scene swap.** The session renders as an overlay above the running
world. Camera does not move, the world does not unload, the snared creature stays
visible beneath the panel. Most of the "pulled out of my experience" feeling is the
transition, not the panel.

**Two meters, one band, four buttons.** Calm and Fear, both `0..10_000` bps. The
creature drifts each beat according to its species `temperament`
([creatures.ts:17](src/content/creatures.ts:17) — the field already exists) plus a
seeded roll. Actions:

| Action | Calm | Fear | Cost |
|---|---|---|---|
| **Steady** | +900 | −200 | 1 beat |
| **Approach** (creature calm) | **+2,600** | +200 | 1 beat |
| **Approach** (creature tense) | **+1,000** | +1,400 | 1 beat |
| **Offer** | +1,400 | −1,600 | 1 beat + 1 berry |
| **Back off** | −400 | −2,400 | 1 beat |

Approach is split across *both* axes by the tell, not just fear — see
"Tuning found during Phase 2" below for why a fear-only penalty failed.

**Fear has a hard break point.** Fear reaching `TAMING_FEAR_BREAK_BPS` (9,500)
ends the session immediately as `broken`. Without it, Approach-spam is a free
dominant line and Back off has no reason to exist.

Four buttons, one readable meter, learnable in a single session and masterable over
fifty. The existing `berry` encounter action ([encounters.ts:30](src/simulation/encounters.ts:30))
survives as **Offer**, which is the only action that consumes an item.

**The telegraph is load-bearing.** `enemyIntent` / `enemyIntentLabel`
([encounters.ts:227](src/simulation/encounters.ts:227)) is the single piece of the
combat encounter genuinely worth keeping. It becomes `mood`, persisted for the same
reason `enemyIntent` is persisted: reloading must never change the telegraphed
response. Moods read as `Straining` / `Watching you` / `Going still` / `Panicking`.

**Snare tier buys beats, not percentage.** Taming Snare = 4 beats. Reinforced Snare
= 6 beats and a wider success band. The trophy snare costs one material from every
species ([encounters.ts:133](src/simulation/encounters.ts:133)); it should feel like
a different tool, not a bigger number.

**Disposition is the payload.** The session writes one enum onto the new companion:

| Disposition | Earned by | Effect |
|---|---|---|
| `eager` | Finishing with beats to spare | −10% expedition duration |
| `wary` | Pushing through high Fear | +15% companion ability power, −25% bond gain |
| `docile` | Berries and patience, low Fear throughout | +15% expedition yield, −10% attack power |
| `broken` | Beats exhausted outside the band | Flat; no modifier |

Same species, five roles, five tames. This is where the content value is — one
screen generating durable replay reasons, feeding the idle economy hours later.

**Frequency guards ship with the feature, not after.** Both of them:
- **Repeat approach.** After the first tame of a species, the panel offers a
  one-tap replay of the last successful pattern for that species — same disposition,
  no screen. The player opts back *into* the ceremony when they want a different build.
- **Always skippable.** "Just take it" resolves immediately to `broken`. Nobody
  mid-errand gets trapped.

Without these, the taming scene reproduces the exact problem it was built to solve.

---

## Cross-cutting constraints

- **Integers only.** `canonicalizeGameState` throws on non-integer numbers. Every
  meter, drift, and threshold is bps or whole beats. No floats anywhere in
  `TamingState`.
- **Seeded RNG only.** Mood drift uses `rollBps` / `src/simulation/rng.ts`, never
  `Math.random`. Two players with the same save and the same taps get the same animal.
- **`coordinateHash` returns signed.** If any species seeding uses it, fold to
  `[0, 1)` before treating it as a roll.
- **Presentation never enters state.** Meter tweens, creature thrash animation, and
  the band highlight live in `src/ui` only.
- **Lane split.** `src/simulation/*` and `src/config/balance.ts` overlap with codex's
  lane; `src/ui/*` and `src/scenes/*` are ours. Phases 1 and 3 are safe to run in
  parallel with sim work; Phase 2 is not.
- **Never `git stash` this tree.** Trace failures with `git diff`.

---

## Phase 0 — Wild creatures must be killable in the overworld ⚠ BLOCKER

**Found during implementation, 2026-08-03.** Phase 1 as originally written cannot
ship. `StrikeTarget` is `ResourceNodeKind | 'raider' | 'structure'`
([balance.ts:85](src/config/balance.ts:85)) — it has no `'creature'` member, and
`provokeCreature` ([creatureCombat.ts:82](src/simulation/creatureCombat.ts:82)) has
**no callers anywhere in `src/`**. Wild creatures roam, aggro, leash, and hit the
player, but the player has no way to damage one outside the Encounter screen.

So the Encounter screen is currently the *only* path to `defeatCreature`, and with
it the only source of creature loot, the `TROPHY_DEFEATS_PER_DROP` counter,
`CREATURE_DEFEAT_XP`, and every creature-defeat quest. Deleting encounter combat
before an overworld kill path exists would silently remove all of it.

Phase 0 must therefore land first:
- `'creature'` joins `StrikeTarget` and `STRIKE_TARGETS`; every tool's
  `damageByTarget` / `wearMultiplierByTarget` gains the row. **This is exactly the
  trap the combat plan already documented** — anything iterating a per-target
  record must use `STRIKE_TARGETS`, or `gameToolDefinition` silently zeroes the new
  row when balance is read back from a save.
- The overworld strike path damages `wild.hp` and calls `provokeCreature`, finally
  wiring up the aggro machinery that already exists.
- `defeatCreature` moves out of `encounters.ts` and is called on `wild.hp === 0`.
- Save + content migration for the widened tool records.

Only then is Phase 1 safe.

### Status: shipped (2026-08-03)

- `'creature'` joins `StrikeTarget` / `STRIKE_TARGETS`; every tool and hands row
  mirrors its `raider` figure, because a creature is flesh exactly as a raider
  is. Species difficulty stays in `encounter.maxHp` / `defense` rather than a
  second per-species damage table.
- `awardCreatureDefeat` ([creatureDefeat.ts](src/simulation/creatureDefeat.ts))
  extracts loot, the trophy counter, world removal, and XP so the encounter and
  overworld kill paths cannot drift.
- `strikeCreatureMelee` ([creatureStrike.ts](src/simulation/creatureStrike.ts))
  mirrors `strikeRaiderMelee` and finally calls `provokeCreature`.
- **Save v68 migration** widens every persisted per-target record, following the
  v44 widening exactly.

**Targeting rule (tool-driven, no mode).** `acquireTarget`
([combatPresentation.ts](src/scenes/combatPresentation.ts)): engaged things
first, then the equipped tool's damage against each candidate, then distance.
The tool *is* the mode — always visible in the hotbar, already changed for other
reasons — so no attack/collect toggle exists to be set wrong.

Two distinctions that turned out to matter, both pinned by tests:

- **Eligible ≠ engaged.** `isHuntable` (aggressive species *or* provoked) says
  what may be auto-acquired; `isEngaged` (`aggroUntilTick > tick`) says what may
  *interrupt* the player. The first draft conflated them, and a sleeping
  Snarlfox across the clearing outranked the tree the player was mid-swing on.
- **Placid creatures are never auto-acquired**, and tapping one still opens the
  taming path rather than swinging. Killing the deer you meant to snare is the
  failure the whole rule set exists to prevent.

---

## Phase 1 — Strip combat out of the encounter

Pure deletion, no new mechanics. Ships on its own and immediately removes the
double-balancing tax.

**Edit:** [src/simulation/encounters.ts](src/simulation/encounters.ts)
- Delete `MAP_SIZE`, `PLAYER_START`, `CREATURE_START`, `MOVE_STEP`, `MELEE_RANGE`,
  `RANGED_RANGE`, `FORWARD_SP_COST`, `BACKWARD_SP_COST`, `REST_SP_RECOVER`,
  `FLEE_CHANCE_BPS`, `FLEE_COOLDOWN_TICKS` ([encounters.ts:80](src/simulation/encounters.ts:80)).
- Delete `STYLE_PROFILES` ([encounters.ts:95](src/simulation/encounters.ts:95)) —
  the overworld damage table replaces it.
- `EncounterAction` narrows from seven members to the taming four.
- `resolveEncounterAction` ([encounters.ts:303](src/simulation/encounters.ts:303))
  loses every branch except `snare` and `berry`.
- `startNearestEncounter` ([encounters.ts:170](src/simulation/encounters.ts:170))
  no longer triggers on proximity. Only a landed snare opens the screen.
- **Keep:** `craftTamingSnare`, `craftReinforcedSnare`, `activeSnare`,
  `snareChanceBps`, `tame` ([encounters.ts:676](src/simulation/encounters.ts:676)),
  `grantEncounterBond`, `rollBps`, `findWild`, the intent telegraph.
- **Move, don't delete:** `defeatCreature` ([encounters.ts:631](src/simulation/encounters.ts:631))
  holds the trophy-counter and level-scaled loot logic. The overworld kill path
  needs it verbatim — relocate it rather than reimplementing it, or the
  `TROPHY_DEFEATS_PER_DROP` counter will drift between the two paths.

**Edit:** [src/ui/encounterPanel.ts](src/ui/encounterPanel.ts)
- Remove the position track, style selector, Rest, and Flee controls.
- Keep the panel shell, the telegraph line, and the message log.

**Also touches:** `companionAbilities` that only make sense in a positional fight
(`enemyMove`, `playerMove`, `guardedDamage` on `CompanionAbilityOutcome`,
[encounters.ts:57](src/simulation/encounters.ts:57)) need a decision — either
retarget them at overworld combat or retire them. Do not leave them dangling.

**Verification:** existing `tests/unit/encounters.test.ts` will fail loudly and
correctly. Rewrite it down to the snare/tame path only.

---

## Phase 2 — The taming session core (headless)

Sim only. No UI. This is the go/no-go phase.

**Edit:** [src/simulation/state.ts](src/simulation/state.ts)
- Replace `EncounterState` ([state.ts:414](src/simulation/state.ts:414)) with:

```ts
export type TamingMood = 'straining' | 'watching' | 'settling' | 'panicking';
export type TamingAction = 'steady' | 'approach' | 'offer' | 'back-off';
export type TameDisposition = 'eager' | 'wary' | 'docile' | 'broken';

export interface TamingState {
  wildCreatureId: string;
  speciesId: SpeciesId;
  level: number;
  beatsRemaining: number;
  /** Both 0..10_000 bps. Integers only. */
  calmBps: number;
  fearBps: number;
  /** Persisted so reloading never changes the telegraphed drift. */
  mood: TamingMood;
  /** Approach tally; resolves to the disposition on the final beat. */
  boldBeats: number;
  patientBeats: number;
  fedBeats: number;
  peakFearBps: number;
  snareItemId: 'taming-snare' | 'reinforced-snare';
  message: string;
}
```

- `activeTaming: TamingState | null` replaces `activeEncounter`.
- `OwnedCreatureState` ([state.ts:433](src/simulation/state.ts:433)) gains
  `disposition?: TameDisposition` — **optional**, exactly as `level` and `housingId`
  are, so legacy roster creatures read as `broken`-equivalent (no modifier) without
  a rewrite.

**New:** `src/simulation/taming.ts`
- `beginTaming(state, wild, snare)` — called by the landed snare throw.
- `resolveTamingAction(state, action): TamingCommandResult` — applies the delta
  table, rolls the next mood from species `temperament` via seeded RNG, decrements
  beats, and on the last beat calls `settleTame`.
- `settleTame(state)` — grades the tally into a `TameDisposition` and hands off to
  the existing `tame()`, which already handles roster push, `firstTamedSpeciesIds`,
  bond, and XP. Extend it additively with the disposition argument; do not rewrite it.
- `tamingMoodLabel(mood)` — the `enemyIntentLabel` analogue.

**Edit:** [src/config/balance.ts](src/config/balance.ts)
- New block beside the existing snare constants ([balance.ts:446](src/config/balance.ts:446)):
  `TAMING_BEATS_BASIC = 4`, `TAMING_BEATS_REINFORCED = 6`, the four action delta
  pairs, `TAMING_BAND_LOW_BPS` / `TAMING_BAND_HIGH_BPS`, and per-mood drift.
  All Admin-editable through the existing balance path.
- `snareChanceBps` ([encounters.ts:620](src/simulation/encounters.ts:620)) keeps its
  formula but now gates *entry* to the session rather than the tame itself. Consider
  raising `SNARE_CHANCE_MIN_BPS` (currently 500) — a 5% floor was tolerable when a
  miss cost one snare, and is punishing when a miss costs a whole planned session.

**Migration → save v68** (current `SAVE_SCHEMA_VERSION = 67`,
[versions.ts:10](src/config/versions.ts:10)): drop `activeEncounter` to `null`,
initialize `activeTaming = null`, leave `disposition` absent on existing creatures.
Follow the v42 migration's shape ([migrations.ts:949](src/persistence/migrations.ts:949)).

**Verification — and the go/no-go gate:** before any UI, write a unit test that
plays 200 seeded sessions with a naive "always Steady" policy and 200 with an
optimal policy. If the disposition distributions are not clearly separated, the
mood telegraph is not readable enough and the mechanic will degrade into mashing
one button. Re-tune the drift table before building Phase 3.

### Status: core shipped, gate PASSED (2026-08-03)

`src/simulation/taming.ts` + `tests/unit/taming.test.ts` are in, 15 tests green,
`tsc --noEmit` clean, full suite 841/841. The core is deliberately **free of
`GameState`** — it takes `(session, action, rngState)` and returns the next
session and RNG word — so the gate runs thousands of seeded sessions cheaply and
the state/migration wiring can land separately.

Measured over 200 seeded sessions each, basic snare, neutral temperament:

| policy | eager | wary | docile | broken |
|---|---|---|---|---|
| Steady only (mash) | 0 | 0 | 81 | **119** |
| Approach only (blind) | 35 | 136 | 0 | **30** |
| Read the mood (bold) | 35 | 133 | 18 | **14** |
| Feed when tense (patient) | 0 | 0 | **151** | 49 |
| Read the mood, *reinforced snare* | **137** | 21 | 41 | **1** |

The two properties that justify the screen both hold: reading the tell **halves**
the disaster rate against blind rushing (30 → 14), and the policy — not the dice —
picks the disposition (patient is 151 docile / 0 eager; bold is 168 eager-or-wary
/ 18 docile).

### Tuning found during Phase 2

The first draft failed the gate, in two ways worth recording:

1. **The patient line was not viable at basic tier.** Feeding scored 192/200
   `broken`, identical to mashing — with 4 beats and a 6,000 band floor, Approach
   was the only move that could reach the band at all, so there was no build choice
   until the trophy snare. Fixed by dropping the floor to 5,000 and raising
   Steady/Offer's Calm.
2. **A fear-only penalty on tense Approach was not enough.** Blind Approach-spam
   and mood-reading produced near-identical distributions, because `wary` is a
   *good* outcome and nothing actually failed. Fixed by the fear break point plus
   splitting Approach across both axes — closing on a settled creature is now the
   strongest move in the session (+2,600) and closing on a straining one is among
   the worst (+1,000 Calm, +1,400 Fear).

The second one is the general lesson: **a tell that only costs a resource the
player doesn't mind spending is not a tell.** It has to change what the action is
worth.

---

## Phase 3 — The overlay panel

Presentation lane, parallel-safe.

**Replace:** [src/ui/encounterPanel.ts](src/ui/encounterPanel.ts) → `src/ui/tamingPanel.ts`
- Overlay above the live world, not a scene transition. World keeps rendering.
- Calm/Fear as one opposed bar with the target band drawn on it. The band must be
  visible from beat one — the player is aiming at it, not discovering it.
- Mood line above the creature portrait, in the telegraph's existing voice.
- Four action buttons. **Offer** shows carried/required berries and disables when
  short, per the costs convention (`ui/costs.ts`) every priced button already follows.
- Beats remaining as discrete pips, not a number. The scarcity should be felt.

**Edit:** [src/scenes/WorldScene.ts](src/scenes/WorldScene.ts)
- The snared creature keeps rendering and animating beneath the overlay.

**Verification:** the Browser pane suspends rAF, so the Phaser loop freezes there —
verify through Playwright, and force state via `globalThis.__game…state.tick` on the
dev server for screenshots. `npm run build` before `npx playwright test`.

---

## Phase 4 — Disposition consequences

The phase that makes the session matter. Everything here is additive.

**Edit:** [src/simulation/expeditions.ts](src/simulation/expeditions.ts)
- Disposition multiplier applied at settlement alongside the existing ±20% variance
  ([expeditions.ts:132](src/simulation/expeditions.ts:132)). `docile` scales yield,
  `eager` scales duration. Both online and offline settle through one path — keep it
  that way.

**Edit:** [src/content/companionAbilities.ts](src/content/companionAbilities.ts)
- `wary` scales ability power; `wary` also throttles `bondXp` gain in
  `grantEncounterBond`.

**Edit:** creature roster UI (`src/ui/` creature panel)
- Disposition shown on every creature card, with its modifier spelled out. An
  invisible stat teaches nobody; the player has to see that their patience bought
  something before they will spend patience again.

---

## Phase 5 — Frequency guards

Ship before the feature reaches anyone who tames more than occasionally.

**Edit:** [src/simulation/state.ts](src/simulation/state.ts)
- `lastTamingPattern: Partial<Record<SpeciesId, TameDisposition>>` — what the player
  last achieved per species.

**Edit:** `src/simulation/taming.ts`
- `quickTame(state, disposition)` — resolves instantly to a previously-achieved
  disposition for that species, no session.
- Skip resolves to `broken` at any point in a live session.

**Edit:** `src/ui/tamingPanel.ts`
- On snare landing for a known species, the panel opens on a two-button chooser:
  "Repeat approach (docile)" or "Tame carefully". First-of-species always opens the
  full session.

**Migration → save v69**: `lastTamingPattern = {}`.

---

## Phase 6 — Balance surface and polish

- Every new constant exposed through Admin → Global Values, alongside the existing
  snare tiers, so the drift table can be tuned live without a deploy.
- Quest hooks: `recordEncounter` becomes `recordTame`; check
  [src/simulation/questTracking.ts](src/simulation/questTracking.ts) for quests that
  counted encounters or defeats through the old screen.
- Blueprint copy: snares are unlocked through Blueprints like everything else — their
  descriptions must now sell "opens a taming session," not "chance to capture."

---

## Verification per phase

1. `npm run typecheck && npm run test:unit`
2. `npm run build` (required before Playwright — the preview serves `dist`)
3. `npx playwright test` — three-mode runs on the dev-chrome project; open via
   `openApp('?localBalance=1')`; poll IDB, never toasts
4. Screenshot proof for phases 3 and 4 via the headless screenshot script

Phases 1, 4, 5, and 6 are independently shippable. **Phase 2's readability test is
the real gate** — if an optimal policy cannot beat a naive one by a clear margin in
seeded simulation, the taming scene is a coin flip wearing a costume, and the honest
move is to delete the modal entirely and resolve tames inline in the overworld.
