import * as THREE from 'three';
import { CreatureAnimator } from './creatureAnimation';
import type { CreatureRig } from './characterRigs';
import type { SpeciesId } from '../simulation/state';
import { Sculpt, joint, paw, sculptEyes, surface, type Point } from './characterSculpt';

interface Model {root:THREE.Group;joints:Record<string,THREE.Group>}
function model(speciesId:SpeciesId):Model {
  const root=new THREE.Group();root.name=`${speciesId}-rig`;
  root.userData.visualStyle='woodland-sculpt';return {root,joints:{}};
}
function moving(m:Model,name:string,position:Point,parent=m.root):THREE.Group {
  const group=joint(parent,name,position);m.joints[name]=group;return group;
}
function legs(m:Model,positions:readonly (readonly [string,number,number])[],height:number,length:number,width:number,
  color:number,foot=color,hoof=false):void {
  for(const [name,x,z] of positions)m.joints[name]=paw(m.root,name,[x,height,z],length,width,color,foot,hoof);
}

function tuftle():Model {
  const m=model('tuftle'),s=new Sculpt();
  s.loft([[-.44,0,0,.48],[-.35,.29,.27,.48],[-.1,.39,.34,.49],[.22,.38,.31,.48],[.43,.23,.22,.46],[.52,0,0,.47]],
    p=>p.y<.4?0xb3c69b:0x6e9b78,[0,0,0],'z');
  // A soft cotton belly, clustered seed fluff and a little leaf-bud tail.
  s.ellipsoid([0,.42,-.18],[.29,.25,.26],0xb8caa0);
  for(const side of [-1,1])for(const z of [-.1,.13,.32])
    s.ellipsoid([side*.31,.55,z],[.115,.14,.14],0x78a47e);
  s.ellipsoid([0,.51,.49],[.15,.17,.15],0xc2d1aa);
  for(const side of [-1,1])s.leaf([side*.18,.64,.27],[side*.36,.77,.48],.12,0x4d8060,.04);
  s.leaf([0,.65,.47],[0,.85,.59],.12,0x638f65,.035);
  s.finish(m.root,'tuftle.cotton-and-foliage');
  const head=moving(m,'head',[0,.74,-.32]),h=new Sculpt();
  h.ellipsoid([0,0,0],[.277,.257,.247],0x81b492);
  for(const side of [-1,1])h.ellipsoid([side*.09,-.10,-.204],[.115,.085,.06],0xd9dbb6);
  h.ellipsoid([0,-.073,-.265],[.034,.024,.017],0x8c7662);
  h.tube([[0,-.09,-.266],[0,-.119,-.258],[-.032,-.13,-.248]], [.006,.005,.003],0x42674e,5,4);
  for(const side of [-1,1])h.ellipsoid([side*.19,-.035,-.18],[.047,.029,.018],0xb3c59a);
  h.finish(head,'tuftle.velvet-face');sculptEyes(head,-1,.122,.035,-.224,.048,0x65815a);
  for(const side of [-1,1]) {
    const ear=moving(m,side<0?'leftLeaf':'rightLeaf',[side*.14,.16,.015],head),leaf=new Sculpt();
    leaf.leaf([0,0,0],[side*.08,.57,-.025],.15,(_p,uv)=>Math.abs(uv.x-.5)<.06?0xb6c78d:uv.x<.5?0x57865e:0x3c6c52,.075);
    for(const t of [.25,.42,.60,.75])leaf.tube([[0,t*.57,.065],[side*.065+.08,t*.57+.06,.045]], [.004,.002],0x9cba7d,4,4);
    leaf.finish(ear,`tuftle.${side<0?'left':'right'}-leaf`);
  }
  legs(m,[['leftFoot',-.23,-.16],['rightFoot',.23,-.16],['rearLeft',-.26,.25],['rearRight',.26,.25]],.28,.27,.105,0x618768,0x88a781);
  return m;
}

