import * as THREE from 'three';
import type { ModelLibrary } from './modelLibrary';
import { QuaterniusArt, releaseArt } from './quaterniusArt';
import { meadowMaterial } from './townEntrance';
import {CombatEffects,BATTLE_TIMING,companionEffectBeat} from './combatEffects';
import { creatureDefinition } from '../content/creatures';
import {
  createCreatureRig,
  createPlayerRig,
  type CreatureRig,
  type PlayerRig,
  type PlayerMotion,
  type CreatureMotion,
} from './characterRigs';
import {
  battleTrackToWorld,
  battleActorPositions,
  type BattlePresentationSnapshot,
  type BattleRoundPresentation,
} from './battleState';

interface HealthPlate {
  readonly sprite: THREE.Sprite;
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  signature: string;
}

interface ActiveRound {
  readonly event: BattleRoundPresentation;
  readonly startedAt: number;
}

interface BattleCaption {readonly sprite:THREE.Sprite;readonly at:number;readonly duration:number;readonly x:number;readonly y:number;readonly z:number}

const ROUND_DURATION_MS = BATTLE_TIMING.duration;
const TERMINAL_LINGER_MS = 2_250;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
};
const pulse = (value: number): number => Math.sin(clamp01(value) * Math.PI);

/** Presentation-only 3D diorama for the deterministic encounter simulation. */
export class ThreeBattleStage {
  readonly root = new THREE.Group();
  /** Player position inside the stage, in stage-local space, for camera framing. */
  readonly focus = new THREE.Vector3();
  private readonly arenaRoot = new THREE.Group();
  private readonly fighterRoot = new THREE.Group();
  private readonly effects = new CombatEffects();
  private readonly captionRoot = new THREE.Group();
  private readonly captions:BattleCaption[]=[];
  private readonly intentGlyph=new THREE.Mesh(new THREE.RingGeometry(.62,.68,48,1,.2,Math.PI*1.6).rotateX(-Math.PI/2),
    new THREE.MeshBasicMaterial({color:0xf18f70,transparent:true,opacity:.38,depthWrite:false,side:THREE.DoubleSide}));
  private playerRig: PlayerRig | null = null;
  private creatureRig: CreatureRig | null = null;
  private companionRig: CreatureRig | null = null;
  private playerPlate: HealthPlate | null = null;
  private creaturePlate: HealthPlate | null = null;
  private encounterId = '';
  private snapshot: BattlePresentationSnapshot | null = null;
  private activeRound: ActiveRound | null = null;
  private lingerUntil = Number.NEGATIVE_INFINITY;
  private art: QuaterniusArt | null = null;

  constructor(private readonly models?: ModelLibrary) {
    this.root.name = 'three-battle-stage';
    this.root.visible = false;
    this.root.add(this.arenaRoot, this.fighterRoot, this.effects.root,this.captionRoot,this.intentGlyph);
  }

  get roundAnimating(): boolean {
    return this.activeRound !== null;
  }
  get effectInstances():number{return this.effects.instanceCount;}

  playRound(event: BattleRoundPresentation): void {
    this.ensureEncounter(event.before);
    this.snapshot = event.resolved;
    const startedAt = performance.now();
    this.activeRound = { event, startedAt };
    this.effects.playBattle(event,startedAt);
    this.prepareCaptions(event,startedAt);
    if (event.result.ended) this.lingerUntil = startedAt + TERMINAL_LINGER_MS;
  }

