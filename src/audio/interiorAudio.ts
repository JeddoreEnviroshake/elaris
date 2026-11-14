export interface InteriorSoundscapeBus {
  rampTo(gain: number, durationMs: number): void;
  stop(): void;
}

export interface InteriorAudioBackend {
  readonly supported?: boolean;
  start(soundscape: string): InteriorSoundscapeBus | null;
  dispose(): void;
}

export interface InteriorAudioSnapshot {
  readonly activeSoundscape: string | null;
  readonly fadingOutBuses: number;
  readonly supported: boolean;
}

const CROSSFADE_MS = 420;
const ROOM_VOLUME = 0.105;

/**
 * Routes the semantic soundscape authored on each interior definition. The
 * router owns crossfades and visibility muting; the backend owns Web Audio
 * nodes, which keeps lifecycle behavior deterministic and unit-testable.
 */
export class InteriorAudioRouter {
  private active: { soundscape: string; bus: InteriorSoundscapeBus } | null = null;
  private readonly fadingOut = new Set<InteriorSoundscapeBus>();
  private readonly stopTimers = new Map<InteriorSoundscapeBus, ReturnType<typeof setTimeout>>();

  constructor(private readonly backend: InteriorAudioBackend = new BrowserInteriorAudioBackend()) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  enter(soundscape: string): void {
    if (this.active?.soundscape === soundscape) {
      this.active.bus.rampTo(documentHidden() ? 0 : ROOM_VOLUME, CROSSFADE_MS);
      return;
    }
    if (this.active) this.retire(this.active.bus);
    const bus = this.backend.start(soundscape);
    this.active = bus ? { soundscape, bus } : null;
    if (bus) bus.rampTo(documentHidden() ? 0 : ROOM_VOLUME, CROSSFADE_MS);
  }

  leave(): void {
    if (!this.active) return;
    this.retire(this.active.bus);
    this.active = null;
  }

  getSnapshot(): InteriorAudioSnapshot {
    return {
      activeSoundscape: this.active?.soundscape ?? null,
      fadingOutBuses: this.fadingOut.size,
      supported: this.backend.supported ?? true,
    };
  }

  dispose(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.active) this.active.bus.stop();
    this.active = null;
    for (const timer of this.stopTimers.values()) clearTimeout(timer);
    for (const bus of this.fadingOut) bus.stop();
    this.stopTimers.clear();
    this.fadingOut.clear();
    this.backend.dispose();
  }

  private retire(bus: InteriorSoundscapeBus): void {
    bus.rampTo(0, CROSSFADE_MS);
    this.fadingOut.add(bus);
    const previousTimer = this.stopTimers.get(bus);
    if (previousTimer) clearTimeout(previousTimer);
    const timer = setTimeout(() => {
      bus.stop();
      this.fadingOut.delete(bus);
      this.stopTimers.delete(bus);
    }, CROSSFADE_MS + 40);
    this.stopTimers.set(bus, timer);
  }

  private readonly onVisibilityChange = (): void => {
    this.active?.bus.rampTo(documentHidden() ? 0 : ROOM_VOLUME, documentHidden() ? 120 : CROSSFADE_MS);
  };
}

interface SoundscapeProfile {
  readonly noiseCutoff: number;
  readonly noiseGain: number;
  readonly humFrequency: number;
  readonly humGain: number;
  readonly modulationHz: number;
}

const DEFAULT_PROFILE: SoundscapeProfile = {
  noiseCutoff: 720, noiseGain: 0.2, humFrequency: 92, humGain: 0.07, modulationHz: 0.13,
};

const PROFILES: Readonly<Record<string, SoundscapeProfile>> = {
  'interior-forge': { noiseCutoff: 1_450, noiseGain: 0.34, humFrequency: 58, humGain: 0.1, modulationHz: 2.4 },
  'interior-stockhouse': { noiseCutoff: 520, noiseGain: 0.2, humFrequency: 118, humGain: 0.035, modulationHz: 0.18 },
  'interior-market': { noiseCutoff: 980, noiseGain: 0.28, humFrequency: 164, humGain: 0.025, modulationHz: 0.46 },
  'interior-sanctuary': { noiseCutoff: 360, noiseGain: 0.1, humFrequency: 196, humGain: 0.07, modulationHz: 0.08 },
  'interior-armoury': { noiseCutoff: 760, noiseGain: 0.17, humFrequency: 74, humGain: 0.055, modulationHz: 0.3 },
  'interior-arcanum': { noiseCutoff: 1_180, noiseGain: 0.13, humFrequency: 232, humGain: 0.085, modulationHz: 0.21 },
  'interior-tavern': { noiseCutoff: 860, noiseGain: 0.3, humFrequency: 110, humGain: 0.04, modulationHz: 0.65 },
  'interior-arena': { noiseCutoff: 680, noiseGain: 0.3, humFrequency: 66, humGain: 0.05, modulationHz: 0.38 },
};

class BrowserInteriorAudioBackend implements InteriorAudioBackend {
  private context: AudioContext | null = null;
  readonly supported = typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);

  start(soundscape: string): InteriorSoundscapeBus | null {
    const context = this.getContext();
    if (!context) return null;
    void context.resume().catch(() => {});
    return new BrowserSoundscapeBus(context, PROFILES[soundscape] ?? DEFAULT_PROFILE);
  }

  dispose(): void {
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context;
    if (!this.supported) return null;
    const AudioContextConstructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.context = AudioContextConstructor ? new AudioContextConstructor() : null;
    return this.context;
  }
}

class BrowserSoundscapeBus implements InteriorSoundscapeBus {
  private readonly output: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private stopped = false;

  constructor(private readonly context: AudioContext, profile: SoundscapeProfile) {
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(context.destination);

    const noise = context.createBufferSource();
    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = profile.noiseCutoff;
    const noiseGain = context.createGain();
    noiseGain.gain.value = profile.noiseGain;
    noise.connect(filter).connect(noiseGain).connect(this.output);
    noise.start();
    this.sources.push(noise);

    const hum = context.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = profile.humFrequency;
    const humGain = context.createGain();
    humGain.gain.value = profile.humGain;
    hum.connect(humGain).connect(this.output);
    hum.start();
    this.sources.push(hum);

    const modulation = context.createOscillator();
    modulation.type = 'sine';
    modulation.frequency.value = profile.modulationHz;
    const modulationDepth = context.createGain();
    modulationDepth.gain.value = Math.min(profile.noiseGain * 0.35, 0.1);
    modulation.connect(modulationDepth).connect(noiseGain.gain);
    modulation.start();
    this.sources.push(modulation);
  }

  rampTo(gain: number, durationMs: number): void {
    if (this.stopped) return;
    const parameter = this.output.gain;
    parameter.cancelScheduledValues(this.context.currentTime);
    parameter.setValueAtTime(parameter.value, this.context.currentTime);
    parameter.linearRampToValueAtTime(Math.max(0, gain), this.context.currentTime + durationMs / 1_000);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already stopped by the audio engine */ }
      source.disconnect();
    }
    this.output.disconnect();
  }
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

declare global {
  interface Window { webkitAudioContext?: typeof AudioContext }
}
