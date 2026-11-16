# Online Multiplayer Plan

Every game is a **world with a code**. Solo play is a world nobody has joined.
There is no separate "multiplayer mode" — the session menu is the only entry
point, and the same simulation module runs it whether it is hosted on the
player's device or on the server.

## The session menu

The game no longer auto-loads a save. Boot lands on a menu:

- **Continue** — a list of the worlds on this device. Each row shows the world
  name, whether it is yours or joined, its member count, and when it was last
  played.
- **New Game** — creates a world you own. Playable immediately, offline.
- **Join Game** — enter a code to join someone else's world.

In-game, a **Quit to Menu** action returns here. Quitting never destroys
anything: the world stays in the list.

### The one rule that makes this work

> A world you created and **nobody has joined** lives on your device and plays
> offline, exactly like the game does today. The moment someone redeems your
> code, it moves to the server and becomes **online-only, permanently.**

This is the whole offline story. It preserves offline play for the common case
(playing your own game), it never requires reconciling a divergent offline
session against a shared world, and it is one sentence in the UI.

Because that transition is one-way, **inviting is an explicit, confirmed
action**: "Sharing this world moves it online. You'll need a connection to play
it from now on." Nothing else in the menu can trigger it by accident.

### Where the code comes from

A code has to be globally unique to be redeemable, so only the server can mint
one. A world created **offline** therefore has no code yet — its row shows
**Invite** instead of a code, and tapping it while connected registers the world
and mints the code then. A world created **online** (the normal case for a
hosted PWA) gets its code at creation, as you described.

Codes are short, unambiguous, and drawn from an alphabet with no `0/O` or `1/I`.

## Decisions of record

| Question | Decision |
| --- | --- |
| Entry point | Session menu: Continue / New Game / Join Game. No auto-load |
| Game identity | Every game is a world with a server-minted join code |
| World scope | Private co-op worlds, small groups, isolated from each other |
| Authority | Solo worlds: the client. Shared worlds: server-authoritative on Cloud Run |
| Offline | A world with no other members plays offline. Sharing it is one-way and makes it online-only |
| Quitting | Returns to the menu. Worlds are kept and listed |
| Existing saves | Adopted on first launch as the player's first world. Nothing is lost |
| Identity | Firebase anonymous-first, upgradeable to Google/Apple/email on the same uid |
| Solo save conflicts | Single-writer lease extended to the cloud; other devices open read-only |
| Shared in a co-op world | Terrain, nodes, containers, buildings, ground drops, visited areas, wild creatures, raiders, arcane storms, survival cycle |
| Personal in a co-op world | Inventory, coins, level/XP/attributes, quests, blueprint knowledge, owned creatures, expeditions, tools, NPC memory |
| Empty world | Frozen; settled server-side on first join |
| Lobby | Durable world, stable join code |
| PvP | None. No player damage, no bag theft, anyone may build or demolish |
| Scale | Friends-and-family. One Cloud Run service, many rooms per instance |

## What the codebase already gives us

- **`src/simulation/` is pure.** 69 imports from `content/`, 62 from `config/`,
  zero DOM, Phaser, or `localStorage`. It runs in Node 22 unmodified.
- **Deterministic by construction.** `FixedStepLoop`, seeded `rng.ts`,
  integer-only `canonicalizeGameState`, and `hashGameState` for desync
  detection.
- **Time is already injectable.** `Clock` / `ManualClock` — the server passes its
  own clock, and no sim code reads the wall clock.
- **A single-writer lease already exists** in `SaveController` (heartbeat,
  demote-to-read-only). The cloud lease is the same shape, one tier up.
- **Version gates exist**: `WORLD_GEN_VERSION`, `CONTENT_VERSION`,
  `SAVE_SCHEMA_VERSION`, `APP_VERSION` — these become the connection handshake.

### Foundation status

- **Multi-world storage is implemented.** `LocalWorlds` owns the device's
  directory; `IndexedDbSaveRepository` scopes snapshots, recovery data, writer
  leases and notifications by `worldId` in independent databases.
- **Menu-first boot is implemented.** `main.ts` waits for a world choice before
  creating the save controller, Phaser game and Three.js renderer. Quit saves,
  releases the lease, disposes the session, and returns to the directory.
