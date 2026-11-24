// Acceptance Test
// Traces to: L2-009, L2-010, L2-024, L2-027, L2-030
// Description: Verify Kokoro cue synthesis in the worker, Web Audio playback, immediate muting when the Settings
// toggle is switched off, de-duplication of repeated cues, and audio-only coaching when the camera is blocked.

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MlWorkerClient, SpeechOutput } from '../ai/ml-worker.client';
import { PreferencesStore } from '../state/preferences.store';
import { TrainPageComponent } from '../../features/train/train-page.component';
import { settleTrain } from '../../features/train/train-testing';
import { SettingsPageComponent } from '../../features/settings/settings-page.component';
import { KokoroLibrary, createTtsEngine, normalizeCueText } from '../../workers/tts-engine';
import { CUE_REPEAT_WINDOW_MS, CueSpeakerService } from './cue-speaker.service';

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  readonly state = 'running';
  readonly destination = {};
  readonly sources: FakeSource[] = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {}
  createBuffer() {
    return { copyToChannel: () => undefined };
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
}

describe('Kokoro TTS engine', () => {
  function fakeLibrary() {
    const spoken: { text: string; voice: string }[] = [];
    let loads = 0;
    const lib: KokoroLibrary = {
      KokoroTTS: {
        from_pretrained: async (id, options) => {
          loads += 1;
          expect(id).toContain('Kokoro-82M');
          expect(options.device).toBe('wasm');
          return {
            generate: async (text, o) => {
              spoken.push({ text, voice: o.voice });
              return { audio: new Float32Array([0.1, 0.2, 0.3]), sampling_rate: 24000 };
            },
          };
        },
      },
    };
    return { lib, spoken, loads: () => loads };
  }

  it('loads the model once and synthesizes sanitized cues in order (L2-009, L2-030)', async () => {
    const { lib, spoken, loads } = fakeLibrary();
    const engine = createTtsEngine({ loadLibrary: async () => lib });
    const [a, b] = await Promise.all([
      engine.synthesize('Chest proud.\n\u0007 Smooth descent.'),
      engine.synthesize('Brace your core.'),
    ]);
    expect(a.samples).toHaveLength(3);
    expect(a.sampleRate).toBe(24000);
    expect(b.samples).not.toBeNull();
    expect(spoken.map((s) => s.text)).toEqual(['Chest proud. Smooth descent.', 'Brace your core.']);
    expect(loads()).toBe(1);
  });

  it('returns a reason instead of throwing when the model is not available, and retries later (L2-027)', async () => {
    let fail = true;
    const { lib } = fakeLibrary();
    const engine = createTtsEngine({
      loadLibrary: async () => {
        if (fail) throw new Error('offline and not cached');
        return lib;
      },
    });
    const first = await engine.synthesize('Hello');
    expect(first.samples).toBeNull();
    expect(first.reason).toContain('offline and not cached');

    fail = false;
    expect((await engine.synthesize('Hello again')).samples).not.toBeNull();
  });

  it('skips synthesis without loading the library when the weights are not cached (L2-027)', async () => {
    const loadLibrary = vi.fn(async () => fakeLibrary().lib);
    const engine = createTtsEngine({ loadLibrary, isCached: async () => false });
    const result = await engine.synthesize('Hello');
    expect(result.samples).toBeNull();
    expect(result.reason).toContain('not downloaded');
    expect(loadLibrary).not.toHaveBeenCalled();
  });

  it('closes remote and local model access before loading so a cue never reaches the network (L2-027)', async () => {
    const { lib } = fakeLibrary();
    const env = { allowRemoteModels: true, allowLocalModels: true };
    const engine = createTtsEngine({ loadLibrary: async () => ({ ...lib, env }) });
    await engine.synthesize('Hello');
    expect(env).toEqual({ allowRemoteModels: false, allowLocalModels: false });
  });

  it('rejects empty cues and caps cue length (L2-028)', async () => {
    expect(normalizeCueText('   \n\t ')).toBe('');
    expect(normalizeCueText('a'.repeat(500))).toHaveLength(280);
    const engine = createTtsEngine({ loadLibrary: async () => fakeLibrary().lib });
    expect((await engine.synthesize('   ')).samples).toBeNull();
  });
});

