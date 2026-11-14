import { WORLD_PX } from '../config/platform';
import {
  WORLD_AREA_COLUMNS,
  WORLD_AREA_ROWS,
  WORLD_BOUNDS,
} from '../content/world';
import { areaPalette, describeArea } from '../simulation/areas';
import {
  respawnDestinations,
  type RespawnCommandResult,
  type RespawnDestination,
} from '../simulation/survivalCycle';
import { deathCacheView, type DeathCacheView } from '../simulation/deathCache';
import { drawBeaconMarker } from './mapMarkers';
import type { GameState, PendingRespawnState } from '../simulation/state';

const CANVAS_SIZE = 360;
const MAP_INSET = 26;
const GRID_SIZE = CANVAS_SIZE - MAP_INSET * 2;
const CELL_WIDTH = GRID_SIZE / WORLD_AREA_COLUMNS;
const CELL_HEIGHT = GRID_SIZE / WORLD_AREA_ROWS;

/**
 * Blocking, save-backed defeat screen. It deliberately has no close action:
 * choosing where to awaken is the only transition back into live simulation.
 */
export class RespawnPanel {
  private readonly overlay: HTMLDivElement;
  private readonly cause: HTMLDivElement;
  private readonly loss: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly destinations: HTMLDivElement;
  private readonly feedback: HTMLDivElement;
  private renderedSignature = '';

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly onChoose: (destinationId: string) => RespawnCommandResult,
  ) {
    ensureRespawnStyles();
    this.overlay = document.createElement('div');
    this.overlay.className = 'elaris-respawn-overlay';
    this.overlay.dataset.respawnOverlay = '';

    const dialog = document.createElement('div');
    dialog.classList.add('elaris-panel', 'elaris-respawn-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'respawn-title');

    const header = document.createElement('div');
    header.className = 'elaris-respawn-header';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'elaris-respawn-eyebrow';
    eyebrow.textContent = 'Your journey is not over';
    const title = document.createElement('h2');
    title.id = 'respawn-title';
    title.textContent = 'Choose where to awaken';
    this.cause = document.createElement('div');
    this.cause.className = 'elaris-respawn-cause';
    this.loss = document.createElement('div');
    this.loss.className = 'elaris-respawn-loss';
    header.append(eyebrow, title, this.cause, this.loss);

    const body = document.createElement('div');
    body.className = 'elaris-respawn-body';
    const mapColumn = document.createElement('div');
    mapColumn.className = 'elaris-respawn-map';
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Respawn map showing Elaris, available beds, and the beacon marking the cache you dropped');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Respawn map canvas is unavailable');
    this.context = context;
    const legend = document.createElement('div');
    legend.className = 'elaris-respawn-legend';
    legend.innerHTML = '<span class="safe">◆ Elaris</span><span class="bed">▰ Bed</span><span class="beacon">▲ Your cache</span>';
    mapColumn.append(this.canvas, legend);

    const choiceColumn = document.createElement('div');
    choiceColumn.className = 'elaris-respawn-choices';
    const choiceTitle = document.createElement('strong');
    choiceTitle.textContent = 'Respawn points';
    const choiceHint = document.createElement('div');
    choiceHint.className = 'elaris-respawn-hint';
    choiceHint.textContent = 'Elaris is always safe. Exposed beds remain available, but may place you near danger.';
    this.destinations = document.createElement('div');
    this.destinations.className = 'elaris-respawn-destinations';
    this.feedback = document.createElement('div');
    this.feedback.className = 'elaris-respawn-feedback';
    this.feedback.setAttribute('aria-live', 'polite');
    choiceColumn.append(choiceTitle, choiceHint, this.destinations, this.feedback);
    body.append(mapColumn, choiceColumn);

    dialog.append(header, body);
    this.overlay.append(dialog);
    this.overlay.addEventListener('keydown', this.onKeyDown);
    parent.append(this.overlay);
    this.refresh(true);
  }

  get open(): boolean {
    return this.overlay.style.display === 'flex';
  }

  refresh(force = false): void {
    const pending = this.state.pendingRespawn;
    if (!pending) {
      this.renderedSignature = '';
      this.overlay.style.display = 'none';
      this.feedback.textContent = '';
      return;
    }

    const choices = respawnDestinations(this.state);
    const cache = deathCacheView(this.state);
    const signature = `${pending.defeatedAtTick}:${pending.cause}:${pending.lostItemCount}:${cache?.cache.id ?? ''}:${choices.map((choice) => choice.id).join('|')}`;
    this.overlay.style.display = 'flex';
    if (!force && signature === this.renderedSignature) return;
    this.renderedSignature = signature;
    this.render(pending, choices, cache);
  }

  destroy(): void {
    this.overlay.removeEventListener('keydown', this.onKeyDown);
    this.overlay.remove();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [...this.destinations.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (buttons.length === 0) {
      event.preventDefault();
      return;
    }
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private render(
    pending: PendingRespawnState,
    choices: readonly RespawnDestination[],
    cache: DeathCacheView | null,
  ): void {
    this.cause.textContent = causeText(pending);
    // The clock is honest about not having started: the simulation is frozen
    // while this screen is up, so the ten minutes begin at the moment the
    // player picks a destination, not at the moment they fell.
    this.loss.textContent = cache
      ? `${cache.itemCount} item${cache.itemCount === 1 ? '' : 's'} dropped at the beacon in ${cache.cache.areaName} · ${cache.label} to recover them once you awaken`
      : pending.lostItemCount > 0
        ? `${pending.lostItemCount} carried item${pending.lostItemCount === 1 ? '' : 's'} dropped where you fell · Storage remains safe`
        : 'No carried items were lost';
    this.destinations.replaceChildren(...choices.map((choice) => this.destinationButton(choice)));
    this.drawMap(pending, choices, cache);
    requestAnimationFrame(() => this.destinations.querySelector<HTMLButtonElement>('button')?.focus());
  }

  private destinationButton(choice: RespawnDestination): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('elaris-button', 'elaris-respawn-destination');
    button.setAttribute('aria-label', `Respawn at ${choice.label}`);

    const heading = document.createElement('span');
    heading.className = 'elaris-respawn-destination-heading';
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = choice.kind === 'elaris' ? '◆' : '▰';
    const name = document.createElement('strong');
    name.textContent = choice.label;
    heading.append(icon, name);

    const detail = document.createElement('span');
    detail.className = 'elaris-respawn-destination-detail';
    detail.textContent = `Region ${choice.areaX}, ${choice.areaY} · ${safetyLabel(choice)}`;
    const action = document.createElement('span');
    action.className = 'elaris-respawn-destination-action';
    action.textContent = 'Awaken here';
    button.append(heading, detail, action);
    button.addEventListener('click', () => {
      const result = this.onChoose(choice.id);
      if (!result.ok) {
        this.feedback.textContent = result.message;
        return;
      }
      this.feedback.textContent = '';
      this.refresh(true);
    });
    return button;
  }

  private drawMap(
    pending: PendingRespawnState,
    choices: readonly RespawnDestination[],
    cache: DeathCacheView | null,
  ): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = '#09130f';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const discovered = new Set(this.state.questProgress.areaKeysVisited);
    discovered.add('0,0');
    discovered.add(pending.defeatedAreaKey);

    for (let areaY = WORLD_BOUNDS.minY; areaY <= WORLD_BOUNDS.maxY; areaY += 1) {
      for (let areaX = WORLD_BOUNDS.minX; areaX <= WORLD_BOUNDS.maxX; areaX += 1) {
        const key = `${areaX},${areaY}`;
        const left = this.areaLeft(areaX);
        const top = this.areaTop(areaY);
        ctx.fillStyle = discovered.has(key)
          ? areaPalette(describeArea(this.state.seed, areaX, areaY).theme).minimap
          : '#1d2822';
        ctx.fillRect(left, top, CELL_WIDTH + 0.5, CELL_HEIGHT + 0.5);
        if (!discovered.has(key)) {
          ctx.fillStyle = 'rgba(3, 8, 5, .32)';
          ctx.fillRect(left, top, CELL_WIDTH + 0.5, CELL_HEIGHT + 0.5);
        }
      }
    }

    ctx.strokeStyle = 'rgba(222,205,158,.16)';
    ctx.lineWidth = 1;
    for (let column = 0; column <= WORLD_AREA_COLUMNS; column += 1) {
      const x = MAP_INSET + column * CELL_WIDTH;
      ctx.beginPath(); ctx.moveTo(x, MAP_INSET); ctx.lineTo(x, MAP_INSET + GRID_SIZE); ctx.stroke();
    }
    for (let row = 0; row <= WORLD_AREA_ROWS; row += 1) {
      const y = MAP_INSET + row * CELL_HEIGHT;
      ctx.beginPath(); ctx.moveTo(MAP_INSET, y); ctx.lineTo(MAP_INSET + GRID_SIZE, y); ctx.stroke();
    }

    for (const choice of choices) {
      if (choice.kind === 'elaris') this.drawElaris(choice);
      else this.drawBed(choice);
    }
    if (cache) this.drawBeacon(cache);
    else this.drawDefeat(pending);

    ctx.strokeStyle = '#d0aa5d';
    ctx.lineWidth = 3;
    ctx.strokeRect(MAP_INSET - 2, MAP_INSET - 2, GRID_SIZE + 4, GRID_SIZE + 4);
    ctx.fillStyle = '#9cad9f';
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let x = WORLD_BOUNDS.minX; x <= WORLD_BOUNDS.maxX; x += 1) {
      ctx.fillText(String(x), this.areaLeft(x) + CELL_WIDTH / 2, MAP_INSET - 12);
    }
    for (let y = WORLD_BOUNDS.minY; y <= WORLD_BOUNDS.maxY; y += 1) {
      ctx.fillText(String(y), MAP_INSET - 12, this.areaTop(y) + CELL_HEIGHT / 2);
    }
  }

  private drawElaris(choice: RespawnDestination): void {
    const ctx = this.context;
    const { x, y } = this.markerPosition(choice);
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff4bd';
    ctx.font = '700 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('ELARIS', x, y - 8);
  }

  private drawBed(choice: RespawnDestination): void {
    const ctx = this.context;
    const { x, y } = this.markerPosition(choice);
    ctx.fillStyle = choice.safe ? '#d9b36c' : '#c78252';
    ctx.strokeStyle = '#2e2112';
    ctx.lineWidth = 1;
    ctx.fillRect(x - 5, y - 3, 10, 6);
    ctx.strokeRect(x - 5, y - 3, 10, 6);
    ctx.fillStyle = '#f3dca1';
    ctx.fillRect(x - 3.5, y - 2, 3, 4);
  }

  private drawDefeat(pending: PendingRespawnState): void {
    if (!this.inBounds(pending.defeatedAreaX, pending.defeatedAreaY)) return;
    const x = this.areaLeft(pending.defeatedAreaX) + pending.defeatedX / WORLD_PX * CELL_WIDTH;
    const y = this.areaTop(pending.defeatedAreaY) + pending.defeatedY / WORLD_PX * CELL_HEIGHT;
    const ctx = this.context;
    ctx.strokeStyle = '#ff7d6e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5);
    ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5);
    ctx.stroke();
  }

  /**
   * The beacon, drawn where the × used to be. It replaces the defeat cross
   * rather than sitting beside it: they mark the same spot, and the one worth
   * showing is the one the player can still do something about.
   */
  private drawBeacon(cache: DeathCacheView): void {
    if (!this.inBounds(cache.cache.areaX, cache.cache.areaY)) return;
    const x = this.areaLeft(cache.cache.areaX) + cache.cache.x / WORLD_PX * CELL_WIDTH;
    const y = this.areaTop(cache.cache.areaY) + cache.cache.y / WORLD_PX * CELL_HEIGHT;
    drawBeaconMarker(this.context, x, y, 7);
  }

  private markerPosition(choice: RespawnDestination): { x: number; y: number } {
    return {
      x: this.areaLeft(choice.areaX) + choice.x / WORLD_PX * CELL_WIDTH,
      y: this.areaTop(choice.areaY) + choice.y / WORLD_PX * CELL_HEIGHT,
    };
  }

  private inBounds(x: number, y: number): boolean {
    return x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX
      && y >= WORLD_BOUNDS.minY && y <= WORLD_BOUNDS.maxY;
  }

  private areaLeft(areaX: number): number {
    return MAP_INSET + (areaX - WORLD_BOUNDS.minX) * CELL_WIDTH;
  }

  private areaTop(areaY: number): number {
    return MAP_INSET + (areaY - WORLD_BOUNDS.minY) * CELL_HEIGHT;
  }
}

