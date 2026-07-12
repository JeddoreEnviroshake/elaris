import { ZOOM_TIERS } from '../config/platform';

export type Orientation = 'portrait' | 'landscape';

export interface Viewport {
  width: number;
  height: number;
}

export interface Layout {
  zoom: number;
  orientation: Orientation;
}

/**
 * Choose an integer camera zoom from the shorter viewport axis so pixel art
 * stays crisp, and report orientation for HUD placement decisions. Portrait is
 * the primary layout; landscape reuses it with overlay controls (no separate
 * HUD), so orientation only drives control positioning, never a reload.
 */
export function computeLayout(vp: Viewport): Layout {
  const minAxis = Math.min(vp.width, vp.height);
  let zoom = ZOOM_TIERS[ZOOM_TIERS.length - 1]?.zoom ?? 2;
  for (const tier of ZOOM_TIERS) {
    if (minAxis <= tier.maxMinAxis) {
      zoom = tier.zoom;
      break;
    }
  }
  return {
    zoom,
    orientation: vp.width >= vp.height ? 'landscape' : 'portrait',
  };
}
