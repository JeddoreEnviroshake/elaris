/**
 * Markers shared between the maps.
 *
 * The death beacon appears on the respawn screen, the atlas, and the mini-map,
 * and it has to be the same shape in all three: a player glances at the small
 * map, opens the big one, and must not have to work out whether the two marks
 * mean the same thing.
 */

/** The one colour the beacon is, everywhere it is drawn. */
export const BEACON_COLOR = '#8fd9ff';
export const BEACON_GLOW = 'rgba(143, 217, 255, 0.35)';

/**
 * A halo, a flame, and a stake. Deliberately unlike every other marker on the
 * map — beds, settlements, and landmarks are all warm and rounded, so the one
 * mark that is cold and vertical reads as "go here now" at a glance.
 */
export function drawBeaconMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.fillStyle = BEACON_GLOW;
  ctx.beginPath();
  ctx.arc(x, y, size * 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = BEACON_COLOR;
  ctx.lineWidth = Math.max(1.5, size / 4);
  ctx.beginPath();
  ctx.moveTo(x, y + size);
  ctx.lineTo(x, y - size);
  ctx.stroke();

  ctx.fillStyle = BEACON_COLOR;
  ctx.beginPath();
  ctx.moveTo(x, y - size * 1.4);
  ctx.lineTo(x + size * 0.7, y - size * 0.5);
  ctx.lineTo(x, y - size * 0.1);
  ctx.lineTo(x - size * 0.7, y - size * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
