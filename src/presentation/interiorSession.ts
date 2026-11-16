import type { NpcId } from '../content/npcs';
import type { TownBuildingId } from '../content/townBuildings';

/**
 * Who owns input right now. Town buildings are walk-in, so there is no
 * separate "inside a building" mode: walking around a shop is ordinary world
 * play. Only a conversation with a keeper — the dialogue, then the service
 * panel it opens — takes input away from the world while it is on screen.
 */
export type GameplayMode =
  | { readonly kind: 'world' }
  | { readonly kind: 'dialogue'; readonly buildingId: TownBuildingId; readonly npcId: NpcId }
  | { readonly kind: 'service'; readonly buildingId: TownBuildingId; readonly npcId: NpcId };

const WORLD_MODE: GameplayMode = Object.freeze({ kind: 'world' });

/** Only world mode may move the player or interact with the world simulation. */
export function gameplayModeAllowsWorldInteraction(mode: GameplayMode): boolean {
  return mode.kind === 'world';
}

/** Dialogue and service surfaces take exclusive UI input while visible. */
export function gameplayModeOwnsOverlayInput(mode: GameplayMode): boolean {
  return mode.kind === 'dialogue' || mode.kind === 'service';
}

/**
 * Transient ownership of one conversation with a town keeper.
 *
 * Deliberately absent from GameState: a conversation is one client's open
 * panel, and a save always resumes in world mode at the saved position —
 * which, for a player who saved mid-conversation, is inside the shop.
 */
export class InteriorSessionController {
  private currentMode: GameplayMode = WORLD_MODE;

  get mode(): GameplayMode { return this.currentMode; }
  /** True while a conversation (dialogue or service) is open. */
  get isActive(): boolean { return this.currentMode.kind !== 'world'; }
  get buildingId(): TownBuildingId | null {
    return this.currentMode.kind === 'world' ? null : this.currentMode.buildingId;
  }
  get allowsWorldInteraction(): boolean { return gameplayModeAllowsWorldInteraction(this.currentMode); }
  get ownsOverlayInput(): boolean { return gameplayModeOwnsOverlayInput(this.currentMode); }

  beginDialogue(buildingId: TownBuildingId, npcId: NpcId): void {
    if (this.currentMode.kind !== 'world') {
      throw new Error(`cannot talk to ${npcId} while a ${this.currentMode.kind} is open`);
    }
    this.currentMode = { kind: 'dialogue', buildingId, npcId };
  }

  openService(npcId: NpcId): void {
    if (this.currentMode.kind !== 'dialogue') throw new Error('a service opens from its keeper\'s dialogue');
    this.currentMode = { kind: 'service', buildingId: this.currentMode.buildingId, npcId };
  }

  /** Close whatever conversation is open and hand input back to the world. */
  endConversation(): void {
    this.currentMode = WORLD_MODE;
  }

  /** Safe load/scene-restart recovery; transient conversation state is discarded. */
  recoverToWorld(): void {
    this.currentMode = WORLD_MODE;
  }
}
