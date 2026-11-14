import type { InteriorDefinition, InteriorHotspot, InteriorProp } from '../content/interiors';
import type { InteriorPose } from '../presentation/interiorSession';
import { div } from './controls';
import { npcDefinition } from '../content/npcs';
import { townBuildingById } from '../content/townBuildings';
import { TILE_SIZE } from '../config/platform';
import { TextureKeys } from '../art/textureKeys';
import {
  interiorFloorTextureKey, interiorNpcTextureKey, interiorPropFootprint, interiorPropTextureKey,
  interiorWallTextureKey, isGlowingProp, type InteriorFacingKey,
} from '../art/interiorTextures';

/** Resolves a generated Phaser texture to a data URL the DOM can paint. */
export type InteriorTextureResolver = (key: string) => string | null;

/**
 * A node laid out from room coordinates. Sprites stand on a tile with their feet
 * at its centre; pips are floor decals centred on the tile.
 */
interface Placement {
  readonly node: HTMLElement;
  /** `tile` fills its whole tile (a doorway); `pip` is a small floor decal. */
  readonly kind: 'sprite' | 'pip' | 'tile';
  x: number;
  y: number;
}

/** Source pixel dimensions of the shared 24×32 character sprites. */
const CHARACTER_PX = { width: 24, height: 32 } as const;
/** Fraction down the character sprite where its feet meet the floor. */
const CHARACTER_FOOT = 29 / CHARACTER_PX.height;

/** Upper zoom bound, matching the world camera's own top tier. */
const MAX_TILE_ZOOM = 4;

function facingKey(facing: InteriorPose['facing']): InteriorFacingKey {
  return facing === 'up' ? 'up' : facing === 'down' ? 'down' : 'side';
}

function playerTextureKey(facing: InteriorPose['facing']): string {
  if (facing === 'up') return TextureKeys.PlayerIdleUp;
  if (facing === 'down') return TextureKeys.PlayerIdleDown;
  return TextureKeys.PlayerIdleSide;
}

/**
 * Playable top-down interior drawn from the same definition as the 3D room, in
 * the world's own art: a tiled floor, a wall band, footprint-sized pixel props,
 * and the overworld player sprite. Layout is an integer tile zoom so the pixels
 * stay as crisp as they are outside the door.
 */
export class InteriorFallback {
  private readonly root: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly room: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly player: HTMLDivElement;
  private readonly playerPlacement: Placement;
  private definition: InteriorDefinition | null = null;
  private hotspotNodes = new Map<string, HTMLDivElement>();
  private placements: Placement[] = [];
  private propNodes: Array<{ node: HTMLElement; prop: InteriorProp }> = [];
  private themeGlow = '#ff8a3d';
  private tileZoom = 2;
  /**
   * A room built before the scene finished generating its textures would keep
   * flat theme colors forever, so an incomplete build is retried on next open.
   */
  private artComplete = false;
  private readonly textureCache = new Map<string, string>();
  private readonly onResize = () => { if (this.definition) this.applyLayout(this.definition); };

  constructor(parent: HTMLElement, private readonly resolveTexture: InteriorTextureResolver) {
    this.root = div({
      position: 'absolute', inset: '0', zIndex: '3', display: 'none', pointerEvents: 'none',
      overflow: 'hidden', color: '#ffe4be', background: '#0b0908',
      font: '700 11px/1.2 "Trebuchet MS", system-ui, sans-serif',
    });
    this.root.dataset.testid = 'playable-interior';
    this.frame = div({
      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
      imageRendering: 'pixelated', boxShadow: '0 26px 80px rgba(0,0,0,.75)',
    });
    this.room = div({ position: 'relative', imageRendering: 'pixelated' });
    this.title = div({
      position: 'absolute', left: '50%', top: '0', transform: 'translate(-50%, -120%)', zIndex: '10',
      padding: '3px 10px', whiteSpace: 'nowrap', letterSpacing: '.5px',
      borderRadius: '3px', fontSize: 'clamp(12px, 1.6vw, 17px)', textShadow: '0 2px 4px #000',
      background: 'rgba(11,18,14,.82)',
    });
    this.frame.appendChild(this.title);
    this.player = this.sprite(playerTextureKey('down'));
    this.player.style.zIndex = '8';
    this.playerPlacement = { node: this.player, kind: 'sprite', x: 0, y: 0 };
    this.frame.appendChild(this.room);
    this.root.append(this.frame);
    parent.appendChild(this.root);
    window.addEventListener('resize', this.onResize);
  }

  open(definition: InteriorDefinition): void {
    if (this.definition?.id !== definition.id || !this.artComplete) this.build(definition);
    this.root.style.display = 'block';
    this.root.setAttribute('aria-label', definition.displayName);
    this.applyLayout(definition);
  }