function causeText(pending: PendingRespawnState): string {
  const cause = pending.cause === 'raider'
    ? 'Raiders cut you down'
    : pending.cause === 'creature'
      ? 'A wild creature defeated you'
      : pending.cause === 'arcane-storm'
        ? 'The Arcane Storm struck you down'
        : 'The poison fog overcame you';
  return `${cause} in ${pending.defeatedAreaName}.`;
}

function safetyLabel(destination: RespawnDestination): string {
  if (destination.kind === 'elaris') return 'Permanent sanctuary';
  if (destination.safe) return 'Purified shelter';
  if (destination.sheltered) return 'Sheltered · air unpurified';
  return 'Exposed bed';
}

function ensureRespawnStyles(): void {
  if (document.getElementById('elaris-respawn-styles')) return;
  const style = document.createElement('style');
  style.id = 'elaris-respawn-styles';
  style.textContent = `
.elaris-respawn-overlay {
  position: fixed; inset: 0; z-index: 150; display: none; align-items: center; justify-content: center;
  box-sizing: border-box;
  padding: max(14px, env(safe-area-inset-top)) max(14px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left));
  background: radial-gradient(circle at 50% 42%, rgba(34,49,39,.88), rgba(3,7,5,.97));
  backdrop-filter: blur(4px); color: var(--elaris-ink); pointer-events: auto;
}
.elaris-respawn-dialog {
  width: min(780px, 100%); max-height: 100%; overflow: auto; box-sizing: border-box; padding: 14px;
  background: linear-gradient(#203328, #111b15) !important;
}
.elaris-respawn-header { text-align: center; margin-bottom: 12px; }
.elaris-respawn-eyebrow { color: #c8a95c; font: 800 10px/1.2 system-ui,sans-serif; letter-spacing: .16em; text-transform: uppercase; }
.elaris-respawn-header h2 { margin: 3px 0 4px; color: #ffe08a; font: 800 clamp(22px,5vw,30px)/1.1 "Trebuchet MS",system-ui,sans-serif; }
.elaris-respawn-cause { color: #f1e7cf; font: 600 13px/1.35 system-ui,sans-serif; }
.elaris-respawn-loss { margin-top: 3px; color: #d79b7e; font: 600 11px/1.3 system-ui,sans-serif; }
.elaris-respawn-body { display: grid; grid-template-columns: minmax(250px,.92fr) minmax(280px,1.08fr); gap: 14px; align-items: start; }
.elaris-respawn-map { padding: 7px; border: 3px double #9b7b3c; background: #09110d; box-shadow: inset 0 0 18px rgba(0,0,0,.75); }
.elaris-respawn-map canvas { display: block; width: 100%; height: auto; aspect-ratio: 1; image-rendering: pixelated; }
.elaris-respawn-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 12px; margin-top: 6px; font: 700 10px system-ui,sans-serif; }
.elaris-respawn-legend .safe { color: #ffe08a; } .elaris-respawn-legend .bed { color: #d9b36c; }
.elaris-respawn-legend .defeat { color: #ff8a7b; } .elaris-respawn-legend .beacon { color: #8fd9ff; }
.elaris-respawn-choices { min-width: 0; }
.elaris-respawn-choices > strong { display: block; color: #ffe08a; font: 800 15px system-ui,sans-serif; }
.elaris-respawn-hint { margin: 4px 0 8px; color: var(--elaris-ink-muted); font: 11px/1.35 system-ui,sans-serif; }
.elaris-respawn-destinations { display: grid; gap: 8px; max-height: 380px; overflow: auto; padding: 2px 4px 3px 2px; }
.elaris-respawn-destination { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 3px 9px; width: 100%; min-height: 62px; padding: 8px 9px !important; text-align: left; cursor: pointer; }
.elaris-respawn-destination-heading { display: flex; align-items: center; gap: 7px; min-width: 0; color: #ffe08a; }
.elaris-respawn-destination-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.elaris-respawn-destination-detail { grid-column: 1; color: #c4d0c5; font: 10px/1.25 system-ui,sans-serif; }
.elaris-respawn-destination-action { grid-column: 2; grid-row: 1 / span 2; align-self: center; color: #fff2c3; font: 800 10px system-ui,sans-serif; text-transform: uppercase; letter-spacing: .05em; }
.elaris-respawn-feedback { min-height: 17px; margin-top: 6px; color: #ff9a8d; font: 600 11px system-ui,sans-serif; }
@media (max-width: 600px) {
  .elaris-respawn-dialog { padding: 11px; }
  .elaris-respawn-body { grid-template-columns: minmax(0,1fr); }
  .elaris-respawn-map { width: min(100%, 350px); box-sizing: border-box; margin: 0 auto; }
  .elaris-respawn-destinations { max-height: none; }
}
@media (max-height: 520px) and (min-width: 601px) {
  .elaris-respawn-dialog { padding: 9px 11px; }
  .elaris-respawn-header { margin-bottom: 7px; }
  .elaris-respawn-header h2 { font-size: 21px; }
  .elaris-respawn-body { grid-template-columns: minmax(210px,.76fr) minmax(300px,1.24fr); gap: 10px; }
  .elaris-respawn-map canvas { max-height: 225px; width: auto; max-width: 100%; margin: 0 auto; }
  .elaris-respawn-destinations { max-height: 210px; }
}
`;
  document.head.append(style);
}
