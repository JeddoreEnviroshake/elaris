import * as THREE from 'three';
import { Sculpt } from './characterSculpt';
import type { ToolKind, ToolDefinition } from '../config/balance';

export type FirstPersonTool = ToolKind | 'hands';
export type FirstPersonToolTier = ToolDefinition['tier'];

export interface FirstPersonArm {
  readonly root: THREE.Group;
  readonly open: THREE.Mesh;
  readonly grip: THREE.Mesh;
}

/** Close-range sleeves, stitched bracers, separate fingers and an opposed thumb. */
export function createFirstPersonArm(side: -1 | 1): FirstPersonArm {
  const root = new THREE.Group();
  root.name = side < 0 ? 'first-person.left-hand' : 'first-person.right-hand';
  const sleeve = new Sculpt();
  sleeve.loft([[-.46, .105, .10, .19], [-.38, .105, .10, .14], [-.23, .086, .083, .065],
    [-.13, .073, .069, .025], [-.10, .073, .069, .02]], 0x3e7367);
  sleeve.loft([[-.24, .088, .084, .068], [-.21, .087, .082, .06], [-.10, .074, .072, .02],
    [-.075, .073, .070, .015]], 0x75513b);
  for (const y of [-.19, -.13]) sleeve.tube([[-.071, y, .05], [0, y, .108], [.071, y, .05]],
    [.006, .006, .006], 0xd8cba7, 7, 5);
  sleeve.ellipsoid([side * .059, -.15, .073], [.014, .018, .006], 0xc5a366);
  sleeve.finish(root, 'first-person.sleeve-and-bracer');

  const hand = (open: boolean): THREE.Mesh => {
    const sculpt = new Sculpt();
    sculpt.ellipsoid([0, -.018, .015], [.064, .077, .038], 0xd1a27d);
    sculpt.ellipsoid([0, -.036, .045], [.062, .052, .012], 0x514638);
    for (let finger = 0; finger < 4; finger++) {
      if (open) {
        const x = (finger - 1.5) * .029;
        const length = finger === 0 || finger === 3 ? .075 : .097;
        sculpt.tube([[x, .025, .012], [x * 1.12, .071, -.008], [x * 1.17, .025 + length, -.025]],
          [.014, .012, .009], 0xd1a27d, 7, 7);
        sculpt.ellipsoid([x * 1.17, .025 + length, -.025], [.009, .012, .010], 0xd1a27d);
      } else {
        const y = -.049 + finger * .027;
        sculpt.tube([[side * .043, y, .008], [side * .045, y, -.04], [-side * .012, y, -.065]],
          [.014, .015, .012], 0xd1a27d, 7, 7);
        sculpt.ellipsoid([-side * .012, y, -.065], [.012, .013, .012], 0xd1a27d);
      }
    }
    sculpt.tube([[-side * .047, -.015, .022], [-side * .082, .022, open ? .002 : -.015],
      [-side * .053, .045, open ? -.018 : -.054]], [.022, .018, .014], 0xc99a75, 8, 8);
    return sculpt.finish(root, open ? 'first-person.open-palm' : 'first-person.tool-grip');
  };
  return { root, open: hand(true), grip: hand(false) };
}

export interface FirstPersonToolModel {
  readonly root: THREE.Group;
  readonly string?: THREE.Line;
  readonly arrow?: THREE.Group;
}

