import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InteriorAudioRouter,
  type InteriorAudioBackend,
  type InteriorSoundscapeBus,
} from '../../src/audio/interiorAudio';

class FakeBus implements InteriorSoundscapeBus {
  readonly ramps: Array<{ gain: number; durationMs: number }> = [];
  stopped = false;
  rampTo(gain: number, durationMs: number): void { this.ramps.push({ gain, durationMs }); }
  stop(): void { this.stopped = true; }
}

class FakeBackend implements InteriorAudioBackend {
  readonly supported = true;
  readonly starts: Array<{ soundscape: string; bus: FakeBus }> = [];
  disposed = false;
  start(soundscape: string): FakeBus {
    const bus = new FakeBus();
    this.starts.push({ soundscape, bus });
    return bus;
  }
  dispose(): void { this.disposed = true; }
}

afterEach(() => vi.useRealTimers());

describe('interior audio routing', () => {
  it('crossfades between authored room soundscapes and retires old buses', () => {
    vi.useFakeTimers();
    const backend = new FakeBackend();
    const router = new InteriorAudioRouter(backend);
    router.enter('interior-forge');
    router.enter('interior-market');

    expect(backend.starts.map(({ soundscape }) => soundscape)).toEqual(['interior-forge', 'interior-market']);
    expect(backend.starts[0]!.bus.ramps.at(-1)?.gain).toBe(0);
    expect(backend.starts[1]!.bus.ramps.at(-1)?.gain).toBeGreaterThan(0);
    expect(router.getSnapshot()).toMatchObject({ activeSoundscape: 'interior-market', fadingOutBuses: 1, supported: true });

    vi.advanceTimersByTime(500);
    expect(backend.starts[0]!.bus.stopped).toBe(true);
    expect(router.getSnapshot().fadingOutBuses).toBe(0);
    router.dispose();
  });

  it('fades out on exit and stops every node during disposal', () => {
    vi.useFakeTimers();
    const backend = new FakeBackend();
    const router = new InteriorAudioRouter(backend);
    router.enter('interior-arcanum');
    router.leave();
    expect(router.getSnapshot().activeSoundscape).toBeNull();
    expect(backend.starts[0]!.bus.ramps.at(-1)?.gain).toBe(0);
    router.dispose();
    expect(backend.starts[0]!.bus.stopped).toBe(true);
    expect(backend.disposed).toBe(true);
  });

  it('does not restart a soundscape when dialogue and service overlays keep the room active', () => {
    const backend = new FakeBackend();
    const router = new InteriorAudioRouter(backend);
    router.enter('interior-tavern');
    router.enter('interior-tavern');
    expect(backend.starts).toHaveLength(1);
    router.dispose();
  });
});
