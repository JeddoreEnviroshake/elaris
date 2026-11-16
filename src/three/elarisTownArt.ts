import * as THREE from 'three';
import { TILE_SIZE } from '../config/platform';
import { isRoadTile } from '../content/roads';
import { townBuildingAtTile, type TownBuildingDefinition, type TownBuildingId } from '../content/townBuildings';
import { isWithinTownSafeZoneWorldPosition } from '../content/townDefences';
import { townBuildingShell } from '../content/interiors';
import { Sculpt, type Point } from './characterSculpt';
import type { QuaterniusArt } from './quaterniusArt';

/** Presentation only: the existing roads turn to stone inside Elaris's gates. */
export function isElarisStoneStreetTile(areaKey: string, x: number, z: number): boolean {
  return areaKey === '0,0' && isRoadTile(areaKey, x, z)
    && isWithinTownSafeZoneWorldPosition((x + .5) * TILE_SIZE, (z + .5) * TILE_SIZE)
    && !townBuildingAtTile(x, z, areaKey);
}

/** Local +z faces the street; local x runs along the entrance's wall. */
export function elarisEntranceFrame(building: TownBuildingDefinition): {
  x: number; z: number; rotation: number; signSide: number;
} {
  const shell = townBuildingShell(building);
  const { side, along } = shell.door;
  const horizontal = side === 'north' || side === 'south';
  const rotation = side === 'north' ? Math.PI : side === 'west' ? -Math.PI / 2 : side === 'east' ? Math.PI / 2 : 0;
  const x = (horizontal ? along : side === 'west' ? shell.left : shell.right) - shell.tilesWide / 2;
  const z = (horizontal ? side === 'north' ? shell.top : shell.bottom : along) - shell.tilesHigh / 2;
  const alongFacade = x * Math.cos(rotation) - z * Math.sin(rotation);
  return { x, z, rotation, signSide: alongFacade > 0 ? -1 : 1 };
}

const WOOD = 0x765338, DARK_WOOD = 0x49382a, IRON = 0x4d5957, BRASS = 0xc7a55d;
const box = (s: Sculpt, at: Point, size: Point, color = WOOD, rotation: Point = [0, 0, 0]): void => {
  s.add(new THREE.BoxGeometry(...size), color, at, [1, 1, 1], rotation);
};

function bench(s: Sculpt, x: number): void {
  for (const z of [.42, .62, .82]) box(s, [x, .48, z], [1.4, .1, .18]);
  for (const dx of [-.52, .52]) {
    box(s, [x + dx, .24, .62], [.12, .48, .52], DARK_WOOD);
    box(s, [x + dx, .65, .38], [.09, .76, .09], DARK_WOOD);
  }
  box(s, [x, .84, .38], [1.4, .22, .08]);
}

function barrel(s: Sculpt, x: number, z: number, height = .72): void {
  s.loft([[0, .25, .25], [.06, .29, .29], [height * .5, .34, .34], [height - .06, .29, .29],
    [height, .25, .25]], WOOD, [x, 0, z], 'y', 12);
  s.add(new THREE.CylinderGeometry(.25, .25, .04, 12), DARK_WOOD, [x, height, z]);
  for (const y of [height * .18, height * .82]) {
    s.add(new THREE.TorusGeometry(.30, .025, 4, 12), IRON, [x, y, z], [1, 1, 1], [Math.PI / 2, 0, 0]);
  }
}

function shield(s: Sculpt, x: number, y: number, z: number, color: number): void {
  const shape = new THREE.Shape();
  shape.moveTo(-.27, .32); shape.lineTo(.27, .32); shape.lineTo(.25, -.08);
  shape.quadraticCurveTo(.2, -.3, 0, -.42); shape.quadraticCurveTo(-.2, -.3, -.25, -.08); shape.closePath();
  s.add(new THREE.ExtrudeGeometry(shape, { depth: .065, bevelEnabled: false }), color, [x, y, z]);
  box(s, [x, y - .015, z + .077], [.045, .56, .025], BRASS);
  box(s, [x, y + .1, z + .08], [.4, .045, .025], BRASS);
  s.ellipsoid([x, y + .04, z + .1], [.075, .075, .045], IRON);
}

