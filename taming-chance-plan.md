# Taming Chance — Build Plan

Replace both taming systems with one overworld mechanic: every wild creature has a
visible **Tame %** that the player raises by meeting that species' requirements,
then cashes in with a thrown snare. No modal, no arena, no beat menu.

This **supersedes [taming-overhaul-plan.md](taming-overhaul-plan.md)**. That plan's
Calm/Fear session shipped only inside the Tuftle tutorial and was never wired to
the world Snare button. Playtesting verdict (2026-11-16): picking one of four
buttons until the creature joins is boring.

---

## Where things stand today

There are two live taming paths, and both go away:

| Path | Entry | What the player sees | Code |
|---|---|---|---|
| **Old battle arena** | World **Throw Snare** button → `throwSnareAtCreature` → `beginEncounter` ([encounters.ts:259](src/simulation/encounters.ts:259)) | Full-screen 3D arena with melee/ranged/magic, forward/back, rest, snare, berry, flee. Snare is a `snareChanceBps` roll. | [encounters.ts](src/simulation/encounters.ts), [encounterPanel.ts](src/ui/encounterPanel.ts), [ThreeBattleStage.ts](src/three/ThreeBattleStage.ts), [battleState.ts](src/three/battleState.ts), battle branches in [Elaris3DRenderer.ts](src/three/Elaris3DRenderer.ts) |
| **Calm/Fear session** | Tuftle tutorial only ([onboarding.ts:72](src/simulation/onboarding.ts:72)) | Steady / Approach / Offer / Back off for 4–6 beats | [taming.ts](src/simulation/taming.ts), [openingPartnershipPanel.ts](src/ui/openingPartnershipPanel.ts) |

The supply-run **Shell Guard practice** ([openingSupplyRun.ts:111](src/simulation/openingSupplyRun.ts:111))
also opens the battle arena.

Useful pieces that already exist:
- `WildCreatureState.captureBonusBps`: documented as "capture chance accumulated
  by feeding", initialised everywhere, read nowhere. Becomes the food progress field.
- `tameEaseBps` per species, `temperament`, `activeSnare()` with snare tiers, and
  `tamingChanceBonusBps()` (Luck), all of which carry over.
- Overworld combat already lowers `wild.hp`, so "wear it down" needs no new combat.

---

## Design decisions (locked)

**One number, always visible.** Lock onto a creature and its Tame % shows as a bar
over the creature, on the Throw Snare button ("Throw Snare · 62%"), and as a
breakdown on the target card (HP +18 · Fed +40 · Unnoticed +10). The player never
guesses what helped.

**Four ways to raise it. Each species weights them differently.**

| Lever | How the player does it | Persisted as |
|---|---|---|
| **Wear it down** | Normal overworld attacks. Lower HP adds chance. The first time it drops to 25% HP or below, it **staggers**: it can't move or attack for a few seconds and gets a big bonus. | `wild.hp`, `wild.staggerUntilTick`, `wild.staggered` (0/1, once per creature life) |
| **Offer its favourite** | **Offer** button: toss the item. The creature walks to it and eats for a few seconds, with its back to you. The favourite gives a large bonus. A berry (generic edible) gives a small one. Capped. | `wild.captureBonusBps`, `wild.eatingUntilTick` |
| **Stay unnoticed** | Throw while it isn't aggro'd or fleeing, and especially while it's eating. | derived from `aggroUntilTick`, `fleeUntilTick`, `eatingUntilTick` |
| **Trap it** (Phase 2) | Bait a placed Snare Trap. Calm creatures wander in; aggressive ones chase you across it. | `wild.trappedUntilTick` |

**The throw is one seeded roll against the shown %.** On a hit the creature joins,
using the existing `acquireWildCreature`. On a miss the snare is spent and the
creature breaks free:
- Passive and skittish creatures flee.
- Neutral and aggressive creatures turn aggro.
- Food progress is halved.
- `wild.snareMisses` goes up by 1, and each miss adds a pity bonus, so a bad streak
  ends.

The bar never resets to zero after a miss, so a miss stings but still progresses.

**Hitting it still costs you.** Overworld attacks can kill the creature. That risk
is what makes wearing it down a skill rather than a free lever. Nothing protects
the player from overkill except the stagger telegraph.