  update(snapshot: BattlePresentationSnapshot | null, timeMs: number, reducedMotion: boolean): boolean {
    if (snapshot) {
      this.ensureEncounter(snapshot);
      this.snapshot = snapshot;
    }
    const active = snapshot !== null || this.activeRound !== null || timeMs < this.lingerUntil;
    this.root.visible = active;
    if (!active || !this.playerRig || !this.creatureRig || !this.snapshot) return false;

    const round = this.activeRound;
    const event = round?.event ?? null;
    const progress = round ? clamp01((timeMs - round.startedAt) / ROUND_DURATION_MS) : 1;
    const before = event?.before ?? this.snapshot;
    const resolved = event?.resolved ?? this.snapshot;
    let playerX = battleTrackToWorld(resolved.playerPos);
    let creatureX = battleTrackToWorld(resolved.creaturePos);

    if(event)({playerX,creatureX}=battleActorPositions(event,progress,reducedMotion));

    this.playerRig.root.position.set(playerX, 0, 0.35);
    this.focus.set((playerX+creatureX)/2, 0, 0.35);
    this.creatureRig.root.position.set(creatureX, 0, -0.2);
    this.intentGlyph.position.set(creatureX,.035,-.2);
    this.intentGlyph.visible=before.enemyIntent.includes('strike')&&(!event||progress<.68);
    this.playerRig.root.rotation.y = Math.PI / 2;
    this.creatureRig.root.rotation.y = Math.PI / 2;
    let playerMotion:PlayerMotion='ready',creatureMotion:CreatureMotion='alert';
    let playerProgress:number|undefined,creatureProgress:number|undefined;
    const playerHit=!!event?.result.creatureStrike&&event.result.creatureStrike.outcome!=='dodge'&&event.result.creatureStrike.damage>0;
    const creatureHit=!!event?.result.playerStrike&&!['miss','dodge'].includes(event.result.playerStrike.outcome)
      ||(event?.result.companionAbility?.damage??0)>0;
    const creatureImpact=event&&!event.result.playerStrike&&(event.result.companionAbility?.damage??0)>0?companionEffectBeat(event):BATTLE_TIMING.impact;
    if(event){
      if(progress<.43){
        playerMotion=event.action==='melee'?'melee':event.action==='magic'?'cast':event.action==='ranged'?'ranged':event.action==='snare'?'throw':event.result.playerMove?'walk':'ready';
        playerProgress=clamp01(progress/.43);
      }
      if(progress>creatureImpact&&progress<creatureImpact+.26){
        if(creatureHit){creatureMotion='hit';creatureProgress=(progress-creatureImpact)/.26;}
        else if(event.result.playerStrike?.outcome==='dodge'){creatureMotion='dodge';creatureProgress=(progress-BATTLE_TIMING.impact)/.26;}
      }
      if(event.result.creatureMove&&progress>.42&&progress<.70&&creatureMotion==='alert')creatureMotion='walk';
      if(event.result.creatureStrike&&progress>.58&&progress<.95){creatureMotion='attack';creatureProgress=(progress-.58)/.37;}
      if(event.result.creatureStrike&&progress>BATTLE_TIMING.reply&&progress<1){playerMotion=playerHit?'hit':event.result.creatureStrike.outcome==='dodge'?'dodge':'ready';playerProgress=(progress-BATTLE_TIMING.reply)/.20;}
      if(event.result.ended&&(event.result.defeated||event.result.tamed)&&progress>.52){
        creatureMotion=event.result.tamed?'capture':'defeat';creatureProgress=clamp01((progress-.52)/.45);
      }
      if(event.result.playerDefeated&&progress>BATTLE_TIMING.reply){playerMotion='defeat';playerProgress=clamp01((progress-BATTLE_TIMING.reply)/.20);}
    }
    const castingWithStaff = event?.action === 'magic' && event.before.magicStaffEquipped && progress < 0.55;
    this.playerRig.setGatherTool(castingWithStaff || (!event && this.snapshot.magicStaffEquipped)
      ? 'staff'
      : event?.action === 'melee' && progress < 0.45 ? 'axe' : event?.action==='ranged'&&progress<.45?'bow':'hands');
    this.playerRig.animate(timeMs,playerMotion,reducedMotion,playerProgress===undefined?undefined:{progress:playerProgress});
    this.creatureRig.animate(timeMs,creatureMotion,reducedMotion,creatureProgress===undefined?undefined:{progress:creatureProgress});

    this.animateReactions(event, progress, reducedMotion);
    this.effects.update(timeMs,reducedMotion);
    this.updateCaptions(timeMs,reducedMotion);
    this.updateCompanion(timeMs, event, progress, reducedMotion, playerX);

    const hpProgress = event ? smooth((progress - creatureImpact) / 0.14) : 1;
    const playerHpProgress=event?smooth((progress-(resolved.playerHp<before.playerHp?BATTLE_TIMING.reply:.39))/.14):1;
    const playerHp = Math.round(THREE.MathUtils.lerp(before.playerHp, resolved.playerHp, playerHpProgress));
    const creatureHp = Math.round(THREE.MathUtils.lerp(before.creatureHp, resolved.creatureHp, hpProgress));
    this.updateHealthPlate(this.playerPlate!, 'Ranger', playerHp, resolved.playerMaxHp, '#78d49b');
    this.updateHealthPlate(
      this.creaturePlate!,
      creatureDefinition(resolved.speciesId).displayName,
      creatureHp,
      resolved.creatureMaxHp,
      '#e46e68',
    );
    this.playerPlate!.sprite.position.set(playerX, 2.35, 0.35);
    this.creaturePlate!.sprite.position.set(creatureX, this.creatureHeight(resolved.speciesId), -0.2);

    if (round && progress >= 1) {
      if (!round.event.result.ended) {
        this.activeRound = null;
      } else if (timeMs >= this.lingerUntil) {
        this.activeRound = null;
      }
    }
    return true;
  }

