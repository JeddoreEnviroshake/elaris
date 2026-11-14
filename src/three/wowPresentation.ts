import type { SpeciesId } from '../simulation/state';
import type { DangerThreat, SurvivalTimerView } from '../simulation/survivalCycle';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function mixChannel(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * clamp01(amount));
}

/** Dependency-free color interpolation so atmosphere decisions remain unit-testable. */
export function mixHexColor(from: number, to: number, amount: number): number {
  return (
    mixChannel((from >> 16) & 0xff, (to >> 16) & 0xff, amount) << 16
    | mixChannel((from >> 8) & 0xff, (to >> 8) & 0xff, amount) << 8
    | mixChannel(from & 0xff, to & 0xff, amount)
  );
}

export interface AtmosphereCue {
  readonly safeProgress: number;
  readonly twilight: number;
  readonly night: number;
  readonly sunIntensity: number;
  readonly hemisphereIntensity: number;
  readonly fillIntensity: number;
  readonly exposure: number;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly skyTint: number;
  readonly sunColor: number;
  readonly fillColor: number;
}

/**
 * Presentation-only light state derived from the authoritative survival clock.
 * The safe phase crosses dawn, daylight, and dusk; the danger phase becomes a
 * readable moonlit night whose hue still distinguishes fog from a raid.
 */
export function atmosphereCue(
  timer: SurvivalTimerView & { openingPhase?: string | null },
  safePhaseSeconds: number,
  dangerBlend: number,
): AtmosphereCue {
  const safeProgress = timer.openingPhase === 'waiting' ? 0.4 : timer.phase === 'safe'
    ? clamp01(1 - (timer.secondsRemaining + 1) / Math.max(1, safePhaseSeconds))
    : 1;
  const dawn = timer.phase === 'safe' ? 1 - smoothstep(0.02, 0.2, safeProgress) : 0;
  const dusk = timer.phase === 'safe' ? smoothstep(0.62, 0.96, safeProgress) : 1;
  const twilight = clamp01(Math.max(dawn * 0.58, dusk) * (1 - clamp01(dangerBlend)));
  const night = timer.phase === 'danger' ? clamp01(dangerBlend) : 0;
  const daylight = 1 - Math.max(twilight * 0.62, night * 0.86);

  const daylightSky = 0xaac9c1;
  const duskSky = 0xd88b68;
  const nightSky = nightTintFor(timer.threat);
  const twilightSky = mixHexColor(daylightSky, duskSky, twilight);
  const skyTint = mixHexColor(twilightSky, nightSky, night);
  const sunColor = mixHexColor(
    mixHexColor(0xfff1d0, 0xffa55f, twilight),
    NIGHT_SUN_TINTS[timer.threat],
    night,
  );

  return {
    safeProgress,
    twilight,
    night,
    sunIntensity: 1.2 + daylight * 1.65 + twilight * 0.55,
    hemisphereIntensity: .9 + daylight * .8 + night * .38,
    fillIntensity: .5 + twilight * .34 + night * .3,
    exposure: .98 + daylight * .1 + twilight * .05 + night * .04,
    fogNear: 34 - twilight * 4 - night * 9,
    fogFar: 76 - twilight * 8 - night * 24,
    skyTint,
    sunColor,
    fillColor: mixHexColor(0x7aa6b6, NIGHT_FILL_TINTS[timer.threat], night),
  };
}

export interface CameraRevealCue {
  readonly zoom: number;
  readonly lift: number;
  readonly targetLead: number;
}

/** A short establishing breath when a 3D area first appears. */
export function cameraRevealCue(elapsedSeconds: number, reducedMotion: boolean): CameraRevealCue {
  if (reducedMotion) return { zoom: 1, lift: 0, targetLead: 0 };
  const settled = smoothstep(0, 1, clamp01(elapsedSeconds / 2.6));
  const reveal = 1 - settled;
  return {
    zoom: 0.9 + settled * 0.1,
    lift: reveal * 1.45,
    targetLead: reveal * 1.15,
  };
}

export interface CreatureTraceStyle {
  readonly color: number;
  readonly emissive: number;
  readonly shape: 'sprout' | 'pebble' | 'petal' | 'leaf';
  readonly intervalMs: number;
}

/** Species-specific traces make creature identity readable outside combat. */
export function creatureTraceStyle(speciesId: SpeciesId): CreatureTraceStyle {
  switch (speciesId) {
    case 'tuftle': return { color: 0x9be37e, emissive: 0x244f2d, shape: 'sprout', intervalMs: 820 };
    case 'craghopper': return { color: 0xc58a58, emissive: 0x4b2615, shape: 'pebble', intervalMs: 1_050 };
    case 'glade-stag': return { color: 0xf1d986, emissive: 0x5d4f20, shape: 'petal', intervalMs: 680 };
    case 'snarlfox': return { color: 0xe88954, emissive: 0x5a2214, shape: 'leaf', intervalMs: 760 };
    case 'masonmole': return { color: 0x9aa4ae, emissive: 0x2e3944, shape: 'pebble', intervalMs: 1_180 };
    case 'bulwark-boar': return { color: 0xb47a5a, emissive: 0x3f2418, shape: 'pebble', intervalMs: 900 };
    case 'quillfinch': return { color: 0xe4d38a, emissive: 0x574a1c, shape: 'leaf', intervalMs: 640 };
    case 'mistmoth': return { color: 0xa8d8e0, emissive: 0x1f4750, shape: 'petal', intervalMs: 700 };
    case 'slingtail': return { color: 0xc9b48a, emissive: 0x4a3c22, shape: 'pebble', intervalMs: 980 };
  }
}

/**
 * The fog front is green, raid night stays clean and moon-blue, and a storm
 * night is lit violet — the same three-way split the 2D wash uses, so a player
 * switching renderers is never told a different threat is outside.
 */
export function nightTintFor(threat: DangerThreat): number {
  return NIGHT_SKY_TINTS[threat];
}

const NIGHT_SKY_TINTS: Readonly<Record<DangerThreat, number>> = {
  fog: 0x263d31,
  raid: 0x17243b,
  storm: 0x241a4d,
};

/** What the key light turns as each night settles in. */
const NIGHT_SUN_TINTS: Readonly<Record<DangerThreat, number>> = {
  fog: 0xa9d39d,
  raid: 0x91acd5,
  storm: 0xb69bf5,
};

/** Ambient fill, kept a shade cooler than the key light for each threat. */
const NIGHT_FILL_TINTS: Readonly<Record<DangerThreat, number>> = {
  fog: 0x759c72,
  raid: 0x607dad,
  storm: 0x7a63c4,
};
