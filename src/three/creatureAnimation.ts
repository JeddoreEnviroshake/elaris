import * as THREE from 'three';
import type {SpeciesId} from '../simulation/state';
import type {CreatureMotion} from './characterRigs';
import {PoseRig,cycle,ease,envelope,footCycle,solveLeg,type AnimationFrame} from './animationMotion';
import {SoftJoints} from './softJoints';

export const CREATURE_GAITS:Record<SpeciesId,{period:number;stride:number;contact:number;weight:number}>={
  tuftle:{period:720,stride:.52,contact:.55,weight:.8},craghopper:{period:980,stride:.86,contact:.64,weight:1.4},
  'glade-stag':{period:840,stride:.70,contact:.57,weight:.55},snarlfox:{period:700,stride:.50,contact:.55,weight:.65},
  masonmole:{period:1150,stride:.36,contact:.73,weight:1.05},slingtail:{period:670,stride:.40,contact:.56,weight:.65},
  'bulwark-boar':{period:1120,stride:.38,contact:.71,weight:1.6},quillfinch:{period:570,stride:.35,contact:.50,weight:.3},
  mistmoth:{period:1150,stride:.65,contact:.4,weight:.15},
};
const RUN_STRIDES:Record<SpeciesId,number>={tuftle:1.4,craghopper:1.8,'glade-stag':3.2,snarlfox:2,
  masonmole:.8,slingtail:1.6,'bulwark-boar':2.6,quillfinch:1.2,mistmoth:1.4};
export function creatureStride(species:SpeciesId,speed:number):number{return speed>2?RUN_STRIDES[species]:CREATURE_GAITS[species].stride;}
interface Leg {name:string;root:THREE.Group;length:number;knee:THREE.Group;ankle:THREE.Group;flex:SoftJoints;custom:boolean}
const TAU=Math.PI*2;

/** Species-authored gaits share only the blending, foot solve and action envelope. */
export class CreatureAnimator {
  private readonly whole=new THREE.Group();
  private readonly body=new THREE.Group();
  private readonly pose:PoseRig;
  private readonly legs:Leg[]=[];
  private readonly leaves:Array<{root:THREE.Group;flex:SoftJoints}>=[];
  private readonly wings:Array<{root:THREE.Group;flex:SoftJoints;side:number}>=[];
  private readonly eyes:THREE.Object3D|undefined;
  private readonly tailFlex:SoftJoints|null;
  private started=0;private previous='';

  constructor(private readonly species:SpeciesId,private readonly root:THREE.Group,private readonly joints:Record<string,THREE.Group>) {
    const old=[...root.children];this.whole.name='creature.motion';root.add(this.whole);
    root.updateMatrixWorld(true);for(const child of old)this.whole.attach(child);
    this.body.name='creature.motion-body';this.body.position.y=.5;this.whole.add(this.body);
    root.updateMatrixWorld(true);
    const legNames=new Set(['leftFoot','rightFoot','leftLeg','rightLeg','frontLeft','frontRight','rearLeft','rearRight']);
    for(const child of old)if(!legNames.has(child.name))this.body.attach(child);
    for(const [name,part] of Object.entries(joints)) {
      const mesh=part.children.find(child=>child instanceof THREE.Mesh) as THREE.Mesh|undefined;
      if(legNames.has(name)&&mesh){
        const length=part.position.y,knee=new THREE.Group(),ankle=new THREE.Group();
        const ankleDepth=Math.max(.10,length-.13),upper=ankleDepth*.52;
        knee.name=`${name}.knee`;ankle.name=`${name}.ankle`;knee.position.y=-upper;ankle.position.y=-(ankleDepth-upper);
        part.add(knee);knee.add(ankle);
        this.legs.push({name,root:part,length,knee,ankle,flex:new SoftJoints(mesh,-upper,-ankleDepth),
          custom:species==='craghopper'||species==='tuftle'||species==='masonmole'||species==='quillfinch'});
      } else if((name==='leftLeaf'||name==='rightLeaf')&&mesh){
        const flex=new SoftJoints(mesh,.26,.43);flex.softness.set(.13,.10);this.leaves.push({root:part,flex});
      } else if((name==='leftWing'||name==='rightWing')&&mesh){
        const flex=new SoftJoints(mesh,.12,.30,'z');flex.softness.set(.12,.10);this.wings.push({root:part,flex,side:name==='leftWing'?-1:1});
      }
    }
    const tail=joints.tail?.children.find(child=>child instanceof THREE.Mesh) as THREE.Mesh|undefined;
    this.tailFlex=tail?new SoftJoints(tail,species==='slingtail'?.65:.40,species==='slingtail'?1:.70,species==='slingtail'?'y':'z'):null;
    if(this.tailFlex)this.tailFlex.softness.set(.20,.15);
    this.eyes=root.getObjectByName('expressive-eyes');
    joints.body=this.body;joints.motion=this.whole;
    this.pose=new PoseRig([this.body,...Object.values(joints),...this.legs.flatMap(leg=>[leg.knee,leg.ankle])]);
  }