- `src/simulation/admin.ts:10` imports camera constants from `src/three/`. Move
  those into `src/config/` so the sim has no presentation dependency.

## Infrastructure

Everything except the game server is Firebase. The game server is Cloud Run in
the same GCP project so it can verify Firebase ID tokens and use the Admin SDK.

| Piece | Product | Role |
| --- | --- | --- |
| Client hosting | Firebase Hosting | already in place |
| Identity | Firebase Auth | anonymous-first, linkable |
| World records + saves | Firestore | world docs, member docs, leases |
| Join code registry | Firestore | `worldCodes/{code}` → worldId, with rules |
| Game server | **Cloud Run** | WebSocket host, authoritative tick loop |
| Large snapshots | Cloud Storage (if needed) | overflow past the 1 MiB Firestore doc cap |
| Secrets | Secret Manager | server-side keys |
| Observability | Cloud Logging + Monitoring | tick budget, desync alerts |

**Why Cloud Run and not Firebase alone.** Firebase has no WebSocket product.
Cloud Functions terminate requests and cannot hold long-lived sockets
economically; App Hosting is built for SSR, not stateful rooms. Realtime
Database could carry messages without any server, but it cannot run your tick
loop or validate anything — it would hand authority back to the client, which is
the one thing we decided against. Cloud Run gives long-lived connections, a
Node 22 runtime that imports `src/simulation/` directly, and scale-to-zero.

## Data model

```
users/{uid}                       displayName, createdAt, linkedProviders
worlds/{worldId}                  ownerUid, name, code, memberUids[], shared: bool,
                                  seed, worldGenVersion, contentVersion,
                                  worldState (shared slice), tick,
                                  lastSettledAt, lease { deviceId, expiresAt }
worlds/{worldId}/members/{uid}    personal slice: player, inventory, coins,
                                  quests, blueprints, creatures, tools
worldCodes/{code}                 worldId, active, rotatedAt
gameConfig/globalBalance          unchanged
admins/{uid}                      unchanged
```

`shared` is the flag that flips one-way on first join and gates offline access.
A solo world's `worldState` is simply the whole `GameState`; it only needs
splitting once the world becomes shared.

Locally, IndexedDB mirrors this: a `worlds` store keyed by `worldId` holding the
menu row (name, ownership, code, last played) plus that world's snapshots and
lease, replacing today's single `current` key.

### The GameState split

The shared slice is `seed`, `rngState`, `tick`, `visitedAreas`, `resourceNodes`,
`containers`, `buildings`, `groundDrops`, `wildCreatures`, `raiders`,
`arcaneStorm`, `raidCycleIndex`, `raidSettledAreaKeys`,
`dangerExposureStartedAtTick`, `gameBalance`, `highestAreaTierEver`,
`highestRatingEverTenths`. Everything else is per-member.

Field sites (outlands plan, Phase 1) straddle the line: `siteProgress` must be
split when a world is shared, with `guardsDefeated` and the live guards (raiders
carrying a `siteId`) in the shared slice, and `searched` per member so
co-op partners each get the loot. `activeSearch` is per member.

This is a **projection** — `splitGameState` / `joinGameState` — not a rewrite of
`GameState`. Solo worlds keep using `GameState` exactly as today, so
`migrations.ts` and every existing test stay valid, and the split only runs when
a world is shared.

## Wire protocol

- **Transport**: WebSocket over WSS. First frame is `hello` carrying the Firebase
  ID token, `worldId`, and the four version constants. A version mismatch closes
  the socket with a "refresh required" reason rather than desyncing.
- **Client → server**: intents only, never state. `MoveIntent`, gather, build,
  place, strike, snare, craft, dialogue. Each carries a client sequence number.
- **Server → client**: snapshots at **12 Hz**, not 60. Overworld movement is
  free analog movement in whole pixels (see `first-person-view-plan.md`), so
  remote players interpolate position-to-position between the last two
  snapshots rather than along an in-progress tile move. Personal state is sent
  only to its owner; shared state is sent to everyone in the world.
- **Interest management**: a client receives only its current area. Areas are
  already the natural partition (`currentArea` / `visitedAreas`).