**Integers and seeded rolls only.** Every new field is a whole number of ticks or
bps, because `canonicalizeGameState` throws on fractions. The roll uses `state.rngState` the same way
`rollBps` does now.

---

## The formula (starting numbers; tune in Admin → Global Values)

```
base      = tameEaseBps × 2_500 / 10_000            // Tuftle 1_750 … Mistmoth 550
hp        = (10_000 − hpPercentBps) × hpWeightBps / 10_000      // default weight 3_500
stagger   = 1_500 while staggerUntilTick > tick
fed       = min(captureBonusBps, FOOD_CAP_BPS)        // favourite +2_000/offer, berry +500, cap 4_000
unnoticed = 1_000 if not aggro/fleeing, 2_000 if eating
trapped   = 2_500 while trappedUntilTick > tick       // Phase 2
pity      = snareMisses × 750
luck      = tamingChanceBonusBps(state)

sum    = base + hp + stagger + fed + unnoticed + trapped + pity + luck
chance = clamp(sum × snareTierBps / 10_000, 500, 9_500)
```

Sanity checks the unit tests pin down:
- **Mistmoth, full HP, unfed, aggro, basic snare:** about 5%. Throwing blind is
  pointless.
- **Mistmoth, fed favourite twice, 25% HP, staggered, unnoticed:** about 85%. Doing
  the work pays.
- **Tuftle, one berry, unnoticed:** about 55%. Starter creatures stay friendly.
- **A Reinforced Snare** (×1.6) turns a 50% setup into 80%. The trophy snare stays
  worth crafting.

Per-species weights go in a new `tameProfile` on each creature definition, so
species play differently without new code:

| Species | Temperament | Favourite (Phase 1, existing items) | Leans on |
|---|---|---|---|
| Tuftle | passive | berry | food |
| Craghopper | neutral | iron-ore | HP (high `hpWeightBps`) |
| Glade Stag | skittish | fiber | unnoticed (it bolts if noticed) |
| Snarlfox | aggressive | berry | trap (kites; Phase 2) |
| Masonmole | neutral | stone | food |
| Bulwark Boar | aggressive | berry | HP + stagger |
| Quillfinch | skittish | fiber | unnoticed |
| Mistmoth | passive | fiber | food + unnoticed |
| Slingtail | neutral | stone | trap (kites; Phase 2) |

Phase 3 swaps these placeholder favourites for crafted baits and lets players
discover them.

---

## Phases

Lane split: **Sim** is Codex's lane, and
**Presentation** (3D, HUD, panels) is Claude's. The HUD files are co-edited.

### Phase 1 — Tame % in the world, and delete the arena

**Sim**
1. Add a `tameProfile` to `CreatureDefinition` in [creatures.ts](src/content/creatures.ts)
   with `favourite`, `hpWeightBps`, `foodCapBps` and `unnoticedBps`. Validate it in
   [validation.ts](src/content/validation.ts).
2. Add `staggerUntilTick`, `staggered`, `eatingUntilTick` and `snareMisses` to
   `WildCreatureState`. Reuse `captureBonusBps` for food progress. Initialise them in
   [worldGeneration.ts](src/simulation/worldGeneration.ts) and `openingSupplyRun.ts`.
3. Create `src/simulation/tameChance.ts` with
   `tameChanceBps(state, wild) → { chanceBps, parts }`. It's a pure function that
   returns the breakdown the UI draws.
4. Stagger: in the overworld damage path ([creatureCombat.ts](src/simulation/creatureCombat.ts)),
   the first time hp crosses 25%, set the stagger. Creature AI skips movement and
   attacks while staggered.
5. `offerToCreature(state, creatureId)` spends one favourite or one berry, sets
   `eatingUntilTick`, and adds progress. Skittish creatures that have noticed you
   refuse the offer and flee.
6. Rewrite `throwSnareAtCreature` to resolve in place: spend the snare, roll, then
   either `acquireWildCreature` or apply the miss consequences. Raise the throw
   range from `TAMING_RANGE_PX` (42) to about 96px so it reads as a throw.
   `snareThrowBlockedReason` stays as the shared gate.