function craghopper():Model {
  const m=model('craghopper'),s=new Sculpt();
  s.loft([[-.45,0,0,.52],[-.35,.35,.27,.52],[-.08,.47,.33,.54],[.24,.43,.32,.54],[.43,.26,.22,.53],[.51,0,0,.52]],0x515e61,[0,0,0],'z',10);
  for(const side of [-1,1])for(const [z,y,r] of [[-.18,.67,.24],[.12,.72,.27],[.35,.64,.21]]) {
    s.add(new THREE.IcosahedronGeometry(1,0),z!<0?0x6e7b76:0x788279,[side*.29,y!,z!],[r!,r!*.75,r!*.95],[.1,side*.2,.1]);
  }
  s.tube([[-.38,.76,-.1],[-.30,.85,.04],[-.2,.83,.25]], [.012,.013,.006],0xaaa078,9,5);
  s.tube([[.25,.83,-.14],[.38,.78,.08],[.32,.74,.3]], [.009,.012,.004],0x8b9563,9,5);
  s.finish(m.root,'craghopper.layered-stone-shell');
  const crystals=new Sculpt();
  for(const side of [-1,1])for(const [z,h,r] of [[-.07,.46,.10],[.22,.35,.085]]) {
    crystals.tube([[side*.29,.80,z!],[side*.37,.97,z!+.025],[side*.41,.8+h!,z!+.05]], [r!,r!*.72,0],0xc29560,8,5);
    crystals.tube([[side*.29,.82,z!],[side*.37,1.0,z!+.04]], [.012,.007],0xebd39b,5,4);
  }
  crystals.finish(m.root,'craghopper.amber-crystals',.42,0xa36c32);
  const head=moving(m,'head',[0,.65,-.43]),h=new Sculpt();
  h.loft([[-.33,0,0],[-.31,.16,.10],[-.17,.28,.19],[.04,.29,.22],[.22,.15,.16],[.28,0,0]],0x83908a,[0,0,0],'z',12);
  for(const side of [-1,1])h.tube([[side*.06,.12,-.245],[side*.14,.15,-.235],[side*.22,.10,-.19]], [.027,.036,.02],0x55665f,7,6);
  h.tube([[-.10,-.10,-.29],[0,-.12,-.323],[.10,-.10,-.29]], [.008,.008,.005],0x374b49,7,4);
  h.finish(head,'craghopper.carved-face');sculptEyes(head,-1,.135,.045,-.302,.046,0xb79a51);
  for(const side of [-1,1]) {
    const leg=moving(m,side<0?'leftLeg':'rightLeg',[side*.37,.48,.19]),l=new Sculpt();
    l.tube([[0,.02,0],[side*.23,-.12,.12],[side*.16,-.36,-.08],[side*.08,-.42,-.22]], [.16,.18,.09,.055],0x596e68,12,7);
    l.ellipsoid([side*.10,-.405,-.23],[.16,.08,.21],0x707f75);
    l.finish(leg,`craghopper.${side<0?'left':'right'}-spring-leg`);
  }
  legs(m,[['frontLeft',-.28,-.25],['frontRight',.28,-.25]],.31,.30,.09,0x677e72);
  return m;
}

