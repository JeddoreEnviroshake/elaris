import { WORLD_PX, WORLD_TILES } from '../config/platform';
import type { GameState, ResourceNodeState } from '../simulation/state';
import { areaPalette } from '../simulation/areas';
import { areaDisplayName } from '../simulation/elarisFall';
import { activeQuest } from '../simulation/progression';
import { shelterChecklist } from '../simulation/openingShelter';
import { openingFogGuidance } from '../simulation/openingFog';
import { paddockView } from '../simulation/openingPaddock';
import { supplyRunAvailable, supplyRunTarget } from '../simulation/openingSupplyRun';
import { openingGardenAvailable, openingGardenTarget } from '../simulation/openingGarden';
import { terrainAtWithBuildings } from '../simulation/landscape';
import { ELARIS_WATER_TEMPLE } from '../content/elarisWaters';
import { WorldMapPanel } from './worldMapPanel';
import {createUiIcon} from './icons';
import { deathCacheView } from '../simulation/deathCache';
import { BEACON_COLOR, drawBeaconMarker } from './mapMarkers';
import { regionalIdentityForArea } from '../content/regions';
import { hasDiscoveredRegionalLandmark, regionalContractView, regionalMasteryView } from '../simulation/regionalProgress';
import type { WaystoneTravelResult } from '../simulation/waystones';
import { siteViewsForArea } from '../presentation/siteViews';
import { drawSiteMarker } from './mapMarkers';

const MAP_SIZE = 112;
/** Outer width of the mini map panel: canvas + 5px padding + the 2px elaris-panel border. */
const PANEL_WIDTH = MAP_SIZE + 14;

/**
 * Convert source-pixel world coordinates into the tile coordinates players use
 * for navigation. Values are clamped so the bottom/right edge is 160, not 161.
 */
export function worldCoordinates(x: number, y: number): { x: number; y: number } {
  const toTile = (value: number) => Math.max(0, Math.min(WORLD_TILES, Math.floor(value / WORLD_PX * WORLD_TILES)));
  return { x: toTile(x), y: toTile(y) };
}

/** Compact, non-interactive map and live coordinate readout for orientation. */
export class WorldNavigator {
  private readonly root: HTMLDivElement;
  private readonly mapPanel: HTMLDivElement;
  private readonly coordinates: HTMLDivElement;
  private readonly cacheTimer: HTMLDivElement;
  private readonly worldMapButton: HTMLButtonElement;
  private readonly worldMap: WorldMapPanel;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly questPanel: HTMLDivElement;
  private readonly questButton: HTMLButtonElement;
  private readonly questList: HTMLDivElement;
  private readonly questTitle: HTMLElement;
  private readonly questObjective: HTMLDivElement;
  private readonly shelterSummary: HTMLDivElement;
  private readonly shelterButton: HTMLButtonElement;
  private readonly paddockButton: HTMLButtonElement;
  private readonly paddockSummary: HTMLDivElement;
  private readonly supplyRunButton: HTMLButtonElement;
  private readonly gardenButton: HTMLButtonElement;
  private readonly regionalActivity: HTMLDivElement;
  private lastDrawAt = 0;
  private terrainLayer: HTMLCanvasElement | null = null;
  private terrainSignature = '';
  private collapsed = false;
  private questsExpanded = true;
  private battleMode = false;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    coinBadge?: HTMLElement,
    onWaystoneTravel?: (destinationAreaKey: string) => WaystoneTravelResult,
    onShelterOpen?: () => void,
    onPaddockOpen?: () => void,
    onSupplyRunOpen?: () => void,
    onGardenOpen?: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.dataset.worldJournal = '';
    Object.assign(this.root.style, {
      position: 'absolute',
      top: 'calc(env(safe-area-inset-top) + 8px)',
      left: 'calc(env(safe-area-inset-left) + 8px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: '7px',
      pointerEvents: 'none',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);

    this.mapPanel = document.createElement('div');
    this.mapPanel.dataset.worldMapFrame = '';
    Object.assign(this.mapPanel.style, {
      width: `${MAP_SIZE}px`,
      padding: '5px',
      borderRadius: '9px',
      background: 'rgba(9,20,14,0.84)',
      border: '1px solid rgba(255,255,255,0.16)',
      boxShadow: '0 3px 12px rgba(0,0,0,0.3)',
      color: '#e8f0ea',
      font: '600 11px system-ui, sans-serif',
      fontVariantNumeric: 'tabular-nums',
      pointerEvents: 'auto',
      cursor: 'pointer',
      touchAction: 'manipulation',
    } satisfies Partial<CSSStyleDeclaration>);
    this.mapPanel.classList.add('elaris-panel');
    this.mapPanel.setAttribute('role', 'button');
    this.mapPanel.setAttribute('tabindex', '0');
    this.mapPanel.setAttribute('aria-label', 'Toggle world map');
    this.mapPanel.setAttribute('aria-expanded', 'true');

    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'World map');
    Object.assign(this.canvas.style, {
      display: 'block',
      width: `${MAP_SIZE}px`,
      height: `${MAP_SIZE}px`,
      borderRadius: '5px',
      imageRendering: 'pixelated',
    } satisfies Partial<CSSStyleDeclaration>);
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Mini map canvas is unavailable');
    this.context = context;

