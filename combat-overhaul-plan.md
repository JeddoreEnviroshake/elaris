# Overworld Combat Overhaul — Build Plan

Turn the overworld into a standard-MMO combat loop: pick a target, attack it, watch
damage numbers pop and a health bar drain. Melee, ranged, and magic all arrive as
**tools**, equipped through the existing hotbar, driven by the **same single action
button** the player already uses to gather.

The creature Encounter screen stays exactly as it is, reserved for wild creatures
and taming. Nothing in this plan touches `activeEncounter`.

---

## Design decisions (locked)

**A weapon is a Tool.** `ToolDefinition` ([src/config/balance.ts:228](src/config/balance.ts:228))
already carries per-target damage, per-target wear multipliers, durability, craft
cost, repair cost, tier gating, and Admin-editable balance. Swords, bows, and staves
become new `ToolDefinition` entries with new `ToolKind`s. No `WeaponDefinition` type
is introduced. This inherits crafting, repair, the hotbar, bag slots/weight, Storage
Box support, and the Admin balance panel for free.

**One button, target-driven.** The action button hits the current target. Its label
names the target (`Chop Tree`, `Strike Scavenger`, `Mine Vein`). No new attack buttons.

**Sticky targeting.** Tap an enemy or node to lock it. A ring plus name plate plus
health bar mark it. Lock clears on death, depletion, or leaving range. Facing-based
targeting cannot express a bow shot 20 tiles out, and it makes "sword vs. tree vs.
raider standing next to the tree" ambiguous.

**Yield always comes from depletion.** A tree burned down by a staff drops wood the
same as an axed one, because yield is awarded on `node.hp === 0`
([src/simulation/gameplayCommands.ts:944](src/simulation/gameplayCommands.ts:944)),
not per hit. One strike function guarantees this can never drift.

**Damage table** (iron tier shown; wooden/stone scale down as existing tools do):

| | tree | stone | metal | plant | berry-bush | raider | structure |
|---|---|---|---|---|---|---|---|
| Axe | 24 | — | — | 10 | 10 | 6 | existing |
| Pick | — | 24 | 24 | — | — | 6 | existing |
| Sickle | 10 | — | — | 24 | 24 | 4 | existing |
| **Sword** | 10 | 8 | — | 12 | 12 | **24** | existing |
| **Bow** | — | — | — | — | — | **20** | — |
| **Staff** | 12 | 12 | 12 | 12 | 12 | **18** | — |

- Sword cannot mine **metal**. Ore is the one thing that must require the right
  tool, protecting the pick and the iron progression gate.
- Staff is the only thing that damages **every** node kind including metal. That is
  magic's niche: a mage is never stranded in front of an iron vein.
- Sword and staff take `wearMultiplierByTarget: 2` on every resource kind. The
  one-slot convenience is paid for in durability.
- Bow is enemies-only, and its cost is crafted ammunition in the Bag.

**Costs per style:**
- Melee → durability wear + the existing 2 SP per swing. Against a hostile, the
  encounter's 10 SP (`MELEE_STAMINA_COST`).
- Ranged → 1 arrow, no SP. Keeps the existing "step outside to shoot" enclosure gate.
- Magic → MP only (`MAGIC_MANA_COST`), **no durability**. A staff that wears out
  competes badly against a resource that already regenerates; MP *is* its durability.

**Attributes drive the styles.** Strength → melee, Dexterity → ranged,
Intelligence/Magic → spell power, reusing `attackPower` / `hitChanceBonusBps` from
[src/simulation/characterProgression.ts](src/simulation/characterProgression.ts).
No new per-style skill levels — the attribute sheet becomes a build choice instead
of a stat dump, at near-zero cost.

---

## Cross-cutting constraints

- **Integers only.** `canonicalizeGameState` throws on non-integer numbers. Every
  damage value, hostile position, and speed stays whole. Use fixed-point tenths if
  fractions are ever unavoidable.
