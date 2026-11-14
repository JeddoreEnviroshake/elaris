import * as THREE from 'three';
import type {PlayerMotion,GatherToolKind} from './characterRigs';
import type {buildWarden} from './playerModel';
import {PoseRig,cycle,ease,envelope,footCycle,solveLeg,type AnimationFrame} from './animationMotion';
import {SoftJoints} from './softJoints';

type Warden=ReturnType<typeof buildWarden>;
const TAU=Math.PI*2;

/** Distance-driven locomotion, local action timelines and secondary cloth motion. */
export class WardenAnimator {
  readonly hips=new THREE.Group();
  readonly leftElbow=new THREE.Group();readonly rightElbow=new THREE.Group();
  readonly leftKnee=new THREE.Group();readonly rightKnee=new THREE.Group();
  readonly leftAnkle=new THREE.Group();readonly rightAnkle=new THREE.Group();
  private readonly leftArmFlex:SoftJoints;private readonly rightArmFlex:SoftJoints;
  private readonly leftLegFlex:SoftJoints;private readonly rightLegFlex:SoftJoints;
  private readonly clothFlex:SoftJoints;
  private readonly pose:PoseRig;
  private readonly eyes:THREE.Object3D|undefined;
  private started=0;private previous='';

  constructor(private readonly w:Warden) {
    const {root,torso,head,leftArm,rightArm,leftLeg,rightLeg,cloak}=w;
    this.hips.name='player.hips';this.hips.position.y=.68;root.add(this.hips);
    root.updateMatrixWorld(true);
    for(const object of [torso,leftLeg,rightLeg,root.getObjectByName('warden.belt-and-satchel')!])this.hips.attach(object);
    for(const object of [head,leftArm,rightArm,cloak])torso.attach(object);
    for(const [group,parent,name,y] of [[this.leftElbow,leftArm,'left-elbow',-.30],[this.rightElbow,rightArm,'right-elbow',-.30],
      [this.leftKnee,leftLeg,'left-knee',-.30],[this.rightKnee,rightLeg,'right-knee',-.30],
      [this.leftAnkle,this.leftKnee,'left-ankle',-.26],[this.rightAnkle,this.rightKnee,'right-ankle',-.26]] as const){
      group.name=name;group.position.y=y;parent.add(group);
    }
    const mesh=(group:THREE.Group):THREE.Mesh=>group.children.find(child=>child instanceof THREE.Mesh) as THREE.Mesh;
    this.leftArmFlex=new SoftJoints(mesh(leftArm),-.30);this.rightArmFlex=new SoftJoints(mesh(rightArm),-.30);
    this.leftLegFlex=new SoftJoints(mesh(leftLeg),-.30,-.56);this.rightLegFlex=new SoftJoints(mesh(rightLeg),-.30,-.56);
    this.clothFlex=new SoftJoints(cloak,.22,-.15);this.clothFlex.softness.set(.23,.20);
    this.eyes=head.getObjectByName('expressive-eyes');
    this.pose=new PoseRig([this.hips,torso,head,leftArm,rightArm,leftLeg,rightLeg,cloak,this.leftElbow,this.rightElbow,
      this.leftKnee,this.rightKnee,this.leftAnkle,this.rightAnkle]);
  }

