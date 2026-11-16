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
