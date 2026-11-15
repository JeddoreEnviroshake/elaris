import * as THREE from 'three';
import {companionAbility} from '../content/companionAbilities';
import type {SpeciesId} from '../simulation/state';
import {battleActorPositions,creatureAttackStyle,type BattleRoundPresentation} from './battleState';
import {BATTLE_TIMING} from '../presentation/combatTiming';
export {BATTLE_TIMING} from '../presentation/combatTiming';

export type CombatEffectKind = 'charge'|'bolt'|'arrow'|'slash'|'impact'|'fizzle'|'snare'|'capture'|'guard'|'heal'|'wind'|'stone'|'dodge';
export interface EffectPoint {readonly x:number;readonly y:number;readonly z:number}
export interface CombatEffectCue {
  readonly kind:CombatEffectKind;
  readonly at:number;
  readonly duration:number;
  readonly from:EffectPoint;
  readonly to:EffectPoint;
  readonly color:number;
  readonly critical?:boolean;
  readonly reducedTo?:EffectPoint;
}
export const COMBAT_PALETTE={arcane:0x6ff3dc,ivory:0xffefd0,gold:0xffcb70,leaf:0xa5df85,stone:0xd7ad81,enemy:0xf18f70,mist:0xb9b3f2};
const clamp=(x:number):number=>Math.max(0,Math.min(1,x));
const ease=(x:number):number=>{const t=clamp(x);return t*t*(3-2*t);};
const point=(x:number,y:number,z:number):EffectPoint=>({x,y,z});
export function companionEffectKind(species:SpeciesId,event:BattleRoundPresentation):CombatEffectKind {
  const ability=event.result.companionAbility;
  const kind=ability?companionAbility(species,ability.abilityId)?.effect.kind:null;
  if(kind==='heal')return 'heal';
  if(kind==='recover-stamina')return 'wind';
  if(kind==='guard'||kind==='reduce-enemy-power'||kind==='prevent-retreat')return 'guard';
  if(kind==='player-dodge-bonus'||kind==='move-player'||kind==='player-hit-bonus')return 'wind';
  return ['craghopper','masonmole','bulwark-boar','slingtail'].includes(species)?'stone':'wind';
}
export function companionEffectBeat(event:BattleRoundPresentation):number {
  const species=event.before.companionSpeciesId,id=event.result.companionAbility?.abilityId;
  const ability=species&&id?companionAbility(species,id):null;
  return ability?.timing==='beforePlayerAction'?.03:ability?.timing==='beforeEnemyAction'?.58:.39;
}