function sword(s: Sculpt, x: number, z: number, angle: number): void {
  const shape = new THREE.Shape();
  shape.moveTo(-.065, .44); shape.lineTo(.065, .44); shape.lineTo(.065, 1.13); shape.lineTo(0, 1.3);
  shape.lineTo(-.065, 1.13); shape.closePath();
  // Use a simple extrusion for a readable pointed steel blade.
  const rotation: Point = [0, 0, angle];
  s.add(new THREE.ExtrudeGeometry(shape, { depth: .035, bevelEnabled: false }), 0xc8d0c9, [x, 0, z], [1, 1, 1], rotation);
  const rotateAt = (px: number, py: number): Point => [x + px * Math.cos(angle) - py * Math.sin(angle), px * Math.sin(angle) + py * Math.cos(angle), z];
  box(s, rotateAt(0, .39), [.38, .055, .09], BRASS, rotation);
  box(s, rotateAt(0, .25), [.08, .24, .07], DARK_WOOD, rotation);
}

function produceStand(s: Sculpt, x: number): void {
  for (const dx of [-.55, .55]) box(s, [x + dx, .3, .55], [.1, .6, .55], DARK_WOOD);
  box(s, [x, .62, .55], [1.3, .1, .64]);
  for (const dx of [-.34, .34]) {
    box(s, [x + dx, .7, .55], [.57, .1, .55], DARK_WOOD);
    for (const dz of [-.25, .25]) box(s, [x + dx, .79, .55 + dz], [.61, .18, .045]);
    for (const edge of [-.27, .27]) box(s, [x + dx + edge, .79, .55], [.045, .18, .5]);
    for (let i = 0; i < 6; i++) {
      const px = x + dx + (i % 3 - 1) * .15, pz = .43 + Math.floor(i / 3) * .19;
      s.ellipsoid([px, .86, pz], [.085, .085, .08], dx < 0 ? 0xad4938 : 0xa0a84e);
      box(s, [px, .95, pz], [.017, .04, .017], DARK_WOOD);
    }
  }
}

function planter(s: Sculpt, x: number): void {
  s.add(new THREE.CylinderGeometry(.33, .23, .42, 10), 0x9b7656, [x, .21, .56]);
  s.add(new THREE.CylinderGeometry(.29, .29, .025, 10), 0x3e392c, [x, .43, .56]);
  for (let i = 0; i < 5; i++) {
    const dx = Math.cos(i * 2.4) * .18, dz = Math.sin(i * 2.4) * .18;
    box(s, [x + dx, .61, .56 + dz], [.025, .36, .025], 0x52643b);
    s.ellipsoid([x + dx, .83, .56 + dz], [.105, .07, .1], i % 2 ? 0xe4cd89 : 0xddd7bd);
    s.ellipsoid([x + dx, .86, .56 + dz], [.04, .025, .04], BRASS);
  }
}

