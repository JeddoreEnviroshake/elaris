# Battle Screen Rework — Positioning, Turn-Start Regen & New Attributes

Implement a positioning/distance system, turn-start regeneration, and three new
regen attributes for the wild-creature encounter (battle) screen.

Touches both lanes: the simulation (`src/simulation/encounters.ts`,
`characterProgression.ts`, `state.ts`, persistence) **and** the presentation
(`src/ui/encounterPanel.ts`). Keep the simulation deterministic (integer math,
existing `rollBps` RNG only) and update all affected tests.

---

## 1. Battle is now positional (a 1-D line, size 100)

Add a linear position to the encounter. Both combatants sit on a 0–100 track.

- Map size: **100**. Player starts at **30**, creature starts at **70**, middle is **50**.
- `distance = creaturePos - playerPos` (player is always left of / ≤ the creature).
- Persist both positions on the encounter so mid-battle saves survive.

Add to `EncounterState` (`src/simulation/state.ts`):

```ts
playerPos: number;   // 0..100, starts 30
creaturePos: number; // 0..100, starts 70
```

Initialize them in `startNearestEncounter`. In the save migration, backfill
missing values on any in-progress `activeEncounter` (default `playerPos: 30`,
`creaturePos: 70`) and bump the save version (`src/config/versions.ts` +
`src/persistence/migrations.ts`, with validation like the other encounter fields).

### Constants (name them; put tunables in balance config where sensible)

```
MAP_SIZE          = 100
PLAYER_START      = 30
CREATURE_START    = 70
MOVE_STEP         = 10   // forward/backward move this much
MELEE_RANGE       = 10   // distance <= 10 to use Melee
RANGED_RANGE      = 30   // distance <= 30 to use Ranged
FORWARD_SP_COST   = 5
BACKWARD_SP_COST  = 5
MELEE_SP_COST     = 10   // was 8 (MELEE_STAMINA_COST)
REST_SP_RECOVER   = 10
```

---

## 2. New / changed actions

`EncounterAction` gains `'forward' | 'backward' | 'rest'`.

| Action    | Cost              | Range requirement      | Effect |
|-----------|-------------------|------------------------|--------|
| Forward   | 5 SP              | distance > 0           | `playerPos += 10`, clamped so it never passes the creature (min distance 0) |
| Backward  | 5 SP              | playerPos > 0          | `playerPos -= 10`, clamped to ≥ 0 |
| Melee     | **10 SP** (was 8) | distance ≤ 10          | unchanged combat resolution |
| Ranged    | 1 arrow (as-is)   | distance ≤ 30          | unchanged combat resolution |
| Magic     | 10 MP (as-is)     | **any distance**       | unchanged combat resolution |
| Rest      | free (0 SP)       | always available       | recovers 10 SP |
| Snare / Berry / Flee | as-is  | any distance (unchanged) | unchanged |

**Every action ends the player's turn** — after resolving it (if the encounter
hasn't ended) the creature acts (see §4). Movement and Rest provoke the creature
exactly like an attack does.

**Clamping (no overshoot):** Forward can't move the player past the creature;
Backward can't leave the map. Distance is never negative.

**Availability** (`encounterAvailability`) must gate on both cost *and* range, and
return a clear disabled reason (`'Too far — move closer'`, `'Not enough SP'`,
etc.) so the button tooltip explains itself, matching the existing pattern.
Note SP is the "stamina" bar (`player.stamina` / `maxStamina`).

---

## 3. Regeneration moves to the start of the player's turn

Today `recoverPlayer` runs once per real second. Change battle regen to be
**turn-based**:

- **During an active encounter, stop the per-second recovery** (skip SP/MP too,
  not just HP). Overworld (no active encounter) per-second recovery stays.
- Apply turn-start regen to **HP, SP, and MP** as the turn hands back to the
  player — i.e. immediately after the creature finishes acting, and once when the
  encounter begins. Apply it there (not lazily at click time) so the HUD bars and
  button affordability already reflect it.
- **Rest** adds its +10 SP **on top of** the turn-start regen that already
  happened that turn (they stack).