  update(pose: InteriorPose, focusedHotspotId: string | null): void {
    const definition = this.definition;
    if (!definition) return;
    this.setSpriteTexture(this.player, playerTextureKey(pose.facing));
    this.player.style.transform = pose.facing === 'left' ? 'scaleX(-1)' : 'none';
    this.playerPlacement.x = pose.x;
    this.playerPlacement.y = pose.y;
    this.place(this.playerPlacement);
    for (const [id, node] of this.hotspotNodes) {
      const focused = id === focusedHotspotId;
      node.style.opacity = focused ? '1' : '.45';
      node.style.filter = focused ? 'brightness(1.45)' : 'none';
      node.style.boxShadow = focused ? `0 0 0 2px #fff1a8, 0 0 18px ${this.themeGlow}` : 'none';
    }
  }

  close(): void {
    this.root.style.display = 'none';
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }

  private build(definition: InteriorDefinition): void {
    this.definition = definition;
    this.hotspotNodes.clear();
    this.placements = [];
    this.propNodes = [];
    this.artComplete = true;
    const theme = townBuildingById(definition.buildingId).interiorTheme;
    this.themeGlow = theme.glow;
    const wall = this.tiled(interiorWallTextureKey(theme.id));
    const floor = this.tiled(interiorFloorTextureKey(theme.id));
    this.frame.style.background = wall ?? theme.background;
    this.frame.style.backgroundColor = theme.background;
    this.room.style.background = floor ?? theme.surface;
    this.room.style.backgroundColor = theme.surface;
    // The wall band casts onto the floor, the way the world shades a building edge.
    this.room.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,.55), inset 0 6px 14px rgba(0,0,0,.45), inset 0 -4px 10px rgba(0,0,0,.35)';
    this.room.replaceChildren();

    this.title.textContent = definition.displayName;
    this.title.style.color = theme.ink;
    this.title.style.border = `2px solid ${theme.accent}`;

    for (const prop of definition.props) {
      const node = div({ position: 'absolute', imageRendering: 'pixelated' });
      const painted = this.background(interiorPropTextureKey(prop.prefab));
      node.style.background = painted ?? theme.background;
      node.style.backgroundSize = '100% 100%';
      node.style.transform = propTransform(prop);
      if (isGlowingProp(prop.prefab)) node.style.filter = `drop-shadow(0 0 10px ${theme.glow})`;
      this.propNodes.push({ node, prop });
      this.room.appendChild(node);
    }

    for (const npc of definition.npcSpawns) {
      const character = npcDefinition(npc.npcId);
      const node = this.sprite(interiorNpcTextureKey(npc.npcId, facingKey(npc.facing)));
      node.dataset.activity = npc.activity;
      node.title = character.name;
      node.setAttribute('aria-label', character.name);
      node.style.zIndex = '7';
      if (npc.facing === 'left') node.style.transform = 'scaleX(-1)';
      this.placements.push({ node, kind: 'sprite', x: npc.tileX + 0.5, y: npc.tileY + 0.5 });
      this.room.appendChild(node);
    }

    for (const hotspot of definition.hotspots) {
      const node = this.hotspotMarker(hotspot);
      this.hotspotNodes.set(hotspot.id, node);
      this.placements.push({
        node,
        kind: hotspot.kind === 'exit' ? 'tile' : 'pip',
        x: hotspot.tileX + 0.5,
        y: hotspot.tileY + 0.5,
      });
      this.room.appendChild(node);
    }