7. **Delete the arena sim.** Remove `beginEncounter`, `resolveEncounterAction`, the
   position/style/intent math, `snareChanceBps`, `EncounterState`, and
   `state.activeEncounter`. Move the crafting functions (`craftTamingSnare`,
   `craftReinforcedSnare`, `craftArrows`, `craftClothMask`) and `activeSnare` into
   `src/simulation/supplyCrafting.ts`, then delete `encounters.ts`.
8. Migration (bump the save version): drop `activeEncounter`. If it was non-null,
   write `creatureHp` back to the wild creature's `hp`. Default the new wild fields
   to 0.
9. **Tutorial:** Tuftle becomes "offer it a berry, watch the bar fill, throw the
   snare". The tutorial throw is guaranteed: the chance is forced to 9_500 and the
   roll skipped for the opening Tuftle. Delete `taming.ts`, the `TAMING_*` balance
   constants and `onboarding.trustSession`.
10. **Shell Guard practice:** delete it, together with the `guardianStarted`
    branch. The supply run already doesn't require the fight.

**Presentation**
1. Tame % bar over the locked creature in [Elaris3DRenderer.ts](src/three/Elaris3DRenderer.ts).
   Show a stagger telegraph: stars plus a slump pose, using `creatureAnimation.ts`.
   Show an eating pose with the creature facing away.
2. HUD ([gameplayHud.ts](src/ui/gameplayHud.ts)): "Throw Snare · NN%", a new
   **Offer {item}** button following the carried/required cost convention, and
   breakdown chips on the target card.
3. Snare throw arc (reuse the raid-arrow projectile pattern). On success, show a
   wrap-and-glow, then the creature-joined toast. On failure, show a burst, then the
   flee or aggro reaction.
4. **Delete the arena presentation:** [encounterPanel.ts](src/ui/encounterPanel.ts),
   [ThreeBattleStage.ts](src/three/ThreeBattleStage.ts),
   [battleState.ts](src/three/battleState.ts), every `battleActive` branch in the
   renderer, `onBattleRound` in [main.ts](src/main.ts), the encounter wiring and
   `performEncounterStart` in [WorldScene.ts](src/scenes/WorldScene.ts), and the
   `.elaris-battle` styles in [woodland.css](src/ui/woodland.css).
5. Audit [combatEffects.ts](src/three/combatEffects.ts) and
   [combatTiming.ts](src/presentation/combatTiming.ts). Their cues are built from
   `BattleRoundPresentation`. Keep anything the overworld uses and delete the rest.
6. Rebuild [openingPartnershipPanel.ts](src/ui/openingPartnershipPanel.ts) as a
   two-step guide: offer, then throw.

**Tests**
- Unit tests for `tameChanceBps`: the sanity rows above, clamps, integer-only
  output, and parts that sum to the total. Determinism: same seed and same throws
  give the same outcomes.
- Unit tests for the miss path: progress halves, pity rises, and the temperament
  reaction fires.
- Delete or rewrite: `encounters.test`, `threeBattleState.test`, `combatEffects.test`,
  the encounter cases in `determinism`, `migrations`, `characterProgression`,
  `creatureRoles`, `creatureTrophies`, `raids`, `targetAcquisition`, `arcaneStorm`,
  `saveRepository` and `openingSupplyRun`, plus e2e `combat-effects.spec` and the
  guardian part of `opening-supply-run.spec`.
- New e2e: lock a Tuftle, Offer berry, Throw Snare, and confirm the roster grows.
  Remember to build first and use the GPU Playwright config.

**Done when:** no code path renders an arena, the world Snare button tames in
place, and the tutorial uses the same mechanic.

**Revision after playtest (2026-11-16): taming runs from the hotbar.** The HUD
Snare/Offer buttons and the tutorial's taming dialog are gone. Food and snares
go on the hotbar (Bag → tap the item → Add to Hotbar), and tapping the slot
uses them ([hotbarItems.ts](src/simulation/hotbarItems.ts)):
- **Food** goes to the locked creature, or the nearest one within 72px. Food a
  creature doesn't want is refused and not spent.