/** Only resolved outcomes create hit effects. Presentation never rolls damage or RNG. */
export function battleEffectCues(event:BattleRoundPresentation):CombatEffectCue[] {
  const release=battleActorPositions(event,BATTLE_TIMING.release),impact=battleActorPositions(event,BATTLE_TIMING.impact);
  const settled=battleActorPositions(event,1,true);
  const p=point(release.playerX,1.05,.35),c=point(impact.creatureX,1,-.2),cues:CombatEffectCue[]=[];
  const add=(kind:CombatEffectKind,at:number,duration:number,from:EffectPoint,to:EffectPoint,color:number,critical=false,anchor:'player'|'creature'='creature'):void=>{
    cues.push({kind,at:at*BATTLE_TIMING.duration,duration,from,to,color,critical,reducedTo:point(anchor==='player'?settled.playerX:settled.creatureX,to.y,to.z)});
  };
  const strike=event.result.playerStrike,hit=!!strike&&!['miss','dodge'].includes(strike.outcome);
  const target=hit?c:point(c.x+.6,c.y,c.z-.7);
  if(event.action==='magic'){
    add('charge',0,250,p,p,COMBAT_PALETTE.arcane,false,'player');
    add('bolt',BATTLE_TIMING.release,184,p,target,COMBAT_PALETTE.arcane);
  }else if(event.action==='ranged')add('arrow',BATTLE_TIMING.release,184,p,target,COMBAT_PALETTE.gold);
  else if(event.action==='melee')add('slash',.20,235,p,target,COMBAT_PALETTE.ivory);
  if(strike)add(hit?'impact':strike.outcome==='dodge'?'dodge':'fizzle',BATTLE_TIMING.impact,hit?420:320,c,strike.outcome==='miss'?target:c,
    strike.outcome==='crit'?COMBAT_PALETTE.gold:event.action==='magic'?COMBAT_PALETTE.arcane:COMBAT_PALETTE.ivory,strike.outcome==='crit');
  if(event.action==='snare'){
    add('snare',BATTLE_TIMING.release,220,p,c,COMBAT_PALETTE.gold);
    add(event.result.tamed?'capture':'fizzle',.37,event.result.tamed?1450:400,c,c,event.result.tamed?COMBAT_PALETTE.leaf:COMBAT_PALETTE.gold);
  }
  if(event.action==='berry'||event.action==='rest')add(event.action==='berry'?'heal':'wind',.18,650,p,p,event.action==='berry'?COMBAT_PALETTE.leaf:COMBAT_PALETTE.gold,false,'player');
  const assist=event.result.companionAbility,species=event.before.companionSpeciesId;
  if(assist&&species){
    const kind=companionEffectKind(species,event),at=companionEffectBeat(event),pose=battleActorPositions(event,at);
    const enemy=kind==='stone'||(assist.damage??0)>0,dest=enemy?point(pose.creatureX,1,-.2):point(pose.playerX,1.05,.35);
    add(kind,at,620,point(pose.playerX-1.05,.65,1.15),dest,kind==='stone'?COMBAT_PALETTE.stone:(assist.recoveredStamina??0)>0?COMBAT_PALETTE.gold:species==='mistmoth'?COMBAT_PALETTE.mist:COMBAT_PALETTE.leaf,false,enemy?'creature':'player');
  }
  const counter=event.result.creatureStrike;
  if(counter){
    const style=counter.style??creatureAttackStyle(event.before.speciesId),launch=battleActorPositions(event,.63),reply=battleActorPositions(event,BATTLE_TIMING.reply);
    const from=point(launch.creatureX,1,-.2),to=point(reply.playerX,1.05,.35);
    const target=counter.outcome==='dodge'?point(to.x-.6,to.y,to.z+.7):to;
    if(style!=='melee')add(style==='magic'?'bolt':'arrow',.63,195,from,target,style==='magic'?event.before.speciesId==='snarlfox'?0xffb36e:COMBAT_PALETTE.mist:COMBAT_PALETTE.enemy,false,'player');
    else add('slash',.67,220,from,to,COMBAT_PALETTE.enemy,false,'player');
    const blocked=counter.outcome!=='dodge'&&counter.damage===0;
    add(counter.outcome==='dodge'?'dodge':blocked?'guard':'impact',BATTLE_TIMING.reply,350,to,to,blocked?COMBAT_PALETTE.leaf:COMBAT_PALETTE.enemy,counter.outcome==='crit','player');
  }
  return cues;
}

const MAX_CUES=24,MAX_GLYPHS=192,MAX_SHARDS=512;
const GROUND=-Math.PI/2;
const X_AXIS=new THREE.Vector3(1,0,0);
const Y_AXIS=new THREE.Vector3(0,1,0);