function entranceProps(parent: THREE.Group, id: TownBuildingId, side: number): void {
  const s = new Sculpt('compact');
  switch (id) {
    case 'weaponsmith':
      // A tool display opposite the forge opening, clear of its working hearth.
      for (const x of [1.35, 2.45]) box(s, [x, .65, .42], [.09, 1.3, .1], DARK_WOOD);
      for (const y of [.3, 1.05]) box(s, [1.9, y, .42], [1.2, .1, .1]);
      for (const [x, lean] of [[1.65, -.13], [2.12, .13]] as const) sword(s, x, .51, lean);
      break;
    case 'armoury':
      for (const x of [-.57, .57]) box(s, [side * 1.95 + x, .65, .48], [.11, 1.3, .13], DARK_WOOD);
      box(s, [side * 1.95, 1.12, .48], [1.3, .12, .13]);
      shield(s, side * 1.95 - .3, .75, .56, 0x627e79);
      shield(s, side * 1.95 + .3, .75, .56, 0x956252);
      break;
    case 'market': produceStand(s, side * 2.05); break;
    case 'tavern': bench(s, side * 2.05); barrel(s, -side * 1.75, .65); break;
    case 'church':
      bench(s, -side * 1.9); planter(s, side * 1.65);
      break;
    case 'arena': {
      const x = side * 3.8;
      box(s, [x, .85, .7], [.13, 1.7, .13], DARK_WOOD);
      for (const dx of [-.35, .35]) box(s, [x + dx, .18, .85], [.09, .5, .09], WOOD, [0, 0, dx]);
      for (const [radius, color] of [[.52, 0xba9b65], [.36, 0x9a5140], [.22, 0xd8be86], [.085, 0x9a5140]] as const) {
        s.add(new THREE.CylinderGeometry(radius, radius, .045, 20), color, [x, 1.27, .77 + (.52 - radius) * .1], [1, 1, 1], [Math.PI / 2, 0, 0]);
      }
      barrel(s, -side * 2.2, .65, .6);
      for (const dx of [-.13, .13]) {
        box(s, [-side * 2.2 + dx, .9, .65], [.045, 1, .045], WOOD, [0, 0, dx]);
      }
      break;
    }
    default: return;
  }
  s.finish(parent, `entrance-props.${id}`);
}

/** Hand-drawn emblems remain crisp and independent of platform emoji fonts. */
function drawEmblem(c: CanvasRenderingContext2D, id: TownBuildingId): void {
  c.save(); c.translate(125, 152); c.scale(1.1, 1.1);
  c.strokeStyle = '#edcf88'; c.fillStyle = '#edcf88'; c.lineWidth = 8; c.lineCap = 'round'; c.lineJoin = 'round';
  const line = (points: readonly (readonly [number, number])[]): void => {
    c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
  };
  const blade = (): void => {
    c.beginPath(); c.moveTo(-9, -6); c.lineTo(-9, -57); c.lineTo(0, -73); c.lineTo(9, -57); c.lineTo(9, -6); c.closePath(); c.fill();
    line([[-22, 0], [22, 0]]); line([[0, 4], [0, 31]]);
  };
  switch (id) {
    case 'weaponsmith':
      c.fillRect(-53, 20, 87, 16); c.fillRect(-27, 32, 38, 25); c.fillRect(-41, 55, 66, 10);
      c.beginPath(); c.moveTo(34, 20); c.lineTo(67, 20); c.lineTo(35, 36); c.closePath(); c.fill();
      c.save(); c.rotate(-.5); c.fillRect(-5, -56, 10, 60); c.fillRect(-29, -68, 58, 24); c.restore();
      break;
    case 'armoury':
      c.beginPath(); c.moveTo(-47, -54); c.lineTo(47, -54); c.lineTo(43, 12); c.quadraticCurveTo(32, 47, 0, 65);
      c.quadraticCurveTo(-32, 47, -43, 12); c.closePath(); c.stroke();
      line([[0, -37], [0, 41]]); line([[-26, -8], [26, -8]]); break;
    case 'market':
      line([[0, -59], [0, 55], [-35, 55], [35, 55]]); line([[-58, -34], [58, -34]]);
      for (const x of [-43, 43]) {
        line([[x, -34], [x - 22, 18], [x + 22, 18], [x, -34]]);
        c.beginPath(); c.arc(x, 18, 22, 0, Math.PI); c.fill();
      }
      break;
    case 'tavern':
      c.strokeRect(-40, -33, 63, 87); c.beginPath(); c.arc(25, 8, 28, -Math.PI / 2, Math.PI / 2); c.stroke();
      for (const x of [-25, -5, 15]) { c.beginPath(); c.arc(x, -40, 15, 0, Math.PI * 2); c.fill(); }
      break;
    case 'church':
      c.beginPath(); c.arc(0, 0, 29, 0, Math.PI * 2); c.stroke();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line([[Math.cos(a) * 43, Math.sin(a) * 43], [Math.cos(a) * 62, Math.sin(a) * 62]]); }
      break;
    case 'arena':
      for (const a of [-.68, .68]) { c.save(); c.translate(0, 16); c.rotate(a); blade(); c.restore(); }
      break;
    default: break;
  }
  c.restore();
}

