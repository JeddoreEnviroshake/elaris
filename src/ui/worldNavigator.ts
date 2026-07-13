import { WORLD_PX, WORLD_TILES } from '../config/platform';
import type { GameState, ResourceNodeState } from '../simulation/state';

const MAP_SIZE = 112;

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
  private readonly coordinates: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private lastDrawAt = 0;

  constructor(parent: HTMLElement, private readonly state: GameState) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      top: 'calc(env(safe-area-inset-top) + 48px)',
      left: 'calc(env(safe-area-inset-left) + 8px)',
      width: `${MAP_SIZE}px`,
      padding: '5px',
      borderRadius: '9px',
      background: 'rgba(9,20,14,0.84)',
      border: '1px solid rgba(255,255,255,0.16)',
      boxShadow: '0 3px 12px rgba(0,0,0,0.3)',
      color: '#e8f0ea',
      font: '600 11px system-ui, sans-serif',
      fontVariantNumeric: 'tabular-nums',
      pointerEvents: 'none',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);

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
    this.root.append(this.canvas, this.coordinates);
    parent.appendChild(this.root);
    this.refresh(true);
  }

  /** Called every frame; the small map itself redraws at most eight times/sec. */
  refresh(force = false): void {
    const { x, y } = worldCoordinates(this.state.player.x, this.state.player.y);
    this.coordinates.textContent = `X ${x}  Y ${y}`;
    const now = performance.now();
    if (!force && now - this.lastDrawAt < 125) return;
    this.lastDrawAt = now;
    this.draw();
  }

  destroy(): void {
    this.root.remove();
  }

  private draw(): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.fillStyle = '#315b3e';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // A subtle grid makes the 160-tile coordinate system legible without noise.
    ctx.strokeStyle = 'rgba(232,240,234,0.14)';
    ctx.lineWidth = 1;
    for (let tile = 40; tile < WORLD_TILES; tile += 40) {
      const p = Math.round(tile / WORLD_TILES * MAP_SIZE) + 0.5;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, MAP_SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(MAP_SIZE, p); ctx.stroke();
    }

    for (const node of this.state.resourceNodes) this.drawNode(node);
    for (const building of this.state.buildings) {
      ctx.fillStyle = '#d9b36c';
      ctx.fillRect(building.tileX / WORLD_TILES * MAP_SIZE - 1, building.tileY / WORLD_TILES * MAP_SIZE - 1, 3, 3);
    }
    for (const creature of this.state.wildCreatures) this.dot(creature.x, creature.y, '#b995df', 2);
    this.dot(this.state.player.x, this.state.player.y, '#fff4bd', 3);
  }

  private drawNode(node: ResourceNodeState): void {
    const color = node.hp <= 0 ? '#617165' : node.kind === 'tree' ? '#123d25' : node.kind === 'stone' ? '#9ca8a0' : '#86bd5f';
    this.dot(node.x, node.y, color, 1);
  }

  private dot(x: number, y: number, color: string, size: number): void {
    this.context.fillStyle = color;
    this.context.fillRect(Math.round(x / WORLD_PX * MAP_SIZE) - Math.floor(size / 2), Math.round(y / WORLD_PX * MAP_SIZE) - Math.floor(size / 2), size, size);
  }
}