  dispose(): void {
    this.art?.retire();
    this.effects.dispose();this.root.remove(this.effects.root);
    this.clearGroup(this.root);
  }

  private ensureEncounter(snapshot: BattlePresentationSnapshot): void {
    if (this.encounterId === snapshot.encounterId && this.playerRig && this.creatureRig) return;
    this.encounterId = snapshot.encounterId;
    this.snapshot = snapshot;
    this.activeRound = null;
    this.lingerUntil = Number.NEGATIVE_INFINITY;
    this.art?.retire();
    this.clearGroup(this.arenaRoot);
    this.art = this.models ? new QuaterniusArt(this.models, this.arenaRoot) : null;
    this.clearGroup(this.fighterRoot);
    this.effects.clear();this.clearGroup(this.captionRoot);this.captions.length=0;
    this.buildArena(snapshot.speciesId);

    this.playerRig = createPlayerRig();
    this.creatureRig = createCreatureRig(snapshot.speciesId);
    this.fighterRoot.add(this.playerRig.root, this.creatureRig.root);
    this.companionRig = snapshot.companionSpeciesId ? createCreatureRig(snapshot.companionSpeciesId) : null;
    if (this.companionRig) {
      this.companionRig.root.scale.setScalar(0.78);
      this.fighterRoot.add(this.companionRig.root);
    }
    this.playerPlate = this.createHealthPlate();
    this.creaturePlate = this.createHealthPlate();
    this.fighterRoot.add(this.playerPlate.sprite, this.creaturePlate.sprite);
  }

  private buildArena(speciesId: BattlePresentationSnapshot['speciesId']): void {
    const habitat = creatureDefinition(speciesId).habitat;
    const groundColor = habitat === 'forest' ? 0x42613c : habitat === 'hills' ? 0x665d4d : 0x627a48;
    const rimColor = habitat === 'hills' ? 0x777772 : 0x795637;
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(18,64).rotateX(-Math.PI/2),
      meadowMaterial(groundColor),
    );
    floor.position.y = -.07;
    floor.receiveShadow = true;
    floor.userData.sharedModelTextures=true;
    this.arenaRoot.add(floor);
    this.arenaRoot.userData.visualStyle = 'quaternius';
    if (this.art) {
      const background = [-8,-6.2,-4.3,-2.5,0,2.4,4.5,6.5,8].map((x,i) => ({x,y:-.07,z:-4.7-(i%3)*1.2,rotation:i*1.8,scale:.8+(i%2)*.2}));
      void this.art.batch(this.arenaRoot, habitat === 'hills' ? 'entrance.rock' : 'entrance.tree', background, habitat === 'hills' ? 2.2 : 4.4);
      void this.art.batch(this.arenaRoot,'entrance.fern', Array.from({length:18},(_,i)=>{
        const angle=i/18*Math.PI*2;
        return {x:Math.cos(angle)*5.9,y:-.02,z:Math.sin(angle)*3.65,rotation:angle};
      }),.35);
    }

