import { TILE_SIZE } from '../config/platform';
import { buildableById } from '../content/buildingParts';
import { creatureDefinition } from '../content/creatures';
import { creatureWorkPassive, type CreatureWorkPassiveDefinition } from '../content/creatureWorkPassives';
import { activeWorksiteFor } from './creatureRoles';
import { structureHp, structureMaxHp } from './gameplayCommands';
import { buildingCenter, damageRaider } from './raids';
import { isStorageContainer, storageBoxContents } from './storageBox';
import type { BuildingState, GameState, OwnedCreatureState, RaiderState } from './state';

/**
 * The non-production half of the Work role, advanced once per fixed step.
 *
 * Every passive here obeys the same three rules, and they are what make a
 * homestead defensible while the player is somewhere else:
 *
 *   - It fires on a fixed tick interval owned by `nextWorkTick`. Producer
 *     species never reach this module (settleCreature owns their clock), so the
 *     field has exactly one writer per creature.
 *   - It is anchored to the worksite, never to the player. A passive that
 *     followed the player would just be a follower with extra steps.
 *   - It resolves in stable array order over whole numbers. No distance sort
 *     over floats, no rolls: creature and building fields feed the canonical
 *     state hash, and a replayed save has to make identical choices.
 *
 * `purified-zone` is deliberately absent from the switch. It is a query, not an
 * event — see creaturePurifiedCells — and has nothing to do on a tick.
 */
export function advanceCreatureWorkPassives(state: GameState): boolean {
  if (state.pendingRespawn) return false;
  let changed = false;
  for (const creature of state.ownedCreatures) {
    const passiveId = creatureDefinition(creature.speciesId).work?.passive;
    if (!passiveId || passiveId === 'purified-zone') continue;
    const worksite = activeWorksiteFor(state, creature);
    if (!worksite) continue;

    const passive = creatureWorkPassive(passiveId);
    // A creature whose clock was left far in the future by an earlier, longer
    // interval is pulled back rather than parked: an Admin retune of the
    // interval should take effect this cycle, not after the old one expires.
    if (creature.nextWorkTick > state.tick + passive.intervalTicks) {
      creature.nextWorkTick = state.tick + passive.intervalTicks;
    }
    if (state.tick < creature.nextWorkTick) continue;

    const applied = passiveId === 'rebuild-walls' ? rebuildWalls(state, worksite, passive)
      : passiveId === 'defend-base' ? attackNearbyHostile(state, worksite, passive, false)
        : passiveId === 'restock-turrets' ? restockTurrets(state, worksite, passive)
          : attackNearbyHostile(state, worksite, passive, true);

    // The clock advances whether or not there was anything to do, so an idle
    // shift cannot bank charges and dump them the instant a raid lands.
    creature.nextWorkTick = state.tick + passive.intervalTicks;
    if (applied) changed = true;
  }
  return changed;
}

function reachSquared(passive: CreatureWorkPassiveDefinition): number {
  const reach = passive.rangeTiles * TILE_SIZE;
  return reach * reach;
}

function squaredDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx; const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Pack health back into one damaged structure in reach.
 *
 * Walls before facilities: a breach is what loses a base, and a Masonmole that
 * spent the raid topping up a Workbench while the perimeter came down would be
 * doing the least useful version of its job. Within a group the worst-damaged
 * wins, so the repair goes where a raid is actually working.
 */