/** Painted tool silhouettes retain the same material tiers as the inventory. */
export function createFirstPersonTool(kind: Exclude<FirstPersonTool, 'hands'>, tier: FirstPersonToolTier): FirstPersonToolModel {
  const root = new THREE.Group();
  root.name = `first-person.tool-${kind}`;
  root.position.z = -.042;
  const wood = 0x795239, leather = 0x514032, brass = 0xc5a366;
  const edge = tier === 'wooden' ? 0xb08c56 : tier === 'stone' ? 0x858e88 : 0xb2bfbc;
  const core = tier === 'wooden' ? 0x79553a : tier === 'stone' ? 0x555f5c : 0x667b7c;
  const sculpt = new Sculpt();
  const haft = (bottom: number, top: number): void => {
    sculpt.loft([[bottom, 0, 0], [bottom + .015, .022, .023], [top, .018, .02], [top + .012, 0, 0]], wood);
    for (const y of [-.045, -.012, .021, .054]) sculpt.tube([[-.021, y, .004], [0, y, .025], [.021, y, .004]],
      [.005, .005, .005], leather, 5, 5);
  };
  if (kind === 'axe') {
    haft(-.20, .38);
    sculpt.ellipsoid([.035, .31, 0], [.075, .082, .045], core);
    sculpt.loft([[.20, .03, .023], [.22, .11, .027], [.31, .16, .025], [.40, .11, .025], [.42, .03, .02]],
      edge, [-.11, 0, 0], 'y', 8);
    sculpt.tube([[.045, .25, .03], [.05, .31, .041], [.045, .38, .03]], [.012, .014, .012], brass, 7, 6);
  } else if (kind === 'pick') {
    haft(-.22, .37);
    sculpt.tube([[-.30, .20, 0], [-.20, .31, 0], [0, .35, 0], [.20, .31, 0], [.30, .20, 0]],
      [.003, .025, .042, .025, .003], edge, 18, 8);
    sculpt.ellipsoid([0, .34, .012], [.045, .06, .044], core);
  } else if (kind === 'sickle') {
    haft(-.16, .20);
    sculpt.tube([[0, .18, 0], [-.14, .24, 0], [-.19, .36, 0], [-.12, .44, 0], [.02, .45, 0], [.12, .38, 0]],
      [.032, .038, .035, .028, .019, .001], edge, 23, 8);
  } else if (kind === 'sword') {
    haft(-.15, .13);
    sculpt.ellipsoid([0, -.17, 0], [.035, .036, .029], brass);
    sculpt.tube([[-.13, .12, .012], [0, .14, 0], [.13, .12, .012]], [.018, .022, .018], brass, 10, 7);
    sculpt.loft([[.15, .045, .018], [.20, .045, .018], [.52, .034, .012], [.64, 0, 0]], edge, [0, 0, 0], 'y', 4);
    sculpt.tube([[0, .18, .019], [0, .48, .013], [0, .56, .006]], [.007, .005, .001], core, 8, 5);
  } else if (kind === 'staff') {
    haft(-.35, .43);
    sculpt.tube([[0, .35, 0], [-.07, .44, 0], [-.06, .53, 0], [0, .57, 0], [.06, .53, 0], [.07, .44, 0], [0, .35, 0]],
      [.016, .016, .014, .012, .014, .016, .016], brass, 22, 7);
    sculpt.add(new THREE.OctahedronGeometry(.058), 0x9ec4c5, [0, .48, 0], [.7, 1.15, .7]);
  } else if (kind === 'bow') {
    sculpt.tube([[0, -.37, -.10], [-.035, -.24, -.08], [0, 0, 0], [-.035, .24, -.08], [0, .37, -.10]],
      [.009, .018, .025, .018, .009], wood, 26, 8);
    for (const y of [-.055, -.025, .005, .035, .065]) sculpt.tube([[-.023, y, 0], [0, y, .025], [.023, y, 0]],
      [.004, .004, .004], leather, 5, 5);
    sculpt.finish(root, 'first-person.bow-limbs');
    const string = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -.37, -.10), new THREE.Vector3(0, 0, -.10), new THREE.Vector3(0, .37, -.10),
    ]), new THREE.LineBasicMaterial({ color: 0xded0a5 }));
    string.name = 'first-person.bowstring';
    root.add(string);
    const arrow = new THREE.Group(); arrow.name = 'first-person.nocked-arrow';
    const shaft = new Sculpt();
    shaft.tube([[0, 0, 0], [0, 0, -.55]], [.004, .004], 0xb7a278, 3, 6);
    shaft.add(new THREE.ConeGeometry(.014, .05, 4), 0xaebbb7, [0, 0, -.57], [1, 1, 1], [-Math.PI / 2, 0, 0]);
    for (const side of [-1, 1]) shaft.leaf([0, 0, -.035], [side * .024, 0, -.10], .012, 0xe0d6b8, .002);
    shaft.finish(arrow, 'first-person.arrow-shaft-and-feathers');
    root.add(arrow);
    return { root, string, arrow };
  }
  sculpt.finish(root, `first-person.${kind}-surface`);
  return { root };
}
