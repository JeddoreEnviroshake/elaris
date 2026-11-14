# Creature Combat Overhaul — Build Plan

Delete the turn-based Encounter screen. Wild creatures become real-time world
entities you fight, capture, and feed on the overworld, using the targeting,
strike, and damage-number machinery that raiders already run on.

This **reverses** the locked decision in [combat-overhaul-plan.md](combat-overhaul-plan.md)
that "the creature Encounter screen stays exactly as it is." That plan's Phases
2–6 are what make this possible: `strike.ts`, swords/bows/staves as tools, and
`CombatOverlay` all exist and are load-bearing here.

---

## Design decisions (locked)

**Creatures fight back by temperament.** `CreatureDefinition.temperament` is
already content-driven ([creatures.ts:17](src/content/creatures.ts:17)) and stops
being decoration:

| temperament | species | overworld behavior |
|---|---|---|
| `aggressive` | Snarlfox | aggros on sight at range, kites to `preferredRange`, attacks on cadence |
| `neutral` | Craghopper | ignores the player until struck, then chases and attacks until it leashes |
| `passive` | Tuftle | ignores the player until struck, then chases; leashes sooner and further |
| `skittish` | Glade Stag | flees when struck or approached closely; only strikes back when cornered at melee reach |

**The equipped tool is the style.** Sword or bare hands → melee, bow → ranged,
staff → magic. One action button, already the pattern for raiders and nodes.
Range, cost, and durability come from the tool exactly as they do today: melee
spends SP through `payStrikeCost`, ranged spends an arrow, magic spends MP.

**Species weakness survives.** `weakTo` (×1.5), `resistTo` (×0.5), `dodgeBps`,
and `defense` move out of the encounter and onto the world strike. This is what
keeps three styles meaningful without three buttons — a Craghopper still wants a
staff and a Glade Stag still wants a bow.

**Creatures reuse the `raider` strike row.** No new `StrikeTarget` is added.
Widening `StrikeTarget` would mean a migration touching every tool's damage and
wear table for a row that would start out as a copy of `raider` anyway. Species
weakness and defense already differentiate creature combat from raider combat.
*Reversible:* if creatures later need to be balanced independently of raiders,
adding `'creature'` to `STRIKE_TARGETS` is a mechanical follow-up migration.

**Berries only help you tame.** Feeding a targeted creature spends one berry and
raises its capture chance; it does not calm it, and it does not heal the player.
Player healing is regeneration and respawn until potions land (Phase 8 of the
original plan), with berries as a potion ingredient.

**Capture chance is the existing formula, shown live.**
`snareChanceBps` already reads `clamp(ease × tier × (1.5 − hpPercent))`
([encounters.ts:605](src/simulation/encounters.ts:605)). It moves to reading the
creature's world HP, gains the feed bonus, and gets rendered as a bar under the
HP bar. Softening a creature visibly fills the bar you are trying to fill.

**Companion abilities become real-time.** The Battle Companion slot, the ability
picker, bond gating, and the quests that count ability use all survive. The
selected ability becomes one HUD button on a tick-based cooldown. Turn-shaped
effects are remapped to durations (below); nothing is silently dropped.

---

## Cross-cutting constraints

- **Integers only.** `canonicalizeGameState` throws on non-integer numbers.
  Creature HP, positions, buff expiry ticks, and bonus basis points are all whole.
- **Seeded RNG only.** Hit, dodge, and capture rolls use the existing `rollBps`
  pattern threaded through `state.rngState`. Never `Math.random`.
- **Presentation never enters state.** Bars, rings, numbers, and hit-stop stay in
  `src/scenes` and `src/ui`.
- **Codex lane.** This is a heavy `src/simulation/*` change. Phases A–E must not
  run concurrently with codex edits to `state.ts`, `encounters.ts`, `creatures.ts`,
  or `migrations.ts`. Never `git stash` this tree.
- **Save versions.** Current `SAVE_SCHEMA_VERSION = 60`, `CONTENT_VERSION = 55`.
  This overhaul lands as **save v61 / content v56**, in one migration.
- **E2E rules.** `npm run build` before Playwright; open via `openApp('?localBalance=1')`;
  poll IndexedDB, never toasts. The Browser pane suspends rAF, so combat is
  Playwright-verified only.

---

## Phase A — Wild creatures become world entities ✅ shipped

`WildCreatureState` now carries `hp`, `maxHp`, `homeX/homeY`, `aggroUntilTick`,
`nextAttackTick`, `fleeUntilTick`, and `captureBonusBps`. Both construction
sites in `worldGeneration.ts` were collapsed into one exported
`newWildCreature`, so a creature can never again be built missing half its
fields — the regional spawner and the fixed starter spawner had drifted into
two separate literals.