Regen amounts are driven by the new attributes below (§5), read from balance
config base values so a level-1 character still functions. Suggested formulas
(put the base numbers in `characterDefaults` / balance config so they're tunable):

```
HP regen / turn = HP_REGEN_BASE  (0) + attributes.health
SP regen / turn = SP_REGEN_BASE  (5) + attributes.stamina
MP regen / turn = MP_REGEN_BASE  (2) + attributes.magic
```

---

## 4. Creature AI — approaches with its own per-species ranges

Creatures currently have no position behavior; they always counterattack. Give
each species movement + range data and make behavior vary by species.

Add to the creature `encounter` definition (`src/content/creatures.ts`):

```ts
moveSpeed: number;              // distance closed/opened per turn
attackRange: number;           // max distance it can attack from
behavior: 'chase' | 'kite';    // chase = close in; kite = hold preferredRange
preferredRange?: number;       // for kiters: distance they try to maintain
```

Per creature turn (after the player acts, if not ended):

1. **If within `attackRange`** and (for a kiter) not needing to reposition →
   attack using the existing styleless counterattack (`attackPower - playerDefense`,
   player dodge as now). Distance does **not** change the damage formula.
2. **chase**: if out of range, move toward the player by `moveSpeed` (clamp so it
   doesn't pass the player). Attack the same turn only if the move brings it into
   range — otherwise it just advances (no attack that turn). Pick one rule and
   keep it consistent; document it.
3. **kite**: move to restore `preferredRange` — advance if the player is too far,
   **retreat** (increase `creaturePos`, clamp ≤ 100) if the player closed inside
   it — then attack if the player is within `attackRange`.

**You (the implementer) choose sensible per-species defaults** and expose them in
content/balance for later tuning. Rough intent (adjust freely):

- **tuftle** — gentle starter: slow chase, short melee range.
- **craghopper** — medium chase, melee range.
- **glade-stag** — chase, melee range (already high dodge).
- **snarlfox** — fast **kiter** with a longer range (it's fast and weak-to-ranged),
  so it punishes players who can't close or can't use magic.

Because the start distance is 40 (player 30 → creature 70), **only Magic is usable
on turn 1**; melee/ranged builds must spend SP closing the gap while the creature
advances. This is intended.

---

## 5. Three new upgradeable attributes: Health, Stamina, Magic

Decision: **split max vs regen.** Vitality/Endurance keep governing *max* HP/SP;
the new attributes govern *regen*. So:

- Add `health`, `stamina`, `magic` to `AttributeId`, `ATTRIBUTE_IDS`,
  `ATTRIBUTE_LABELS`, `ATTRIBUTE_DESCRIPTIONS`, and the default attribute block in
  state init (default 0). Handle them in `spendAttributePoint` (no max-stat side
  effect — they only raise regen).
- **Remove the regen clauses** from Vitality and Endurance so roles don't overlap:
  - Vitality → `'+10 max HP.'` (drop "+1 HP recovery per second")
  - Endurance → `'+10 max stamina.'` (drop "+1 stamina recovery per second")
- New attribute descriptions:
  - Health → `'+1 HP recovered at the start of each battle turn (and overworld recovery).'`
  - Stamina → `'+1 SP recovered at the start of each battle turn (and overworld recovery).'`
  - Magic → `'+1 MP recovered at the start of each battle turn (and overworld recovery).'`
- Unify: the overworld per-second `recoverPlayer` should also use the new
  attributes for its regen amounts (so Vitality/Endurance truly only affect max).
- Update the admin panel attribute list, save-migration validation for the new
  attribute keys (default 0 for old saves), and any character-sheet UI that
  iterates attributes (most already iterate `ATTRIBUTE_IDS` and pick up new ones
  for free — verify).

---

## 6. UI (`src/ui/encounterPanel.ts`) — presentation lane

- Add a movement/rest row to the action bar, e.g. `[◀ Backward] [Forward ▶] [Rest]`,
  with SP cost labels (`Forward · 5 SP`, `Rest +10 SP`). Melee label updates to
  `⚔️ Melee · 10 SP`.
- **Reposition the two fighter sprites along the arena to reflect `playerPos` /
  `creaturePos`** (map 0–100 to the stage's horizontal extent). Animate the slide
  when someone moves, and animate the creature's advance/retreat on its turn.
- Show the current **distance** and each attack's range gate clearly (e.g. a range
  track/indicator, or reachability styling on the melee/ranged buttons) so the
  player understands why an action is disabled.
- Keep the existing round-replay animation flow (`playResult`) — extend it to
  play a "move" beat for forward/backward/rest and the creature's reposition.
- Buttons stay disabled with an explanatory tooltip when out of range or SP, using
  `encounterAvailability`.

---

## 7. Tests & verification

- Update/extend unit tests: `tests/unit/encounters.test.ts` (range gating,
  movement clamping, turn-start regen, Rest stacking, creature chase/kite AI, SP
  costs), `determinism.test.ts` (state-shape change), `migrations.test.ts` +
  `saveRepository.test.ts` (new encounter fields + new attributes backfill),
  `characterProgression.test.ts` (new attributes, regen formulas), and
  `gameplay.test.ts` if affected.
- Update the e2e `tests/e2e/creatures.spec.ts` for the new buttons/flow.
- **Run `npm run build` before Playwright** (the e2e preview serves `dist/` on
  port 4173 — otherwise it runs stale code). Then run unit + e2e suites.
- Keep everything deterministic; movement/AI are pure functions of state (no new
  RNG unless you route it through the existing `rollBps`).

---

## Design decisions already locked (from the requester)

1. Every action (move / attack / rest / snare / berry / flee) **ends the turn**;
   the creature acts afterward.
2. Creature **advances/retreats with its own per-species range** (chase vs kite).
3. Regen is **turn-start**, amounts **driven by new Health/Stamina/Magic
   attributes** (split from Vitality/Endurance, which keep only max bonuses).
4. Ranged still costs arrows, Magic still costs MP; out-of-range just disables.
5. Distance is **clamped, no overshoot**. **Rest is free and always available**,
   and **turn-start regen stacks with Rest's +10 SP**.