- **Seeded RNG only.** Any hit/crit/loot roll uses `rollChanceBps` and friends from
  [src/simulation/rng.ts](src/simulation/rng.ts), never `Math.random`.
- **Presentation never enters state.** Floating numbers, target rings, hit-stop, and
  bar fades live in the scene/UI layer only.
- **Lane split.** Simulation changes (`src/simulation/*`, `src/config/balance.ts`)
  overlap with codex's lane; presentation (`src/ui/*`, `src/scenes/*`) is ours.
  Phases 1, 6, and the UI half of 3/7/8 are safe to run in parallel with sim work.
- **Save versions.** Current `SAVE_SCHEMA_VERSION = 44`
  ([src/config/versions.ts](src/config/versions.ts)). Every new `ToolDefinition`
  needs a migration backfilling `state.gameBalance.tools[<newId>]`, because that
  record is built from `TOOL_DEFINITIONS` at default-creation time and persisted.
- **E2E rules.** `npm run build` before Playwright; open via `openApp('?localBalance=1')`;
  poll IndexedDB, never toasts. The Browser pane suspends rAF, so the Phaser loop
  cannot be verified there — combat verification is Playwright-only.

---

## Phase 1 — Targeting, damage numbers, health bars

Presentation-only. Drives the **existing** arrow shot so the feel is proven before
any content is committed.

**New:** `src/ui/targetOverlay.ts`
- Sticky target model: `{ kind: 'node' | 'raider' | 'structure', id }`.
- Target ring + name plate + health bar rendered in world space.
- Bar fades in on first damage, lingers ~4s after the last hit, hides at full —
  matching the hide-when-full rule the player bars adopt in Phase 6.
- Colors from `durabilityColor` ([src/ui/inventorySlots.ts:46](src/ui/inventorySlots.ts:46))
  so every bar in the game reads identically.

**New:** `src/ui/damageNumbers.ts`
- Floating numbers, colored by style: steel-white melee, amber ranged, violet magic.
- Crits render larger with a pop; misses render grey as `Miss`.
- Staggered vertical offsets so rapid hits do not overlap into mush.
- ~60ms hit-stop on the target sprite. This sells impact better than particles.

**Edit:** [src/scenes/WorldScene.ts](src/scenes/WorldScene.ts)
- Tap/click a hostile or node sets the sticky target; store on the scene, not state.
- `performContextAction` (line ~1453) consults the sticky target first, falling back
  to today's proximity chain when nothing is locked.
- Replace the existing `spawnFloatingText` path for combat results with `damageNumbers`.

**Edit:** [src/ui/gameplayHud.ts](src/ui/gameplayHud.ts) — `refreshAction` (line ~1130)
- Label reads from the sticky target rather than `nearestRaiderInRange`.
- Retire the `Shoot`/`Gather` binary in favor of verb-plus-target labels.
- Keep `data-resource-target-*` datasets intact; existing e2e specs read them.

**Tests:** `tests/unit/targeting.test.ts` (selection, range clearing, death clearing).
E2E: extend [tests/e2e/creatures.spec.ts](tests/e2e/creatures.spec.ts) to assert a
locked target survives movement and clears on depletion.

---

## Phase 2 — Unified strike path ✅ shipped

Delivered as [src/simulation/strike.ts](src/simulation/strike.ts): `strikeProfile`
resolves damage/wear/cooldown for any target, `payStrikeCost` spends stamina,
cooldown, and durability, and `strikeBlockedReason` holds the shared gates.
`gatherNearest` and `attackFacedWall` now compute nothing themselves, and
`strikeRaiderMelee` (in raids.ts) adds melee-vs-raider on the same path — the bow
stays primary while it can fire, with a swing as the fallback.

Save v45 / content v40 widen `damageByTarget` and `wearMultiplierByTarget` to
`StrikeTarget`. **Bug caught in review:** `gameToolDefinition` filtered those
records over `RESOURCE_NODE_KINDS`, which silently zeroed every tool's new combat
and wall rows when read back through save-backed balance; it now filters over
`STRIKE_TARGETS`.