  animate(time:number,motion:CreatureMotion,reduced:boolean,frame?:AnimationFrame):void {
    this.root.userData.animationMotion=motion;
    if(motion!==this.previous){this.started=time;this.previous=motion;}
    this.pose.reset(motion,frame);this.root.position.y=0;this.root.rotation.x=0;this.root.rotation.z=0;
    const profile=CREATURE_GAITS[this.species],t=time/1000,still=reduced?0:1;
    const walking=motion==='walk'||motion==='run',run=motion==='run';
    const phase=frame?.phase??cycle(time/profile.period),p=phase*TAU;
    const head=this.joints.head??this.joints.neck,tail=this.joints.tail;
    const phaseSeed=this.species.length*.71;
    if(!reduced){
      const breath=Math.sin(t*(this.species==='bulwark-boar'?1.7:2.1)+phaseSeed);
      this.body.scale.y=1+breath*.012;this.body.scale.x=1-breath*.004;
      if(head){head.rotation.x+=Math.sin(t*1.35+phaseSeed)*.018;head.rotation.y+=Math.sin(t*.65+phaseSeed)*.045;}
      if(!walking)this.idle(t,phaseSeed);
    }
    let bob=0;
    if(walking&&!reduced){
      bob=-Math.min(run?.06:.03,(this.legs[0]?.length??.3)*(run?.16:.12))+Math.sin(p*2)*.005*profile.weight;
      this.body.position.y+=bob;
      this.body.rotation.z=Math.sin(p)*.015*profile.weight;
      this.body.rotation.x=Math.cos(p*2-.4)*.015*profile.weight;
      for(const leg of this.legs){
        const front=leg.name.startsWith('front')||leg.name.endsWith('Foot');
        const left=leg.name.endsWith('Left')||leg.name.startsWith('left');
        const diagonal=this.species==='snarlfox'||this.species==='slingtail';
        const offset=run?(front?0:.5)+(left?0:.07):diagonal?(left===front?0:.5):((front?0:.25)+(left?0:.5));
        const contact=run?(this.species==='glade-stag'?.17:.14):profile.contact;
        const stride=(run?RUN_STRIDES[this.species]:profile.stride)*contact/2;
        const foot=footCycle(phase+offset,Math.min(stride,leg.length*.35),leg.length*(run?.22:.15),contact);
        leg.root.position.y+=bob;
        if(leg.custom){
          leg.root.rotation.x=Math.sin((phase+offset)*TAU)*(this.species==='masonmole'?.18:.3);
          leg.root.position.y+=foot.lift*.65;leg.knee.rotation.x=Math.max(0,Math.sin((phase+offset)*TAU))*.18;
        }else{
          const ankleDepth=Math.max(.1,leg.length-.13),upper=ankleDepth*.52;
          const solve=solveLeg(-ankleDepth-bob+foot.lift,-foot.z,upper,ankleDepth-upper,front?-1:1);
          leg.root.rotation.x=solve.hip;leg.knee.rotation.x=solve.knee;leg.ankle.rotation.x=-solve.hip-solve.knee-foot.roll;
        }
      }
      if(head){head.rotation.x-=Math.sin(p*2-.5)*.018;head.rotation.z-=this.body.rotation.z*.6;}
      if(run&&this.legs.length&&this.species!=='tuftle'&&this.species!=='craghopper'){
        let air=1;
        for(const leg of this.legs){
          const front=leg.name.startsWith('front')||leg.name.endsWith('Foot'),left=leg.name.endsWith('Left')||leg.name.startsWith('left');
          const foot=footCycle(phase+(front?0:.5)+(left?0:.07),.1,1,this.species==='glade-stag'?.17:.14);
          air=Math.min(air,foot.lift);
        }
        this.root.position.y=air*.07;
      }
      if(this.species==='tuftle') {
        const flight=envelope(phase,.14,.46,.82),squash=envelope(phase,0,.10,.20)+envelope(phase,.78,.90,1);
        this.root.position.y=flight*.13;this.body.scale.y=1-squash*.08+flight*.035;this.body.scale.x=1+squash*.035;
        for(const leg of this.legs){leg.root.rotation.x=(leg.name.endsWith('Foot')?-.22:.18)*flight;leg.knee.rotation.x=.25*flight;}
      } else if(this.species==='craghopper') {
        const leap=envelope(phase,.20,.51,.86),crouch=envelope(phase,0,.14,.27)+envelope(phase,.82,.93,1);
        this.root.position.y=leap*.20;this.body.position.y-=crouch*.055;this.body.rotation.x=-leap*.08;
        for(const leg of this.legs)if(leg.custom){leg.root.rotation.x=-.35*leap+.23*crouch;leg.knee.rotation.x=.45*crouch-.12*leap;}
      }
    }
    const turn=THREE.MathUtils.clamp(frame?.turn??0,-3,3)*still;
    this.body.rotation.z-=turn*(this.species==='bulwark-boar'?.008:.015);
    if(tail){tail.rotation.y+=Math.sin(t*(walking?4:2.1)-.6)*.14*still-turn*.035;tail.rotation.x+=Math.sin(t*2.8-.9)*.035*still;}
    if(this.tailFlex)this.tailFlex.angles.set(Math.sin(t*(walking?5:2)-.8)*.09*still,Math.sin(t*(walking?5:2)-1.5)*.13*still);
    for(const [index,leaf] of this.leaves.entries()){
      const side=index===0?-1:1;
      leaf.root.rotation.z=-side*.22+Math.sin(t*(walking?6:2.5)-index*.45)*.09*still;
      leaf.flex.angles.set(Math.sin(t*(walking?7:2.5)-.6-index*.3)*.10*still,Math.sin(t*(walking?7:2.5)-1.2)*.15*still);
    }
    for(const wing of this.wings){
      const moth=this.species==='mistmoth',rate=moth?6.2:walking?15:3.2;
      const amplitude=moth?.40:walking?.72:.055;
      wing.root.rotation.z=-wing.side*(.12+Math.sin(t*rate)*amplitude*still);
      wing.root.rotation.x=Math.cos(t*rate-.7)*(moth?.09:.06)*still;
      wing.flex.angles.set(Math.sin(t*rate-.65)*.12*still,Math.sin(t*rate-1.3)*.18*still);
    }
    if(this.species==='mistmoth'&&!reduced){this.root.position.y=.06+Math.sin(t*2.7)*.035;this.body.rotation.x+=Math.sin(t*2.1)*.035;}
    if(motion==='alert'&&!reduced){if(head){head.rotation.x-=.10;head.rotation.y*=.3;}this.body.rotation.x-=.02;}
    if(['attack','hit','dodge','defeat','capture','assist'].includes(motion))this.action(motion,reduced?1:frame?.progress??cycle((time-this.started)/900),reduced);
    this.pose.blend(frame,reduced);
    for(const leg of this.legs)leg.flex.angles.set(leg.knee.rotation.x,leg.ankle.rotation.x);
    if(this.eyes){const b=cycle((t+phaseSeed)/5.1);this.eyes.scale.y=reduced?1:1-.92*envelope(b,.01,.023,.046);}
  }

