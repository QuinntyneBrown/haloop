// Acceptance Test
// Traces to: L2-009, L2-027, L2-029, L2-030
// Description: Verify hands-free workout commands: utterance segmentation, Whisper transcription in the worker
// (cache-only, WebGPU to WASM fallback), command matching, microphone lifecycle, and Train state transitions.

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MlWorkerClient } from '../ai/ml-worker.client';
import { TrainPageComponent } from '../../features/train/train-page.component';
import { SttLibrary, createSttEngine } from '../../workers/stt-engine';
import { UtteranceSegmenter, VOICE_SAMPLE_RATE, VoiceCommandService, matchCommand } from './voice-command.service';

const CHUNK = 1280; // 80 ms at 16 kHz
const speech = () => new Float32Array(CHUNK).fill(0.2);
const silence = () => new Float32Array(CHUNK).fill(0);

describe('UtteranceSegmenter', () => {
  it('emits one utterance with pre-roll after speech followed by silence (L2-009)', () => {
    const out: Float32Array[] = [];
    const seg = new UtteranceSegmenter((s) => out.push(s));
    for (let i = 0; i < 5; i++) seg.push(silence());
    for (let i = 0; i < 6; i++) seg.push(speech());
    expect(out).toHaveLength(0);
    for (let i = 0; i < 10; i++) seg.push(silence());
    expect(out).toHaveLength(1);
    // 2 pre-roll + 6 speech + enough silence to close the utterance.
    expect(out[0].length).toBeGreaterThanOrEqual(8 * CHUNK);
  });

  it('ignores silence and clicks shorter than the minimum length (L2-009)', () => {
    const out: Float32Array[] = [];
    const seg = new UtteranceSegmenter((s) => out.push(s));
    for (let i = 0; i < 20; i++) seg.push(silence());
    expect(out).toHaveLength(0);
  });

  it('caps a continuous utterance at six seconds (L2-030)', () => {
    const out: Float32Array[] = [];
    const seg = new UtteranceSegmenter((s) => out.push(s));
    for (let i = 0; i < 100; i++) seg.push(speech());
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].length).toBeLessThanOrEqual(6 * VOICE_SAMPLE_RATE + CHUNK);
  });
});

describe('matchCommand', () => {
  it.each([
    ['Next set', 'next-set'],
    ['okay next', 'next-set'],
    ['pause', 'pause'],
    ['Pause the workout', 'pause'],
    ['resume', 'resume'],
    ['Let us continue', 'resume'],
    ['finish session', 'finish'],
    ["I'm done", 'finish'],
  ])('%s -> %s (L2-009)', (phrase, expected) => {
    expect(matchCommand(phrase)).toBe(expected);
  });

  it('ignores unrelated speech (L2-009)', () => {
    expect(matchCommand('what a lovely morning')).toBeNull();
  });
});

describe('Whisper STT engine', () => {
  function fakeLibrary(failGpu = false) {
    const devices: string[] = [];
    const env = { useBrowserCache: false, allowRemoteModels: true, allowLocalModels: true };
    const lib: SttLibrary = {
      env,
      pipeline: async (task, model, options) => {
        devices.push(options.device);
        expect(task).toBe('automatic-speech-recognition');
        expect(model).toBe('onnx-community/whisper-base');
        if (options.device === 'webgpu' && failGpu) throw new Error('no webgpu');
        return async () => ({ text: ' Next set. ' });
      },
    };
    return { lib, devices, env };
  }
  const clip = new Float32Array(16000);

  it('transcribes locally, cache-only, and trims the text (L2-027, L2-030)', async () => {
    const { lib, env } = fakeLibrary();
    const engine = createSttEngine({ loadLibrary: async () => lib, detectWebGpu: async () => true });
    const result = await engine.transcribe(clip, 'AutoWebGpu');
    expect(result).toMatchObject({ text: 'Next set.', device: 'webgpu' });
    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(false);
  });

  it('falls back to WASM CPU when WebGPU cannot start, then stays on WASM (L2-030)', async () => {
    const { lib, devices } = fakeLibrary(true);
    const engine = createSttEngine({ loadLibrary: async () => lib, detectWebGpu: async () => true });
    expect((await engine.transcribe(clip, 'AutoWebGpu')).device).toBe('wasm');
    expect(devices).toEqual(['webgpu', 'wasm']);
  });

  it('skips loading when weights are not cached and rejects oversized clips (L2-027, L2-029)', async () => {
    const loadLibrary = vi.fn(async () => fakeLibrary().lib);
    const engine = createSttEngine({ loadLibrary, detectWebGpu: async () => false, isCached: async () => false });
    const missing = await engine.transcribe(clip, 'WasmCpu');
    expect(missing.text).toBeNull();
    expect(missing.reason).toContain('not downloaded');
    expect(loadLibrary).not.toHaveBeenCalled();

    const tooLong = await engine.transcribe(new Float32Array(16000 * 30), 'WasmCpu');
    expect(tooLong.reason).toContain('too long');
  });

  it('reports a reason instead of throwing when the model cannot load (L2-029)', async () => {
    const engine = createSttEngine({
      loadLibrary: async () => {
        throw new Error('offline and not cached');
      },
      detectWebGpu: async () => false,
    });
    const result = await engine.transcribe(clip, 'WasmCpu');
    expect(result.text).toBeNull();
    expect(result.reason).toContain('offline and not cached');
  });
});