Save v61 / content v56 backfills every creature in `wildCreatures` **and** in
every `visitedAreas` snapshot, adds the six new per-species balance rows, and
nulls `activeEncounter`.

**Deviation from the plan below:** the new tuning lives on
`EditableCreatureBalance` per species rather than as global `gameBalance.defense`
dials. Leash, aggro, cadence, and speed all differ per species — a Snarlfox
that aggros at 7 tiles and a Tuftle that never aggros cannot share one number —
so a global dial would have needed per-species exceptions immediately.

**Interim bridge:** `beginEncounter` seeds `creatureHp` from the creature's
world health and writes it back on every action, flee, and player defeat. The
battle screen stays up until Phase F, and without this a creature worn down in
the world would get a full bar back the moment a duel opened.

## Phase A — Wild creatures become world entities (original plan)

**Edit:** [src/simulation/state.ts](src/simulation/state.ts) — `WildCreatureState`
gains, all integers:

```
hp, maxHp                 // was encounter-only
homeX, homeY              // leash anchor, seeded at spawn
aggroUntilTick            // 0 = idle; set by aggro or by being struck
nextAttackTick
fleeUntilTick             // skittish only
captureBonusBps           // accumulated feeding, capped
```

`encounterCooldownUntilTick` is retained and repurposed as the post-flee
disengage window, which is what it already means.

**Edit:** [src/simulation/worldGeneration.ts](src/simulation/worldGeneration.ts) —
`generateWildCreatures` seeds `hp = maxHp` from the species definition and
`homeX/homeY` from the spawn point.

**Edit:** [src/persistence/migrations.ts](src/persistence/migrations.ts) — save v61:
backfill every `wildCreatures[]` entry and every `AreaSnapshot.wildCreatures[]`
entry with full HP at its spawn point, and **drop `activeEncounter`**. Follow the
shape of the v42 migration ([migrations.ts:949](src/persistence/migrations.ts:949)).

**Tests:** `tests/unit/migrations.test.ts` — an old save mid-encounter loads with
the creature at full HP and no encounter.

---

## Phase B — Real-time creature AI ✅ shipped

[src/simulation/creatureCombat.ts](src/simulation/creatureCombat.ts) holds
`advanceWildCreatures`, called from `commands.ts` beside `advanceRoamers`, plus
`provokeCreature` for Phase C's strike path to call. Behavior follows
temperament exactly as designed: aggro is opt-in per species via `aggroRangePx`
(0 for everything but the Snarlfox), Snarlfox kites to `preferredRangePx`,
Glade Stag flees and bites back only when cornered, and everything leashes home
and regenerates there. Creatures will not step through a wall and never attack
one. `playerIsHuntable` is now exported from `raids.ts` and shared, so a
respawning, protected, or walled-in player is off limits to every hostile.

**Three deviations, all deliberate:**

- **`attackPower` was left alone; only cadence was retuned.** The plan's table
  cut per-hit damage ~40%. Cadence turned out to be the single honest knob —
  changing `attackPower` would also have weakened the still-live battle screen
  and its unit suite for no gain. Contact DPS lands at 1.7 (Tuftle) to 5
  (Snarlfox) per second before armour.
- **No dodge roll on contact hits.** Raiders do not roll either, and adding an
  RNG consumer to the tick loop would perturb the shared stream for every other
  system. Player dodge belongs on the strike path in Phase C.
- **Flight ends at the leash, not on a timer**, so a startled Glade Stag cannot
  end up across the map from where it lives.

**Bug caught by tests:** creatures stopped a full tile short of home and
regenerated there, because movement and healing shared one tolerance. A leashed
creature drifting a tile from its spawn every chase would have walked itself
across the map over a session. Movement now runs to zero distance; the tolerance
survives only as the healing check, so a creature wedged against a wall on the
way home still recovers.

`tests/unit/creatureCombat.test.ts` covers all of it — 19 cases including
whole-pixel integrity against a fractional player position, replay determinism,
and a guard that the module consumes no shared RNG.

## Phase B — Real-time creature AI (original plan)

**New:** `advanceWildCreatures(state)` in `src/simulation/creatureCombat.ts`,
modeled directly on `advanceRoamers` ([raids.ts:617](src/simulation/raids.ts:617)),
called from the same place in the tick loop.

- Aggro range, leash distance, flee speed, and attack cadence become
  `gameBalance.defense` fields beside the roamer dials, so they are Admin-editable
  the way `roamerAggroRangeTiles` already is.
- `behavior: 'kite'` keeps `preferredRange`; `'chase'` closes to `attackRange`.
  Both fields already exist per species and are reused verbatim.