/** Two persistent GPU batches for every spell, trail, glyph and spark. No per-frame meshes or lights. */
export class CombatEffects {
  readonly root=new THREE.Group();
  private readonly cues:CombatEffectCue[]=[];
  private readonly glyphs:THREE.InstancedMesh<THREE.PlaneGeometry,THREE.ShaderMaterial>;
  private readonly shards:THREE.InstancedMesh<THREE.OctahedronGeometry,THREE.MeshBasicMaterial>;
  private readonly params=new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLYPHS*3),3);
  private readonly transform=new THREE.Object3D();
  private readonly color=new THREE.Color();
  private readonly direction=new THREE.Vector3();
  private glyphCount=0;
  private shardCount=0;
  private disposed=false;

  constructor(){
    this.root.name='woodland-combat-effects';
    const plane=new THREE.PlaneGeometry(2,2);plane.setAttribute('effectParams',this.params);
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
      vertexShader:`attribute vec3 effectParams;
        varying vec2 vUv; varying vec3 vColor; varying vec3 vEffect;
        void main(){vUv=uv*2.-1.;vColor=instanceColor;vEffect=effectParams;
          if(effectParams.x>1.5&&effectParams.x<2.5){
            vec4 center=modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
            vec3 axis=(modelMatrix*instanceMatrix*vec4(1.,0.,0.,0.)).xyz;
            float width=length((modelMatrix*instanceMatrix*vec4(0.,1.,0.,0.)).xyz);
            vec3 side=normalize(cross(normalize(axis),normalize(cameraPosition-center.xyz)));
            gl_Position=projectionMatrix*viewMatrix*vec4(center.xyz+axis*position.x+side*width*position.y,1.);
          }else gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
      fragmentShader:`varying vec2 vUv; varying vec3 vColor; varying vec3 vEffect;
        float band(float d,float r,float w){return 1.-smoothstep(w,w+.025,abs(d-r));}
        void main(){vec2 p=vUv;float r=length(p),a=atan(p.y,p.x),mask=0.;float style=vEffect.x;
          if(style<.5){
            float runes=step(.42,sin(a*12.+vEffect.z))*band(r,.69,.035);
            float spokes=pow(max(0.,cos(a*6.+vEffect.z)),28.)*step(.72,r)*step(r,.9);
            mask=band(r,.9,.014)+band(r,.54,.012)*.65+runes*.9+spokes*.8;
          }else if(style<1.5){
            float sweep=smoothstep(-2.7,-1.8,a)*(1.-smoothstep(.8,1.6,a));
            mask=(band(r,.76,.025)+band(r,.63,.07)*.35)*sweep;
          }else if(style<2.5){
            mask=exp(-p.y*p.y*80.)*(1.-smoothstep(.4,1.,abs(p.x)));
          }else if(style<3.5){
            mask=exp(-r*r*5.)*(1.-smoothstep(.65,1.,r));
          }else if(style<4.5){
            float rays=pow(abs(cos(a*4.)),18.)*(1.-smoothstep(.1,.95,r));
            mask=rays+exp(-r*r*28.);
          }else if(style<5.5){
            float hex=cos(mod(a+3.141593/6.,3.141593/3.)-3.141593/6.)*r;
            mask=band(hex,.64,.022)+band(hex,.49,.014)*.5+(1.-smoothstep(.0,.8,r))*.10;
          }else{
            mask=(1.-smoothstep(.10,.15,abs(p.x)))*(1.-smoothstep(.46,.55,abs(p.y)))
              +(1.-smoothstep(.10,.15,abs(p.y)))*(1.-smoothstep(.46,.55,abs(p.x)));
          }
          float alpha=min(1.,mask)*vEffect.y;
          if(alpha<.006)discard;gl_FragColor=vec4(vColor,alpha);
        }`,
    });
    this.glyphs=new THREE.InstancedMesh(plane,material,MAX_GLYPHS);
    this.glyphs.name='combat-glyph-batch';
    this.shards=new THREE.InstancedMesh(new THREE.OctahedronGeometry(1,0),new THREE.MeshBasicMaterial({
      transparent:true,opacity:.85,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
    }),MAX_SHARDS);
    this.shards.name='combat-shard-batch';
    for(const batch of [this.glyphs,this.shards]){
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);batch.frustumCulled=false;batch.count=0;batch.renderOrder=4;
    }
    // Allocate instance color buffers once, including before the first visible effect.
    this.glyphs.setColorAt(0,this.color);this.shards.setColorAt(0,this.color);
    this.params.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.glyphs,this.shards);
  }

  get activeCount():number{return this.cues.length;}
  get instanceCount():number{return this.glyphCount+this.shardCount;}
  emit(cue:CombatEffectCue):void {
    if(this.disposed||cue.duration<=0)return;
    if(this.cues.length===MAX_CUES)this.cues.shift();
    this.cues.push({...cue,from:{...cue.from},to:{...cue.to}});
  }
  playBattle(event:BattleRoundPresentation,at:number):void {
    this.clear();
    for(const cue of battleEffectCues(event))this.emit({...cue,at:at+cue.at});
  }
  clear():void {this.cues.length=0;this.glyphCount=this.shardCount=0;this.glyphs.count=this.shards.count=0;}
  update(timeMs:number,reducedMotion:boolean):void {
    if(this.disposed)return;
    this.glyphCount=this.shardCount=0;
    for(let i=this.cues.length-1;i>=0;i--){
      const cue=this.cues[i]!;
      if(timeMs>=cue.at+cue.duration){this.cues.splice(i,1);continue;}
      if(timeMs<cue.at)continue;
      const t=clamp((timeMs-cue.at)/cue.duration);
      if(reducedMotion){
        // A stable, low-opacity symbol replaces travel, rotation, flashes and bursts.
        const at=cue.reducedTo??(cue.kind==='charge'?cue.from:cue.to);
        const opacity=.28*Math.min(1,t*6,(1-t)*6);
        this.glyph(at.x,.06,at.z,.52,.52,cue.color,opacity,cue.kind==='guard'?5:cue.kind==='heal'?6:0,0,true);
      }else this.draw(cue,t);
    }
    this.glyphs.count=this.glyphCount;this.shards.count=this.shardCount;
    this.glyphs.visible=this.glyphCount>0;this.shards.visible=this.shardCount>0;
    if(this.glyphCount){this.glyphs.instanceMatrix.needsUpdate=true;this.glyphs.instanceColor!.needsUpdate=true;this.params.needsUpdate=true;}
    if(this.shardCount){this.shards.instanceMatrix.needsUpdate=true;this.shards.instanceColor!.needsUpdate=true;}
  }
  dispose():void {
    if(this.disposed)return;this.clear();this.disposed=true;
    this.glyphs.dispose();this.shards.dispose();
    this.glyphs.geometry.dispose();this.glyphs.material.dispose();this.shards.geometry.dispose();this.shards.material.dispose();this.root.clear();
  }

  private glyph(x:number,y:number,z:number,sx:number,sy:number,color:number,alpha:number,style:number,rotation=0,ground=false,yaw=0):void {
    if(this.glyphCount>=MAX_GLYPHS||alpha<=0)return;
    this.transform.position.set(x,y,z);this.transform.rotation.set(ground?GROUND:0,yaw,rotation,'YXZ');this.transform.scale.set(sx,sy,1);
    this.writeGlyph(color,alpha,style,rotation);
  }
  private writeGlyph(color:number,alpha:number,style:number,phase:number):void {
    const i=this.glyphCount++;this.transform.updateMatrix();this.glyphs.setMatrixAt(i,this.transform.matrix);
    this.glyphs.setColorAt(i,this.color.setHex(color));this.params.setXYZ(i,style,alpha,phase);
  }
  private streak(ax:number,ay:number,az:number,bx:number,by:number,bz:number,width:number,color:number,alpha:number):void {
    if(this.glyphCount>=MAX_GLYPHS)return;
    this.direction.set(bx-ax,by-ay,bz-az);const length=this.direction.length();if(length<.001)return;
    this.transform.position.set((ax+bx)/2,(ay+by)/2,(az+bz)/2);
    this.transform.quaternion.setFromUnitVectors(X_AXIS,this.direction.divideScalar(length));
    this.transform.scale.set(length*.65,width,1);this.writeGlyph(color,alpha,2,0);
  }
  private shard(x:number,y:number,z:number,size:number,color:number,t:number,stretch=1):void {
    if(this.shardCount>=MAX_SHARDS||size<=.001)return;
    this.transform.position.set(x,y,z);this.transform.rotation.set(t*2,t*3,t);this.transform.scale.set(size,size*stretch,size*.55);
    this.transform.updateMatrix();this.shards.setMatrixAt(this.shardCount,this.transform.matrix);
    this.shards.setColorAt(this.shardCount++,this.color.setHex(color));
  }
  private arrowPart(x:number,y:number,z:number,width:number,length:number,color:number):void {
    if(this.shardCount>=MAX_SHARDS)return;
    this.transform.position.set(x,y,z);this.transform.quaternion.setFromUnitVectors(Y_AXIS,this.direction);
    this.transform.scale.set(width,length,width);this.transform.updateMatrix();
    this.shards.setMatrixAt(this.shardCount,this.transform.matrix);this.shards.setColorAt(this.shardCount++,this.color.setHex(color));
  }

  private draw(cue:CombatEffectCue,t:number):void {
    const {from:f,to:p,color,kind}=cue,fade=1-ease(t),wave=Math.sin(t*Math.PI);
    if(kind==='charge'){
      this.glyph(f.x,.055,f.z,.8,.8,COMBAT_PALETTE.gold,wave*.7,0,-t*.5,true);
      this.glyph(f.x,f.y,f.z,.24+t*.15,.24+t*.15,color,wave*.8,3);
      for(let i=0;i<14;i++){const a=i*2.4+t*3,r=.62*(1-t)+.08;
        this.shard(f.x+Math.cos(a)*r,f.y+Math.sin(a)*r,f.z+Math.sin(a*2)*r*.5,.035*wave,color,a,1.6);}
    }else if(kind==='bolt'||kind==='arrow'||kind==='snare'){
      const travel=ease(t),arc=kind==='snare'?1.05:kind==='arrow'?.16:.25;
      const x=THREE.MathUtils.lerp(f.x,p.x,travel),y=THREE.MathUtils.lerp(f.y,p.y,travel)+Math.sin(travel*Math.PI)*arc,z=THREE.MathUtils.lerp(f.z,p.z,travel);
      if(kind==='snare'){
        this.glyph(x,y,z,.33,.33,color,.9,0,t*8,false);this.glyph(x,y,z,.34,.34,color,.6,0,-t*6,true);
      }else{
        for(let j=1;j<=8;j++){
          const back=ease(Math.max(0,t-j*.025)),bx=THREE.MathUtils.lerp(f.x,p.x,back),by=THREE.MathUtils.lerp(f.y,p.y,back)+Math.sin(back*Math.PI)*arc,bz=THREE.MathUtils.lerp(f.z,p.z,back);
          const next=ease(Math.max(0,t-(j-1)*.025)),nx=THREE.MathUtils.lerp(f.x,p.x,next),ny=THREE.MathUtils.lerp(f.y,p.y,next)+Math.sin(next*Math.PI)*arc,nz=THREE.MathUtils.lerp(f.z,p.z,next);
          this.streak(bx,by,bz,nx,ny,nz,(kind==='bolt'?.13:.025)*(1-j/10),color,(1-j/10)*.7);
          if(kind==='bolt'){
            const a=t*16-j;
            this.streak(bx,by+Math.sin(a)*.13,bz+Math.cos(a)*.13,nx,ny+Math.sin(a+1)*.13,nz+Math.cos(a+1)*.13,.025,color,(1-j/10)*.65);
            this.shard(bx,by+Math.sin(a)*.13,bz+Math.cos(a)*.13,.032*(1-j/10),j%3?color:COMBAT_PALETTE.gold,j+t);
          }
        }
        if(kind==='bolt')this.glyph(x,y,z,.35,.35,color,.65,3);
        this.glyph(x,y,z,kind==='bolt'?.12:.07,kind==='bolt'?.12:.07,COMBAT_PALETTE.ivory,.85,3);
        if(kind==='bolt')this.shard(x,y,z,.075,color,t,1.4);
        else{
          this.direction.set(p.x-f.x,p.y-f.y+Math.cos(travel*Math.PI)*arc*Math.PI,p.z-f.z).normalize();
          this.arrowPart(x,y,z,.016,.28,0xbba174);
          this.arrowPart(x+this.direction.x*.30,y+this.direction.y*.30,z+this.direction.z*.30,.055,.10,0xe6eee3);
          this.arrowPart(x-this.direction.x*.22,y-this.direction.y*.22,z-this.direction.z*.22,.06,.09,color);
        }
      }
    }else if(kind==='slash'){
      const yaw=-Math.atan2(p.z-f.z,p.x-f.x),x=THREE.MathUtils.lerp(f.x,p.x,.78),z=THREE.MathUtils.lerp(f.z,p.z,.78);
      this.glyph(x,p.y,z,.85,.68,color,wave*.85,1,-.85+t*2.7,false,yaw);
      this.glyph(x,p.y+.05,z,.70,.58,COMBAT_PALETTE.gold,wave*.35,1,-1+t*2.7,false,yaw);
    }else if(kind==='impact'||kind==='stone'||kind==='fizzle'){
      const hit=kind!=='fizzle',size=cue.critical?1.3:kind==='stone'?1.15:.8;
      if(hit){
        this.glyph(p.x,p.y,p.z,size*(.45+t),size*(.45+t),color,fade*.8,4,t*.4);
        this.glyph(p.x,.065,p.z,(.35+t*1.1)*size,(.35+t*1.1)*size,color,fade*.5,0,0,true);
      }
      const count=hit?cue.critical?26:18:7;
      for(let i=0;i<count;i++){
        const a=i*2.399963,r=(.12+t*(.7+(i%5)*.16))*size;
        this.shard(p.x+Math.cos(a)*r,p.y+Math.sin(a*1.7)*r*.65+t*.45-t*t*.9,p.z+Math.sin(a)*r,
          (.035+(i%3)*.014)*fade,hit?i%4===0?COMBAT_PALETTE.ivory:color:0xa1afa4,a+t*3,kind==='stone'?1:2.3);
      }
    }else if(kind==='guard'){
      this.glyph(p.x+.35,p.y,p.z,.76,.91,color,wave*.55,5,0,false,-.22);
      this.glyph(p.x,.065,p.z,.8,.8,color,wave*.45,0,0,true);
      for(let i=0;i<8;i++){const a=i*Math.PI/4;this.shard(p.x+.35+Math.cos(a)*.65,p.y+Math.sin(a)*.75,p.z,.035*wave,COMBAT_PALETTE.ivory,a);}
    }else if(kind==='capture'){
      for(let j=0;j<3;j++)this.glyph(p.x,.16+j*.43,p.z,(.84-j*.14)*(1-t*.25),(.84-j*.14)*(1-t*.25),j===1?COMBAT_PALETTE.gold:color,wave*.65,0,t*(j%2?-2:2),true);
      for(let i=0;i<22;i++){const a=i*2.4+t*5,r=.75*(1-t*.55);this.shard(p.x+Math.cos(a)*r,.15+(i%7)*.19+t*.55,p.z+Math.sin(a)*r,.035*wave,i%3?color:COMBAT_PALETTE.gold,a,1.6);}
    }else{
      // Healing, veils and evasive steps share leaves, with different paths and symbols.
      this.glyph(p.x,.065,p.z,.65+t*.35,.65+t*.35,color,wave*.5,0,-t*.7,true);
      if(kind==='heal')this.glyph(p.x,p.y+.3+t*.35,p.z,.25,.25,color,wave*.7,6);
      else if(kind==='dodge')this.glyph(p.x,p.y,p.z,.65,.7,color,wave*.3,1,-t*.3);
      for(let i=0;i<16;i++){
        const a=i*2.4+t*(kind==='heal'?2:4),r=.45+(i%3)*.1;
        this.shard(p.x+Math.cos(a)*r,.15+((i%5)/5+t)*.85,p.z+Math.sin(a)*r,.045*wave,color,a,2.1);
      }
    }
  }
}
