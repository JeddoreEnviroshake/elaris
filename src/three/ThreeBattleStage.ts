import * as THREE from 'three';
import type { ModelLibrary } from './modelLibrary';
import { QuaterniusArt, releaseArt } from './quaterniusArt';
import { meadowMaterial } from './townEntrance';
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
  readonly projectile: THREE.Group | null;
}

const ROUND_DURATION_MS = 1_150;
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
  private readonly effectRoot = new THREE.Group();
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
    this.root.add(this.arenaRoot, this.fighterRoot, this.effectRoot);
  }

  get roundAnimating(): boolean {
    return this.activeRound !== null;
  }

  playRound(event: BattleRoundPresentation): void {
    this.ensureEncounter(event.before);
    this.snapshot = event.resolved;
    this.clearGroup(this.effectRoot);
    const projectile = this.createProjectile(event);
    if (projectile) this.effectRoot.add(projectile);
    const startedAt = performance.now();
    this.activeRound = { event, startedAt, projectile };
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

    if (event && !reducedMotion) {
      const playerMove = event.result.companionAbility?.playerMove ?? event.result.playerMove;
      if (playerMove) {
        playerX = THREE.MathUtils.lerp(
          battleTrackToWorld(playerMove.from),
          battleTrackToWorld(playerMove.to),
          smooth(progress / 0.34),
        );
      }
      const enemyMove = event.result.companionAbility?.enemyMove ?? event.result.creatureMove;
      if (enemyMove) {
        creatureX = THREE.MathUtils.lerp(
          battleTrackToWorld(enemyMove.from),
          battleTrackToWorld(enemyMove.to),
          smooth((progress - 0.42) / 0.3),
        );
      }
      if (event.action === 'melee' && progress < 0.42) {
        playerX += Math.min(1.3, Math.max(0.4, creatureX - playerX - 0.4)) * pulse(progress / 0.4);
      }
      if (event.result.creatureStrike && progress > 0.63) {
        creatureX -= Math.min(1.1, Math.max(0.35, creatureX - playerX - 0.35)) * pulse((progress - 0.63) / 0.32);
      }
    }

    this.playerRig.root.position.set(playerX, 0, 0.35);
    this.focus.set((playerX+creatureX)/2, 0, 0.35);
    this.creatureRig.root.position.set(creatureX, 0, -0.2);
    this.playerRig.root.rotation.y = Math.PI / 2;
    this.creatureRig.root.rotation.y = Math.PI / 2;
    let playerMotion:PlayerMotion='ready',creatureMotion:CreatureMotion='alert';
    let playerProgress:number|undefined,creatureProgress:number|undefined;
    const playerHit=!!event?.result.creatureStrike&&event.result.creatureStrike.outcome!=='dodge';
    const creatureHit=!!event?.result.playerStrike&&!['miss','dodge'].includes(event.result.playerStrike.outcome)
      ||(event?.result.companionAbility?.damage??0)>0;
    if(event){
      if(progress<.43){
        playerMotion=event.action==='melee'?'melee':event.action==='magic'?'cast':event.action==='ranged'?'ranged':event.action==='snare'?'throw':event.result.playerMove?'walk':'ready';
        playerProgress=clamp01(progress/.43);
      }
      if(progress>.20&&progress<.51){
        if(creatureHit){creatureMotion='hit';creatureProgress=(progress-.20)/.31;}
        else if(event.result.playerStrike?.outcome==='dodge'){creatureMotion='dodge';creatureProgress=(progress-.20)/.31;}
      }
      if(event.result.creatureMove&&progress>.42&&progress<.70)creatureMotion='walk';
      if(event.result.creatureStrike&&progress>.58&&progress<.95){creatureMotion='attack';creatureProgress=(progress-.58)/.37;}
      if(event.result.creatureStrike&&progress>.74&&progress<.99){playerMotion=playerHit?'hit':'dodge';playerProgress=(progress-.74)/.25;}
      if(event.result.ended&&(event.result.defeated||event.result.tamed)&&progress>.52){
        creatureMotion=event.result.tamed?'capture':'defeat';creatureProgress=clamp01((progress-.52)/.45);
      }
      if(event.result.playerDefeated&&progress>.76){playerMotion='defeat';playerProgress=clamp01((progress-.76)/.24);}
    }
    const castingWithStaff = event?.action === 'magic' && event.before.magicStaffEquipped && progress < 0.55;
    this.playerRig.setGatherTool(castingWithStaff || (!event && this.snapshot.magicStaffEquipped)
      ? 'staff'
      : event?.action === 'melee' && progress < 0.45 ? 'axe' : event?.action==='ranged'&&progress<.45?'bow':'hands');
    this.playerRig.animate(timeMs,playerMotion,reducedMotion,playerProgress===undefined?undefined:{progress:playerProgress});
    this.creatureRig.animate(timeMs,creatureMotion,reducedMotion,creatureProgress===undefined?undefined:{progress:creatureProgress});

    this.animateReactions(event, progress, reducedMotion);
    this.updateProjectile(round, progress, playerX, creatureX, reducedMotion);
    this.updateCompanion(timeMs, event, progress, reducedMotion, playerX);

    const hpProgress = event ? smooth((progress - 0.2) / 0.25) : 1;
    const playerHp = Math.round(THREE.MathUtils.lerp(before.playerHp, resolved.playerHp, hpProgress));
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
        this.clearGroup(this.effectRoot);
      } else if (timeMs >= this.lingerUntil) {
        this.activeRound = null;
        this.clearGroup(this.effectRoot);
      }
    }
    return true;
  }

  dispose(): void {
    this.art?.retire();
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
    this.clearGroup(this.effectRoot);
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
    if(event.result.playerStrike?.outcome==='dodge'&&progress>.20&&progress<.51){
      this.creatureRig.root.position.z-=pulse((progress-.20)/.31)*.32;
    }
    if(event.result.creatureStrike?.outcome==='dodge'&&progress>.74&&progress<.99){
      this.playerRig.root.position.z+=pulse((progress-.74)/.25)*.30;
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
    const acting = Boolean(event?.result.companionAbility) && progress > 0.25 && progress < 0.62;
    this.companionRig.animate(timeMs,acting?'assist':'idle',reducedMotion,acting?{progress:(progress-.25)/.37}:undefined);
    if (acting && !reducedMotion) this.companionRig.root.position.y += pulse((progress - 0.25) / 0.37) * 0.34;
  }

  private createProjectile(event: BattleRoundPresentation): THREE.Group | null {
    if (!['ranged', 'magic', 'snare'].includes(event.action)) return null;
    const root = new THREE.Group();
    root.name = `battle-${event.action}-projectile`;
    if (event.action === 'ranged') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 6), new THREE.MeshStandardMaterial({ color: 0xd8c79d, roughness: 0.7 }));
      shaft.rotation.z = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.19, 5), new THREE.MeshStandardMaterial({ color: 0xaeb5b2, roughness: 0.55 }));
      tip.rotation.z = -Math.PI / 2;
      tip.position.x = 0.42;
      root.add(shaft, tip);
    } else if (event.action === 'magic') {
      root.add(new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.2, 1),
        new THREE.MeshStandardMaterial({ color: 0xd19aff, emissive: 0x7435a4, emissiveIntensity: 2.2, roughness: 0.25 }),
      ));
      root.add(new THREE.PointLight(0xc57cff, 4, 4, 2));
    } else {
      const snare = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.055, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0xd1b07a, roughness: 0.82 }),
      );
      snare.rotation.x = Math.PI / 2;
      root.add(snare);
    }
    root.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = true; });
    return root;
  }

  private updateProjectile(
    round: ActiveRound | null,
    progress: number,
    playerX: number,
    creatureX: number,
    reducedMotion: boolean,
  ): void {
    const projectile = round?.projectile;
    if (!projectile) return;
    const flight = reducedMotion ? 1 : smooth((progress - 0.17) / 0.16);
    projectile.visible = progress <= 0.38;
    projectile.position.set(
      THREE.MathUtils.lerp(playerX + 0.35, creatureX - 0.3, flight),
      1.05 + Math.sin(flight * Math.PI) * (round!.event.action === 'snare' ? 1.1 : 0.35),
      0.05,
    );
    if (round!.event.action === 'snare') projectile.rotation.z = flight * Math.PI * 3;
    if (round!.event.action === 'magic') projectile.scale.setScalar(0.8 + Math.sin(flight * Math.PI * 3) * 0.18);
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
