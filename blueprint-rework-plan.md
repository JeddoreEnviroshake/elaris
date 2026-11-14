# Blueprint Rework Plan

Replaces the unlock-point economy with blueprints that are **earned, carried, and
registered**. Unlock points are deleted entirely.

Two classes of blueprint:

- **Core** — granted by level-up or quest completion. Instant, never an item,
  never lost.
- **Supplementary** — found in the field, dropped by raiders, bought, or traded.
  Exists as an inventory item until registered. Losable until then.

---

## 1. Core blueprints (level gates)

| Level | Grants |
| --- | --- |
| 1 (start) | Thatch Floor, Thatch Wall, Wooden Axe, Wooden Sickle, Wooden Pick |
| 2 | Cloth Mask, Air Purifier |
| 3 | All remaining Thatch build items |
| 4 | Wooden Sword, Storage Box, **Workbench** |
| 5 | Bow, Arrows |
| 7 | Bed, Taming Snare |
| 10 | All Wood items |
| 15 | All Stone items |
| 20 | All Metal items |

The handcraft consumables and the Rowboat carry blueprint ids of their own
(`taming-snare`, `reinforced-snare`, `arrow`, `cloth-mask`, `rowboat`). They used
to be always known for want of an id rather than by design; giving them ids is
what lets Arrows and the Snare sit on gates at all. Saves from before v72 keep
all five outright — a returning player must never find a recipe they have been
using for hours now needs discovering.

Rules:

- Grants are **item-level first, category second**. Bed and Storage Box are wood
  items granted early by explicit id; the level-10 "all wood" sweep grants
  whatever is still unknown rather than re-granting.
- **Facilities are not gated.** They are not needed to progress, so they are
  earned the way Magic, Utility and the variants are — quests, raiders during a
  danger phase, and field finds. Four are named exceptions: the Storage Box and
  Workbench (level 4), the Bed (level 7) and the Air Purifier (level 2). The
  Workbench is named because it is where blueprints are registered; the Air
  Purifier because it answers the fog. Material sweeps explicitly step over
  facilities, so `stone-yard` is not swallowed by the level-15 gate and any
  facility added later joins the found pool without anyone editing the table.
- Levels 6, 8, 9, 11–14, 16–19 grant nothing by design — those stretches are
  where supplementary finds carry the sense of progress.
- Quest blueprints are core too, and are granted on quest completion.

**Grant UX:** reuses the existing claimed-reward pattern. A level-up queues a
flashing banner; the catalog row stays `????` until the player taps to claim,
then flips to its real name. Unclaimed grants persist across sessions.

---

## 2. Supplementary blueprints (the field pool)

Pool = the **Magic** and **Utility** catalog categories, **every facility** bar
the four named on gates, and a new tier of **variants** — field-only upgraded
recipes that don't exist yet (e.g. Reinforced Storage Box, Heavy Bow). Variants
need authoring and balance; treat them as a second phase after the core loop
works.

Facilities being found rather than earned is what gives the pool real weight: a
Furnace or a Warehouse is a genuine prize, and the homestead you end up with
reflects where you have been rather than only how long you have played.

**Finding one while gathering:** hashed per-node roll, seeded from the node
coordinate + its respawn generation, so a respawned node is a fresh chance.
`coordinateHash` returns a **signed** value — fold to `[0,1)` before using it as a
roll.

**Find rate scales with biome danger.** Starting-area nodes are near-barren;
dangerous biomes are where blueprints actually come from. This makes the find
rate itself the risk/reward dial and keeps early game uncluttered. Concrete
per-biome rates go in `config/balance.ts` so they're admin-tunable.

**Raider drops:** raiders carry blueprints. Killing one during a danger phase can
drop a blueprint item. This closes the loop — carrying blueprints draws raiders,
who drop more blueprints.

---

## 3. Carrying and registering

- A blueprint occupies **one inventory slot each**, negligible weight. Different
  blueprints don't stack; duplicates of the same one do.
- **Registration happens at a Workbench** — your own, or the public one in
  Elaris. Walking up and registering consumes the item and adds the blueprint
  permanently.
- **Registration is permanent.** Once registered, nothing — death, raid, anything
  — can take it back. All loss in this system is loss of the *unregistered item*.

### Raider heat

While the player is carrying **any** unregistered blueprint:

- raider spawn rate increases
- raider aggression radius × **1.25**

Flat, not stacking — one blueprint or five is the same heat. Simple to reason
about and to test.

### Stashing

Blueprints **can** go into a Storage Box, but a box holding blueprints
**radiates the same raider heat** from its own position. Stashing is a real
option, not a loophole: it moves the danger to your base instead of removing it.