describe('VoiceCommandService', () => {
  function setup(transcript: string | null) {
    const transcribeAudio = vi.fn(async () => ({ text: transcript }));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: MlWorkerClient, useValue: { transcribeAudio, disposePose: async () => undefined } }],
    });
    return { service: TestBed.inject(VoiceCommandService), transcribeAudio };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('transcribes an utterance in the worker and dispatches the matched command (L2-009)', async () => {
    const { service, transcribeAudio } = setup('Next set.');
    const seen: string[] = [];
    // Drive the pipeline directly; microphone capture is covered by the lifecycle tests.
    (service as unknown as { handler: (c: string) => void }).handler = (c) => seen.push(c);
    expect(await service.handleUtterance(new Float32Array(8000))).toBe('next-set');
    expect(seen).toEqual(['next-set']);
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(service.lastHeard()).toBe('Next set.');
  });

  it('does nothing for unavailable recognition or unrelated speech (L2-029)', async () => {
    expect(await setup(null).service.handleUtterance(new Float32Array(8000))).toBeNull();
    TestBed.resetTestingModule();
    expect(await setup('lovely weather').service.handleUtterance(new Float32Array(8000))).toBeNull();
  });

  it('reports unsupported browsers without opening a microphone (L2-029)', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
    vi.stubGlobal('AudioContext', undefined);
    const { service } = setup('x');
    expect(await service.start(() => undefined)).toBe(false);
    expect(service.state()).toBe('unsupported');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('marks the microphone blocked when permission is denied (L2-009)', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    });
    vi.stubGlobal('AudioContext', class {});
    vi.stubGlobal('AudioWorkletNode', class {});
    const { service } = setup('x');
    expect(await service.start(() => undefined)).toBe(false);
    expect(service.state()).toBe('blocked');
  });

  it('ignores transcripts that finish after the microphone was stopped (L2-009)', async () => {
    let release: (v: { text: string }) => void = () => undefined;
    const transcribeAudio = vi.fn(() => new Promise<{ text: string }>((resolve) => (release = resolve)));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: MlWorkerClient, useValue: { transcribeAudio } }],
    });
    const service = TestBed.inject(VoiceCommandService);
    const seen: string[] = [];
    (service as unknown as { handler: (c: string) => void }).handler = (c) => seen.push(c);
    const pending = service.handleUtterance(new Float32Array(8000));
    service.stop();
    release({ text: 'finish' });
    expect(await pending).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe('Train voice commands', () => {
  function setup() {
    const stop = vi.fn();
    let handler: (c: 'next-set' | 'pause' | 'resume' | 'finish') => void = () => undefined;
    const voice = {
      state: () => 'listening',
      lastHeard: () => '',
      start: vi.fn(async (h: typeof handler) => {
        handler = h;
        return true;
      }),
      stop,
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: VoiceCommandService, useValue: voice },
        { provide: MlWorkerClient, useValue: { disposePose: async () => undefined, synthesizeCue: async () => ({ samples: null }) } },
      ],
    });
    const fixture = TestBed.createComponent(TrainPageComponent);
    fixture.detectChanges();
    return { fixture, voice, stop, say: (c: Parameters<typeof handler>[0]) => handler(c), host: fixture.nativeElement as HTMLElement };
  }

  it('drives pause, resume, next set and finish from recognized commands (L2-009)', async () => {
    const { fixture, voice, stop, say, host } = setup();
    // The mocked service reports "listening", so exercise the handler registration path directly.
    await (fixture.componentInstance as unknown as { enableVoice(): Promise<void> }).enableVoice();
    expect(voice.start).toHaveBeenCalledTimes(1);

    say('pause');
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="train-paused-banner"]')).not.toBeNull();
    expect(stop).not.toHaveBeenCalled(); // a spoken pause keeps the microphone open to hear "resume"

    say('resume');
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="train-paused-banner"]')).toBeNull();

    expect(host.textContent).toContain('Set 2 of 3');
    say('next-set');
    fixture.detectChanges();
    expect(host.textContent).toContain('Set 3 of 3');
    expect(host.querySelector('[data-testid="train-reps"]')!.textContent).toContain('0 / 12');

    say('finish');
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="end-workout-dialog"]')).not.toBeNull();
    fixture.destroy();
    expect(stop).toHaveBeenCalled();
  });

  it('releases the microphone on a manual pause (L2-009)', () => {
    const { fixture, stop, host } = setup();
    host.querySelector<HTMLButtonElement>('[data-testid="train-pause"]')!.click();
    expect(stop).toHaveBeenCalled();
    fixture.destroy();
  });
});
