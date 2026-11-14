import * as THREE from 'three';
import type { PlayerRigPalette } from './characterRigs';
import { Sculpt, joint, sculptEyes, surface, type Point, type SculptDetail } from './characterSculpt';

/** Original woodland warden, built around the established tool and riding pivots. */
export function buildWarden(palette: PlayerRigPalette, detail:SculptDetail='full') {
  const root=new THREE.Group();root.name='player-rig';root.userData.visualStyle='woodland-sculpt';
  const cloth=palette.cloth??0x3e7367,leather=palette.leather??0x75513b;
  const skin=palette.skin??0xd1a27d,boot=palette.boot??0x3c342e,cloakColor=palette.cloak??0x345b4e;
  const linen=0xd8cba7,brass=0xc5a366;
  const torso=joint(root,'torso',[0,.88,0]);
  const coat=new Sculpt(detail);
  coat.loft([[-.30,0,0],[-.29,.28,.20],[-.13,.255,.17],[.02,.21,.155],[.27,.265,.175],
    [.39,.29,.17],[.48,.16,.12],[.51,0,0]],cloth);
  // A shaped leather vest, piped edges and a diagonal baldric.
  coat.loft([[-.04,0,0],[-.035,.225,.165],[.12,.23,.177],[.31,.275,.18],[.38,.255,.17],[.4,0,0]],leather);
  coat.tube([[-.22,.36,.12],[-.12,.20,.188],[.02,.03,.18],[.2,-.12,.16]], [.033,.032,.028,.024],0x3e352b,10);
  for(const side of [-1,1])coat.tube([[side*.14,.38,.165],[side*.16,.23,.19],[side*.12,.04,.17]], [.009,.009,.007],brass,8,5);
  for(const y of [.08,.19,.30])coat.ellipsoid([.035,y,.191],[.016,.016,.012],brass);
  // Folded scarf and its short asymmetric end.
  coat.tube([[-.15,.43,.02],[-.10,.43,.14],[.08,.43,.15],[.16,.45,.03],[.05,.46,-.12],[-.15,.43,.02]],
    [.06,.06,.052,.05,.045,.06],linen,18,8);
  coat.leaf([-.11,.4,.17],[-.19,.13,.215],.062,0xb5ad85,.035);
  // Bedroll, pack and straps are part of the torso's single painted surface.
  coat.ellipsoid([0,.13,-.24],[.20,.25,.12],0x806b47);
  coat.ellipsoid([0,.30,-.29],[.24,.085,.09],0x9a9977);
  for(const x of [-.14,.14])coat.tube([[x,.39,-.28],[x,.28,-.385],[x,.08,-.35]], [.014,.013,.012],leather,7,5);
  coat.ellipsoid([0,.15,-.358],[.16,.10,.022],0x6d5b3f);
  coat.finish(torso,'warden.tailored-coat');

  const head=joint(root,'head',[0,1.53,0]),face=new Sculpt(detail);
  face.loft([[-.225,0,0],[-.205,.105,.115],[-.14,.18,.165],[-.025,.224,.205],[.12,.218,.194],
    [.22,.15,.14],[.265,0,0]],skin);
  face.ellipsoid([0,-.02,.215],[.035,.065,.055],skin);
  face.ellipsoid([0,-.058,.249],[.04,.03,.028],0xc39573);
  for(const side of [-1,1]) {
    face.ellipsoid([side*.218,-.025,0],[.046,.078,.032],skin,[0,0,side*-.12]);
    face.ellipsoid([side*.235,-.025,.022],[.017,.046,.014],0xb78267);
    face.tube([[side*.04,.09,.19],[side*.075,.103,.197],[side*.115,.087,.177]], [.013,.014,.009],0x604335,5,5);
  }
  face.tube([[-.052,-.125,.172],[0,-.136,.188],[.052,-.125,.172]], [.006,.006,.004],0x895d4d,7,5);
  face.add(new THREE.SphereGeometry(1,detail==='compact'?8:14,detail==='compact'?6:8,0,Math.PI*2,0,Math.PI*.45),0x684835,[0,.06,-.012],[.228,.245,.218]);
  for(const [x,y,z] of [[-.13,.15,.12],[-.055,.18,.172],[.04,.17,.174],[.15,.13,.10]] as Point[]) {
    face.ellipsoid([x,y,z],[.075,.10,.039],0x72503a,[0,0,-x*2]);
  }
  // A deep open hood, with a swept tip and an embroidered face opening.
  face.add(new THREE.SphereGeometry(1,detail==='compact'?8:16,detail==='compact'?6:10,Math.PI,Math.PI,0,Math.PI*.78),cloakColor,
    [0,.028,-.035],[.285,.33,.28]);
  face.tube([[0,.16,-.25],[0,.23,-.35],[0,.26,-.43]], [.13,.08,.001],cloakColor,9,10);
  face.tube([[-.245,-.12,.035],[-.27,.09,.06],[-.19,.27,.075],[0,.35,.065],[.19,.27,.075],[.27,.09,.06],[.245,-.12,.035]],
    [.024,.024,.027,.027,.027,.024,.024],0x78927a,24,6);
  face.finish(head,'warden.hood-and-face');
  sculptEyes(head,1,.081,.014,.194,.034,0x6f8659,detail);

  const leftArm=arm(root,'left-arm',-.34,cloth,leather,skin,linen,detail);
  const rightArm=arm(root,'right-arm',.34,cloth,leather,skin,linen,detail);
  const leftLeg=leg(root,'left-leg',-.14,boot,leather,detail),rightLeg=leg(root,'right-leg',.14,boot,leather,detail);
  const belt=new Sculpt(detail);
  belt.loft([[.75,0,0],[.755,.255,.19],[.84,.252,.187],[.845,0,0]],0x493b2f);
  belt.ellipsoid([0,.8,.192],[.055,.039,.018],brass);
  belt.ellipsoid([0,.8,.207],[.032,.019,.006],0x493b2f);
  belt.ellipsoid([-.26,.70,.13],[.11,.13,.075],leather,[0,0,-.12]);
  belt.ellipsoid([-.26,.76,.185],[.105,.058,.025],0x947152);
  belt.ellipsoid([-.26,.738,.212],[.015,.015,.007],brass);
  belt.tube([[.25,.79,-.015],[.29,.64,.01],[.27,.51,.06]], [.023,.023,.017],0x393b31,7,6);
  belt.finish(root,'warden.belt-and-satchel');

  const cloak=new Sculpt(detail).add(cloakGeometry(detail),(_p,uv)=>uv.y>.95||Math.abs(uv.x-.5)>.47?0x889c76:cloakColor).finish(root,'player.cloak');
  cloak.position.set(0,.94,-.16);cloak.rotation.x=.12;
  const clasp=new Sculpt(detail);
  clasp.ellipsoid([-.19,.43,.15],[.045,.045,.019],brass);
  clasp.leaf([-.21,.40,.172],[-.17,.47,.172],.017,0x678865,.004);
  clasp.finish(torso,'warden.leaf-brooch',.6);
  return {root,torso,head,leftArm,rightArm,leftLeg,rightLeg,cloak};
}