- **Prediction**: the client keeps running its local `FixedStepLoop` for its own
  movement and reconciles against the authoritative snapshot. A `MoveIntent`
  crosses the wire already quantised (`quantizeDirection` in
  `src/simulation/commands.ts`) so both sides step identical integers, and
  reconciliation must carry the transient sub-pixel remainder
  (`GridMovementState.subX`/`subY`) alongside the position, or a replayed
  walk drifts by up to a pixel per correction. Everything
  else — gathering, building, combat, loot — waits for the server, because those
  are the actions worth validating.
- **Desync detection**: the server includes a truncated `hashGameState` of the
  shared slice every N snapshots; a mismatching client resyncs from a full
  snapshot and logs it.

## Server-owned time

`settleOfflineTime(state, elapsedMs)` currently trusts the local clock, which in
a shared world is a free-resources exploit. In shared worlds the server computes
`elapsedMs` from `lastSettledAt` against its own clock and calls the same
function. The client never supplies elapsed time. Solo worlds keep today's
behaviour — it is the player's own save, and there is nobody to cheat.

## Phases

**Phase 1 — The menu, local only**
Implemented: the menu, local world directory, independent snapshots/leases,
legacy-save adoption with a retained raw backup, offline creation/continuation,
and Quit to Menu. The directory lives in `elaris-worlds:{profileId}`; each
world's existing save stores live in `elaris:{profileId}:world:{worldId}`.
Join Game reports that online play is not available yet.

Multi-world storage keyed by `worldId` (snapshots and leases), the session menu
with Continue / New Game / Join Game, Quit to Menu, and a world list. New Game
and Continue fully work offline. Join Game is present and reports that online
play is not available yet. No Firebase, no server, no auth. **This is the
largest local refactor in the plan and everything else depends on it.**

*Adopting the existing save.* On first launch of Phase 1, the single `current`
snapshot is migrated into the new per-world store as the player's first world:
owned, unshared, no code, and playable offline like any other New Game. It is
named from its own progress — the current area plus the player's level, e.g.
"Elaris Meadow · Level 7" — so the list is meaningful before the player has
renamed anything. The player never sees a menu with an empty Continue list on
an upgrade, and the pre-migration snapshot is retained under the existing
`preMigrationBackup` key so the adoption is reversible.

**Phase 2 — Accounts and cloud presence**
Firebase Auth anonymous-on-boot, account linking UI, `worlds/{worldId}` mirrored
to Firestore for worlds you own, cloud lease with heartbeat reusing the
`SaveController` pattern, read-only takeover UI, owner-only Firestore rules.
Code minting and the Invite affordance land here. **This satisfies "the same
game across devices."**

**Phase 3 — Headless sim harness**
Move the `src/three/` constants out of `admin.ts`. Add a Node entry point that
boots `createInitialState`, runs `FixedStepLoop` at 60 Hz, applies intents, and
proves via `hashGameState` that a server run and a client run of the same intent
stream agree. No networking. This is the correctness gate for everything after.

**Phase 4 — World/member projection**
Implement `splitGameState` / `joinGameState` with round-trip property tests, and
the one-way `shared` transition that converts an owned solo world into a hosted
one. Still no networking.

**Phase 5 — Game server and join**
Cloud Run service, WSS endpoint, Firebase ID token verification, room registry
in memory, world load/snapshot to Firestore, code redemption wired to Join Game,
presence and disconnect handling, first-join settlement. Single player per
hosted world end-to-end before adding a second.

**Phase 6 — Multiplayer play**
Remote player rendering and interpolation, per-area interest filtering, shared
raids and survival cycle, contention rules for a node two players gather at
once, disconnect-mid-raid policy, desync telemetry.

**Phase 7 — Hardening**
Rate limits per connection, intent validation bounds, code rotation, a
world-member cap, structured logging, tick-budget alerts, and load testing with
synthetic clients.

## Open items to settle later

- Whether disconnecting mid-raid removes your body or leaves it vulnerable.
- Whether the world owner can evict a member, or delete a shared world.
- Whether a member who leaves a shared world keeps a copy of their character.
- Whether players can rename a world, and whether the owner can rename a shared
  one.
- Snapshot size: if a mature world's shared slice approaches Firestore's 1 MiB
  document limit, move snapshots to Cloud Storage with a pointer in Firestore.