    this.coordinates = document.createElement('div');
    Object.assign(this.coordinates.style, { marginTop: '4px', textAlign: 'center' } satisfies Partial<CSSStyleDeclaration>);
    // The deadline lives with the map because the map is the answer to it.
    // Hidden entirely when there is no cache: a permanently present timer row
    // reading "—" would train the eye to ignore the one moment it matters.
    this.cacheTimer = document.createElement('div');
    this.cacheTimer.dataset.deathCacheTimer = '';
    this.cacheTimer.setAttribute('role', 'status');
    this.cacheTimer.setAttribute('aria-live', 'polite');
    Object.assign(this.cacheTimer.style, {
      display: 'none',
      marginTop: '3px',
      textAlign: 'center',
      color: BEACON_COLOR,
      font: '700 10px system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>);
    this.mapPanel.append(this.canvas, this.coordinates, this.cacheTimer);
    this.mapPanel.addEventListener('click', this.toggleCollapsed);
    this.mapPanel.addEventListener('keydown', this.onKeyDown);

    this.worldMap = new WorldMapPanel(parent, state, onWaystoneTravel);
    this.worldMapButton = document.createElement('button');
    this.worldMapButton.type = 'button';
    this.worldMapButton.append(createUiIcon('compass',18));
    this.worldMapButton.classList.add('elaris-button');
    this.worldMapButton.setAttribute('aria-label', 'Open large map');
    Object.assign(this.worldMapButton.style, {
      position: 'absolute',
      top: coinBadge ? '47px' : '7px',
      left: `${MAP_SIZE - 28}px`,
      minWidth: '29px',
      minHeight: '22px',
      padding: '2px 3px',
      color: '#e8d9aa',
      font: '700 8px system-ui, sans-serif',
      letterSpacing: '0.04em',
      opacity: '0.78',
      cursor: 'pointer',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      zIndex: '1',
    } satisfies Partial<CSSStyleDeclaration>);
    this.worldMapButton.addEventListener('click', this.openWorldMap);

    this.questPanel = document.createElement('div');
    Object.assign(this.questPanel.style, {
      width: `${PANEL_WIDTH}px`,
      boxSizing: 'border-box',
      borderRadius: '7px',
      overflow: 'hidden',
      background: 'rgba(9,20,14,0.9)',
      border: '1px solid rgba(255,255,255,0.16)',
      boxShadow: '0 3px 12px rgba(0,0,0,0.3)',
      color: '#e8f0ea',
      font: '12px system-ui, sans-serif',
      pointerEvents: 'auto',
      transition: 'opacity 0.15s ease, background-color 0.15s ease',
    } satisfies Partial<CSSStyleDeclaration>);
    this.questPanel.classList.add('elaris-panel');
    this.questPanel.setAttribute('aria-label', 'Active quests');

    this.questButton = document.createElement('button');
    this.questButton.type = 'button';
    Object.assign(this.questButton.style, {
      display: 'flex',
      width: '100%',
      minHeight: '32px',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 8px',
      border: '0',
      color: 'inherit',
      background: 'transparent',
      font: '700 11px system-ui, sans-serif',
      cursor: 'pointer',
      touchAction: 'manipulation',
    } satisfies Partial<CSSStyleDeclaration>);
    this.questButton.setAttribute('aria-expanded', 'true');
    this.questButton.setAttribute('aria-controls', 'active-quest-list');
    this.questButton.setAttribute('aria-label', 'Hide active quest');
    this.questButton.addEventListener('click', this.toggleQuests);

    const questLabel = document.createElement('span');
    questLabel.textContent = 'Quests';
    const questChevron = document.createElement('span');
    questChevron.textContent = '▾';
    questChevron.setAttribute('aria-hidden', 'true');
    questChevron.dataset.questChevron = '';
    this.questButton.append(questLabel, questChevron);

    this.questList = document.createElement('div');
    this.questList.id = 'active-quest-list';
    Object.assign(this.questList.style, {
      padding: '0 8px 9px',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      lineHeight: '1.35',
    } satisfies Partial<CSSStyleDeclaration>);
    this.questTitle = document.createElement('strong');
    Object.assign(this.questTitle.style, {
      display: 'block',
      marginTop: '7px',
      color: '#ffe08a',
      fontSize: '11px',
    } satisfies Partial<CSSStyleDeclaration>);
    this.questObjective = document.createElement('div');
    Object.assign(this.questObjective.style, {
      marginTop: '3px',
      fontSize: '11px',
      opacity: '0.82',
    } satisfies Partial<CSSStyleDeclaration>);
    this.regionalActivity = document.createElement('div');
    Object.assign(this.regionalActivity.style, {
      display: 'none',
      marginTop: '7px',
      paddingTop: '6px',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      color: '#dcebb8',
      fontSize: '10px',
    } satisfies Partial<CSSStyleDeclaration>);
    this.shelterSummary = document.createElement('div');
    Object.assign(this.shelterSummary.style, { marginTop: '6px', fontSize: '11px', color: '#b5edb5', display: 'none' });
    this.shelterSummary.setAttribute('role', 'status');
    this.shelterButton = document.createElement('button');
    this.shelterButton.textContent = 'Shelter guide';
    Object.assign(this.shelterButton.style, { minHeight: '44px', width: '100%', marginTop: '5px', cursor: 'pointer', display: 'none', color: '#f5ecd6', background: '#31543b', border: '1px solid #8ca776', borderRadius: '5px' });
    this.shelterButton.addEventListener('click', () => onShelterOpen?.());
    this.paddockSummary = document.createElement('div');
    Object.assign(this.paddockSummary.style, { marginTop: '6px', fontSize: '11px', color: '#b5edb5', display: 'none' });
    this.paddockSummary.setAttribute('role', 'status');
    this.paddockButton = document.createElement('button'); this.paddockButton.textContent = 'Paddock guide';
    this.paddockButton.style.cssText = this.shelterButton.style.cssText;
    this.paddockButton.addEventListener('click', () => onPaddockOpen?.());
    this.supplyRunButton = document.createElement('button'); this.supplyRunButton.textContent = 'Supply run guide';
    this.supplyRunButton.style.cssText = this.shelterButton.style.cssText;
    this.supplyRunButton.addEventListener('click', () => onSupplyRunOpen?.());
    this.gardenButton = document.createElement('button'); this.gardenButton.textContent = 'Garden guide';
    this.gardenButton.style.cssText = this.shelterButton.style.cssText;
    this.gardenButton.addEventListener('click', () => onGardenOpen?.());
    this.questList.append(this.questTitle, this.questObjective, this.shelterSummary, this.shelterButton, this.paddockSummary, this.paddockButton, this.supplyRunButton, this.gardenButton, this.regionalActivity);
    this.questPanel.append(this.questButton, this.questList);
    this.root.append(this.mapPanel, this.questPanel, this.worldMapButton);
    if (coinBadge) {
      Object.assign(coinBadge.style, {
        width: `${PANEL_WIDTH}px`,
        pointerEvents: 'auto',
      } satisfies Partial<CSSStyleDeclaration>);
      this.root.prepend(coinBadge);
    }
    parent.appendChild(this.root);
    this.refresh(true);
  }

  /** Gold, mini map, and quests belong to the overworld; battle hides them. */
  setBattleMode(active: boolean): void {
    this.battleMode = active;
    if (active) this.worldMap.close();
    this.root.style.display = active ? 'none' : 'flex';
  }

  get largeMapOpen(): boolean {
    return this.worldMap.open;
  }

  /** Called every frame; the small map itself redraws at most eight times/sec. */
  refresh(force = false): void {
    if (this.battleMode) return;
    const { x, y } = worldCoordinates(this.state.player.x, this.state.player.y);
    this.coordinates.textContent = `${areaDisplayName(this.state)} · X ${x}  Y ${y}`;
    const cache = deathCacheView(this.state);
    this.cacheTimer.style.display = cache ? 'block' : 'none';
    this.cacheTimer.textContent = cache
      ? cache.inCurrentArea
        ? `▲ Cache ${cache.label} · X ${cache.tileX} Y ${cache.tileY}`
        : `▲ Cache ${cache.label} · ${cache.cache.areaName}`
      : '';
    const quest = activeQuest(this.state);
    this.questTitle.textContent = quest?.title ?? 'All quests complete';
    this.questObjective.textContent = quest
      ? `${quest.objective}${quest.reward ? ` · Reward: ${quest.reward}` : ''}`
      : 'Your milestone journey is complete.';
    this.questTitle.style.color = quest ? '#ffe08a' : '#b8e6c5';
    const fog = openingFogGuidance(this.state);
    const chapter = this.state.onboarding;
    const supplyActive = supplyRunAvailable(this.state);
    const gardenActive = openingGardenAvailable(this.state);
    this.supplyRunButton.style.display = supplyActive && !gardenActive ? 'block' : 'none';
    this.gardenButton.style.display = gardenActive ? 'block' : 'none';
    this.gardenButton.textContent = chapter.status === 'complete' ? 'Journey recap' : 'Garden guide';
    const paddockActive = !supplyActive && chapter.completedMilestoneIds.includes('weather-fog') && (chapter.status === 'active' || chapter.production?.plan?.areaKey === this.state.currentArea.key);
    const shelterActive = quest?.id === 'opening-build-shelter' || quest?.id === 'opening-weather-fog' || fog?.notice || fog?.departureWarning
      || (!supplyActive && !paddockActive && this.state.onboarding.completedMilestoneIds.includes('build-shelter') && this.state.onboarding.shelterHome?.areaKey === this.state.currentArea.key);
    this.shelterSummary.style.display = shelterActive ? 'block' : 'none';
    this.shelterButton.style.display = shelterActive ? 'block' : 'none';
    if (shelterActive) {
      const check = shelterChecklist(this.state);
      const done = [check.floor, check.enclosed, check.entrance, check.purifier, check.storage, check.breathable].filter(Boolean).length;
      this.shelterSummary.textContent = `${done}/6 ready · ${check.area}/8 floor tiles · ${check.protectedHere ? 'Protected here' : 'Outside purified air'}`;
      if (fog && (quest?.id === 'opening-weather-fog' || fog.notice || fog.departureWarning)) this.shelterSummary.textContent = `${fog.title} · ${check.protectedHere ? 'Protected here' : 'Outside purified air'}`;
    }
    this.paddockButton.style.display = paddockActive ? 'block' : 'none';
    this.paddockSummary.style.display = paddockActive ? 'block' : 'none';
    if (paddockActive) {
      const view = paddockView(this.state);
      this.paddockSummary.textContent = view.working ? `${view.full ? 'Storage full' : `Next fiber in ${view.nextDeliverySeconds}s`} · ${view.bin}/${view.binCapacity} stored`
        : chapter.completedMilestoneIds.includes('return-to-follow') ? 'Tuftle following · housing reserved' : `${view.area}/8 yard tiles · ${view.creature?.role === 'follow' ? 'Tuftle following' : 'Assign Work in the guide'}`;
    }
    const regional = regionalContractView(this.state, this.state.currentArea.key);
    if (regional) {
      const discovered = hasDiscoveredRegionalLandmark(this.state, this.state.currentArea.key);
      const mastery = regionalMasteryView(this.state, this.state.currentArea.key)!;
      this.regionalActivity.style.display = 'block';
      this.regionalActivity.textContent = regional.completed
        ? `${regional.definition.contract.title} complete · Mastery: ${mastery.tier} · Landmark: ${discovered ? regional.definition.landmark.name : 'undiscovered'}`
        : `${regional.definition.contract.title} ${regional.progress}/${regional.definition.contract.target} ${regional.definition.contract.resourceId} · ${regional.definition.contract.rewardCoins} coins · Mastery: ${mastery.tier} · Landmark: ${discovered ? regional.definition.landmark.name : 'undiscovered'}`;
    } else {
      this.regionalActivity.style.display = 'none';
      this.regionalActivity.textContent = '';
    }
    const now = performance.now();
    if (!force && now - this.lastDrawAt < 125) return;
    this.lastDrawAt = now;
    this.draw();
    this.worldMap.refresh();
  }

  destroy(): void {
    this.mapPanel.removeEventListener('click', this.toggleCollapsed);
    this.mapPanel.removeEventListener('keydown', this.onKeyDown);
    this.worldMapButton.removeEventListener('click', this.openWorldMap);
    this.questButton.removeEventListener('click', this.toggleQuests);
    this.worldMap.destroy();
    this.root.remove();
  }

  private toggleCollapsed = (): void => {
    this.collapsed = !this.collapsed;
    this.canvas.style.display = this.collapsed ? 'none' : 'block';
    this.worldMapButton.style.display = this.collapsed ? 'none' : 'block';
    this.mapPanel.style.width = this.collapsed ? 'auto' : `${MAP_SIZE}px`;
    this.coordinates.style.marginTop = this.collapsed ? '0' : '4px';
    this.mapPanel.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true');
  };

  private toggleQuests = (): void => {
    this.questsExpanded = !this.questsExpanded;
    this.questList.style.display = this.questsExpanded ? 'block' : 'none';
    this.questPanel.style.opacity = this.questsExpanded ? '1' : '0.42';
    this.questPanel.style.background = this.questsExpanded ? 'rgba(9,20,14,0.9)' : 'rgba(9,20,14,0.45)';
    this.questButton.setAttribute('aria-expanded', this.questsExpanded ? 'true' : 'false');
    this.questButton.setAttribute('aria-label', this.questsExpanded ? 'Hide active quest' : 'Show active quest');
    const chevron = this.questButton.querySelector<HTMLElement>('[data-quest-chevron]');
    if (chevron) chevron.textContent = this.questsExpanded ? '▾' : '▸';
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleCollapsed();
    }
  };