function arm(root: THREE.Group,name:string,x:number,cloth:number,leather:number,skin:number,linen:number,detail:SculptDetail): THREE.Group {
  const group=joint(root,name,[x,1.26,0]),s=new Sculpt(detail);
  s.loft([[-.38,0,0],[-.37,.083,.079],[-.24,.087,.085],[-.10,.113,.108],[.025,.11,.105],[.075,0,0]],cloth);
  s.ellipsoid([Math.sign(x)*.015,-.02,-.015],[.136,.095,.135],0x547a66);
  s.loft([[-.59,0,0],[-.585,.067,.068],[-.50,.076,.078],[-.37,.086,.085],[-.32,.087,.086],[-.31,0,0]],leather);
  for(const y of [-.48,-.43])s.tube([[-.074,y,.025],[0,y,.082],[.074,y,.025]], [.009,.009,.009],linen,6,5);
  s.ellipsoid([0,-.64,.008],[.075,.086,.065],skin);
  s.ellipsoid([-Math.sign(x)*.065,-.62,.04],[.032,.046,.032],skin,[0,0,Math.sign(x)*-.3]);
  s.ellipsoid([0,-.62,-.025],[.075,.075,.044],0x4c4133);
  s.finish(group,`${name}.tailored-sleeve`);return group;
}

function leg(root:THREE.Group,name:string,x:number,boot:number,leather:number,detail:SculptDetail):THREE.Group {
  const group=joint(root,name,[x,.68,0]),s=new Sculpt(detail);
  s.loft([[-.54,0,0],[-.53,.068,.073],[-.32,.08,.09],[-.13,.11,.115],[.04,.12,.12],[.065,0,0]],0x4e5645);
  s.loft([[-.61,0,0],[-.60,.085,.09,.015],[-.43,.09,.088],[-.30,.103,.095],[-.285,0,0]],leather);
  s.ellipsoid([0,-.605,.075],[.095,.066,.174],boot);
  s.ellipsoid([0,-.645,.076],[.1,.025,.18],0x252d27);
  s.tube([[-.08,-.33,.06],[0,-.33,.097],[.08,-.33,.06]], [.014,.014,.014],0x987451,6,5);
  for(const y of [-.44,-.48])s.tube([[-.04,y,.085],[.04,y-.02,.09]], [.006,.006],0xb4a37a,3,4);
  s.finish(group,`${name}.boot-and-trousers`);return group;
}

/** Folded cloth widens toward a scalloped hem; every vertex stays behind the legs. */
function cloakGeometry(detail:SculptDetail): THREE.BufferGeometry {
  const vertices:number[]=[],uv:number[]=[],indices:number[]=[],rows=detail==='compact'?6:10,columns=detail==='compact'?8:12;
  for(let r=0;r<=rows;r++)for(let c=0;c<=columns;c++) {
    const t=r/rows,u=c/columns*2-1,width=.13+t*.28;
    vertices.push(u*width,.43-t*.91+(t>.8?Math.cos(u*Math.PI*3)*.018:0),
      -.025-t*.12+Math.cos(u*Math.PI*3)*.023*t);
    uv.push(c/columns,t);
    if(r<rows&&c<columns){const k=r*(columns+1)+c;indices.push(k,k+1,k+columns+1,k+1,k+columns+2,k+columns+1);}
  }
  return surface(vertices,uv,indices);
}