function stag():Model {
  const m=model('glade-stag'),s=new Sculpt();
  s.loft([[-.83,0,0,1.1],[-.64,.28,.35,1.13],[-.40,.35,.39,1.14],[0,.34,.37,1.15],
    [.44,.32,.34,1.14],[.68,.20,.27,1.12],[.78,0,0,1.14]],p=>p.y<1.05?0xc8ba91:0xa88754,[0,0,0],'z');
  // Pale dappling follows the flanks, below the saddle line.
  for(const side of [-1,1])for(let i=0;i<8;i++) {
    const z=-.2+(i%4)*.19,y=1.19+Math.floor(i/4)*.13;
    s.ellipsoid([side*(.337-Math.floor(i/4)*.025),y,z],[.013,.023,.027],0xd3c9a4);
  }
  s.finish(m.root,'stag.dappled-coat');
  const neck=moving(m,'neck',[0,1.2,-.64]),n=new Sculpt();
  n.loft([[-.18,0,0],[0,.23,.22,.02],[.28,.19,.18,-.08],[.57,.125,.13,-.20],[.83,.105,.11,-.29],[.88,0,0,-.3]],0xb59b69);
  n.ellipsoid([0,.81,-.33],[.17,.195,.27],p=>p.z<-.3?0xd8ca9e:0xb99e70);
  n.loft([[-.63,0,0,.76],[-.60,.09,.07,.76],[-.45,.13,.10,.78],[-.33,.14,.12,.81],[-.24,0,0,.82]],0xc9bc98,[0,0,0],'z');
  n.ellipsoid([0,.77,-.60],[.093,.059,.048],0x4d5242);
  n.tube([[0,.32,-.24],[0,.53,-.34],[0,.78,-.53]], [.035,.029,.014],0xdad1ad,12,7);
  for(const side of [-1,1]) {
    n.leaf([side*.13,.85,-.20],[side*.39,1.04,-.16],.092,0xae9667,.025);
    n.leaf([side*.15,.87,-.221],[side*.35,1.02,-.182],.057,0xd7c6a0,.02);
    n.tube([[side*.13,.96,-.27],[side*.23,1.15,-.20],[side*.39,1.37,-.15],[side*.52,1.54,-.10]], [.037,.032,.022,0],0xd0c29c,16,6);
    for(const [x,y,reach] of [[.24,1.17,.22],[.36,1.33,.20],[.45,1.45,.17]]) {
      n.tube([[side*x!,y!,-.18],[side*(x!-.04),y!+.13,-.28],[side*(x!+.015),y!+reach!,-.29]], [.02,.013,0],0xddd3ad,9,5);
    }
    n.leaf([side*.25,1.14,-.19],[side*.37,1.24,-.24],.045,0x728c5c,.015);
  }
  n.finish(neck,'stag.neck-face-and-branching-antlers');sculptEyes(neck,-1,.113,.86,-.509,.035,0x766b43);
  legs(m,[['frontLeft',-.24,-.50],['frontRight',.24,-.50],['rearLeft',-.265,.49],['rearRight',.265,.49]],
    .96,.94,.079,0x9d8059,0x494e40,true);
  const tail=moving(m,'tail',[0,1.17,.69]);
  new Sculpt().tube([[0,0,0],[0,.11,.13],[0,.06,.28]], [.11,.095,.006],0xc9c3a0,10,8).finish(tail,'stag.leaf-tail');
  return m;
}

function fox():Model {
  const m=model('snarlfox'),s=new Sculpt();
  s.loft([[-.67,0,0,.66],[-.47,.25,.31,.69],[-.22,.28,.32,.67],[.17,.25,.29,.63],[.44,.18,.24,.61],[.56,0,0,.62]],
    p=>p.y<.54?0xd3bb8f:0xa85e3d,[0,0,0],'z');
  s.ellipsoid([0,.64,-.42],[.24,.28,.20],0xd8c4a0);
  for(const side of [-1,1])s.leaf([side*.08,.76,-.37],[side*.25,.47,-.46],.085,0xe3d3af,.06);
  s.finish(m.root,'fox.russet-coat-and-ruff');
  const head=moving(m,'head',[0,.88,-.56]),h=new Sculpt();
  h.ellipsoid([0,0,0],[.255,.235,.26],p=>Math.abs(p.x)>.52&&p.y<.12?0xd7c59d:0xbe8051);
  h.loft([[-.45,0,0,-.075],[-.40,.055,.045,-.07],[-.28,.125,.08,-.055],[-.13,.16,.11,-.035],[.02,0,0]],0xdfceaa,[0,0,0],'z');
  h.ellipsoid([0,-.055,-.426],[.045,.029,.027],0x253333);
  for(const side of [-1,1]) {
    h.leaf([side*.14,.15,0],[side*.20,.54,.045],.125,0xa96b46,.065);
    h.leaf([side*.14,.20,-.015],[side*.195,.47,.022],.077,0xe1c59c,.04);
    h.tube([[side*.07,.10,-.226],[side*.125,.113,-.221],[side*.184,.073,-.177]], [.015,.016,.008],0x693f2f,7,5);
    h.leaf([side*.18,-.02,-.05],[side*.32,-.14,-.03],.075,0xcba476,.02);
  }
  h.tube([[-.085,-.1,-.31],[0,-.115,-.4],[.085,-.1,-.31]], [.006,.005,.004],0x705140,9,4);
  h.finish(head,'fox.long-muzzle-and-ears');sculptEyes(head,-1,.115,.035,-.228,.044,0xb7a16a);
  legs(m,[['frontLeft',-.20,-.32],['frontRight',.20,-.32],['rearLeft',-.20,.29],['rearRight',.20,.29]],
    .51,.49,.07,0x80523a,0x3d3d31);
  const tail=moving(m,'tail',[0,.66,.48]);
  new Sculpt().tube([[0,0,0],[0,.18,.3],[.06,.19,.66],[.07,.27,.88],[.03,.37,1.02]],
    [.12,.20,.22,.14,0],(_p,uv)=>uv.y>.70?0xddd3af:uv.y>.58?0xc18756:0xa45f3b,22,10)
    .finish(tail,'fox.full-brush-tail');
  return m;
}