Original plan below, for reference.

## Phase 2 — Unified strike path (original plan)

**Edit:** [src/config/balance.ts](src/config/balance.ts)
- Widen the target space: `export type StrikeTarget = ResourceNodeKind | 'raider' | 'structure'`.
- `baseDamageByTarget` / `wearMultiplierByTarget` keyed by `StrikeTarget`.
- Content validation ([src/content/validation.ts](src/content/validation.ts)) keeps
  enforcing "every positive damage entry pairs with a positive wear multiplier."

**New:** `src/simulation/strike.ts` — the single chokepoint, mirroring the role
`damageStructure` already plays for buildings.
```
performStrike(state, target: StrikeTargetRef): StrikeResult
```
- Resolves equipped tool → `baseDamageByTarget[targetKind]`, zero means ineligible
  with a named requirement (identical to today's gather message).
- Applies `minimumToolTier` gate, `powerRank` bonus, attribute bonus, cooldown via
  `actionCooldown`, durability wear via `wearPerHit × hardness × wearMultiplier`.
- Routes node depletion into the existing yield/XP/drop block, structures into
  `damageStructure`, hostiles into `damageRaider`.
- Returns `{ ok, damage, outcome: 'hit' | 'crit' | 'miss', remaining, depleted, killed }`
  for the Phase 1 presentation layer to consume.

**Edit:** [src/simulation/gameplayCommands.ts](src/simulation/gameplayCommands.ts)
- `gatherNearest` and `attackFacedWall` become thin wrappers over `performStrike`.
- Behavior must be byte-identical for existing tools; the current unit suites are
  the regression net.

**Edit:** [src/simulation/raids.ts](src/simulation/raids.ts)
- `firePlayerShot` delegates its damage application to `performStrike`, keeping its
  arrow spend, enclosure gate, and bounty payout.

**Tests:** extend [tests/unit/gameplay.test.ts](tests/unit/gameplay.test.ts) and
[tests/unit/determinism.test.ts](tests/unit/determinism.test.ts) — same seed, same
strike sequence, same state hash.

---

## Phase 3 — Swords ✅ shipped

Three tiers added as ordinary `ToolDefinition` entries (`wooden-sword`,
`stone-sword`, `iron-sword`) with `ToolKind` gaining `'sword'`. Iron sword:
raider 24, tree 10, stone 8, plant/berry 12, **metal 0** — ore still needs a
pick. Every resource row wears 2×; the raider row wears 1×. Unlock costs mirror
the tier pattern (1 / 8 / 12) and three `unlock-*-sword` quests were added,
because the quest catalog asserts one quest per unlockable item.

Save v46 / content v41 backfills the three new balance rows. A new `sword` icon
joins the shared set, since `ToolKind` doubles as the icon name.

Original plan below, for reference.

## Phase 3 — Swords (original plan)

**Edit:** [src/config/balance.ts](src/config/balance.ts)
- `ToolKind` gains `'sword'`.
- Three `TOOL_DEFINITIONS` entries: `wooden-sword`, `stone-sword`, `iron-sword`,
  following the existing tier pattern for durability, `actionTicks`, craft and
  repair cost. Damage table above; `wearMultiplierByTarget: 2` on all node kinds.
- `efficiencyAxes` — reuse `['break', 'uptime']`.

**Edit:** [src/simulation/unlocks.ts](src/simulation/unlocks.ts) — unlock requirements
for each tier, matching how stone/iron tools gate today.

**Edit:** [src/simulation/gameplayCommands.ts](src/simulation/gameplayCommands.ts) —
`toolUnlockReason` already routes stone/iron tiers through the workbench; swords
inherit it with no change.

**Edit:** [src/ui/icons.ts](src/ui/icons.ts), [src/art/proceduralTextures.ts](src/art/proceduralTextures.ts) —
sword icon and swing arc.

**Migration → save v45:** backfill `gameBalance.tools['wooden-sword' | 'stone-sword' | 'iron-sword']`
from `createDefaultGameBalance()`. Bump `CONTENT_VERSION` to 40.

**Tests:** unit coverage that a sword damages a tree at reduced rate, wears 2×, and
is refused against `metal` with the pick-required message.

---

## Phase 4 — Bow becomes a tool ✅ shipped

`state.bowOwned` is gone. The Bow is now a `ToolDefinition` (`bow`, tier `stone`,
so it lands in the workbench recipe list), which means it takes a bag slot, wears
one durability per shot, breaks, and **must be equipped to fire** — carrying a bow
means not carrying an axe. Both `!bowOwned` guards became "is a bow in hand"
(`equippedBow`), and the bespoke `craftBow` command plus its hand-built workbench
card were deleted in favour of the ordinary tool recipe path.

### Damage model: the tool is the base, the attribute is the bonus

A hit deals what the weapon is worth plus what the attribute has bought — a Bow
dialled to 10 deals 10 plus `dexterityRangedDamage` for every point of Dexterity.
Which attribute pays out follows what is in hand: a staff swings on Magic, every
other tool (and a bare fist) swings on Strength, and Dexterity is paid at the
arrow rather than at a bow used as a club. The bonus is computed once, in
`meleeDamageBonus` / `rangedDamageBonus` / `magicDamageBonus`, and applied in
`attributeStrikeBonus` (creatures and raiders only — resource nodes have their own
Strength payout via gathering's `bonusDamage`, and no attribute helps knock down a
structure). The character sheet shows the `+N` those functions return rather than
a total, because a total is wrong the moment the player equips something else.

Shot damage deliberately stays out of the tool's damage table: it is
`defense.playerShotDamage` — the Admin dial already labelled "Bow damage" and
shared with arrow presentation — plus what Dexterity has bought, resolved once in
`playerShotDamage(state)` so a raider shot, a hunting shot, and the arrow VFX all
read the same number. The bow's `raider: 3` row is the close-range bash, so a
player caught with no arrows is weak rather than helpless.

Save v47 / content v42 mints a full-durability `bow` instance for anyone whose
save had `bowOwned: true`, then drops the field.

Original plan below, for reference.

## Phase 4 — Bow becomes a tool (original plan)

Today the bow is a boolean flag, `state.bowOwned`
([src/simulation/state.ts:562](src/simulation/state.ts:562)), crafted by `craftBow`
([src/simulation/gameplayCommands.ts:1003](src/simulation/gameplayCommands.ts:1003)).
It must become a real `ToolInstance` so it occupies a hotbar slot and competes for
bag space like everything else.

- Add `ToolKind` `'bow'` and a `wooden-bow` definition (raider damage only, empty
  node table). Durability wears per shot.
- `craftBow` becomes a normal tool recipe; delete the `bowOwned` special case.
- Update the two `!state.bowOwned` guards at
  [encounters.ts:239](src/simulation/encounters.ts:239) and
  [raids.ts:648](src/simulation/raids.ts:648) to "a bow is equipped."
- Update the workbench card at [gameplayHud.ts:1028](src/ui/gameplayHud.ts:1028).

**Migration → save v46:** `bowOwned: true` mints a `wooden-bow` `ToolInstance` at
full durability and pushes it onto `state.tools`; drop the field. Guard against the
bag being full — spill to the ground the way `spillStoredContents` does.

**Watch:** the arrow-count assertions in
[tests/e2e/creatures.spec.ts](tests/e2e/creatures.spec.ts) and any spec that sets
`bowOwned` directly.

---

## Phase 5 — Roaming hostiles ✅ shipped

Two roaming kinds — **Drifter** (24 HP, drops fiber) and **Poacher** (40 HP, drops
arrows) — live in `state.raiders` behind a `roaming` flag, so every combat path
built in Phases 1–4 works on them unchanged. They ignore buildings, aggro at
6 tiles, leash at 14, walk home when they lose interest, and stay out of Elaris
and out of raid nights. Loot drops on the ground via `addGroundDrop`; the coin
bounty is unchanged. Admin gains four dials: aggro range, leash, per-area quota,
and respawn cadence. Save v48 / content v43.

**Two bugs caught by tests:** roamers carry `unlockCycle 0`, so without an explicit
filter they joined every *raid* wave and filled it with hostiles that ignore
buildings; and seeding the spawn point from `(seed, area, slot)` alone meant a
point rejected for being too close to the player was re-rolled to the same
rejected spot forever, so an area could never restock. The spawn seed now includes
the tick — still deterministic, since the tick is state.

Original plan below, for reference.

## Phase 5 — Roaming hostiles (original plan)

Raiders currently exist only during the danger minute, which would leave melee and
magic unused most of a session. Roaming hostiles give the whole system daily purpose.

**Edit:** [src/simulation/state.ts](src/simulation/state.ts)
- Reuse `RaiderState` — it is already integer-clean and real-time. Add
  `roaming?: true` and `homeX`/`homeY` so a hostile returns to its post when the
  player disengages.
- `AreaSnapshot.raiders` already persists per area, so roamers travel with the world
  state for free.

**Edit:** [src/content/raiders.ts](src/content/raiders.ts)
- Two low-tier roamers so early players meet something before their first raid.
- Add `lootTable` — coin bounty (existing) plus resource drops via `addGroundDrop`.
  Weapon fragments and potion ingredients here make fighting a supply line rather
  than a chore.

**Edit:** [src/simulation/raids.ts](src/simulation/raids.ts)
- Roamer spawn seeded per area, respecting `AreaTier` so early zones stay gentle.
- Aggro reuses `raiderAggroRangeTiles`, already Admin-configurable
  ([balance.ts:379](src/config/balance.ts:379)). Add
  `roamerAggroRangeTiles`, `roamerLeashTiles`, and `roamerRespawnTicks` beside it so
  the Admin menu can tune aggro range as requested.
- Roamers leash home instead of chasing forever, and ignore buildings — they hunt
  the player, they do not raid the base.

**Edit:** [src/simulation/admin.ts](src/simulation/admin.ts) +
[src/ui/adminPanel.ts](src/ui/adminPanel.ts) — expose the new defense fields, with
`validateGameBalance` bounds.

**Migration → save v47:** backfill `gameBalance.defense` roamer fields and the new
raider kinds; existing `raiders` arrays are already valid.

**Tests:** unit coverage for aggro entry, leash return, and loot on death. E2E: a
roamer approaches, a locked target survives, HP bar drains, loot lands as a ground drop.

---

## Phase 6 — SP and MP bars, hide-when-full ✅ shipped

The HP bar's hand-built markup became a shared `buildVitalBar` builder, and SP
(amber) and MP (blue) joined the status stack. The policy lives in
[src/ui/vitalBars.ts](src/ui/vitalBars.ts) — pure, clock-injected, unit-tested:
below full is always shown; a just-refilled bar lingers 1s before fading so
regeneration stays visible; and a raid, a hostile in range, or an unsheltered
danger phase pins every bar up regardless.

Hidden bars **fade and collapse** rather than unmounting. The node always stays
in the DOM so `data-player-*` hooks and aria labels keep resolving; the height
animates so the stack slides instead of jumping. Reserving the slot was the
other option and it just left holes in the corner — see the screenshots taken
during verification.

Original plan below, for reference.

## Phase 6 — SP and MP bars, hide-when-full (original plan)

Presentation-only, and now MP finally matters.

**Edit:** [src/ui/gameplayHud.ts](src/ui/gameplayHud.ts)
- Extract the HP bar construction (lines ~174–212) into a reusable builder; add SP
  and MP bars to `statusStack` with their own colors.
- Hide-when-full rules:
  - Fade out only after a bar has been full for ~1s, so a mid-refill bar is never
    yanked away.
  - **Never** hide during a raid, while a hostile is aggroed, or while poison fog is
    draining HP.
  - Do **not** remove from the DOM. E2E and screen readers key off
    `data-player-health` / `data-player-health-fill`. Fade with opacity plus
    `aria-hidden`, and reserve the layout slot so the stack never jumps.

SP/MP already regenerate once per second in the overworld via `recoverPlayer`
([characterProgression.ts:127](src/simulation/characterProgression.ts:127)), so the
bars are live from day one.

**Tests:** extend [tests/e2e/smoke.spec.ts](tests/e2e/smoke.spec.ts) — bars present in
DOM at full, visible after spending.

---

## Phase 7 — Staff and magic

**Edit:** [src/config/balance.ts](src/config/balance.ts)
- `ToolKind` gains `'staff'`; add `iron-staff` (gated at iron tier — it is the
  universal harvester and should not arrive early).
- `maxDurability: 0` sentinel meaning "does not wear"; `performStrike` skips wear
  and charges `MAGIC_MANA_COST` MP instead. `wearMultiplierByTarget` stays empty.

**Edit:** [src/simulation/gameplayCommands.ts](src/simulation/gameplayCommands.ts) —
workbench recipe, as decided. Reuses `toolUnlockReason`'s existing iron-tier path.

**Edit:** `src/simulation/strike.ts` — MP cost branch, `Not enough MP` when short,
never blocking the fallback of a bare-handed swing.

**Edit:** [src/art/proceduralTextures.ts](src/art/proceduralTextures.ts) — projectile
and impact art; violet damage numbers already wired in Phase 1.

**Migration → save v48:** backfill `gameBalance.tools['iron-staff']`.

---

## Phase 8 — Consumable slots and potions

Deliberately last: the schema-heaviest phase. Today `SlotEntry` is
`resource | tool | empty` and selection means *equip* via `equippedToolId`
([src/ui/inventorySlots.ts:11](src/ui/inventorySlots.ts:11),
[src/ui/hotbar.ts](src/ui/hotbar.ts)). Potions need slots that **use**.

**Edit:** [src/simulation/state.ts](src/simulation/state.ts)
- `ConsumableId = 'potion-hp' | 'potion-sp' | 'potion-mp'` folded into `CraftedSupplyId`.
- `consumableCooldownUntilTick: number` — one shared ~5s cooldown across all
  potions, so nobody chugs six mid-raid.

**Edit:** [src/simulation/gameplayCommands.ts](src/simulation/gameplayCommands.ts)
- `useConsumable(state, id)`, modeled on the existing berry-eating command
  (`BERRY_HEAL_SHARE`, [balance.ts:278](src/config/balance.ts:278)) — that is the
  working prototype for this entire feature.
- Workbench recipes tying potions to the garden/berry economy already in place.

**Edit:** [src/ui/hotbar.ts](src/ui/hotbar.ts), [src/ui/inventorySlots.ts](src/ui/inventorySlots.ts)
- Slot selection branches: tool → equip, consumable → consume immediately.
- Cooldown sweep rendered over consumable slots.

**Migration → save v49:** backfill `inventory['potion-hp' | 'potion-sp' | 'potion-mp'] = 0`,
`inventoryStacks[...] = []`, `gameBalance.bagWeight.itemHundredths[...]`, and
`consumableCooldownUntilTick = 0`. Follow the shape of the v42 migration
([migrations.ts:949](src/persistence/migrations.ts:949)), which did exactly this move.

---

## Verification per phase

1. `npm run typecheck && npm run test:unit`
2. `npm run build` (required before Playwright)
3. `npx playwright test` — three-mode runs on the dev-chrome project
4. Screenshot proof for phases 1, 3, 6, 7 via the headless screenshot script; force
   state with `globalThis.__game…state.tick` on the dev server only.

Each phase is independently shippable. Phase 1 is the go/no-go: if targeting plus
damage numbers do not feel good driving the arrow shot alone, stop and re-tune
before committing to content.
