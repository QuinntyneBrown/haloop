// Acceptance Test
// Traces to: L2-009, L2-012, L2-014, L2-018, L2-027, L2-030
// Description: Verify dedicated ML Web Worker client (including on-device Qwen2.5-0.5B-Instruct fallback wiring), Chrome Built-in AI fallback adapter, and BLE Heart Rate / Battery GATT payload parsers.

import { TestBed } from '@angular/core/testing';
import { ChromeAiService } from './chrome-ai.service';
import { MlWorkerClient } from './ml-worker.client';
import {
  parseBleBatteryLevel,
  parseBleHeartRateMeasurement,
} from '../wearables/web-bluetooth.adapter';

describe('ML Worker, Chrome AI & BLE GATT Adapters', () => {
  let worker: MlWorkerClient;
  let chromeAi: ChromeAiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    worker = TestBed.inject(MlWorkerClient);
    chromeAi = TestBed.inject(ChromeAiService);
  });

  it('steps pose estimation and parses Whisper voice commands via MlWorkerClient (L2-009, L2-030)', async () => {
    const pose = await worker.stepPose(8, 12, 'WebGPU');
    expect(pose.completedReps).toBe(9);
    expect(pose.formScorePercent).toBeGreaterThanOrEqual(88);

    expect(await worker.parseVoiceCommand('pause workout')).toBe('pause');
    expect(await worker.parseVoiceCommand('next set please')).toBe('next-set');
  });

  it('generates on-device Coach replies cleanly via ChromeAiService fallback (L2-012, L2-027)', async () => {
    const reply = await chromeAi.promptCoach('Give me a breath prayer before plank holds');
    expect(reply.text.length).toBeGreaterThan(20);
    expect(reply.engine).toContain('Haloop Coach');
  });

  it('returns a non-empty reply and engine label from the Qwen worker path (L2-012, L2-027, L2-030)', async () => {
    const output = await worker.generateCoachReply('Coach me through steady squats');
    expect(output.reply.length).toBeGreaterThan(0);
    expect(output.reflection).toContain('Hebrews 12:1');
    expect(output.engine.length).toBeGreaterThan(0);
  });

  it('reports the worker-reported engine label when falling back from Gemini Nano (L2-012)', async () => {
    const reply = await chromeAi.promptCoach('How should I pace my run today?');
    expect(reply.text.length).toBeGreaterThan(20);
    expect(reply.engine).toMatch(/^Haloop Coach · /);
  });

  describe('with a dedicated ML Web Worker', () => {
    class FakeWorker {
      static last: FakeWorker | null = null;
      readonly posted: Record<string, unknown>[] = [];
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;

      constructor() {
        FakeWorker.last = this;
      }

      postMessage(message: Record<string, unknown>): void {
        this.posted.push(message);
      }

      terminate(): void {
        this.terminated = true;
      }

      reply(data: Record<string, unknown>): void {
        this.onmessage?.({ data: { id: this.posted.at(-1)?.['id'], ...data } });
      }
    }

    beforeEach(() => {
      FakeWorker.last = null;
      vi.stubGlobal('Worker', FakeWorker);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('labels Coach replies with the engine and backend the worker actually used (L2-012, L2-030)', async () => {
      const pending = chromeAi.promptCoach('How should I pace my run today?');
      await Promise.resolve();
      const fake = FakeWorker.last!;
      expect(fake.posted[0]).toMatchObject({ type: 'qwen-generate', preferredBackend: 'AutoWebGpu' });

      fake.reply({
        type: 'qwen-generate',
        reply: 'Hold an easy, conversational pace for the first ten minutes.',
        reflection: 'Hebrews 12:1 — run with patience the race set before you.',
        engine: 'Qwen2.5-0.5B-Instruct · WebGPU',
        device: 'webgpu',
      });

      const reply = await pending;
      expect(reply.text).toContain('conversational pace');
      expect(reply.engine).toBe('Haloop Coach · Qwen2.5-0.5B-Instruct · WebGPU');
    });

    it('forwards streamed Qwen chunks to the caller as an accumulating reply (L2-012, L2-030)', async () => {
      const seen: string[] = [];
      const pending = chromeAi.promptCoach('Pace my run', (text) => seen.push(text));
      await Promise.resolve();
      const fake = FakeWorker.last!;
      expect(fake.posted[0]).toMatchObject({ type: 'qwen-generate', stream: true });

      fake.reply({ type: 'qwen-chunk', chunk: 'Easy ' });
      fake.reply({ type: 'qwen-chunk', chunk: 'pace.' });
      expect(seen).toEqual(['Easy ', 'Easy pace.']);

      fake.reply({ type: 'qwen-generate', reply: 'Easy pace.', reflection: 'r', engine: 'Qwen2.5-0.5B-Instruct · WASM CPU', device: 'wasm' });
      expect((await pending).text).toBe('Easy pace.');
    });

    it('does not request streaming when no chunk callback is given (L2-012)', async () => {
      void chromeAi.promptCoach('Pace my run');
      await Promise.resolve();
      expect(FakeWorker.last!.posted[0]).toMatchObject({ stream: false });
    });

    it('forwards Qwen download progress without settling the request early (L2-027)', async () => {
      const seen: number[] = [];
      const pending = worker.downloadQwen('WasmCpu', (p) => seen.push(p.loadedBytes));
      const fake = FakeWorker.last!;
      expect(fake.posted[0]).toMatchObject({ type: 'qwen-download', preferredBackend: 'WasmCpu' });

      fake.reply({ type: 'qwen-progress', loadedBytes: 1_000, totalBytes: 4_000 });
      fake.reply({ type: 'qwen-progress', loadedBytes: 4_000, totalBytes: 4_000 });
      fake.reply({ type: 'qwen-download', ok: true, device: 'wasm' });

      expect((await pending).ok).toBe(true);
      expect(seen).toEqual([1_000, 4_000]);
    });

    it('replays a request on a fresh worker when the worker reports an unusable runtime (L2-030)', async () => {
      const pending = worker.generateCoachReply('My calf is tight', 'AutoWebGpu');
      const broken = FakeWorker.last!;
      const brokenReply = {
        type: 'qwen-generate',
        reply: 'rule-based',
        reflection: 'r',
        engine: 'Deterministic fallback',
        device: null,
        restart: true,
      };

      broken.reply(brokenReply);

      const fresh = FakeWorker.last!;
      expect(fresh).not.toBe(broken);
      expect(broken.terminated).toBe(true);
      expect(fresh.posted[0]).toEqual(broken.posted[0]);

      fresh.reply({
        type: 'qwen-generate',
        reply: 'Ease in with ankle rocks.',
        reflection: 'r',
        engine: 'Qwen2.5-0.5B-Instruct · WASM CPU',
        device: 'wasm',
      });
      expect((await pending).engine).toBe('Qwen2.5-0.5B-Instruct · WASM CPU');

      // A second failure is final: the request settles instead of restarting forever.
      const again = worker.generateCoachReply('Still tight');
      fresh.reply(brokenReply);
      const third = FakeWorker.last!;
      expect(third).not.toBe(fresh);
      third.reply(brokenReply);
      expect((await again).engine).toBe('Deterministic fallback');
      expect(FakeWorker.last).toBe(third);
    });

    it('settles pending requests with local fallbacks when the worker crashes (L2-030)', async () => {
      const reply = worker.generateCoachReply('My calf is tight');
      const status = worker.qwenCacheStatus();
      const crashed = FakeWorker.last!;

      crashed.onerror?.();

      expect((await reply).engine).toBe('Deterministic fallback');
      expect((await reply).reply).toContain('20% lighter');
      expect(await status).toBeNull();
      expect(crashed.terminated).toBe(true);

      void worker.parseVoiceCommand('pause');
      expect(FakeWorker.last).not.toBe(crashed);
    });
  });

  describe('Gemini Nano streaming', () => {
    function stubLanguageModel(chunks: readonly string[]): void {
      vi.stubGlobal('LanguageModel', {
        create: async () => ({
          prompt: async () => chunks.join(''),
          promptStreaming: async function* () {
            for (const c of chunks) yield c;
          },
        }),
      });
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      chromeAi.resetPromptSession();
    });

    it('streams promptStreaming() deltas as an accumulating reply (L2-012)', async () => {
      stubLanguageModel(['Keep ', 'the load ', 'light.']);
      const seen: string[] = [];

      const reply = await chromeAi.promptCoach('Sore calves', (t) => seen.push(t));

      expect(seen).toEqual(['Keep ', 'Keep the load ', 'Keep the load light.']);
      expect(reply.text).toBe('Keep the load light.');
      expect(reply.engine).toBe('Haloop Coach · Gemini Nano');
    });

    it('never shows the Chromium echo stub and falls back to the local engine (L2-012)', async () => {
      stubLanguageModel(['On-device model is not available', ' in Chromium: echo']);
      const seen: string[] = [];

      const reply = await chromeAi.promptCoach('Give me a breath prayer before plank holds', (t) => seen.push(t));

      expect(seen.some((t) => t.includes('On-device model is not available'))).toBe(false);
      expect(reply.engine).not.toContain('Gemini Nano');
    });
  });

  it('parses standard BLE 8-bit and 16-bit Heart Rate and Battery characteristics (L2-018)', () => {
    const hr8 = new DataView(new Uint8Array([0x00, 134]).buffer);
    expect(parseBleHeartRateMeasurement(hr8)).toBe(134);

    const hr16 = new DataView(new Uint8Array([0x01, 0x98, 0x00]).buffer);
    expect(parseBleHeartRateMeasurement(hr16)).toBe(152);

    const bat = new DataView(new Uint8Array([88]).buffer);
    expect(parseBleBatteryLevel(bat)).toBe(88);
  });
});