function mole():Model {
  const m=model('masonmole'),s=new Sculpt();
  s.loft([[-.47,0,0,.46],[-.35,.30,.29,.47],[-.04,.39,.34,.47],[.28,.35,.30,.47],[.49,.19,.20,.44],[.57,0,0,.43]],
    p=>p.y<.35?0xaaa088:0x726b5c,[0,0,0],'z');
  s.ellipsoid([0,.46,.48],[.14,.17,.16],0x89816a);s.finish(m.root,'mole.velvet-burrower');
  const head=moving(m,'head',[0,.62,-.38]),h=new Sculpt();
  h.ellipsoid([0,0,0],[.28,.25,.26],p=>Math.abs(p.x)<.23?0xd0c6a1:0x625f52);
  h.loft([[-.45,0,0,-.04],[-.41,.075,.06,-.03],[-.24,.18,.13,-.015],[-.09,.22,.18],[.07,0,0]],0x9e9b80,[0,0,0],'z');
  h.ellipsoid([0,-.026,-.428],[.085,.051,.037],0xb18d7b);
  for(const side of [-1,1]) {
    h.ellipsoid([side*.23,.12,.02],[.06,.085,.035],0x595d50,[0,0,side*-.4]);
    h.ellipsoid([side*.235,.12,-.005],[.027,.048,.016],0xada17e,[0,0,side*-.4]);
    for(const y of [-.08,-.03])h.tube([[side*.11,y,-.29],[side*.25,y+.01,-.30],[side*.32,y+.04,-.24]], [.004,.003,.001],0xd0c5a4,7,4);
  }
  h.finish(head,'mole.mask-and-whiskers');sculptEyes(head,-1,.154,.053,-.229,.034,0x4b4e3e);
  for(const [name,x,z] of [['frontLeft',-.27,-.26],['frontRight',.27,-.26],['rearLeft',-.27,.28],['rearRight',.27,.28]] as const) {
    const leg=moving(m,name,[x,.27,z]),l=new Sculpt(),front=z<0;
    l.tube([[0,.01,0],[Math.sign(x)*.04,-.13,-.02],[0,-.20,-.10]], [.12,.10,.085],0x656452,9,7);
    l.ellipsoid([0,-.20,-.12],[front?.16:.10,.074,front?.17:.13],0xa69b7a);
    for(const offset of [-1,0,1])l.tube([[offset*.066,-.18,-.22],[offset*.072,-.18,-.30],[offset*.074,-.23,-.34]],
      [front?.025:.018,.016,0],0xdad0b1,8,5);
    l.finish(leg,`mole.${name}.spade-paw`);
  }
  return m;
}