---

## 4. Loss and recovery

On death while carrying unregistered blueprints:

- they **drop at the death site** as a recoverable pile
- the pile survives **10 real minutes**, then is gone forever
- recovering it is a corpse run; raiders may already be on it

Voluntarily dropping a blueprint on the ground (the player-to-player trading
handoff) uses the **same rules**: 10-minute timer, radiates raider heat. A trade
handoff is itself a tense moment.

---

## 5. Duplicates and sinks

Duplicates are intentional and collectable. Three exits:

1. **Sell** — an existing merchant NPC buys blueprints, extended additively
   through `npcServiceModel` / `npcStock`.
2. **Trade** — drop on the ground for another player.
3. **Scrap** — at a workbench, breaks down into 2 Draft Parchment, so a solo
   player always gets value. Scrapping is bench work rather than a field action:
   it is the one irreversible thing a player can do to a blueprint on purpose.

---

## 6. Blueprints tab display

Unknown entries show as `????`:

- **name hidden, category and slot count visible** — you can see there are four
  unknown Magic blueprints and nothing more
- no hint text about how to obtain them, no cost, no silhouette
- known blueprints show normally; the Craft tab and work tables keep showing only
  owned recipes, as they do today

---

## 7. Migration off unlock points

`unlockPoints` and `isItemUnlocked` are deleted. Touched files today:
`simulation/unlockPoints.ts` (removed), `simulation/state.ts`,
`persistence/migrations.ts`, `ui/blueprintCatalog.ts`, `ui/blueprintsPanel.ts`,
`ui/gameplayHud.ts`, `simulation/characterProgression.ts`,
`simulation/gameplayCommands.ts`, `simulation/worldContainers.ts`
(`EXHAUSTED_BLUEPRINT_UNLOCK_POINTS`), `simulation/expeditions.ts`,
`simulation/regionalProgress.ts`, `simulation/admin.ts`, `ui/adminPanel.ts`,
`content/quests.ts`, `content/regions.ts`, `config/balance.ts`.

Save migration:

- every already-unlocked item becomes a **permanently known core blueprint**
- every core blueprint at or below the player's current level is granted outright
  (no retroactive banner spam — grant silently on migrate)
- the 5 starting points and any unspent balance are dropped
- existing unlock-point *rewards* (containers, expeditions, regional progress)
  need replacement payloads — a supplementary blueprint item, or coin

State additions must stay integer-only (`canonicalizeGameState` throws on
non-integer numbers).

---

## Implementation phases

Each phase should leave the game playable and the test suite green.

**Phase 1 — Tear out unlock points. ✅ Shipped.**
Delete `simulation/unlockPoints.ts`, `unlockPoints` from state, and every
`isItemUnlocked` call. Replace with a `knownBlueprints` set on the player. Save
migration converts already-unlocked items to known blueprints and drops the
balance. Replace the unlock-point payloads in containers, expeditions, and
regional progress with coin for now. Blueprints tab still lists everything, but
known-ness is now a set rather than a purchase.

**Phase 2 — Core grants and level gates. ✅ Shipped.**
Author the level table in `config/balance.ts` as explicit item ids plus category
sweeps. Grant on level-up through `characterProgression`, queued as claimable
banners reusing the quest-reward pattern. `????` masking in the Blueprints tab:
name hidden, category and slot count visible.

**Phase 3 — Blueprints as items. ✅ Shipped.**
`CarriedBlueprint` instances in `state.carriedBlueprints`, one bag slot each.
Registering at a workbench consumes the paper and calls `learnBlueprint`. The
Elaris public bench is **derived town content**, not a row in `state.buildings`
— a real building there would be counted by the Homestead Rating and would
quietly complete the quest that asks the player to build a Workbench of their
own. It answers only in area `0,0` and only while `hasElarisFallen` is false.

**Phase 4 — Finding them. ✅ Shipped.**
Per-node hashed rolls seeded by area seed + node tile + respawn generation,
folded to `[0,1)` with the same `((h % 1) + 1) % 1` worldContainers uses.
Generation is *derived* (`floor(tick / respawnTicks)`) rather than stored, so no
node gained a save field. Rates live in `BLUEPRINT_FIND_BPS_BY_THEME`: Elaris
pays nothing, the marsh roughly one node in twenty. Raider drops roll from the
raider's own position on the fatal blow.

A full bag costs the player the find and says so — blueprints on the ground
belong to Phase 5, and half-building them here would have created the risk-free
stash the design rules out.

