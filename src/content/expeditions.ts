import { OFFLINE_CAP_MS } from '../config/balance';
import type { ExpeditionRouteId, GatherableResourceId, SpeciesId } from '../simulation/state';

/**
 * Creature expeditions: the game's one piece of genuinely idle content.
 *
 * The existing offline systems (growers, furnace, worker creatures) all settle
 * time the player already committed to by building something. An expedition is
 * a *decision* taken before logging off — which creature, and for how long — so
 * returning to the game has a result attached to a choice rather than to a
 * timer that was always running.
 */

export interface ExpeditionRouteDefinition {
  id: ExpeditionRouteId;
  displayName: string;
  summary: string;
  /** Whole milliseconds of travel. */
  durationMs: number;
  /**
   * How much the party can carry home, as bag weight rather than a unit count.
   *
   * A flat count would be wildly unfair across species: 90 fiber is 45 weight
   * but 90 iron-ore is 270, so a Snarlfox survey would leave the player at
   * nearly triple their carry limit while a Tuftle's barely registered. Budgeting
   * by weight makes every route the same size of haul, and because the shipped
   * resources have roughly equal value-per-weight it keeps them equally worth
   * running too.
   */
  primaryYieldHundredths: number;
  /** Units of the route's staple, shared by every species. */
  berryYield: number;
  /** Coins paid by whatever the party sells on the road. */
  coins: number;
  /**
   * Whether this route can return a blueprint. Only the longest one can: an
   * eight-hour survey is the idle mirror of walking to a collapsed cellar, and
   * the short routes must not turn the unlock tree into an afk timer.
   */
  blueprint: boolean;
}

const MINUTE = 60_000;

export const EXPEDITION_ROUTES: readonly ExpeditionRouteDefinition[] = [
  {
    id: 'short-forage',
    displayName: 'Short Forage',
    summary: 'A loop of the near woods. Home within the hour.',
    durationMs: 30 * MINUTE,
    primaryYieldHundredths: 1_500,
    berryYield: 3,
    coins: 15,
    blueprint: false,
  },
  {
    id: 'long-haul',
    displayName: 'Long Haul',
    summary: 'A working trip out to the far ridges and back.',
    durationMs: 120 * MINUTE,
    primaryYieldHundredths: 4_500,
    berryYield: 8,
    coins: 70,
    blueprint: false,
  },
  {
    id: 'deep-survey',
    displayName: 'Deep Survey',
    // Deliberately the same length as the offline cap: a player who sends a
    // creature out overnight loses nothing to a window they cannot bank.
    summary: 'A full expedition into unmapped country. Back in eight hours.',
    durationMs: OFFLINE_CAP_MS,
    primaryYieldHundredths: 9_000,
    berryYield: 24,
    coins: 260,
    blueprint: true,
  },
];

/**
 * What each species is good at fetching. Every creature is useful on a route,
 * which is the point — otherwise expeditions would just be a second job for
 * whichever species already had the best worksite.
 */
export const EXPEDITION_SPECIALTY: Readonly<Record<SpeciesId, GatherableResourceId>> = {
  tuftle: 'fiber',
  craghopper: 'stone',
  'glade-stag': 'wood',
  snarlfox: 'iron-ore',
  // The defence roster fetches the materials a base is rebuilt and rearmed
  // with, so a quiet cycle spent on routes still pays for the next raid.
  masonmole: 'stone',
  'bulwark-boar': 'wood',
  quillfinch: 'wood',
  mistmoth: 'fiber',
  slingtail: 'iron-ore',
};

export function expeditionRoute(id: ExpeditionRouteId): ExpeditionRouteDefinition {
  const route = EXPEDITION_ROUTES.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`unknown expedition route ${id}`);
  return route;
}

export function isExpeditionRouteId(value: unknown): value is ExpeditionRouteId {
  return typeof value === 'string' && EXPEDITION_ROUTES.some((route) => route.id === value);
}