function slingtail():Model {
  const m=model('slingtail'),s=new Sculpt();
  s.loft([[-.49,0,0,.49],[-.35,.25,.25,.51],[-.10,.30,.30,.50],[.22,.29,.28,.47],[.44,.17,.20,.46],[.51,0,0,.45]],
    p=>p.y<.42?0xb5af87:0x918262,[0,0,0],'z');
  s.finish(m.root,'slingtail.warm-umber-coat');
  const head=moving(m,'head',[0,.73,-.39]),h=new Sculpt();
  h.ellipsoid([0,0,0],[.26,.24,.245],p=>p.y>.04?0xb7ae84:p.y<-.15?0xcac49b:0x5c6551);
  h.loft([[-.35,0,0,-.07],[-.32,.07,.045,-.07],[-.19,.14,.09,-.05],[-.07,.16,.11],[.02,0,0]],0xc6c099,[0,0,0],'z');
  h.ellipsoid([0,-.06,-.327],[.047,.032,.03],0x35473d);
  for(const side of [-1,1]) {
    h.leaf([side*.16,.14,.01],[side*.29,.41,.055],.105,0x686d53,.06);
    h.leaf([side*.17,.18,-.003],[side*.26,.36,.033],.065,0xd4c99f,.035);
    h.tube([[side*.055,.088,-.23],[side*.12,.102,-.218],[side*.18,.07,-.18]], [.013,.015,.009],0xd9d0a3,7,5);
  }
  h.finish(head,'slingtail.masked-face');sculptEyes(head,-1,.121,.025,-.226,.044,0x7c8f5f);
  legs(m,[['frontLeft',-.21,-.26],['frontRight',.21,-.26],['rearLeft',-.22,.27],['rearRight',.22,.27]],.32,.30,.075,0x7a795b,0x4c5947);
  const tail=moving(m,'tail',[0,.53,.43]);
  new Sculpt().tube([[0,0,0],[.02,.15,.30],[.07,.49,.65],[.12,.87,.62],[.15,1.05,.38],[.16,1.03,.18]],
    [.11,.15,.18,.20,.18,.015],(_p,uv)=>Math.sin(uv.y*Math.PI*13)>.22?0x4c5e4d:0xb6ad7d,32,10)
    .finish(tail,'slingtail.curled-ringed-tail');
  return m;
}

function boar():Model {
  const m=model('bulwark-boar'),s=new Sculpt();
  s.loft([[-.78,0,0,.66],[-.56,.35,.43,.69],[-.26,.44,.48,.69],[.12,.42,.40,.64],[.50,.29,.31,.59],[.68,0,0,.58]],
    p=>p.y<.48?0x6c5b47:0x8e6c50,[0,0,0],'z');
  // Overlapping bark plates leave the central saddle position clear.
  for(const side of [-1,1])for(let i=0;i<4;i++) {
    s.add(new THREE.IcosahedronGeometry(1,0),i%2?0x535947:0x62644e,[side*.27,1.0-i*.055,-.30+i*.23],
      [.23,.13,.21],[0,side*.17,side*-.18]);
    if(i<3)s.leaf([side*.32,1.02-i*.05,-.24+i*.23],[side*.42,1.08-i*.05,-.12+i*.23],.065,0x82916a,.02);
  }
  s.finish(m.root,'boar.bark-armour');
  const head=moving(m,'head',[0,.73,-.65]),h=new Sculpt();
  h.ellipsoid([0,.015,0],[.32,.30,.32],0x917556);
  h.loft([[-.52,0,0,-.095],[-.48,.14,.115,-.09],[-.32,.21,.15,-.06],[-.12,.255,.21,-.015],[.08,0,0]],0xa68a69,[0,0,0],'z');
  h.ellipsoid([0,-.08,-.485],[.145,.098,.025],0xbaa17e);
  for(const side of [-1,1]) {
    h.ellipsoid([side*.06,-.07,-.509],[.024,.032,.008],0x5a5847);
    h.leaf([side*.19,.19,.02],[side*.39,.33,-.035],.13,0x796c52,.07);
    h.leaf([side*.23,.225,-.005],[side*.36,.30,-.05],.073,0xb39b76,.04);
    h.tube([[side*.20,-.15,-.31],[side*.28,-.13,-.41],[side*.30,.02,-.46],[side*.245,.13,-.44]],
      [.055,.047,.027,0],0xe4d9b7,16,8);
    h.tube([[side*.07,.13,-.26],[side*.16,.16,-.25],[side*.23,.11,-.21]], [.025,.032,.015],0x635e45,8,6);
  }
  h.finish(head,'boar.curved-tusks-and-snout');sculptEyes(head,-1,.16,.065,-.272,.045,0xa99462);
  legs(m,[['frontLeft',-.29,-.41],['frontRight',.29,-.41],['rearLeft',-.28,.36],['rearRight',.28,.36]],
    .48,.45,.12,0x77634a,0x414c3c,true);
  const tail=moving(m,'tail',[0,.66,.61]);
  new Sculpt().tube([[0,0,0],[.02,.03,.2],[.08,.12,.26],[.12,.14,.19],[.1,.07,.17]], [.029,.025,.02,.016,.009],0x7e7557,18,6)
    .finish(tail,'boar.curled-tail');
  return m;
}