**Phase 5 — Risk. ✅ Shipped.**
`blueprintHeat.ts` applies the flat 1.25× aggro at the range check rather than
baking it into balance, so the Admin panel keeps showing the tuned base. The
wave bonus is added *after* the size cap, so heat is felt even by a late-game
base already at the ceiling. Storage Boxes hold blueprints and radiate the same
heat from their own position. Death drops everything unregistered at the death
site on a 10-minute expiry, and the Safeguard Charm protects blueprints exactly
as it protects everything else carried.

**Phase 6 — Sinks. ✅ Shipped.**
Tavi buys unregistered blueprints for 120 coins, one market row per carried
piece of paper. Scrapping yields 2 Draft Parchment and — like registering — is
**workbench work**: the trip home is the pause for thought, so nothing is
destroyed by a mistap mid-raid. Selling deliberately pays more than the
parchment is worth, keeping scrapping the floor under a duplicate rather than
the obvious move. The recipes that consume Draft Parchment belong to Phase 7.

**Phase 7 — Quality, parchment economy, and the drafting table. ✅ Shipped.**
`content/blueprintQuality.ts` gives every blueprint a tier (Common / Rare / Epic
/ Legendary) with per-*tier* roll weights of 50/30/15/5 — per tier rather than
per blueprint, so adding Common recipes never drowns out the Legendary pool.
Quality shows only on **known** entries; on a masked tile it would be a hint
about what is hiding there.

Draft Parchment sells for 250. **Create Blueprint** costs 5 parchment at a
workbench and draws one blueprint the player does not own, weighted toward
Common, arriving as unregistered paper like any field find. Exhausted tiers are
dropped from the roll rather than rolled and rerolled, so the odds stay honest
as a collection fills in. The roll comes from the persisted RNG stream, so a
draw cannot be rerolled by reloading.

Tavi's blueprint price rose 120 → 600 to keep selling a whole blueprint better
than scrapping it; at 250/parchment the old price made her row dead content.

**Variant tools. ✅ Shipped.** Three grades above Iron — Reinforced (Rare),
Masterwork (Epic), Ancient (Legendary) — for all five tool kinds, fifteen
recipes. Generated from a table in `config/balance.ts` rather than written out
longhand: each is its Iron row scaled by one multiplier set, so fifteen hand
copies would be fifteen chances to mistype a damage figure. They carry the Iron
tier so they gate like Iron tools, but sit in their own Blueprints category and
their own Admin headings. No level grants them and no shop sells them — a
blueprint is the only route to one.

**Safeguard Charm. ✅ Reworked.** One charm saves one item, spent most-precious
first: unregistered blueprints, then tools, then whole resource stacks. Carrying
one charm is now a choice about *what* matters rather than blanket immunity.

**Dropped blueprints render. ✅ Shipped.** Drawn with the blueprint icon tinted
to their quality, outside the chunked ground-drop pipeline — there are only ever
a handful and a corpse run fails outright if the thing being run back for is not
on screen. The pickup button takes a blueprint before any resource stack lying
just as close.

---

## Open items

1. **Variant recipes** (Reinforced Storage Box, Heavy Bow, …) are unauthored.
   Phase them after the Magic/Utility pool ships.
2. **Which quests grant which blueprints** — needs a pass over
   `content/quests.ts`.
3. **Per-biome find rates** — needs actual numbers.
4. **The field pool is large**, now that the facilities are in it: Furnace,
   Barn, Farm Counter, Small Pen, Stone Yard, Cart Dock, Warehouse, Logistics
   Hub, Garden Bed, Woodlot Planter, War Table, Turret, plus Water, the bridges,
   the Reinforced Snare and the Rowboat. Phase 4 tunes find rates against this
   list, not the Magic/Utility split first assumed.

---

## The Elaris public workbench

The early-game registration gap is solved by the town, not by a fallback
building. **Elaris holds a public Workbench any player can use to register
blueprints**, added to `content/townBuildings.ts`.

It follows the town's existing lifecycle rather than a new rule:
`ELARIS_LAST_SAFE_LEVEL = 7`, and `hasElarisFallen` is derived from
`player.level > 7` — never stored. So the public workbench serves you through
level 7 and is destroyed with the rest of the town once you pass it.

That lines up with the level gates on its own:

- levels 1–3: the town workbench is the only way to register a field find
- level 4: you're granted the Workbench blueprint and can build your own
- levels 5–7: last levels with both — room to get one of your own standing
- level 8+: Elaris is ruins; registration is entirely on your own base

The ruined workbench should stay visibly present and non-functional rather than
being removed, so the loss reads as something that happened to the town.
Interacting with it after the fall is the moment a player learns that
registration is now their own problem.
