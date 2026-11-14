import type { NpcId } from '../content/npcs';
import type { TownBuildingId } from '../content/townBuildings';
import type { Facing } from '../simulation/state';

export type GameplayMode =
  | { readonly kind: 'world' }
  | { readonly kind: 'interior'; readonly buildingId: TownBuildingId }
  | { readonly kind: 'dialogue'; readonly buildingId: TownBuildingId; readonly npcId: NpcId }
  | { readonly kind: 'service'; readonly buildingId: TownBuildingId; readonly npcId: NpcId };

export interface InteriorPose {
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
}

export interface InteriorTransition {
  readonly kind: 'entering' | 'leaving';
  readonly progress: number;
}

const WORLD_MODE: GameplayMode = Object.freeze({ kind: 'world' });

/** World and interior exploration accept movement; overlays own movement input. */
export function gameplayModeAllowsMovement(mode: GameplayMode): boolean {
  return mode.kind === 'world' || mode.kind === 'interior';
}

/** Only world mode may mutate or interact with the exterior simulation. */
export function gameplayModeAllowsWorldInteraction(mode: GameplayMode): boolean {
  return mode.kind === 'world';
}

/** Dialogue and service surfaces take exclusive UI input while visible. */
export function gameplayModeOwnsOverlayInput(mode: GameplayMode): boolean {
  return mode.kind === 'dialogue' || mode.kind === 'service';
}

/**
 * Renderer-neutral, transient ownership for one building visit.
 *
 * It is deliberately absent from GameState: a save always recovers in world
 * mode at the authoritative exterior player position. Future interior renderers
 * can keep local pose, focus, and transition progress here without affecting the
 * deterministic world simulation or area snapshots.
 */
export class InteriorSessionController {
  private currentMode: GameplayMode = WORLD_MODE;
  private currentPose: InteriorPose | null = null;
  private focusedId: string | null = null;
  private currentTransition: InteriorTransition | null = null;

  get mode(): GameplayMode { return this.currentMode; }
  get isActive(): boolean { return this.currentMode.kind !== 'world'; }
  get buildingId(): TownBuildingId | null {
    return this.currentMode.kind === 'world' ? null : this.currentMode.buildingId;
  }
  get pose(): InteriorPose | null { return this.currentPose ? { ...this.currentPose } : null; }
  get focusedHotspotId(): string | null { return this.focusedId; }
  get transition(): InteriorTransition | null {
    return this.currentTransition ? { ...this.currentTransition } : null;
  }
  get allowsLocalMovement(): boolean {
    return this.currentTransition === null && gameplayModeAllowsMovement(this.currentMode);
  }
  get allowsWorldInteraction(): boolean {
    return this.currentTransition === null && gameplayModeAllowsWorldInteraction(this.currentMode);
  }
  get ownsOverlayInput(): boolean { return gameplayModeOwnsOverlayInput(this.currentMode); }

  enter(buildingId: TownBuildingId, spawn: InteriorPose): void {
    if (this.isActive) throw new Error(`cannot enter ${buildingId} while ${this.buildingId} is active`);
    this.validatePose(spawn);
    this.currentMode = { kind: 'interior', buildingId };
    this.currentPose = { ...spawn };
    this.focusedId = null;
    this.currentTransition = { kind: 'entering', progress: 0 };
  }

  beginDialogue(npcId: NpcId): void {
    const buildingId = this.requireExplorableInterior('begin dialogue');
    this.currentMode = { kind: 'dialogue', buildingId, npcId };
    this.focusedId = `npc:${npcId}`;
  }

  openService(npcId: NpcId): void {
    const buildingId = this.requireActiveBuilding('open service');
    if (this.currentTransition) throw new Error('cannot open service during an interior transition');
    this.currentMode = { kind: 'service', buildingId, npcId };
    this.focusedId = `npc:${npcId}`;
  }

  resumeInterior(): void {
    const buildingId = this.requireActiveBuilding('resume interior');
    if (this.currentTransition) throw new Error('cannot resume interior during an interior transition');
    this.currentMode = { kind: 'interior', buildingId };
  }

  updatePose(pose: InteriorPose): void {
    this.requireActiveBuilding('update interior pose');
    this.validatePose(pose);
    this.currentPose = { ...pose };
  }

  focusHotspot(hotspotId: string | null): void {
    this.requireExplorableInterior('focus hotspot');
    this.focusedId = hotspotId;
  }

  beginExit(): void {
    const buildingId = this.requireActiveBuilding('leave interior');
    if (this.currentTransition) throw new Error('interior transition already active');
    this.currentMode = { kind: 'interior', buildingId };
    this.focusedId = null;
    this.currentTransition = { kind: 'leaving', progress: 0 };
  }

  updateTransition(progress: number): void {
    const transition = this.currentTransition;
    if (!transition) throw new Error('no interior transition is active');
    if (!Number.isFinite(progress)) throw new Error('interior transition progress must be finite');
    const clamped = Math.max(0, Math.min(1, progress));
    if (clamped < 1) {
      this.currentTransition = { kind: transition.kind, progress: clamped };
      return;
    }
    if (transition.kind === 'leaving') this.recoverToWorld();
    else this.currentTransition = null;
  }

  completeTransition(): void {
    this.updateTransition(1);
  }

  /** Safe load/scene-restart recovery; transient interior state is discarded. */
  recoverToWorld(): void {
    this.currentMode = WORLD_MODE;
    this.currentPose = null;
    this.focusedId = null;
    this.currentTransition = null;
  }

  private requireActiveBuilding(action: string): TownBuildingId {
    if (this.currentMode.kind === 'world') throw new Error(`cannot ${action} from world mode`);
    return this.currentMode.buildingId;
  }

  private requireExplorableInterior(action: string): TownBuildingId {
    const buildingId = this.requireActiveBuilding(action);
    if (this.currentMode.kind !== 'interior' || this.currentTransition) {
      throw new Error(`cannot ${action} unless an interior is ready for exploration`);
    }
    return buildingId;
  }

  private validatePose(pose: InteriorPose): void {
    if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y)) throw new Error('interior pose must be finite');
  }
}
