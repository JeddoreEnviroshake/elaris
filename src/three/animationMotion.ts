import * as THREE from 'three';

export interface AnimationFrame {
  readonly deltaSeconds?: number;
  readonly speed?: number;
  /** One full stride, advanced by distance rather than display frame count. */
  readonly phase?: number;
  /** Explicit local action progress; combat and gathering never use global phase. */
  readonly progress?: number;
  readonly turn?: number;
  readonly mounted?: boolean;
}

export const unit = (x:number):number => Math.max(0,Math.min(1,x));
export const ease = (x:number):number => {const t=unit(x);return t*t*(3-2*t);};
export const cycle = (x:number):number => ((x%1)+1)%1;
export function playerStride(speed:number):number {
  if(speed<=3.2)return .74;
  const sprint=unit((speed-6)/3);return 2*(.25+sprint*.025)/(.28-sprint*.05);
}
export const envelope = (p:number,start:number,peak:number,end:number):number =>
  p<peak?ease((p-start)/(peak-start)):1-ease((p-peak)/(end-peak));

/** Foot stays down for the stance interval, then arcs back during swing. */
export function footCycle(phase:number,stride:number,lift:number,contact=.60):{z:number;lift:number;roll:number} {
  const p=cycle(phase);
  if(p<contact)return {z:THREE.MathUtils.lerp(stride,-stride,p/contact),lift:0,roll:.07*Math.sin(p/contact*Math.PI*2)};
  const swing=(p-contact)/(1-contact);
  return {z:THREE.MathUtils.lerp(-stride,stride,ease(swing)),lift:Math.sin(swing*Math.PI)*lift,roll:-.12*Math.sin(swing*Math.PI)};
}

/** Analytic two-bone solve, with a stable bend direction and finite reach. */
export function solveLeg(y:number,z:number,upper:number,lower:number,bendDirection=1):{hip:number;knee:number} {
  const reach=Math.min(upper+lower-.00001,Math.max(Math.abs(upper-lower)+.00001,Math.hypot(y,z)));
  const knee=Math.acos(THREE.MathUtils.clamp((reach*reach-upper*upper-lower*lower)/(2*upper*lower),-1,1))*bendDirection;
  return {hip:Math.atan2(-z,-y)-Math.atan2(lower*Math.sin(knee),upper+lower*Math.cos(knee)),knee};
}

interface Track {x:number;z:number;heading:number;time:number;phase:number;speed:number;frame:{deltaSeconds:number;speed:number;phase:number;turn:number}}
/** Weak ownership means region changes cannot retain old animation tracks. */
export class MotionTracker {
  private readonly tracks=new WeakMap<THREE.Object3D,Track>();
  speed(root:THREE.Object3D):number{return this.tracks.get(root)?.speed??0;}
  sample(root:THREE.Object3D,time:number,x:number,z:number,heading:number,stride=.74):AnimationFrame {
    let track=this.tracks.get(root);
    if(!track){track={x,z,heading,time,phase:0,speed:0,frame:{deltaSeconds:1/60,speed:0,phase:0,turn:0}};this.tracks.set(root,track);return track.frame;}
    const dt=Math.max(.001,(time-track.time)/1000),distance=Math.hypot(x-track.x,z-track.z);
    const teleport=distance>3||dt>1.5;
    track.speed=teleport?0:THREE.MathUtils.lerp(track.speed,distance/dt,1-Math.exp(-dt*14));
    if(!teleport)track.phase=cycle(track.phase+distance/stride);
    const turn=teleport?0:Math.atan2(Math.sin(heading-track.heading),Math.cos(heading-track.heading))/dt;
    track.frame.deltaSeconds=Math.min(.1,dt);track.frame.speed=track.speed;
    track.frame.phase=track.phase;track.frame.turn=THREE.MathUtils.clamp(turn,-6,6);
    track.x=x;track.z=z;track.heading=heading;track.time=time;return track.frame;
  }
}

interface Rest {object:THREE.Object3D;position:THREE.Vector3;rotation:THREE.Euler;scale:THREE.Vector3;fromPosition:THREE.Vector3;fromRotation:THREE.Quaternion;fromScale:THREE.Vector3;targetRotation:THREE.Quaternion}
/** Reset every authored channel, then blend mode changes without accumulating transforms. */
export class PoseRig {
  private readonly rest:Rest[];
  private previous='';
  private elapsed=1;
  constructor(objects:readonly THREE.Object3D[]) {
    this.rest=[...new Set(objects)].map(object=>({object,position:object.position.clone(),rotation:object.rotation.clone(),scale:object.scale.clone(),
      fromPosition:object.position.clone(),fromRotation:object.quaternion.clone(),fromScale:object.scale.clone(),targetRotation:new THREE.Quaternion()}));
  }
  reset(mode:string,frame?:AnimationFrame):void {
    if(mode!==this.previous){
      for(const r of this.rest){r.fromPosition.copy(r.object.position);r.fromRotation.copy(r.object.quaternion);r.fromScale.copy(r.object.scale);}
      this.elapsed=this.previous?0:1;this.previous=mode;
    }
    this.elapsed+=frame?.deltaSeconds??1;
    for(const r of this.rest){r.object.position.copy(r.position);r.object.rotation.copy(r.rotation);r.object.scale.copy(r.scale);}
  }
  blend(frame:AnimationFrame|undefined,reduced:boolean):void {
    if(reduced||frame?.deltaSeconds===undefined||frame.progress!==undefined||this.elapsed>=.16)return;
    const amount=ease(this.elapsed/.16);
    for(const r of this.rest){r.object.position.lerpVectors(r.fromPosition,r.object.position,amount);
      r.targetRotation.copy(r.object.quaternion);
      r.object.quaternion.slerpQuaternions(r.fromRotation,r.targetRotation,amount);r.object.scale.lerpVectors(r.fromScale,r.object.scale,amount);}
  }
}

export function turnTowards(current:number,target:number,dt:number,rate=14):number {
  return current+Math.atan2(Math.sin(target-current),Math.cos(target-current))*(1-Math.exp(-dt*rate));
}