  private openWorldMap = (): void => {
    this.worldMap.show(this.worldMapButton);
  };

  /** Rebuild static terrain only when the area or player landscaping changes. */
  private cachedTerrain(): HTMLCanvasElement {
    const area = this.state.currentArea;
    const landscape = this.state.buildings.filter((building) => building.definitionId === 'water'
      || building.definitionId === 'wood-bridge' || building.definitionId === 'stone-bridge');
    const signature = JSON.stringify([this.state.seed, area.key, area.seed, area.theme,
      area.landClearingTiles, landscape.map((building) => [building.definitionId, building.tileX, building.tileY, building.rotated])]);
    if (this.terrainLayer && signature === this.terrainSignature) return this.terrainLayer;
    const layer = this.terrainLayer ?? document.createElement('canvas');
    layer.width = MAP_SIZE;
    layer.height = MAP_SIZE;
    const ctx = layer.getContext('2d');
    if (!ctx) throw new Error('Mini map terrain context is unavailable');
    this.terrainLayer = layer;
    this.terrainSignature = signature;
    ctx.fillStyle = areaPalette(this.state.currentArea.theme).minimap;
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Landscape is sampled from the same authoritative terrain queries as
    // movement and both world renderers. Two-tile sampling keeps this redraw
    // inexpensive while retaining rivers, lakes, bridges, and ridge walls.
    for (let tileY = 0; tileY < WORLD_TILES; tileY += 2) {
      for (let tileX = 0; tileX < WORLD_TILES; tileX += 2) {
        const terrain = terrainAtWithBuildings(this.state.seed, this.state.currentArea, this.state.buildings, tileX, tileY);
        if (terrain === 'ground') continue;
        ctx.fillStyle = terrain === 'deep-water' ? '#245f78'
          : terrain === 'shallow-water' ? '#4a9ca0'
            : terrain === 'bridge' ? '#b3834f'
              : '#4d5653';
        const x = Math.floor(tileX / WORLD_TILES * MAP_SIZE);
        const y = Math.floor(tileY / WORLD_TILES * MAP_SIZE);
        const size = Math.max(1, Math.ceil(2 / WORLD_TILES * MAP_SIZE));
        ctx.fillRect(x, y, size, size);
      }
    }

    // A subtle grid makes the 160-tile coordinate system legible without noise.
    ctx.strokeStyle = 'rgba(232,240,234,0.14)';
    ctx.lineWidth = 1;
    for (let tile = 40; tile < WORLD_TILES; tile += 40) {
      const p = Math.round(tile / WORLD_TILES * MAP_SIZE) + 0.5;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, MAP_SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(MAP_SIZE, p); ctx.stroke();
    }

    return layer;
  }

