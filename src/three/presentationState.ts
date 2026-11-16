import type { GatherAssistancePresentation } from '../presentation/followerCreatures';
import type { BoundaryEdge, BuildingDefinitionId, EnvironmentKind, ResourceNodeKind } from '../simulation/state';

/** Read-only placement state shared with alternate world renderers. */
export interface BuildPlacementPresentation {
  readonly definitionId: BuildingDefinitionId;
  readonly tileX: number;
  readonly tileY: number;
  readonly tilesWide: number;
  readonly tilesHigh: number;
  readonly rotated: boolean;
  readonly boundaryEdge: BoundaryEdge | null;
  readonly environmentKind: EnvironmentKind | null;
  readonly layer: 'surface' | 'boundary' | 'footprint';
  readonly valid: boolean;
  readonly message: string;
  readonly blockedCells: readonly { tileX: number; tileY: number; reason: string }[];
}

export type InteractionTargetKind = 'resource' | 'drop' | 'creature' | 'facility' | 'garden' | 'woodlot' | 'town-hotspot' | 'site-container';

/** The same context-action target selected by WorldScene for the HUD. */
export interface InteractionTargetPresentation {
  readonly kind: InteractionTargetKind;
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly value?: number;
  readonly maxValue?: number;
  /** Wild creatures only: the tame chance in basis points, drawn as a fill bar. */
  readonly tameBps?: number;
}

export interface ThreePresentationState {
  /** Interpolated world pose in source pixels, shared with the 2D renderer. */
  readonly playerPosition?: { readonly x: number; readonly y: number };
  readonly journalOpen?:boolean;
  readonly worldBackdrop?: boolean;
  readonly batchPlacements?: readonly BuildPlacementPresentation[];
  readonly shelterGuide?: { tileX: number; tileY: number } | null;
  readonly journeyWaypoint?: { tileX: number; tileY: number; label: string } | null;
  readonly placement: BuildPlacementPresentation | null;
  /** Placed building the delete prompt is targeting, drawn in the blocked red. */
  readonly selection: BuildPlacementPresentation | null;
  readonly target: InteractionTargetPresentation | null;
  readonly gathering: boolean;
  /** Retain the hit's resource even when depletion or a turn changes the target. */
  readonly gatherKind?: ResourceNodeKind | null;
  readonly gatherProgress?: number;
  readonly playerAction?:{readonly id:number;readonly arrowTracked:boolean;readonly kind:'melee'|'ranged'|'magic';readonly progress:number;readonly x:number;readonly y:number}|null;
  /** The latest snare throw: the renderer arcs a snare to (x, y), then wraps or bursts. */
  readonly tameThrow?:{readonly id:number;readonly outcome:'tamed'|'missed';readonly x:number;readonly y:number}|null;
  readonly gatherAssistance?: GatherAssistancePresentation | null;
  readonly prefersReducedMotion: boolean;
}