  private idle(t:number,seed:number):void {
    const head=this.joints.head??this.joints.neck;
    if(!head)return;
    const p=cycle((t+seed)/8.4),habit=envelope(p,.35,.50,.73);
    switch(this.species){
      case 'tuftle':head.rotation.x+=habit*.20;head.rotation.z+=Math.sin(t*3)*habit*.07;break;
      case 'craghopper':head.rotation.y+=habit*.12;this.body.position.y-=habit*.015;break;
      case 'glade-stag':head.rotation.x-=habit*.22;head.rotation.y+=habit*.10;break;
      case 'snarlfox':head.rotation.x-=habit*.09;head.rotation.z+=habit*.11;break;
      case 'masonmole':head.rotation.x-=habit*.18;head.position.z-=habit*.025;break;
      case 'slingtail':head.rotation.y+=habit*.25;head.rotation.z+=habit*.06;break;
      case 'bulwark-boar':head.rotation.x-=habit*.16;this.body.rotation.z+=Math.sin(t*1.8)*habit*.01;break;
      case 'quillfinch':head.rotation.x-=envelope(p,.40,.43,.49)*.45;head.rotation.z+=habit*.12;break;
      case 'mistmoth':head.rotation.z+=Math.sin(t*1.4)*.035;break;
    }
  }

