import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { REGIONAL_IDENTITIES } from '../content/regions';
import { authoredWorldAreaByKey } from '../content/world';
import { enterWorldArea } from './areas';
import { isRegionalMastered } from './regionalProgress';
import type { GameState } from './state';
import { ELARIS_SANCTUARY_TILE, survivalSchedule } from './survivalCycle';

const WAYSTONE_USE_RADIUS_PX = TILE_SIZE * 4;
const ELARIS_KEY = '0,0';

export interface WaystoneDestination {
  readonly areaKey: string;
  readonly name: string;
}

export interface WaystoneOriginView {
  readonly active: boolean;
  readonly name: string | null;
  readonly reason: string;
}

export interface WaystoneTravelResult {
  readonly ok: boolean;
  readonly message: string;
}

export function waystoneOriginView(state: GameState): WaystoneOriginView {
  if (state.pendingRespawn) return { active: false, name: null, reason: 'Choose where to awaken first.' };
  if (survivalSchedule(state).phase === 'danger') {
    return { active: false, name: null, reason: 'Waystones sleep during the danger phase.' };
  }

  if (state.currentArea.key === ELARIS_KEY) {
    const x = (ELARIS_SANCTUARY_TILE.x + 0.5) * TILE_SIZE;
    const y = (ELARIS_SANCTUARY_TILE.y + 0.5) * TILE_SIZE;
    return Math.hypot(state.player.x - x, state.player.y - y) <= WAYSTONE_USE_RADIUS_PX
      ? { active: true, name: 'Elaris Sanctuary', reason: 'The sanctuary waystone is awake.' }
      : { active: false, name: 'Elaris Sanctuary', reason: 'Stand near Elaris Sanctuary to use its waystone.' };
  }

  const definition = REGIONAL_IDENTITIES.find((candidate) => candidate.areaKey === state.currentArea.key);
  if (!definition) return { active: false, name: null, reason: 'There is no waystone in this region.' };
  if (!isRegionalMastered(state, definition.areaKey)) {
    return { active: false, name: definition.landmark.name, reason: `Master ${state.currentArea.name} to awaken its waystone.` };
  }
  const x = (definition.landmark.tileX + 0.5) * TILE_SIZE;
  const y = (definition.landmark.tileY + 0.5) * TILE_SIZE;
  return Math.hypot(state.player.x - x, state.player.y - y) <= WAYSTONE_USE_RADIUS_PX
    ? { active: true, name: definition.landmark.name, reason: `${definition.landmark.name} is linked to the waystone network.` }
    : { active: false, name: definition.landmark.name, reason: `Stand near ${definition.landmark.name} to use its waystone.` };
}

export function waystoneDestinations(state: GameState): WaystoneDestination[] {
  if (!waystoneOriginView(state).active) return [];
  const destinations: WaystoneDestination[] = [];
  if (state.currentArea.key !== ELARIS_KEY) destinations.push({ areaKey: ELARIS_KEY, name: 'Elaris' });
  for (const definition of REGIONAL_IDENTITIES) {
    if (definition.areaKey === state.currentArea.key || !isRegionalMastered(state, definition.areaKey)) continue;
    const area = authoredWorldAreaByKey(definition.areaKey);
    if (area) destinations.push({ areaKey: area.key, name: area.name });
  }
  return destinations;
}

export function travelViaWaystone(state: GameState, destinationAreaKey: string): WaystoneTravelResult {
  const origin = waystoneOriginView(state);
  if (!origin.active) return { ok: false, message: origin.reason };
  const destination = waystoneDestinations(state).find((candidate) => candidate.areaKey === destinationAreaKey);
  if (!destination) return { ok: false, message: 'That waystone route has not been mastered.' };

  const destinationDefinition = REGIONAL_IDENTITIES.find((candidate) => candidate.areaKey === destinationAreaKey);
  const area = destinationAreaKey === ELARIS_KEY
    ? { x: 0, y: 0 }
    : authoredWorldAreaByKey(destinationAreaKey);
  if (!area || !enterWorldArea(state, area.x, area.y)) return { ok: false, message: 'The waystone route is unavailable.' };

  if (destinationAreaKey === ELARIS_KEY) {
    state.player.x = (ELARIS_SANCTUARY_TILE.x + 0.5) * TILE_SIZE;
    state.player.y = (ELARIS_SANCTUARY_TILE.y + 0.5) * TILE_SIZE;
  } else if (destinationDefinition) {
    state.player.x = Math.min(WORLD_TILES - 0.5, destinationDefinition.landmark.tileX + 3.5) * TILE_SIZE;
    state.player.y = (destinationDefinition.landmark.tileY + 0.5) * TILE_SIZE;
  }
  state.player.facing = 'left';
  state.dangerExposureStartedAtTick = null;
  return { ok: true, message: `The waystone carries you to ${destination.name}.` };
}