  private draw(): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.drawImage(this.cachedTerrain(), 0, 0);
    for (const node of this.state.resourceNodes) this.drawNode(node);
    for (const building of this.state.buildings) {
      ctx.fillStyle = building.definitionId === 'water' ? '#4a9ca0'
        : building.definitionId === 'wood-bridge' ? '#b3834f'
          : building.definitionId === 'stone-bridge' ? '#9aa19d'
            : '#d9b36c';
      const landscape = building.definitionId === 'water' || building.definitionId.endsWith('-bridge');
      ctx.fillRect(
        building.tileX / WORLD_TILES * MAP_SIZE - (landscape ? 0 : 1),
        building.tileY / WORLD_TILES * MAP_SIZE - (landscape ? 0 : 1),
        landscape ? 2 : 3,
        landscape ? 2 : 3,
      );
    }
    for (const creature of this.state.wildCreatures) this.dot(creature.x, creature.y, '#b995df', 2);
    // Hostiles read as red so a danger minute is legible at a glance.
    for (const raider of this.state.raiders) this.dot(raider.x, raider.y, '#ff4136', 3);
    this.drawWaterTemple();
    this.drawRegionalLandmark();
    this.drawSites();
    this.drawDeathBeacon();
    const target = openingGardenAvailable(this.state) ? openingGardenTarget(this.state) : supplyRunTarget(this.state);
    if (target) {
      const x = (target.tileX + .5) / WORLD_TILES * MAP_SIZE; const y = (target.tileY + .5) / WORLD_TILES * MAP_SIZE;
      ctx.fillStyle = '#8de4ed'; ctx.strokeStyle = '#122d35'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    this.dot(this.state.player.x, this.state.player.y, '#fff4bd', 3);
  }

