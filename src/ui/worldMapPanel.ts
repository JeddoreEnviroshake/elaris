import { WORLD_PX, WORLD_TILES } from '../config/platform';
import {
  AUTHORED_WORLD_AREAS,
  WORLD_AREA_COLUMNS,
  WORLD_AREA_COUNT,
  WORLD_AREA_ROWS,
  WORLD_BOUNDS,
  type AuthoredWorldArea,
} from '../content/world';
import { areaPalette, describeArea } from '../simulation/areas';
import { terrainAt } from '../simulation/landscape';
import { questViews } from '../simulation/progression';
import type { BuildingState, GameState } from '../simulation/state';
import { REGIONAL_IDENTITIES } from '../content/regions';
import { hasDiscoveredRegionalLandmark, regionalContractView, regionalMasteryView } from '../simulation/regionalProgress';
import { waystoneDestinations, waystoneOriginView, type WaystoneTravelResult } from '../simulation/waystones';
import { areaDisplayName, hasElarisFallen } from '../simulation/elarisFall';
import { deathCacheView, type DeathCacheView } from '../simulation/deathCache';
import { BEACON_COLOR, drawBeaconMarker } from './mapMarkers';

const CANVAS_SIZE = 560;
const MAP_INSET = 34;
const GRID_WIDTH = CANVAS_SIZE - MAP_INSET * 2;
const CELL_WIDTH = GRID_WIDTH / WORLD_AREA_COLUMNS;
const CELL_HEIGHT = GRID_WIDTH / WORLD_AREA_ROWS;
const TERRAIN_SAMPLE_TILES = 16;

interface BedMarker {
  readonly areaX: number;
  readonly areaY: number;
  readonly tileX: number;
  readonly tileY: number;
}