function signTexture(building: TownBuildingDefinition, ruined: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 304;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#303b32'; c.fillRect(0, 0, 768, 304);
  // Quiet timber grain, with a contrasting painted rim and lettering.
  c.strokeStyle = '#384237'; c.lineWidth = 3;
  for (let y = 15; y < 304; y += 17) {
    c.beginPath(); c.moveTo(12, y); c.bezierCurveTo(245, y - 8, 493, y + 7, 756, y); c.stroke();
  }
  c.strokeStyle = '#c7a55d'; c.lineWidth = 6; c.strokeRect(12, 12, 744, 280);
  c.lineWidth = 2; c.strokeRect(23, 23, 722, 258);
  drawEmblem(c, building.id);
  c.fillStyle = '#f7edcf'; c.textAlign = 'center'; c.textBaseline = 'middle';
  const name = building.displayName;
  let size = 63;
  do { c.font = `bold ${size--}px Georgia, serif`; } while (c.measureText(name).width > 465 && size > 24);
  c.fillText(name, 490, ruined ? 130 : 150);
  c.fillStyle = '#d1b777'; c.font = '24px Georgia, serif';
  c.fillText(ruined ? 'RUINED' : 'E L A R I S', 490, 218);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

/** Physical facade signs survive view changes; all dressing is outside the doorway. */
export function addElarisEntranceArt(parent: THREE.Group, building: TownBuildingDefinition, ruined: boolean, _art: QuaterniusArt): void {
  if (building.areaKey !== '0,0') return;
  const frame = elarisEntranceFrame(building);
  const root = new THREE.Group(); root.name = `entrance-art.${building.id}`;
  root.position.set(frame.x, 0, frame.z); root.rotation.y = frame.rotation;
  parent.add(root);
  const sign = new THREE.Group(); sign.name = `building-sign.${building.id}`;
  sign.userData.buildingName = building.displayName;
  // The tavern's diagonal porch braces hide a wall plaque; its sign stands
  // on the street side of the porch instead.
  const postMounted = building.id === 'arena' || building.id === 'tavern';
  sign.position.set(frame.signSide * (building.id === 'arena' ? 2.25 : 1.7), 1.96, building.id === 'tavern' ? 1.8 : .17);
  if (ruined) sign.rotation.z = .08;
  root.add(sign);
  const timber = new Sculpt('compact');
  box(timber, [0, 0, 0], [1.86, .79, .12], DARK_WOOD);
  // Metal corner studs ground the painted plaque in the building's materials.
  for (const x of [-.85, .85]) for (const y of [-.31, .31]) timber.ellipsoid([x, y, .075], [.025, .025, .018], BRASS);
  if (postMounted) box(timber, [0, -.98, -.06], [.12, 1.96, .12], WOOD);
  timber.finish(sign, 'building-sign.frame');
  const texture = signTexture(building, ruined);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.78, .70), new THREE.MeshStandardMaterial({
    map: texture, emissiveMap: texture, roughness: .9, emissive: 0xffffff, emissiveIntensity: .3,
  }));
  face.name = 'building-sign.lettering'; face.position.z = .065; sign.add(face);
  if (!ruined) {
    entranceProps(root, building.id, frame.signSide);
    // The bench outside the Weaponsmith is the town's public workbench, drawn
    // (and made usable) at ELARIS_PUBLIC_WORKBENCH_TILE by the renderer.
  }
}
