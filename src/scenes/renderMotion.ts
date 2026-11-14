export interface RenderPoint {
  x: number;
  y: number;
}

/**
 * Blend between the previous and current fixed-step poses for this render
 * frame. The simulation remains authoritative; this only removes visible
 * stepping on displays that render between simulation updates.
 */
export function interpolateRenderPoint(
  previous: RenderPoint,
  current: RenderPoint,
  alpha: number,
): RenderPoint {
  const t = Math.max(0, Math.min(1, alpha));
  return {
    x: previous.x + (current.x - previous.x) * t,
    y: previous.y + (current.y - previous.y) * t,
  };
}

/** Keep a mounted creature in front of its rider at the shared y-sort point. */
export function mountedActorDepths(y: number): { player: number; mount: number } {
  return { player: y, mount: y + 0.1 };
}

export type CardinalFacing = 'up' | 'down' | 'left' | 'right';

/** The Glade Stag source art faces left; rotate/flip it into movement facing. */
export function mountTransformForFacing(facing: CardinalFacing): { angle: number; flipX: boolean } {
  switch (facing) {
    case 'left': return { angle: 0, flipX: false };
    case 'right': return { angle: 0, flipX: true };
    case 'up': return { angle: 90, flipX: false };
    case 'down': return { angle: -90, flipX: false };
  }
}