- **A snare** is thrown in front of the character, in this order:
  1. the lock, if it's within throwing range;
  2. the nearest creature in a ±45° cone along the last movement direction (or
     the first-person look);
  3. any creature within 72px.

  A throw that hits nothing lands as a pickup.
- **The tutorial** teaches these same controls. Help Tuftle gets a berry and a
  snare from the roadside basket and tells the player to put them on the
  hotbar. The berry has to come before the snare, the first throw always holds,
  and only the naming dialog is left.

**Second revision (2026-11-16):**
- **Offers stack.** A creature eats several offers in a row, even mid-meal, up
  to its species' food cap: favourite +12%, berry +4%, caps of 36–60%.
- **Taming is no longer the first lesson.** The opening chapter starts with
  three steps: pick berries from a bush, craft a Wooden Axe, then craft a
  Taming Snare. Crafting the axe teaches the snare recipe. The Tuftle won't
  engage until the snare step is done, and the roadside basket is gone.
- **Saves.** Save v93 credits these steps to anyone already past the Tuftle.
- **Plants.** Harvestable plants render at berry-bush height.

**Status (2026-11-16): built, not committed.** Save v92 / content v70. Notes on
what differs from the steps above:
- The new wild-creature fields (`staggerUntilTick`, `staggerSpent`,
  `eatingUntilTick`, `snareMisses`) are optional, so absent means 0 and no
  existing fixture needed rewriting.
- The stagger and eating telegraph is the floating label ("Tame 62% · Staggered!")
  with a gold fill bar. The slump and eating poses in `creatureAnimation.ts` are
  still to do.
- Companion battle abilities are untouched data with no stage (open question 1).
- The battle-only fields on `CreatureDefinition.encounter` (`weakTo`, `resistTo`,
  `dodgeBps`, `moveSpeed`, `attackRange`, `behavior`, `preferredRange`) are now
  unread. They're left in place to keep Admin balance overrides loading, and
  are ready for cleanup.

### Phase 2 — Traps and luring

1. Add a **Snare Trap** buildable via [buildPlacement.ts](src/scenes/buildPlacement.ts).
   It's a starter recipe, so it isn't gated behind a blueprint find, and it can be
   baited with one food item.
2. Creature AI: an unnoticed creature within lure radius of a baited trap walks to
   it. Any creature whose path crosses an armed trap springs it and gets
   `trappedUntilTick` (it can't move or flee and gets +2_500 chance). The trap's
   durability drops each time it springs.
3. Aggressive chasers (Snarlfox, Bulwark Boar) are lured by kiting: they chase you
   across the trap.
4. Presentation: trap model (armed/sprung), bait visible on it, trapped creature
   straining against it.

### Phase 3 — Discovery and baits

1. Favourites start hidden. The target card shows "Loves: ?" until the player
   offers the favourite once, tames one, or reads it in the field journal. The
   wrong food gets a visible sniff-and-refuse reaction, with no penalty.
2. Craftable baits (for example sweet mash and ore lick) replace the
   placeholder favourites. They're stronger than raw items, so cooking is worth it.
3. Per-species quirks as a `tameProfile.quirk` enum, one at a time. Examples:
   - The Mistmoth calms near a lit lantern.
   - The Craghopper's shell opens right after it attacks, giving a stagger window.
   - The Glade Stag only eats at dusk.

### Phase 4 — How you tamed it matters (optional)

Stamp a `tameStyle` on the acquired creature: `fed` / `subdued` / `trapped`, from
the biggest part at the moment of the throw. It gives a small, readable effect, for
example:
- **fed:** +bond gain
- **subdued:** +companion damage
- **trapped:** +work yield

This revives the best idea from the Calm/Fear plan without a menu. Effects land in
the expedition settle path.

---

## Open questions

1. **Companion battle abilities** (`selectedBattleAbilityId`, `battleAbilities`)
   were only ever used in the arena. After Phase 1 they have no stage. Should they
   move to an overworld companion assist, or be retired with the arena?
2. **Should a staggered creature that dies to the next hit still drop a trophy?**
   The current plan says yes: a kill is a kill.
3. **Tutorial throw:** guaranteed (as planned), or a real roll at about 95%?
