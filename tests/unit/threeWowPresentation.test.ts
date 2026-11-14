import { describe, expect, it } from 'vitest';
import {
  atmosphereCue,
  cameraRevealCue,
  creatureTraceStyle,
  mixHexColor,
} from '../../src/three/wowPresentation';

describe('3D wow presentation', () => {
  it('keeps daylight while the opening waits for a shelter', () => {
    const waiting = atmosphereCue({ phase: 'safe', threat: 'fog', secondsRemaining: 0, label: '—', openingPhase: 'waiting' }, 600, 0);
    expect(waiting.twilight).toBe(0);
    expect(waiting.night).toBe(0);
  });
  it('moves the safe phase from dawn through daylight into dusk', () => {
    const dawn = atmosphereCue({ phase: 'safe', threat: 'fog', secondsRemaining: 599, label: '9:59' }, 600, 0);
    const day = atmosphereCue({ phase: 'safe', threat: 'fog', secondsRemaining: 359, label: '5:59' }, 600, 0);
    const dusk = atmosphereCue({ phase: 'safe', threat: 'fog', secondsRemaining: 19, label: '0:19' }, 600, 0);

    expect(dawn.twilight).toBeGreaterThan(0.4);
    expect(day.twilight).toBeLessThan(0.1);
    expect(dusk.twilight).toBeGreaterThan(0.9);
    expect(day.sunIntensity).toBeGreaterThan(dusk.sunIntensity);
  });

  it('uses a close, darker atmosphere only as danger visually arrives', () => {
    const entering = atmosphereCue({ phase: 'danger', threat: 'fog', secondsRemaining: 59, label: '0:59' }, 600, 0);
    const arrived = atmosphereCue({ phase: 'danger', threat: 'fog', secondsRemaining: 58, label: '0:58' }, 600, 1);

    expect(entering.night).toBe(0);
    expect(arrived.night).toBe(1);
    expect(arrived.fogFar).toBeLessThan(entering.fogFar);
    expect(arrived.exposure).toBeLessThan(entering.exposure);
  });

  it('settles the establishing camera move and disables it for reduced motion', () => {
    expect(cameraRevealCue(0, false).zoom).toBeLessThan(1);
    expect(cameraRevealCue(3, false)).toEqual({ zoom: 1, lift: 0, targetLead: 0 });
    expect(cameraRevealCue(0, true)).toEqual({ zoom: 1, lift: 0, targetLead: 0 });
  });

  it('assigns an unmistakable environmental trace to every species', () => {
    expect(creatureTraceStyle('tuftle').shape).toBe('sprout');
    expect(creatureTraceStyle('craghopper').shape).toBe('pebble');
    expect(creatureTraceStyle('glade-stag').shape).toBe('petal');
    expect(creatureTraceStyle('snarlfox').shape).toBe('leaf');
  });

  it('interpolates packed RGB colors without Three.js', () => {
    expect(mixHexColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});