  private action(motion:CreatureMotion,p:number,reduced:boolean):void {
    if(reduced&&motion!=='defeat'&&motion!=='capture')return;
    const head=this.joints.head??this.joints.neck;
    const wind=envelope(p,0,.24,.40),strike=envelope(p,.25,.45,.77),recoil=envelope(p,0,.18,1);
    if(motion==='attack'){
      this.body.position.y-=wind*.045;this.body.rotation.x=-wind*.10+strike*.18;
      if(head)head.rotation.x+=this.species==='glade-stag'?wind*.18-strike*.34:wind*.07-strike*.20;
      for(const leg of this.legs)leg.root.rotation.x+=(leg.name.startsWith('front')?-.25:.16)*strike;
      if(this.species==='tuftle'||this.species==='craghopper')this.root.position.y+=strike*.17;
      if(this.species==='quillfinch'||this.species==='mistmoth')this.body.rotation.z+=strike*.16;
    }else if(motion==='hit'){
      this.body.rotation.x=-recoil*.17;this.body.scale.y*=1-recoil*.05;this.body.scale.z*=1+recoil*.025;
      if(head)head.rotation.x+=recoil*.20;
    }else if(motion==='dodge'){
      const evade=envelope(p,0,.4,1);this.body.rotation.z=evade*.22;this.body.position.y-=evade*.045;
    }else if(motion==='assist'){
      const show=envelope(p,0,.4,1);if(head)head.rotation.x-=show*.18;this.root.position.y+=show*.08;
      for(const leaf of this.leaves)leaf.root.rotation.z*=1-show*.5;
    }else if(motion==='defeat'){
      const fall=ease(p);this.whole.rotation.z=fall*1.35;this.whole.position.y=fall*.14;
      for(const leg of this.legs){leg.root.rotation.z+=(leg.name.toLowerCase().includes('left')?1:-1)*fall*.35;leg.knee.rotation.x+=fall*.5;}
      if(head)head.rotation.x+=fall*.2;
    }else if(motion==='capture'){
      const soften=ease((p-.15)/.65);this.whole.scale.setScalar(1-soften*.40);
      if(head)head.rotation.x+=soften*.15;
    }
  }
}