function rebuildWalls(
  state: GameState,
  worksite: BuildingState,
  passive: CreatureWorkPassiveDefinition,
): boolean {
  const origin = buildingCenter(worksite);
  const range = reachSquared(passive);
  const walls: BuildingState[] = [];
  const facilities: BuildingState[] = [];

  for (const building of state.buildings) {
    const max = structureMaxHp(building, state.gameBalance);
    if (max === null || structureHp(building, state.gameBalance)! >= max) continue;
    const center = buildingCenter(building);
    if (squaredDistance(origin.x, origin.y, center.x, center.y) > range) continue;
    if (buildableById(building.definitionId).layer === 'boundary') walls.push(building);
    else facilities.push(building);
  }

  // A group is exhausted before the next is touched at all, the same shape the
  // raid's own target priority uses.
  const candidates = walls.length > 0 ? walls : facilities;
  let target: BuildingState | null = null;
  let targetMissing = 0;
  for (const building of candidates) {
    const missing = structureMaxHp(building, state.gameBalance)! - structureHp(building, state.gameBalance)!;
    // Strictly greater keeps the first candidate in array order on a tie, so
    // two identically damaged walls repair in a stable, replayable order.
    if (missing <= targetMissing) continue;
    target = building;
    targetMissing = missing;
  }

  if (!target) return false;
  const max = structureMaxHp(target, state.gameBalance)!;
  const healed = Math.min(max, structureHp(target, state.gameBalance)! + passive.amount);
  // Absent `hp` is how this codebase spells "undamaged", so a fully repaired
  // structure gives the field back rather than persisting a redundant number.
  if (healed >= max) delete target.hp;
  else target.hp = healed;
  return true;
}

/**
 * Hit the nearest hostile in reach of the worksite.
 *
 * `includeRoamers` is the whole difference between the two combat passives: a
 * Bulwark Boar answers a raid, while a Slingtail throws at anything hostile
 * that wanders into range, raid night or not.
 */
function attackNearbyHostile(
  state: GameState,
  worksite: BuildingState,
  passive: CreatureWorkPassiveDefinition,
  includeRoamers: boolean,
): boolean {
  const origin = buildingCenter(worksite);
  const range = reachSquared(passive);
  let victim: RaiderState | null = null;
  let victimDistance = Number.POSITIVE_INFINITY;
  for (const raider of state.raiders) {
    if (!includeRoamers && raider.roaming) continue;
    const distance = squaredDistance(origin.x, origin.y, raider.x, raider.y);
    if (distance <= range && distance < victimDistance) {
      victim = raider;
      victimDistance = distance;
    }
  }
  if (!victim) return false;
  damageRaider(state, victim, passive.amount);
  return true;
}

/**
 * Carry arrows out of nearby storage and into a turret that is low.
 *
 * The turret is the creature's own worksite, so one Quillfinch keeps one
 * turret fed and a wall of them is a real staffing cost. Arrows come from
 * player-built containers rather than from nowhere: this passive removes the
 * trip, not the crafting.
 */
function restockTurrets(
  state: GameState,
  worksite: BuildingState,
  passive: CreatureWorkPassiveDefinition,
): boolean {
  if (worksite.definitionId !== 'turret') return false;
  const ammunition = worksite.turret ?? (worksite.turret = { ammo: 0, nextFireTick: 0 });
  const space = state.gameBalance.defense.turretAmmoCapacity - ammunition.ammo;
  if (space <= 0) return false;

  const origin = buildingCenter(worksite);
  const range = reachSquared(passive);
  let remaining = Math.min(space, passive.amount);
  let moved = 0;
  // Stable array order, deliberately not a distance sort: containers hold whole
  // arrows and the choice between two of them must replay identically.
  for (const container of state.buildings) {
    if (remaining <= 0) break;
    if (!isStorageContainer(container)) continue;
    const center = buildingCenter(container);
    if (squaredDistance(origin.x, origin.y, center.x, center.y) > range) continue;

    const contents = storageBoxContents(container);
    const taken = Math.min(remaining, contents.inventory.arrow);
    if (taken <= 0) continue;
    contents.inventory.arrow -= taken;
    // Re-reading normalizes the stack boundaries against the new total, which
    // is the same path deposits and withdrawals go through.
    storageBoxContents(container);
    remaining -= taken;
    moved += taken;
  }

  if (moved <= 0) return false;
  ammunition.ammo += moved;
  return true;
}

/** Every work passive a creature is currently running, for HUD and test use. */
export function activeWorkPassives(state: GameState): Array<{ creature: OwnedCreatureState; worksite: BuildingState }> {
  const active: Array<{ creature: OwnedCreatureState; worksite: BuildingState }> = [];
  for (const creature of state.ownedCreatures) {
    if (!creatureDefinition(creature.speciesId).work?.passive) continue;
    const worksite = activeWorksiteFor(state, creature);
    if (worksite) active.push({ creature, worksite });
  }
  return active;
}