  /**
   * The beacon over the cache you dropped, drawn only while you are in the
   * region holding it. The mini-map shows one region, so a mark for a cache
   * two regions east would be a lie about where to walk; the countdown under
   * the map names the region instead, and the atlas shows the world view.
   */
  private drawDeathBeacon(): void {
    const cache = this.state.deathCache;
    if (!cache || cache.areaKey !== this.state.currentArea.key) return;
    const x = Math.round(cache.x / WORLD_PX * MAP_SIZE);
    const y = Math.round(cache.y / WORLD_PX * MAP_SIZE);
    drawBeaconMarker(this.context, x, y, 4);
  }

  private drawWaterTemple(): void {
    if (this.state.currentArea.key !== '0,0') return;
    const x = Math.round((ELARIS_WATER_TEMPLE.tileX + 0.5) / WORLD_TILES * MAP_SIZE);
    const y = Math.round((ELARIS_WATER_TEMPLE.tileY + 0.5) / WORLD_TILES * MAP_SIZE);
    const ctx = this.context;
    ctx.fillStyle = '#d8eee7';
    ctx.strokeStyle = '#163b42';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x + 5, y - 1);
    ctx.lineTo(x + 3, y - 1);
    ctx.lineTo(x + 3, y + 4);
    ctx.lineTo(x - 3, y + 4);
    ctx.lineTo(x - 3, y - 1);
    ctx.lineTo(x - 5, y - 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#62ddd5';
    ctx.fillRect(x - 1, y, 2, 4);
  }