    const rimMaterial = new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.92, flatShading: true });
    for (let index = 0; index < 22; index += 1) {
      const angle = (index / 22) * Math.PI * 2;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32 + (index % 3) * 0.04), rimMaterial);
      stone.position.set(Math.cos(angle) * 6.05, 0.06, Math.sin(angle) * 4.15);
      stone.scale.y = 0.62;
      stone.rotation.y = angle;
      stone.castShadow = true;
      this.arenaRoot.add(stone);
      void this.art?.surface(stone,'entrance.rock',.25);
    }
    for (const x of [-5.2, 5.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.65, 7), new THREE.MeshStandardMaterial({ color: 0x563b27, roughness: 0.9 }));
      post.position.set(x, 0.72, -2.9);
      post.castShadow = true;
      void this.art?.surface(post,'entrance.deck',.45);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.19, 0.55, 7),
        new THREE.MeshStandardMaterial({ color: 0xffb34f, emissive: 0xff5b20, emissiveIntensity: 1.8 }),
      );
      flame.position.set(x, 1.72, -2.9);
      const light = new THREE.PointLight(0xff7a35, 3.5, 5, 2);
      light.position.copy(flame.position);
      this.arenaRoot.add(post, flame, light);
    }
  }

  private animateReactions(event: BattleRoundPresentation | null, progress: number, reducedMotion: boolean): void {
    if (!event || reducedMotion || !this.playerRig || !this.creatureRig) return;
    // The articulated clips own recoil and terminal poses. Only the dodge step
    // offsets the whole fighter; no full-body shrinking or hit vibration.
    if(event.result.playerStrike?.outcome==='dodge'&&progress>BATTLE_TIMING.impact&&progress<.59){
      this.creatureRig.root.position.z-=pulse((progress-BATTLE_TIMING.impact)/.26)*.32;
    }
    if(event.result.creatureStrike?.outcome==='dodge'&&progress>BATTLE_TIMING.reply&&progress<1){
      this.playerRig.root.position.z+=pulse((progress-BATTLE_TIMING.reply)/.20)*.30;
    }
  }

  private updateCompanion(
    timeMs: number,
    event: BattleRoundPresentation | null,
    progress: number,
    reducedMotion: boolean,
    playerX: number,
  ): void {
    if (!this.companionRig) return;
    this.companionRig.root.position.set(playerX - 1.05, 0, 1.15);
    this.companionRig.root.rotation.y = -Math.PI / 2;
    const beat=event?companionEffectBeat(event):.39,start=Math.max(0,beat-.10),duration=.42;
    const acting = Boolean(event?.result.companionAbility) && progress > start && progress < start+duration;
    this.companionRig.animate(timeMs,acting?'assist':'idle',reducedMotion,acting?{progress:(progress-start)/duration}:undefined);
    if (acting && !reducedMotion) this.companionRig.root.position.y += pulse((progress-start)/duration) * 0.34;
  }

  private prepareCaptions(event:BattleRoundPresentation,startedAt:number):void {
    this.clearGroup(this.captionRoot);this.captions.length=0;
    const p=battleActorPositions(event,BATTLE_TIMING.reply).playerX,c=battleActorPositions(event,BATTLE_TIMING.impact).creatureX;
    const strike=event.result.playerStrike,counter=event.result.creatureStrike;
    if(strike)this.addCaption(strike.outcome==='miss'?'MISS':strike.outcome==='dodge'?'EVADE':`${strike.outcome==='crit'?'CRITICAL  ':''}${strike.damage}`,
      strike.outcome==='crit'?'#ffce79':event.action==='magic'?'#9ff7e7':'#fff0d4',c,this.creatureHeight(event.before.speciesId)+.4,-.2,startedAt+BATTLE_TIMING.impact*ROUND_DURATION_MS);
    if(counter)this.addCaption(counter.outcome==='dodge'?'EVADE':counter.damage===0?'BLOCKED':String(counter.damage),counter.damage===0?'#c0e9a4':'#ffb79d',p,2.65,.35,startedAt+BATTLE_TIMING.reply*ROUND_DURATION_MS);
    const assist=event.result.companionAbility;
    if(assist)this.addCaption(assist.displayName,'#c0e9a4',p-1.05,1.8,1.15,startedAt+companionEffectBeat(event)*ROUND_DURATION_MS);
    if(event.result.tamed)this.addCaption('BONDED','#ddf4ac',c,this.creatureHeight(event.before.speciesId)+.8,-.2,startedAt+650,1300);
  }

  private addCaption(text:string,color:string,x:number,y:number,z:number,at:number,duration=720):void {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
    const context=canvas.getContext('2d');if(!context)return;
    context.textAlign='center';context.textBaseline='middle';context.font='900 36px Trebuchet MS, sans-serif';
    context.lineJoin='round';context.strokeStyle='#13271e';context.lineWidth=9;context.strokeText(text,256,48);
    context.fillStyle=color;context.fillText(text,256,48);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}));
    sprite.scale.set(3.2,.6,1);sprite.renderOrder=35;sprite.visible=false;this.captionRoot.add(sprite);
    this.captions.push({sprite,at,duration,x,y,z});
  }

  private updateCaptions(timeMs:number,reducedMotion:boolean):void {
    for(let i=this.captions.length-1;i>=0;i--){
      const caption=this.captions[i]!,t=(timeMs-caption.at)/caption.duration;
      if(t>=1){this.captionRoot.remove(caption.sprite);releaseArt(caption.sprite);this.captions.splice(i,1);continue;}
      caption.sprite.visible=t>=0;
      caption.sprite.position.set(caption.x,caption.y+(reducedMotion?0:smooth(t)*.5),caption.z);
      (caption.sprite.material as THREE.SpriteMaterial).opacity=t<0?0:Math.min(1,t*8,(1-t)*5);
    }
  }

  private createHealthPlate(): HealthPlate {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(3.6, 0.68, 1);
    sprite.renderOrder = 30;
    return { sprite, canvas, texture, signature: '' };
  }

  private updateHealthPlate(plate: HealthPlate, label: string, value: number, max: number, color: string): void {
    const signature = `${label}|${value}|${max}`;
    if (signature === plate.signature) return;
    plate.signature = signature;
    const context = plate.canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, 512, 96);
    context.fillStyle = 'rgba(8, 16, 11, .9)';
    context.beginPath();
    context.roundRect(8, 8, 496, 80, 16);
    context.fill();
    context.fillStyle = '#f7efdd';
    context.font = '800 27px Trebuchet MS, sans-serif';
    context.fillText(`${label}  ${value}/${max}`, 24, 38);
    context.fillStyle = '#1d271f';
    context.fillRect(24, 53, 464, 20);
    context.fillStyle = color;
    context.fillRect(27, 56, Math.round(458 * Math.max(0, Math.min(1, value / Math.max(1, max)))), 14);
    plate.texture.needsUpdate = true;
  }

  private creatureHeight(speciesId: BattlePresentationSnapshot['speciesId']): number {
    const minimum=speciesId === 'glade-stag' ? 2.8 : speciesId === 'snarlfox' ? 1.75 : 1.9;
    return Math.max(minimum,Number(this.creatureRig?.root.userData.modelHeight??0)+.24);
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      releaseArt(child);
    }
  }
}