    this.playerPlacement.x = definition.playerSpawn.tileX + 0.5;
    this.playerPlacement.y = definition.playerSpawn.tileY + 0.5;
    this.placements.push(this.playerPlacement);
    this.room.appendChild(this.player);
  }

  /**
   * Size everything from one tile zoom, chosen so the room plus its wall band
   * fits the viewport. Zoom snaps to half steps: whole 16px tiles either way, so
   * no source pixel ever lands on a fraction of a screen pixel — a phone gets a
   * room half again as large as a strict integer tier would allow.
   */
  private applyLayout(definition: InteriorDefinition): void {
    const viewportWidth = this.root.clientWidth || window.innerWidth;
    const viewportHeight = this.root.clientHeight || window.innerHeight;
    const tilesWide = definition.dimensions.tilesWide + 2;
    const tilesHigh = definition.dimensions.tilesHigh + 2;
    const fitting = Math.floor(Math.min(
      (viewportWidth * 0.94) / (tilesWide * TILE_SIZE),
      (viewportHeight * 0.82) / (tilesHigh * TILE_SIZE),
    ) * 2) / 2;
    this.tileZoom = Math.max(1, Math.min(MAX_TILE_ZOOM, fitting));
    const tile = this.tileZoom * TILE_SIZE;
    this.frame.style.padding = `${tile}px`;
    this.frame.style.backgroundSize = `${tile}px ${tile}px`;
    this.room.style.width = `${definition.dimensions.tilesWide * tile}px`;
    this.room.style.height = `${definition.dimensions.tilesHigh * tile}px`;
    this.room.style.backgroundSize = `${tile}px ${tile}px`;
    for (const { node, prop } of this.propNodes) {
      const footprint = interiorPropFootprint(prop.prefab);
      const width = footprint.tilesWide * tile;
      const height = footprint.tilesHigh * tile;
      node.style.width = `${width}px`;
      node.style.height = `${height}px`;
      const originX = footprint.centered ? (prop.tileX + 0.5) * tile - width / 2 : prop.tileX * tile;
      const originY = footprint.centered ? (prop.tileY + 0.5) * tile - height / 2 : prop.tileY * tile;
      node.style.left = `${Math.round(originX)}px`;
      node.style.top = `${Math.round(originY)}px`;
    }
    for (const placement of this.placements) this.place(placement);
  }

  private place(placement: Placement): void {
    const tile = this.tileZoom * TILE_SIZE;
    if (placement.kind === 'sprite') {
      const width = CHARACTER_PX.width * this.tileZoom;
      const height = CHARACTER_PX.height * this.tileZoom;
      placement.node.style.width = `${width}px`;
      placement.node.style.height = `${height}px`;
      placement.node.style.left = `${Math.round(placement.x * tile - width / 2)}px`;
      placement.node.style.top = `${Math.round(placement.y * tile - height * CHARACTER_FOOT)}px`;
      return;
    }
    const size = Math.round(tile * (placement.kind === 'tile' ? 1 : 0.38));
    placement.node.style.width = `${size}px`;
    placement.node.style.height = `${size}px`;
    placement.node.style.left = `${Math.round(placement.x * tile - size / 2)}px`;
    placement.node.style.top = `${Math.round(placement.y * tile - size / 2)}px`;
  }

  private sprite(textureKey: string): HTMLDivElement {
    const node = div({
      position: 'absolute', imageRendering: 'pixelated', backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat', transformOrigin: 'center',
    });
    this.setSpriteTexture(node, textureKey);
    return node;
  }

  private setSpriteTexture(node: HTMLElement, textureKey: string): void {
    if (node.dataset.texture === textureKey) return;
    const painted = this.background(textureKey);
    if (!painted) {
      this.artComplete = false;
      return;
    }
    node.dataset.texture = textureKey;
    node.style.background = painted;
    node.style.backgroundSize = '100% 100%';
    node.style.backgroundRepeat = 'no-repeat';
  }

  /**
   * Interaction pips: the exit paints the world's own door, and service or
   * examine points get a small themed floor decal that lights when focused.
   */
  private hotspotMarker(hotspot: InteriorHotspot): HTMLDivElement {
    const node = div({
      position: 'absolute', imageRendering: 'pixelated', zIndex: '6', borderRadius: '2px',
      transition: 'opacity 120ms, box-shadow 120ms, filter 120ms',
    });
    node.title = hotspot.label;
    node.setAttribute('aria-label', hotspot.label);
    node.dataset.hotspotKind = hotspot.kind;
    if (hotspot.kind === 'exit') {
      const door = this.background(TextureKeys.DoorWood);
      if (door) {
        node.style.background = door;
        node.style.backgroundSize = '100% 100%';
      } else node.style.background = '#415f74';
    } else {
      // A small floor diamond, the way the world marks an interaction point:
      // present enough to aim at, quiet enough not to read as an object.
      const accent = hotspot.kind === 'service' ? '#ffd07a' : '#9fd7ff';
      node.style.background = `linear-gradient(${accent}, rgba(0,0,0,0))`;
      node.style.border = `2px solid ${accent}`;
      node.style.transform = 'rotate(45deg)';
    }
    node.style.opacity = '.45';
    return node;
  }

  private tiled(key: string): string | null {
    const painted = this.background(key);
    return painted ? `${painted} repeat` : null;
  }

  /** Cache hits only on success: a texture generated later still gets painted. */
  private background(key: string): string | null {
    const cached = this.textureCache.get(key);
    if (cached) return `url("${cached}")`;
    const resolved = this.resolveTexture(key);
    if (!resolved) {
      this.artComplete = false;
      return null;
    }
    this.textureCache.set(key, resolved);
    return `url("${resolved}")`;
  }
}

/**
 * Authored rotations only ever face a prop at the room, so mirroring carries
 * them: 270° is the opposite wall from 90°, and 180° turns a bench around.
 */
function propTransform(prop: InteriorProp): string {
  if (prop.rotationDegrees === 270) return 'scaleX(-1)';
  if (prop.rotationDegrees === 180) return 'scaleY(-1)';
  return 'none';
}