  /** Discovered field sites in this region, each with its refill state. */
  private drawSites(): void {
    for (const view of siteViewsForArea(this.state)) {
      if (!view.discovered) continue;
      const x = Math.round(view.x / WORLD_PX * MAP_SIZE);
      const y = Math.round(view.y / WORLD_PX * MAP_SIZE);
      drawSiteMarker(this.context, x, y, 4, view.color, view.searchedCount >= view.containerCount);
      this.context.fillStyle = '#f5ecd6';
      this.context.font = '700 7px system-ui, sans-serif';
      this.context.textAlign = 'center';
      this.context.textBaseline = 'top';
      this.context.fillText(view.status, x, y + 6);
    }
  }

  private drawRegionalLandmark(): void {
    const definition = regionalIdentityForArea(this.state.currentArea.key);
    if (!definition) return;
    const x = Math.round((definition.landmark.tileX + 0.5) / WORLD_TILES * MAP_SIZE);
    const y = Math.round((definition.landmark.tileY + 0.5) / WORLD_TILES * MAP_SIZE);
    const discovered = hasDiscoveredRegionalLandmark(this.state, this.state.currentArea.key);
    this.context.fillStyle = discovered ? definition.landmark.color : '#8d998f';
    this.context.strokeStyle = '#172019';
    this.context.lineWidth = 1;
    this.context.beginPath();
    this.context.moveTo(x, y - 4);
    this.context.lineTo(x + 4, y);
    this.context.lineTo(x, y + 4);
    this.context.lineTo(x - 4, y);
    this.context.closePath();
    this.context.fill();
    this.context.stroke();
  }

  private drawNode(node: ResourceNodeState): void {
    const color = node.hp <= 0 ? '#617165' : node.kind === 'tree' ? '#123d25' : node.kind === 'stone' ? '#9ca8a0' : node.kind === 'berry-bush' ? '#c75b72' : '#86bd5f';
    this.dot(node.x, node.y, color, 1);
  }

  private dot(x: number, y: number, color: string, size: number): void {
    this.context.fillStyle = color;
    this.context.fillRect(Math.round(x / WORLD_PX * MAP_SIZE) - Math.floor(size / 2), Math.round(y / WORLD_PX * MAP_SIZE) - Math.floor(size / 2), size, size);
  }
}