  animate(time:number,motion:PlayerMotion,reduced:boolean,tool:GatherToolKind,frame?:AnimationFrame):void {
    this.w.root.userData.animationMotion=motion;
    const {torso,head,leftArm,rightArm,leftLeg,rightLeg,cloak}=this.w;
    const key=`${motion}:${motion==='gather'?tool:''}`;
    if(key!==this.previous){this.started=time;this.previous=key;}
    this.pose.reset(key,frame);
    const t=time/1000,still=reduced?0:1,phase=frame?.phase??cycle(t/ .82);
    const speed=frame?.speed??(motion==='run'?4:motion==='walk'?2:motion==='ride'?2:0);
    const run=motion==='run',moving=motion==='walk'||run;
    const sprint=Math.max(0,Math.min(1,(speed-6)/3));
    const breathe=Math.sin(t*2.2)*still;
    torso.position.y+=breathe*.007;head.rotation.y=Math.sin(t*.63)*.035*still;
    this.leftElbow.rotation.x=-.07*still;this.rightElbow.rotation.x=-.07*still;
    if(moving&&!reduced) {
      const p=phase*TAU,bob=(run?-.09:-.045)+Math.cos(p*2)*(run?.018:.007);
      this.hips.position.y+=bob;
      this.hips.rotation.z=Math.sin(p)*(run?.045:.025);
      torso.rotation.y=Math.sin(p)*.075;torso.rotation.x=run?-.13:-.025;
      head.rotation.y=-torso.rotation.y*.5;head.rotation.z=-this.hips.rotation.z*.5;
      const amplitude=run?.65:.38;
      leftArm.rotation.x=Math.sin(p)*amplitude;rightArm.rotation.x=-Math.sin(p)*amplitude;
      leftArm.rotation.z=.04;rightArm.rotation.z=-.04;
      this.leftElbow.rotation.x=-(run?.9:.20)-Math.max(0,-Math.sin(p))*.15;
      this.rightElbow.rotation.x=-(run?.9:.20)-Math.max(0,Math.sin(p))*.15;
      for(const [leg,knee,ankle,offset] of [[leftLeg,this.leftKnee,this.leftAnkle,0],[rightLeg,this.rightKnee,this.rightAnkle,.5]] as const){
        const foot=footCycle(phase+offset,run?.25+sprint*.025:.222,run?.17+sprint*.035:.115,run?.28-sprint*.05:.60);
        const solve=solveLeg(-.56-bob+foot.lift,foot.z,.30,.26);
        leg.rotation.x=solve.hip;knee.rotation.x=solve.knee;ankle.rotation.x=-solve.hip-solve.knee+foot.roll;
      }
    } else if(motion==='ready') {
      leftArm.rotation.x=-.23;rightArm.rotation.x=-.28;
      this.leftElbow.rotation.x=-.30;this.rightElbow.rotation.x=-.38;
      if(!reduced)head.rotation.y=0;
    } else if(motion==='ride') {
      const riding=still*Math.min(1,speed/.4),p=phase*TAU;
      this.hips.position.y+=Math.sin(p*2-.25)*.025*riding;
      this.hips.rotation.x=Math.sin(p*2)*.035*riding;
      torso.rotation.x=-.065+Math.sin(p*2-.5)*.025*riding;
      leftLeg.rotation.set(-.80,0,-.46);rightLeg.rotation.set(-.80,0,.46);
      this.leftKnee.rotation.x=.45;this.rightKnee.rotation.x=.45;
      this.leftAnkle.rotation.x=.10;this.rightAnkle.rotation.x=.10;
      leftArm.rotation.set(-.58+Math.sin(p*2-.7)*.035*riding,0,.16);
      rightArm.rotation.set(-.58+Math.sin(p*2-.7)*.035*riding,0,-.16);
      this.leftElbow.rotation.x=-.62;this.rightElbow.rotation.x=-.62;head.rotation.x=-.035;
    } else if(motion==='gather'&&!reduced) {
      const period=tool==='pickaxe'?780:tool==='sickle'?680:tool==='hands'?650:880;
      const p=frame?.progress??cycle((time-this.started)/period);
      const wind=envelope(p,0,.26,.43),strike=envelope(p,.26,.45,.78),recover=1-ease((p-.70)/.30);
      const light=tool==='sickle'||tool==='hands';
      torso.rotation.y=(light?-.20:-.28)*wind+(light?.32:.18)*strike;
      torso.rotation.x=(light?.20:.09)*strike;
      head.rotation.x=.12+strike*.08;
      rightArm.rotation.x=-.38-(light?.35:1.30)*wind-.50*strike;
      rightArm.rotation.z=-.12-(light?.42:.18)*strike;
      this.rightElbow.rotation.x=-.32-.82*wind+.18*strike;
      leftArm.rotation.x=tool==='hands'?rightArm.rotation.x*.75:-.24-.28*wind;
      this.leftElbow.rotation.x=tool==='hands'?this.rightElbow.rotation.x:-.35;
      if(light)rightArm.rotation.y=-.55*wind+.65*strike;
      if(tool==='hands'){this.hips.position.y-=.12*recover;torso.rotation.x=.23*recover;leftArm.rotation.z=.16;}
      if(tool==='pickaxe'){
        torso.rotation.y=-.07*wind+.05*strike;torso.rotation.x+=.10*strike;
        rightArm.rotation.x-=.15*wind;rightArm.rotation.z=-.06;rightArm.rotation.y=-.20*wind;
        leftArm.rotation.x=rightArm.rotation.x*.82;leftArm.rotation.z=.18;leftArm.rotation.y=.45*wind;
        this.leftElbow.rotation.x=this.rightElbow.rotation.x*.75-.20;
      }
      if(tool==='staff'){rightArm.rotation.x=-.55-.5*wind;this.rightElbow.rotation.x=-.65;torso.rotation.y=.12*strike;}
      this.hips.position.y-=strike*.025;
    } else if(['melee','ranged','cast','throw','hit','dodge','defeat','celebrate'].includes(motion)) {
      const p=reduced?1:frame?.progress??cycle((time-this.started)/900);
      this.action(motion,p,reduced);
    } else if(!reduced) {
      // A slow weight shift, breathing and a brief, occasional look around.
      const look=envelope(cycle((t+3.1)/9),.48,.64,.86);
      head.rotation.y+=look*.19;head.rotation.x=-look*.035;
      leftArm.rotation.x=breathe*.017;rightArm.rotation.x=-breathe*.017;
      this.hips.rotation.z=Math.sin(t*.8)*.009;
    }
    if(!reduced){
      if(!moving&&!frame?.mounted&&motion!=='idle'&&motion!=='ride'&&motion!=='defeat'&&motion!=='ready'){
        for(const [leg,knee,ankle] of [[leftLeg,this.leftKnee,this.leftAnkle],[rightLeg,this.rightKnee,this.rightAnkle]] as const){
          const z=-Math.sin(leg.rotation.x)*.56;
          const solve=solveLeg(.12-this.hips.position.y,z,.30,.26);
          leg.rotation.x=solve.hip;knee.rotation.x=solve.knee;ankle.rotation.x=-solve.hip-solve.knee;
        }
      }
      const lean=THREE.MathUtils.clamp(frame?.turn??0,-3,3);
      torso.rotation.z-=lean*.012;head.rotation.z+=lean*.008;
      cloak.rotation.x+=(moving?.10:motion==='ride'?.12:.025)*still;
      cloak.rotation.z=-lean*.014;
      this.clothFlex.angles.set(Math.sin(t*(moving?7:2.3)-.6)*(moving?.065:.018),Math.sin(t*(moving?7:2.3)-1.4)*(moving?.10:.026));
    } else this.clothFlex.angles.set(0,0);
    // Upper-body actions stay layered over the seated lower body.
    if(frame?.mounted&&motion!=='ride'){
      this.hips.position.y=.68+Math.sin(phase*TAU*2-.25)*.025*still;
      leftLeg.rotation.set(-.80,0,-.46);rightLeg.rotation.set(-.80,0,.46);
      this.leftKnee.rotation.x=.45;this.rightKnee.rotation.x=.45;
      this.leftAnkle.rotation.x=.10;this.rightAnkle.rotation.x=.10;
    }
    this.pose.blend(frame,reduced);
    this.leftArmFlex.angles.set(this.leftElbow.rotation.x,0);this.rightArmFlex.angles.set(this.rightElbow.rotation.x,0);
    this.leftLegFlex.angles.set(this.leftKnee.rotation.x,this.leftAnkle.rotation.x);
    this.rightLegFlex.angles.set(this.rightKnee.rotation.x,this.rightAnkle.rotation.x);
    if(this.eyes){const blink=cycle((t+1.46)/4.7);this.eyes.scale.y=reduced?1:1-.92*envelope(blink,.012,.024,.048);}
  }