- A creature that leashes walks home, clears aggro, and regenerates to full.
- Creature damage to the player routes through the existing player-damage path,
  including `beginPlayerDefeat(state, 'creature')` at 0 HP — the defeat and
  respawn flow is unchanged.
- Creatures never attack buildings. They hunt the player or they go home.

**Retuning.** Encounter stats were per-round; real-time strikes land far more
often. Proposed starting numbers, all Admin-tunable:

| species | HP (was) | hit (was) | attack every | aggro | leash |
|---|---|---|---|---|---|
| Tuftle | 36 → 36 | 5 → 3 | 90 ticks | on hit only | 10 tiles |
| Craghopper | 54 → 54 | 8 → 5 | 75 ticks | on hit only | 12 tiles |
| Glade Stag | 46 → 46 | 6 → 4 | 60 ticks | flees | 14 tiles |
| Snarlfox | 42 → 48 | 10 → 6 | 50 ticks | 7 tiles | 14 tiles |

HP is held roughly steady so an iron sword (24 to `raider`) still needs 2–3 clean
hits, matching the roamer feel. Per-hit damage drops because cadence replaces turns.

**Tests:** `tests/unit/creatureCombat.test.ts` — aggro entry per temperament,
leash return with regen, skittish flight, deterministic attack cadence.

---

## Phase C — Striking a creature

**New:** `strikeCreature(state, creatureId)` in `src/simulation/creatureCombat.ts`.

- Style resolves from the equipped `ToolKind`: `sword`/none → melee, `bow` → ranged,
  `staff` → magic. One `toolKindStyle` map, no branching on ids elsewhere.
- Reach per style: melee `MELEE_REACH_PX`, ranged `playerShotRangeTiles`, magic
  the staff's own range. Out of reach returns `'Too far — move closer'` and keeps
  the lock, as raiders do.
- Damage = `strikeProfile(state, 'raider').damage`, then `weakTo`/`resistTo`
  multipliers, then `defense` subtracted, floored at 1. Hit and dodge rolls reuse
  `STYLE_PROFILES[style].hitBps + hitChanceBonusBps(state)` and the species
  `dodgeBps`, in the same fixed roll order (hit → dodge) so replays stay honest.
- Costs are unchanged from the world: melee `payStrikeCost` (SP + cooldown +
  durability), ranged one arrow + bow wear, magic `MAGIC_MANA_COST` + staff wear.
- Striking sets `aggroUntilTick` on the creature — hitting something is what makes
  it notice you.
- At 0 HP: the existing `defeatCreature` payout is kept intact — loot, the
  `TROPHY_DEFEATS_PER_DROP` trophy counter, `grantXp(40)`, `recordCreatureDefeat`,
  and ground-drop spill when the bag is full.

`recordEncounter` (which drives the `meet-<species>` quests,
[quests.ts:276](src/content/quests.ts:276)) fires on the first strike or first
lock of a species instead of on opening a battle, so those quests still complete.

**Tests:** weakness/resistance multipliers, defense floor, per-style costs, loot
and trophy payout on death, and a determinism case with a fixed strike sequence.

---

## Phase D — Capture and feed

**New in `creatureCombat.ts`:**

- `throwSnare(state, creatureId)` — range-gated at `TAMING_RANGE_PX`, spends the
  strongest snare carried (`activeSnare` is reused unchanged), rolls
  `snareChanceBps`. Success runs the existing `tame()` payout: roster entry,
  `firstTamedSpeciesIds`, `grantXp(50)`. Failure spends the snare and aggros the
  creature — a miss has to cost something now that there is no turn to lose.
  The roster-full and per-species-limit checks stay pre-roll, so a snare is never
  wasted on a capture that could not have been accepted.
- `feedCreature(state, creatureId)` — spends one berry, adds `FEED_CAPTURE_BONUS_BPS`
  (proposed **+500**, capped at **+2000**) to `captureBonusBps`. Capped so feeding
  is a supplement to weakening, not a replacement for it.
- `snareChanceBps(state, creature)` reads world HP and adds `captureBonusBps`,
  still clamped to `SNARE_CHANCE_MIN_BPS`/`MAX_BPS`.

**Tests:** capture chance rises as HP falls, feeding raises it and caps, a failed
throw consumes the snare and aggros, a blocked throw consumes nothing.

---

## Phase E — Companion abilities in real time

**Edit:** [src/simulation/state.ts](src/simulation/state.ts) — the Battle Companion
keeps `battleCompanionId` and `selectedBattleAbilityId`. Round-based cooldowns
become `companionAbilityReadyTick: number` on `GameState`, plus a small integer
buff block (`playerBuffs`) holding effect id and expiry tick.