describe('CueSpeakerService', () => {
  let synth: ReturnType<typeof vi.fn>;
  let release: (v: SpeechOutput) => void;

  beforeEach(() => {
    localStorage.clear();
    FakeAudioContext.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
    synth = vi.fn(async () => ({ samples: new Float32Array([0.1, 0.2]), sampleRate: 24000 }));
    TestBed.configureTestingModule({ providers: [{ provide: MlWorkerClient, useValue: { synthesizeCue: synth } }] });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('synthesizes in the worker and plays through the Web Audio API (L2-009, L2-027)', async () => {
    const speaker = TestBed.inject(CueSpeakerService);
    expect(await speaker.speak('Chest proud.')).toBe(true);
    expect(synth).toHaveBeenCalledWith('Chest proud.');
    expect(FakeAudioContext.instances[0].sources[0].started).toBe(true);
  });

  it('does not repeat the same cue inside the repeat window (L2-009)', async () => {
    const speaker = TestBed.inject(CueSpeakerService);
    expect(await speaker.speak('Brace.', 1000)).toBe(true);
    expect(await speaker.speak('Brace.', 1000 + CUE_REPEAT_WINDOW_MS - 1)).toBe(false);
    expect(await speaker.speak('Brace.', 1000 + CUE_REPEAT_WINDOW_MS + 1)).toBe(true);
    expect(synth).toHaveBeenCalledTimes(2);
  });

  it('never synthesizes while Kokoro cues are disabled (L2-024)', async () => {
    const prefs = TestBed.inject(PreferencesStore);
    await prefs.save({ kokoroTtsEnabled: false });
    const speaker = TestBed.inject(CueSpeakerService);
    expect(await speaker.speak('Silent.')).toBe(false);
    expect(synth).not.toHaveBeenCalled();
  });

  it('mutes at once: stops playing audio and discards in-flight synthesis when disabled (L2-024)', async () => {
    const prefs = TestBed.inject(PreferencesStore);
    const speaker = TestBed.inject(CueSpeakerService);
    await speaker.speak('First cue.', 0);
    const playing = FakeAudioContext.instances[0].sources[0];

    synth.mockImplementationOnce(() => new Promise<SpeechOutput>((resolve) => (release = resolve)));
    const pending = speaker.speak('Second cue.', 100_000);
    await prefs.save({ kokoroTtsEnabled: false });
    TestBed.tick();
    expect(playing.stopped).toBe(true);

    release({ samples: new Float32Array([0.5]), sampleRate: 24000 });
    expect(await pending).toBe(false);
    expect(FakeAudioContext.instances[0].sources).toHaveLength(1);
  });

  it('degrades silently when the worker cannot synthesize (L2-027)', async () => {
    synth.mockResolvedValueOnce({ samples: null, sampleRate: 0, reason: 'not cached' });
    expect(await TestBed.inject(CueSpeakerService).speak('No model.')).toBe(false);
  });
});

describe('Train audio-only coaching and Settings toggle', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('keeps speaking cues after "Continue audio-only" when the camera is blocked (L2-010)', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    });
    const synth = vi.fn(async () => ({ samples: new Float32Array([0.1]), sampleRate: 24000 }));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: MlWorkerClient, useValue: { synthesizeCue: synth, disposePose: async () => undefined, warmUp: async () => true } }],
    });
    const fixture = TestBed.createComponent(TrainPageComponent);
    const host = fixture.nativeElement as HTMLElement;
    await settleTrain(fixture);

    host.querySelector<HTMLButtonElement>('[data-testid="train-enable-camera"]')!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="train-audio-only"]')).not.toBeNull();
    });
    host.querySelector<HTMLButtonElement>('[data-testid="train-audio-only"]')!.click();
    await vi.waitFor(() => expect(synth).toHaveBeenCalledTimes(1));
    expect(FakeAudioContext.instances.at(-1)?.sources[0].started).toBe(true);
    fixture.destroy();
  });

  it('applies the Settings Kokoro toggle immediately and persists it (L2-024)', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const prefs = TestBed.inject(PreferencesStore);
    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-testid="settings-kokoro-toggle"]')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(prefs.preferences().kokoroTtsEnabled).toBe(false));
  });
});