  private action(motion:PlayerMotion,p:number,reduced:boolean):void {
    const {torso,head,leftArm,rightArm,leftLeg,rightLeg}=this.w;
    const wind=envelope(p,0,.24,.40),hit=envelope(p,.25,.43,.75),hold=envelope(p,0,.35,.80);
    if(motion==='melee'){
      torso.rotation.y=-wind*.55+hit*.60;rightArm.rotation.x=-.4-wind*1.5-hit*.8;
      rightArm.rotation.z=-.15-hit*.5;this.rightElbow.rotation.x=-.75*wind-.15;
      leftArm.rotation.x=-.25-hit*.25;leftLeg.rotation.x=-hit*.20;rightLeg.rotation.x=hit*.16;
    } else if(motion==='cast'){
      rightArm.rotation.x=-.45-hold*.95;this.rightElbow.rotation.x=-.55*hold;
      leftArm.rotation.x=-hold*.85;leftArm.rotation.z=hold*.35;this.leftElbow.rotation.x=-hold*.75;
      torso.rotation.x=-hold*.06;head.rotation.x=-hold*.09;
    } else if(motion==='ranged'){
      leftArm.rotation.x=-hold*1.35;leftArm.rotation.y=-hold*.30;
      rightArm.rotation.x=-hold*.95;rightArm.rotation.y=hold*.55;this.rightElbow.rotation.x=-hold*1.4;
      torso.rotation.y=-hold*.35;head.rotation.y=hold*.20;
    } else if(motion==='throw'){
      rightArm.rotation.x=-wind*2.2-hit*1.1;this.rightElbow.rotation.x=-wind*.8;
      torso.rotation.y=-wind*.3+hit*.4;leftArm.rotation.z=hold*.3;
    } else if(motion==='hit'){
      const recoil=envelope(p,0,.18,1);torso.rotation.x=-recoil*.22;head.rotation.x=recoil*.15;
      leftArm.rotation.x=-recoil*.4;rightArm.rotation.x=-recoil*.5;this.hips.position.y-=recoil*.045;
    } else if(motion==='dodge'){
      const duck=envelope(p,0,.42,1);this.hips.position.y-=duck*.16;torso.rotation.x=duck*.30;
      this.hips.rotation.z=-duck*.20;leftArm.rotation.z=duck*.25;rightArm.rotation.z=-duck*.25;
    } else if(motion==='defeat'){
      const fall=ease(p);this.hips.position.y-=fall*.3;torso.rotation.x=fall*.65;head.rotation.x=fall*.4;
      this.leftKnee.rotation.x=fall*.9;this.rightKnee.rotation.x=fall*.9;leftLeg.rotation.x=-fall*.5;rightLeg.rotation.x=-fall*.5;
    } else if(motion==='celebrate'){
      leftArm.rotation.z=hold*1.5;rightArm.rotation.z=-hold*1.5;head.rotation.x=-hold*.10;
    }
    if(reduced&&motion!=='defeat')return;
  }
}