**Effect remap** — `cooldownTurns` becomes ticks at a fixed conversion:

| effect | real-time form |
|---|---|
| `heal`, `recover-stamina` | instant, unchanged |
| `guard` | damage reduction buff, ~6s |
| `player-damage-bonus`, `player-hit-bonus`, `ignore-defense` | buff on the next strikes, ~6s |
| `player-dodge-bonus` | buff, ~6s |
| `reduce-enemy-power` | debuff on the locked creature, ~6s |
| `push-enemy` | knockback in world pixels along the player→target vector |
| `move-player` | short dash forward or backward |
| `nonlethal-damage` | damage that cannot reduce the target below 1 HP |
| `interrupt` | pushes the target's `nextAttackTick` out |
| `prevent-retreat` | roots a kiting/fleeing target briefly |

`recordAbilityUse` still fires, so ability-count quests are unaffected.

**Tests:** cooldown gating in ticks, buff expiry, and that every ability id in
`companionAbilities.ts` resolves to a real-time effect (a table-completeness test,
so a future ability cannot be added without a mapping).

---

## Phase F — Presentation

**Edit:** [src/scenes/combatPresentation.ts](src/scenes/combatPresentation.ts) —
`CombatTargetKind` gains `'creature'`; `resolveCombatTarget` resolves creature
position, HP, and reach per current style.

**Edit:** [src/scenes/combatOverlay.ts](src/scenes/combatOverlay.ts) — the HP bar
already works once creatures are tracked ids. Add a **capture bar** drawn directly
beneath it: same width, distinct colour, filled to `snareChanceBps`, shown only
while a creature is locked and a snare is carried, hidden entirely otherwise so
raiders and nodes are unaffected. Both bars use the shared `durabilityColor`
ramp so every bar in the game reads identically.

**Edit:** [src/scenes/WorldScene.ts](src/scenes/WorldScene.ts) —
- Tapping a creature locks it instead of opening an encounter (line ~2138).
- `performContextAction` gains creatures in its priority chain, above gathering
  and below raiders.
- Delete `applyEncounterResult`, the encounter panel wiring, and the
  `state.activeEncounter` input gates at lines 292, 751, 1750, 1865.

**Edit:** [src/ui/gameplayHud.ts](src/ui/gameplayHud.ts) —
- Target line becomes `Wild Tuftle 24/36 · Capture 43%`; action button reads
  `Strike Tuftle`. The `tap to encounter` copy at line 1515 goes.
- Two new target-scoped buttons, `Throw Snare` and `Feed Berry`, showing carried
  counts and disabled with a reason through the shared `ui/costs.ts` pattern.
- One `Companion Ability` button with a cooldown sweep.
- `setBattleMode` is deleted here and in [worldNavigator.ts:221](src/ui/worldNavigator.ts:221).

**Delete:** `src/ui/encounterPanel.ts`, `src/three/battleState.ts`,
`src/three/ThreeBattleStage.ts`, and their imports in
[main.ts](src/main.ts) and `WorldScene`.

---

## Phase G — Sim cleanup and tests

**Edit:** [src/simulation/encounters.ts](src/simulation/encounters.ts) — keep the
crafting commands (`craftTamingSnare`, `craftReinforcedSnare`, `craftArrows`,
`craftClothMask`) and `activeSnare`; delete everything encounter-shaped. The file
is renamed to `src/simulation/consumableCrafting.ts` so nothing is left called
"encounters".

**Delete the `activeEncounter` branches** in `areas.ts:163`,
`characterProgression.ts:176`, `creatureRoles.ts:88`, `gameplayCommands.ts:778`,
`survivalCycle.ts:458,567`, and `waystones.ts:30`.

**Tests:** `tests/unit/encounters.test.ts` is replaced by `creatureCombat.test.ts`;
`creatureTrophies.test.ts` is rewritten against world strikes;
`tests/e2e/creatures.spec.ts` becomes state-driven — lock a creature, strike until
HP drops in IndexedDB, feed, then snare — with no reliance on toasts.

---

## Verification per phase

1. `npm run typecheck && npm run test:unit`
2. `npm run build` (required before Playwright)
3. `npx playwright test` — three-mode runs on the dev-chrome project
4. Screenshot proof for Phase F via the headless screenshot script; force state
   with `globalThis.__game…state.tick` on the dev server only.

**Go/no-go is Phase C.** If striking a creature in the world does not feel better
than the duel did, stop before Phases D–G and re-tune cadence and damage. Phases
A–C are shippable on their own only if the encounter screen stays up alongside
them, so the delete lands in F — the old screen is the fallback until the new
loop is proven.