function finch():Model {
  const m=model('quillfinch'),s=new Sculpt();
  s.ellipsoid([0,.58,0],[.27,.34,.36],p=>p.z<-.25?0xd8ba6c:p.y<-.2?0xe0c791:0xb59455);
  s.ellipsoid([0,.53,-.23],[.20,.25,.13],0xdac187);
  for(const x of [-.08,0,.08])s.leaf([x,.59,.23],[x*1.6,.53,.77-Math.abs(x)],.072,0x4e7275,.025);
  s.finish(m.root,'finch.gold-breast-and-tail');
  const head=moving(m,'head',[0,.94,-.22]),h=new Sculpt();
  h.ellipsoid([0,0,0],[.22,.225,.225],p=>p.y>.1?0x506f70:0xc2a45f);
  h.tube([[0,-.035,-.18],[0,-.04,-.32],[0,-.08,-.38]], [.078,.052,.001],0x9c7842,8,5);
  for(const [x,height] of [[-.09,.23],[0,.32],[.09,.24]])
    h.leaf([x!, .14,.015],[x!*1.4,.20+height!,.10],.04,0xd4b464,.025);
  h.finish(head,'finch.crown-and-beak');sculptEyes(head,-1,.11,.025,-.194,.043,0x5f7155);
  for(const side of [-1,1]) {
    const wing=moving(m,side<0?'leftWing':'rightWing',[side*.22,.69,.02]),w=new Sculpt();
    w.ellipsoid([side*.07,-.025,.065],[.14,.075,.24],0x547679);
    for(let i=0;i<6;i++) {
      w.leaf([side*.025,-.015,-.09+i*.055],[side*(.23+i*.022),-.07,.21+i*.055],.058,
        (_p,uv)=>uv.x<.15||uv.x>.85?0xa5b2a0:i%2?0x607f7e:0x45696c,.025);
    }
    w.finish(wing,`finch.${side<0?'left':'right'}-layered-feathers`);
  }
  for(const side of [-1,1]) {
    const foot=moving(m,side<0?'rearLeft':'rearRight',[side*.11,.30,.02]),f=new Sculpt();
    f.tube([[0,0,0],[0,-.13,.015],[0,-.24,-.035]], [.026,.021,.017],0x8b7547,8,5);
    for(const x of [-.055,0,.055])f.tube([[0,-.23,-.02],[x,-.265,-.08],[x*1.2,-.26,-.13]], [.013,.012,.001],0xb1a06b,7,5);
    f.finish(foot,`finch.${side<0?'left':'right'}-talons`);
  }
  return m;
}