/** Dedicated finite-world atlas opened from the mini-map. */
export class WorldMapPanel {
  private readonly overlay: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly summary: HTMLDivElement;
  private readonly routeSummary: HTMLDivElement;
  private readonly regionCards: HTMLDivElement;
  private readonly waystonePanel: HTMLDivElement;
  private readonly closeButton: HTMLButtonElement;
  private returnFocus: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly onWaystoneTravel?: (destinationAreaKey: string) => WaystoneTravelResult,
  ) {
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
      padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
      background: 'rgba(3, 8, 5, 0.78)',
      backdropFilter: 'blur(3px)',
      pointerEvents: 'auto',
      zIndex: '120',
    } satisfies Partial<CSSStyleDeclaration>);
    this.overlay.dataset.worldMapOverlay = '';

    this.dialog = document.createElement('div');
    this.dialog.classList.add('elaris-panel');
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('aria-labelledby', 'large-world-map-title');
    Object.assign(this.dialog.style, {
      width: 'min(720px, 100%)',
      maxHeight: '100%',
      overflow: 'auto',
      boxSizing: 'border-box',
      padding: '12px',
      color: '#f5ecd6',
      background: 'linear-gradient(#203328, #101a14)',
      font: '13px system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>);

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      marginBottom: '8px',
    } satisfies Partial<CSSStyleDeclaration>);

    const heading = document.createElement('div');
    const title = document.createElement('h2');
    title.id = 'large-world-map-title';
    title.textContent = 'The Lands of Elaris';
    Object.assign(title.style, {
      margin: '0',
      color: '#ffe08a',
      font: '700 clamp(18px, 4vw, 24px) "Trebuchet MS", system-ui, sans-serif',
      letterSpacing: '0.03em',
    } satisfies Partial<CSSStyleDeclaration>);
    const subtitle = document.createElement('div');
    subtitle.textContent = 'Discovered regions, shelters, and the road home';
    Object.assign(subtitle.style, { marginTop: '2px', opacity: '0.7', fontSize: '12px' } satisfies Partial<CSSStyleDeclaration>);
    heading.append(title, subtitle);

    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.classList.add('elaris-button');
    this.closeButton.textContent = 'Close';
    this.closeButton.setAttribute('aria-label', 'Close large map');
    Object.assign(this.closeButton.style, {
      minWidth: '64px',
      minHeight: '36px',
      padding: '6px 10px',
      cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>);
    header.append(heading, this.closeButton);

    const mapFrame = document.createElement('div');
    Object.assign(mapFrame.style, {
      width: 'min(68vh, 100%)',
      maxWidth: `${CANVAS_SIZE}px`,
      margin: '0 auto',
      padding: '7px',
      boxSizing: 'border-box',
      border: '3px double #9b7b3c',
      background: '#0a120d',
      boxShadow: 'inset 0 0 20px rgba(0,0,0,.75), 0 5px 18px rgba(0,0,0,.45)',
    } satisfies Partial<CSSStyleDeclaration>);

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Large world map showing settlements, quest destinations, the player, discovered regions, player beds, and the beacon over any cache you dropped on defeat');
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: 'auto',
      aspectRatio: '1',
      imageRendering: 'pixelated',
    } satisfies Partial<CSSStyleDeclaration>);
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Large world map canvas is unavailable');
    this.context = context;
    mapFrame.append(this.canvas);

    const legend = document.createElement('div');
    legend.setAttribute('aria-label', 'World map legend');
    Object.assign(legend.style, {
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: '7px 16px',
      marginTop: '10px',
      color: '#d7dfd6',
      fontSize: '12px',
    } satisfies Partial<CSSStyleDeclaration>);
    for (const [symbol, label, color] of [
      ['◆', 'Elaris', '#ffe08a'],
      ['⬟', 'Town', '#bdda72'],
      ['✦', 'Quest', '#f7cd67'],
      ['●', 'You', '#fff4bd'],
      ['▰', 'Bed', '#d9b36c'],
      ['▲', 'Your cache', BEACON_COLOR],
      ['■', 'Undiscovered', '#27322b'],
    ] as const) {
      const item = document.createElement('span');
      item.textContent = `${symbol} ${label}`;
      item.style.color = color;
      legend.append(item);
    }

    this.routeSummary = document.createElement('div');
    this.routeSummary.textContent = 'Eastern road: Elaris → Verdant Reach → Sylvaren';
    Object.assign(this.routeSummary.style, {
      marginTop: '8px',
      textAlign: 'center',
      color: '#e5d7a8',
      fontWeight: '700',
      fontSize: '12px',
    } satisfies Partial<CSSStyleDeclaration>);

    this.summary = document.createElement('div');
    Object.assign(this.summary.style, {
      marginTop: '8px',
      textAlign: 'center',
      color: '#b9c7ba',
      fontSize: '12px',
    } satisfies Partial<CSSStyleDeclaration>);

    this.regionCards = document.createElement('div');
    this.regionCards.setAttribute('aria-label', 'Regional discoveries and repeatable activities');
    Object.assign(this.regionCards.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px, 100%), 1fr))',
      gap: '8px',
      marginTop: '10px',
    } satisfies Partial<CSSStyleDeclaration>);

    this.waystonePanel = document.createElement('div');
    this.waystonePanel.setAttribute('aria-label', 'Waystone network');
    Object.assign(this.waystonePanel.style, {
      marginTop: '10px',
      padding: '9px 10px',
      border: '1px solid rgba(155, 242, 233, 0.4)',
      borderRadius: '8px',
      background: 'rgba(40, 82, 79, 0.2)',
      color: '#d9f4ef',
      fontSize: '11px',
    } satisfies Partial<CSSStyleDeclaration>);

    this.dialog.append(header, mapFrame, legend, this.routeSummary, this.summary, this.regionCards, this.waystonePanel);
    this.overlay.append(this.dialog);
    parent.append(this.overlay);

    this.closeButton.addEventListener('click', this.close);
    this.overlay.addEventListener('pointerdown', this.onBackdropPointerDown);
    document.addEventListener('keydown', this.onDocumentKeyDown);
  }

  get open(): boolean {
    return this.overlay.style.display !== 'none';
  }

  show = (returnFocus?: HTMLElement): void => {
    this.returnFocus = returnFocus ?? null;
    this.refresh(true);
    this.overlay.style.display = 'flex';
    this.closeButton.focus();
  };

  close = (): void => {
    if (!this.open) return;
    this.overlay.style.display = 'none';
    this.returnFocus?.focus();
    this.returnFocus = null;
  };

  refresh(force = false): void {
    if (!force && !this.open) return;
    this.draw();
  }

  destroy(): void {
    this.closeButton.removeEventListener('click', this.close);
    this.overlay.removeEventListener('pointerdown', this.onBackdropPointerDown);
    document.removeEventListener('keydown', this.onDocumentKeyDown);
    this.overlay.remove();
  }

  private onBackdropPointerDown = (event: PointerEvent): void => {
    if (event.target === this.overlay) this.close();
  };

  private onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.open) return;
    event.preventDefault();
    this.close();
  };

  private draw(): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = '#09130f';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const discovered = new Set(this.state.questProgress.areaKeysVisited);
    discovered.add(this.state.currentArea.key);
    discovered.add('0,0');

    for (let areaY = WORLD_BOUNDS.minY; areaY <= WORLD_BOUNDS.maxY; areaY += 1) {
      for (let areaX = WORLD_BOUNDS.minX; areaX <= WORLD_BOUNDS.maxX; areaX += 1) {
        const descriptor = describeArea(this.state.seed, areaX, areaY);
        const key = `${areaX},${areaY}`;
        const left = this.areaLeft(areaX);
        const top = this.areaTop(areaY);
        const known = discovered.has(key);

        ctx.fillStyle = known ? areaPalette(descriptor.theme).minimap : '#202b24';
        ctx.fillRect(left, top, CELL_WIDTH + 0.5, CELL_HEIGHT + 0.5);
        if (known) this.drawAreaTerrain(descriptor, left, top);
        else {
          ctx.fillStyle = 'rgba(4, 9, 6, 0.36)';
          ctx.fillRect(left, top, CELL_WIDTH + 0.5, CELL_HEIGHT + 0.5);
        }
      }
    }

    ctx.strokeStyle = 'rgba(222, 205, 158, 0.16)';
    ctx.lineWidth = 1;
    for (let column = 0; column <= WORLD_AREA_COLUMNS; column += 1) {
      const x = MAP_INSET + column * CELL_WIDTH;
      ctx.beginPath(); ctx.moveTo(x, MAP_INSET); ctx.lineTo(x, MAP_INSET + GRID_WIDTH); ctx.stroke();
    }
    for (let row = 0; row <= WORLD_AREA_ROWS; row += 1) {
      const y = MAP_INSET + row * CELL_HEIGHT;
      ctx.beginPath(); ctx.moveTo(MAP_INSET, y); ctx.lineTo(MAP_INSET + GRID_WIDTH, y); ctx.stroke();
    }

    this.drawElaris(hasElarisFallen(this.state));
    for (const area of AUTHORED_WORLD_AREAS) {
      if (area.key !== '0,0') this.drawSettlement(area, discovered.has(area.key));
    }
    for (const region of REGIONAL_IDENTITIES) this.drawRegionalLandmark(region.areaKey, discovered.has(region.areaKey));
    const journey = questViews(this.state).find((quest) => !quest.complete && quest.mapAreaKey);
    if (journey?.mapAreaKey) this.drawQuestDestination(journey.mapAreaKey);
    const beds = this.bedMarkers();
    for (const bed of beds) this.drawBed(bed);
    // The beacon is drawn after the beds and before the player: it must never
    // be hidden under a shelter marker, and the player dot on top of it is how
    // "you are standing on your cache" reads.
    const cache = deathCacheView(this.state);
    if (cache) this.drawBeacon(cache);
    this.drawPlayer();

    ctx.strokeStyle = '#d0aa5d';
    ctx.lineWidth = 4;
    ctx.strokeRect(MAP_INSET - 3, MAP_INSET - 3, GRID_WIDTH + 6, GRID_WIDTH + 6);
    ctx.strokeStyle = '#4e3a20';
    ctx.lineWidth = 2;
    ctx.strokeRect(MAP_INSET - 8, MAP_INSET - 8, GRID_WIDTH + 16, GRID_WIDTH + 16);

    ctx.fillStyle = '#9cad9f';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let x = WORLD_BOUNDS.minX; x <= WORLD_BOUNDS.maxX; x += 1) {
      ctx.fillText(String(x), this.areaLeft(x) + CELL_WIDTH / 2, MAP_INSET - 16);
    }
    for (let y = WORLD_BOUNDS.minY; y <= WORLD_BOUNDS.maxY; y += 1) {
      ctx.fillText(String(y), MAP_INSET - 17, this.areaTop(y) + CELL_HEIGHT / 2);
    }

    const knownCount = [...discovered].filter((key) => {
      const [x, y] = key.split(',').map(Number);
      return x !== undefined && y !== undefined
        && x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX
        && y >= WORLD_BOUNDS.minY && y <= WORLD_BOUNDS.maxY;
    }).length;
    // The cache line goes first when there is one. It is the only thing on this
    // panel with a deadline, and burying it behind the region count would make
    // the map worse at the one job it has while the timer runs.
    this.summary.textContent = (cache
      ? `Your cache: ${cache.itemCount} item${cache.itemCount === 1 ? '' : 's'} at ${cache.cache.areaName} X ${cache.tileX} Y ${cache.tileY} · ${cache.label} left · `
      : '')
      + `${areaDisplayName(this.state)} · ${knownCount}/${WORLD_AREA_COUNT} regions discovered · ${beds.length} bed${beds.length === 1 ? '' : 's'}`
      + (journey?.locationLabel ? ` · Next journey: ${journey.locationLabel}` : '');
    this.summary.style.color = cache ? '#8fd9ff' : '#b9c7ba';
    this.refreshRegionCards(discovered);
    this.refreshWaystonePanel();
  }

  private refreshRegionCards(discoveredAreas: ReadonlySet<string>): void {
    const cards = REGIONAL_IDENTITIES.map((definition) => {
      const area = AUTHORED_WORLD_AREAS.find((candidate) => candidate.key === definition.areaKey)!;
      const known = discoveredAreas.has(definition.areaKey);
      const landmarkFound = hasDiscoveredRegionalLandmark(this.state, definition.areaKey);
      const contract = regionalContractView(this.state, definition.areaKey)!;
      const mastery = regionalMasteryView(this.state, definition.areaKey)!;
      const card = document.createElement('section');
      Object.assign(card.style, {
        minWidth: '0',
        padding: '9px 10px',
        border: `1px solid ${known ? area.mapColor : '#455149'}`,
        borderRadius: '8px',
        background: known ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.16)',
      } satisfies Partial<CSSStyleDeclaration>);
      const heading = document.createElement('strong');
      heading.textContent = known ? area.name : 'Undiscovered region';
      heading.style.color = known ? area.mapColor : '#9ba69e';
      const identity = document.createElement('div');
      Object.assign(identity.style, { marginTop: '4px', lineHeight: '1.4', color: '#cbd6cc', fontSize: '11px' });
      identity.textContent = known
        ? `${definition.signatureResource.label} · ${definition.characteristicCreature.label}`
        : 'Travel beyond Elaris to reveal this region.';
      const landmark = document.createElement('div');
      Object.assign(landmark.style, { marginTop: '5px', color: landmarkFound ? definition.landmark.color : '#a8b1aa', fontSize: '11px' });
      landmark.textContent = landmarkFound
        ? `Landmark discovered: ${definition.landmark.name}`
        : known ? 'Landmark: undiscovered' : 'Landmark: hidden';
      const activity = document.createElement('div');
      Object.assign(activity.style, { marginTop: '5px', color: contract.completed ? '#b8e6c5' : '#e5d7a8', fontSize: '11px' });
      activity.textContent = known
        ? contract.completed
          ? `${definition.contract.title}: complete this cycle · ${definition.contract.rewardCoins} coins earned`
          : `${definition.contract.title}: ${contract.progress}/${definition.contract.target} ${definition.contract.resourceId} · Reward ${definition.contract.rewardCoins} coins`
        : 'Repeatable activity: hidden';
      const masteryLine = document.createElement('div');
      Object.assign(masteryLine.style, {
        marginTop: '6px',
        color: mastery.tier === 'Mastered' ? '#9bf2e9' : '#d7c9f0',
        fontSize: '11px',
        fontWeight: '700',
      } satisfies Partial<CSSStyleDeclaration>);
      masteryLine.textContent = known
        ? `Mastery: ${mastery.tier}${mastery.nextTierRequirement ? ` · ${mastery.nextTierRequirement}` : ' · Waystone awakened'}`
        : 'Mastery: Unknown';
      card.append(heading, identity, landmark, activity, masteryLine);
      return card;
    });
    this.regionCards.replaceChildren(...cards);
  }

  private refreshWaystonePanel(): void {
    const heading = document.createElement('strong');
    heading.textContent = 'Waystone network';
    heading.style.color = '#9bf2e9';
    const origin = waystoneOriginView(this.state);
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    Object.assign(status.style, { marginTop: '3px', opacity: '0.86' } satisfies Partial<CSSStyleDeclaration>);
    status.textContent = origin.reason;
    const buttons = document.createElement('div');
    Object.assign(buttons.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '7px',
      marginTop: '7px',
    } satisfies Partial<CSSStyleDeclaration>);
    for (const destination of waystoneDestinations(this.state)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.classList.add('elaris-button');
      button.textContent = `Travel to ${destination.name}`;
      button.setAttribute('aria-label', `Use waystone to travel to ${destination.name}`);
      Object.assign(button.style, {
        minHeight: '36px',
        padding: '6px 10px',
        cursor: this.onWaystoneTravel ? 'pointer' : 'not-allowed',
      } satisfies Partial<CSSStyleDeclaration>);
      button.disabled = !this.onWaystoneTravel;
      button.addEventListener('click', () => {
        const result = this.onWaystoneTravel?.(destination.areaKey)
          ?? { ok: false, message: 'Waystone travel is unavailable.' };
        status.textContent = result.message;
        status.style.color = result.ok ? '#b8e6c5' : '#f0b3a6';
        if (result.ok) this.close();
      });
      buttons.append(button);
    }
    this.waystonePanel.replaceChildren(heading, status, buttons);
  }

  private drawRegionalLandmark(areaKey: string, areaDiscovered: boolean): void {
    const definition = REGIONAL_IDENTITIES.find((candidate) => candidate.areaKey === areaKey);
    const area = AUTHORED_WORLD_AREAS.find((candidate) => candidate.key === areaKey);
    if (!definition || !area || !areaDiscovered) return;
    const x = this.areaLeft(area.x) + (definition.landmark.tileX + 0.5) / WORLD_TILES * CELL_WIDTH;
    const y = this.areaTop(area.y) + (definition.landmark.tileY + 0.5) / WORLD_TILES * CELL_HEIGHT;
    const found = hasDiscoveredRegionalLandmark(this.state, areaKey);
    const ctx = this.context;
    ctx.fillStyle = found ? definition.landmark.color : '#a3afa5';
    ctx.strokeStyle = '#202820';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x + 5, y);
    ctx.lineTo(x, y + 5);
    ctx.lineTo(x - 5, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (!found) {
      ctx.fillStyle = '#182019';
      ctx.font = '800 7px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x, y);
    }
  }

  private drawAreaTerrain(
    descriptor: ReturnType<typeof describeArea>,
    left: number,
    top: number,
  ): void {
    const ctx = this.context;
    const sampleWidth = CELL_WIDTH * TERRAIN_SAMPLE_TILES / WORLD_TILES;
    const sampleHeight = CELL_HEIGHT * TERRAIN_SAMPLE_TILES / WORLD_TILES;
    for (let tileY = 0; tileY < WORLD_TILES; tileY += TERRAIN_SAMPLE_TILES) {
      for (let tileX = 0; tileX < WORLD_TILES; tileX += TERRAIN_SAMPLE_TILES) {
        const terrain = terrainAt(this.state.seed, descriptor, tileX, tileY);
        if (terrain === 'ground') continue;
        ctx.fillStyle = terrain === 'deep-water' ? '#1d536b'
          : terrain === 'shallow-water' ? '#3b858c'
            : terrain === 'bridge' ? '#aa7945'
              : '#434c49';
        ctx.fillRect(
          left + tileX / WORLD_TILES * CELL_WIDTH,
          top + tileY / WORLD_TILES * CELL_HEIGHT,
          Math.ceil(sampleWidth),
          Math.ceil(sampleHeight),
        );
      }
    }
    const buildings = descriptor.key === this.state.currentArea.key
      ? this.state.buildings
      : this.state.visitedAreas[descriptor.key]?.buildings ?? [];
    for (const building of buildings) {
      if (building.definitionId !== 'water' && building.definitionId !== 'wood-bridge' && building.definitionId !== 'stone-bridge') continue;
      ctx.fillStyle = building.definitionId === 'water' ? '#3b858c'
        : building.definitionId === 'wood-bridge' ? '#aa7945' : '#9aa19d';
      ctx.fillRect(
        left + building.tileX / WORLD_TILES * CELL_WIDTH,
        top + building.tileY / WORLD_TILES * CELL_HEIGHT,
        Math.max(1, (building.definitionId === 'water' ? 1 : 2) / WORLD_TILES * CELL_WIDTH),
        Math.max(1, (building.definitionId === 'water' ? 1 : 2) / WORLD_TILES * CELL_HEIGHT),
      );
    }
  }

  private drawElaris(fallen: boolean): void {
    const ctx = this.context;
    const x = this.areaLeft(0) + CELL_WIDTH / 2;
    const y = this.areaTop(0) + CELL_HEIGHT / 2;
    ctx.fillStyle = fallen ? '#7d7266' : '#ffe08a';
    ctx.strokeStyle = '#4b3214';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x + 7, y);
    ctx.lineTo(x, y + 9);
    ctx.lineTo(x - 7, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = fallen ? '#a49688' : '#fff4bd';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(fallen ? 'ELARIS (RUINS)' : 'ELARIS', x, y - 11);
  }

  private drawSettlement(area: AuthoredWorldArea, discovered: boolean): void {
    const ctx = this.context;
    const x = this.areaLeft(area.x) + CELL_WIDTH / 2;
    const y = this.areaTop(area.y) + CELL_HEIGHT / 2;
    ctx.fillStyle = discovered ? area.mapColor : '#7b897d';
    ctx.strokeStyle = '#1a201b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let point = 0; point < 6; point += 1) {
      const angle = Math.PI / 3 * point - Math.PI / 2;
      const px = x + Math.cos(angle) * 7;
      const py = y + Math.sin(angle) * 7;
      if (point === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = discovered ? area.mapColor : '#b7c0b7';
    ctx.font = '700 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(area.mapLabel, x, y - 9);
  }

  private drawQuestDestination(areaKey: string): void {
    const area = AUTHORED_WORLD_AREAS.find((candidate) => candidate.key === areaKey);
    if (!area) return;
    const ctx = this.context;
    const x = this.areaLeft(area.x) + CELL_WIDTH / 2;
    const y = this.areaTop(area.y) + CELL_HEIGHT / 2;
    ctx.strokeStyle = '#f7cd67';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff2a8';
    ctx.font = '900 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', x, y);
  }

  private drawPlayer(): void {
    const ctx = this.context;
    const x = this.areaLeft(this.state.currentArea.x)
      + this.state.player.x / WORLD_PX * CELL_WIDTH;
    const y = this.areaTop(this.state.currentArea.y)
      + this.state.player.y / WORLD_PX * CELL_HEIGHT;
    ctx.fillStyle = '#fff4bd';
    ctx.strokeStyle = '#1a1408';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /** The cache you dropped when you died, wherever in the world it lies. */
  private drawBeacon(cache: DeathCacheView): void {
    const { areaX, areaY } = cache.cache;
    if (areaX < WORLD_BOUNDS.minX || areaX > WORLD_BOUNDS.maxX
      || areaY < WORLD_BOUNDS.minY || areaY > WORLD_BOUNDS.maxY) return;
    const x = this.areaLeft(areaX) + cache.cache.x / WORLD_PX * CELL_WIDTH;
    const y = this.areaTop(areaY) + cache.cache.y / WORLD_PX * CELL_HEIGHT;
    drawBeaconMarker(this.context, x, y, 8);
    this.context.fillStyle = BEACON_COLOR;
    this.context.font = '800 9px system-ui, sans-serif';
    this.context.textAlign = 'center';
    this.context.textBaseline = 'top';
    this.context.fillText(cache.label, x, y + 11);
  }

  private drawBed(bed: BedMarker): void {
    if (bed.areaX < WORLD_BOUNDS.minX || bed.areaX > WORLD_BOUNDS.maxX
      || bed.areaY < WORLD_BOUNDS.minY || bed.areaY > WORLD_BOUNDS.maxY) return;
    const ctx = this.context;
    const x = this.areaLeft(bed.areaX) + (bed.tileX + 0.5) / WORLD_TILES * CELL_WIDTH;
    const y = this.areaTop(bed.areaY) + (bed.tileY + 0.5) / WORLD_TILES * CELL_HEIGHT;
    ctx.fillStyle = '#d9b36c';
    ctx.strokeStyle = '#382815';
    ctx.lineWidth = 1.5;
    ctx.fillRect(x - 5, y - 3, 10, 6);
    ctx.strokeRect(x - 5, y - 3, 10, 6);
    ctx.fillStyle = '#f3dca1';
    ctx.fillRect(x - 3.5, y - 2, 3, 4);
  }

  private bedMarkers(): BedMarker[] {
    const markers: BedMarker[] = [];
    const seen = new Set<string>();
    const add = (areaX: number, areaY: number, buildings: readonly BuildingState[]) => {
      for (const building of buildings) {
        if (building.definitionId !== 'bed' || seen.has(building.id)) continue;
        seen.add(building.id);
        markers.push({ areaX, areaY, tileX: building.tileX, tileY: building.tileY });
      }
    };
    add(this.state.currentArea.x, this.state.currentArea.y, this.state.buildings);
    for (const area of Object.values(this.state.visitedAreas)) add(area.x, area.y, area.buildings);
    return markers;
  }

  private areaLeft(areaX: number): number {
    return MAP_INSET + (areaX - WORLD_BOUNDS.minX) * CELL_WIDTH;
  }

  private areaTop(areaY: number): number {
    return MAP_INSET + (areaY - WORLD_BOUNDS.minY) * CELL_HEIGHT;
  }
}