function moth():Model {
  const m=model('mistmoth'),s=new Sculpt();
  s.loft([[-.24,0,0,.64],[-.17,.14,.18,.65],[.03,.17,.18,.60],[.24,.135,.14,.55],[.40,.07,.09,.51],[.45,0,0,.5]],
    (_p,uv)=>Math.sin(uv.y*26)>.3?0x90bcb6:0x638e91,[0,0,0],'z');
  for(const side of [-1,1])for(const z of [-.05,.09,.22])
    s.tube([[side*.1,.57,z],[side*.22,.43,z+.035],[side*.21,.29,z-.025]], [.016,.012,.003],0x665f80,10,5);
  s.finish(m.root,'moth.velvet-abdomen-and-six-legs');
  const head=moving(m,'head',[0,.78,-.24]),h=new Sculpt();
  h.ellipsoid([0,0,0],[.19,.185,.18],0xacc9ba);
  for(let i=0;i<7;i++) {
    const a=i/7*Math.PI*2;
    h.ellipsoid([Math.cos(a)*.14,-.10,Math.sin(a)*.12+.035],[.07,.09,.065],0xd0d4b7);
  }
  for(const side of [-1,1]) {
    h.tube([[side*.08,.12,.01],[side*.16,.31,-.01],[side*.24,.40,-.065]], [.014,.010,.002],0x626c86,16,5);
    for(const t of [.35,.55,.75])h.leaf([side*(.08+t*.15),.12+t*.27,-t*.04],
      [side*(.12+t*.16),.15+t*.28,-.02-t*.04],.02,0xa9baaf,.008);
  }
  h.finish(head,'moth.fur-collar-and-feathered-antennae');sculptEyes(head,-1,.086,.025,-.158,.042,0x7679a0);
  for(const side of [-1,1]) {
    const wing=moving(m,side<0?'leftWing':'rightWing',[side*.11,.66,-.015]),w=new Sculpt();
    for(const rear of [false,true]) {
      const outline=rear?[[0,.02],[.20,-.02],[.60,.17],[.65,.45],[.46,.59],[.15,.47]]
        :[[0,.03],[.22,-.27],[.64,-.48],[.94,-.32],[.90,.02],[.65,.30],[.18,.35]];
      const shape=new THREE.Shape();
      shape.moveTo(outline[0]![0]!,outline[0]![1]!);
      // Quadratic arcs through midpoints produce scalloped, rounded wing lobes.
      for(let i=1;i<=outline.length;i++) {
        const a=outline[i%outline.length]!,b=outline[(i+1)%outline.length]!;
        shape.quadraticCurveTo(a[0]!,a[1]!, (a[0]!+b[0]!)/2,(a[1]!+b[1]!)/2);
      }
      shape.closePath();
      // Interior vertices carry the painted eye spots; outline-only triangles
      // would interpolate straight across them and erase the wing markings.
      const border=shape.getPoints(5),center=border.reduce((sum,p)=>sum.add(p),new THREE.Vector2()).divideScalar(border.length);
      const vertices:number[]=[],uv:number[]=[],indices:number[]=[],rings=10,count=border.length;
      for(let r=0;r<=rings;r++)for(let b=0;b<=count;b++) {
        const p=center.clone().lerp(border[b%count]!,r/rings),x=p.x,z=p.y;
        vertices.push(side*x,.035*Math.sin(x*4)+x*.055,z);uv.push(x,z);
        if(r<rings&&b<count){const k=r*(count+1)+b;indices.push(k,k+1,k+count+1,k+1,k+count+2,k+count+1);}
      }
      const geometry=surface(vertices,uv,indices);
      w.add(geometry,p=>{
        const x=Math.abs(p.x),z=p.z;
        const spot=Math.hypot((x-(rear?.43:.63))/.13,(z-(rear?.30:-.13))/.14);
        if(spot<.30)return 0x454e78;
        if(spot<.52)return 0xd8ce9f;
        if(spot<.70)return 0x817794;
        const band=Math.sin(x*20+z*8);
        return x>.78?0x69768d:band>.7?0xc0c6b4:rear?0xa4bdb7:0xa1a8c6;
      });
    }
    for(const z of [-.26,-.04,.21])w.tube([[0,.01,.03],[side*.34,.06,z*.4],[side*.74,.07,z]], [.006,.004,.001],0x7b8c9b,13,4);
    w.finish(wing,`moth.${side<0?'left':'right'}-painted-wings`,.85);
  }
  return m;
}

const BUILDERS:Record<SpeciesId,()=>Model>={tuftle,craghopper,'glade-stag':stag,snarlfox:fox,masonmole:mole,
  slingtail,'bulwark-boar':boar,quillfinch:finch,mistmoth:moth};

export function createSculptedCreature(speciesId:SpeciesId):CreatureRig {
  const {root,joints}=BUILDERS[speciesId]();
  root.userData.modelHeight=new THREE.Box3().setFromObject(root).max.y;
  const animator=new CreatureAnimator(speciesId,root,joints);
  return {root,speciesId,joints,animate(time,motion,reducedMotion,frame){
    animator.animate(time,motion,reducedMotion,frame);
  }};
}
