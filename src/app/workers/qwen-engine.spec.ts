// Acceptance Test
// Traces to: L2-012, L2-027, L2-030
// Description: Verify the on-device Qwen2.5-0.5B-Instruct engine resolves models from the local cache only,
// selects WebGPU with automatic WASM CPU fallback, serializes downloads with generation, and degrades to the
// deterministic reply when the model is unavailable.

import {
  DETERMINISTIC_ENGINE,
  NOT_PERSISTED_REASON,
  QWEN_DTYPE,
  QWEN_MODEL_ID,
  QwenLibrary,
  QwenPipeline,
  createQwenEngine,
  extractQwenReply,
} from './qwen-engine';

interface PipelineCall {
  readonly device: string;
  readonly dtype: string;
  readonly remoteAllowed: boolean;
}

interface FakeLibrary extends QwenLibrary {
  readonly calls: PipelineCall[];
  readonly prompts: { readonly remoteAllowed: boolean; readonly options: Record<string, unknown> }[];
  cached: boolean;
  failDevices: Set<string>;
  failRunDevices: Set<string>;
  garbageDevices: Set<string>;
  disposed: number;
  gate: Promise<void> | null;
  readonly fetched: string[];
}

function createFakeLibrary(): FakeLibrary {
  const lib: FakeLibrary = {
    calls: [],
    prompts: [],
    cached: false,
    failDevices: new Set<string>(),
    failRunDevices: new Set<string>(),
    garbageDevices: new Set<string>(),
    disposed: 0,
    gate: null,
    fetched: [],
    env: {
      allowRemoteModels: true,
      allowLocalModels: true,
      useBrowserCache: false,
      fetch: async (input) => {
        lib.fetched.push(String(input));
        return new Response('ok');
      },
      backends: { onnx: { wasm: {} } },
    },
    async pipeline(_task, _model, options) {
      lib.calls.push({ device: options.device, dtype: options.dtype, remoteAllowed: lib.env.allowRemoteModels });
      if (lib.gate) {
        await lib.gate;
      }
      if (!lib.cached && !lib.env.allowRemoteModels) {
        throw new Error('file was not found locally');
      }
      if (lib.failDevices.has(options.device)) {
        throw new Error(`no ${options.device} session`);
      }
      if (lib.env.allowRemoteModels) {
        expect(lib.env.allowLocalModels).toBe(false);
        expect((await lib.env.fetch('https://huggingface.co/config.json')).status).toBe(200);
      }
      options.progress_callback?.({ status: 'initiate', file: 'config.json' });
      options.progress_callback?.({ status: 'progress', file: 'config.json', loaded: 10, total: 10 });
      options.progress_callback?.({ status: 'progress', file: 'onnx/model_q4f16.onnx', loaded: 50, total: 90 });
      lib.cached = true;
      const pipe = (async (messages: readonly { content: string }[], generateOptions: Record<string, unknown>) => {
        if (lib.garbageDevices.has(options.device)) {
          return [{ generated_text: [{ role: 'assistant', content: 'ABCDEFG的:：[ [ :]' }] }];
        }
        if (messages.at(-1)?.content.includes('exactly one word')) {
          return [{ generated_text: [{ role: 'assistant', content: 'Ready!' }] }];
        }
        if (lib.failRunDevices.has(options.device)) {
          throw new Error('GPU device lost');
        }
        lib.prompts.push({ remoteAllowed: lib.env.allowRemoteModels, options: generateOptions });
        const streamer = generateOptions['streamer'] as { options: { callback_function: (text: string) => void } } | undefined;
        for (const piece of ['  Brace, ', 'breathe, ', 'and move with patience.  ']) streamer?.options.callback_function(piece);
        return [{ generated_text: [{ role: 'assistant', content: '  Brace, breathe, and move with patience.  ' }] }];
      }) as QwenPipeline;
      (pipe as { tokenizer?: unknown }).tokenizer = {};
      pipe.dispose = async () => {
        lib.disposed += 1;
      };
      return pipe;
    },
    TextStreamer: class {
      constructor(
        readonly tokenizer: unknown,
        readonly options: { callback_function: (text: string) => void },
      ) {}
    },
    ModelRegistry: {
      is_pipeline_cached: async () => lib.cached,
      clear_pipeline_cache: async () => {
        lib.cached = false;
      },
    },
  };
  return lib;
}

function createEngine(lib: FakeLibrary, webGpu = true) {
  let loads = 0;
  const engine = createQwenEngine({
    loadLibrary: async () => {
      loads += 1;
      return lib;
    },
    detectWebGpu: async () => webGpu,
    baseUrl: 'https://haloop.test/app/worker-abc.js',
  });
  return { engine, loadCount: () => loads };
}

describe('Qwen2.5-0.5B-Instruct on-device engine', () => {
  it('does not import Transformers.js until a Qwen request arrives (L2-030)', async () => {
    const lib = createFakeLibrary();
    const { engine, loadCount } = createEngine(lib);
    expect(loadCount()).toBe(0);
    await engine.status();
    await engine.status();
    expect(loadCount()).toBe(1);
  });

  it('locks the library to the browser cache and same-origin ONNX Runtime binaries (L2-027)', async () => {
    const lib = createFakeLibrary();
    const { engine } = createEngine(lib);
    await engine.status();

    // Transformers.js rejects "local and remote both disabled"; local-only plus the fetch guard is cache-only.
    expect(lib.env.allowRemoteModels).toBe(false);
    expect(lib.env.allowLocalModels).toBe(true);
    expect(lib.env.useBrowserCache).toBe(true);
    expect(lib.env.backends.onnx.wasm?.wasmPaths).toEqual({
      mjs: 'https://haloop.test/app/ort/ort-wasm-simd-threaded.asyncify.mjs',
      wasm: 'https://haloop.test/app/ort/ort-wasm-simd-threaded.asyncify.wasm',
    });
  });

  it('answers every model request with 404 instead of the network unless a download is running (L2-027)', async () => {
    const lib = createFakeLibrary();
    const { engine } = createEngine(lib);
    await engine.status();

    const remote = await lib.env.fetch('https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/config.json');
    const local = await lib.env.fetch('/models/onnx-community/Qwen2.5-0.5B-Instruct/config.json');
    expect(remote.status).toBe(404);
    expect(local.status).toBe(404);
    expect(lib.fetched).toEqual([]);

    const runtime = await lib.env.fetch('https://haloop.test/app/ort/ort-wasm-simd-threaded.asyncify.wasm');
    expect(runtime.status).toBe(200);
    expect(lib.fetched).toEqual(['https://haloop.test/app/ort/ort-wasm-simd-threaded.asyncify.wasm']);
  });

  it('returns the deterministic reply with a reason when the model is not cached (L2-012)', async () => {
    const lib = createFakeLibrary();
    const { engine } = createEngine(lib);

    const result = await engine.generate('My calf is tight today', 'AutoWebGpu');

    expect(result.engine).toBe(DETERMINISTIC_ENGINE);
    expect(result.device).toBeNull();
    expect(result.reply).toContain('20% lighter');
    expect(result.reason).toContain('not found locally');
    expect(lib.calls.every((c) => !c.remoteAllowed)).toBe(true);
  });

  it('streams generated tokens to the caller as they are produced (L2-012, L2-030)', async () => {
    const lib = createFakeLibrary();
    const { engine } = createEngine(lib);
    await engine.download('AutoWebGpu', () => undefined);

    const chunks: string[] = [];
    const result = await engine.generate('Coach me', 'AutoWebGpu', (c) => chunks.push(c));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('').trim()).toBe(result.reply);
    expect(lib.prompts.at(-1)?.options['streamer']).toBeDefined();
  });

  it('does not attach a streamer when no chunk callback is given (L2-012)', async () => {
    const lib = createFakeLibrary();
    const { engine } = createEngine(lib);
    await engine.download('AutoWebGpu', () => undefined);

    await engine.generate('Coach me', 'AutoWebGpu');

    expect(lib.prompts.at(-1)?.options['streamer']).toBeUndefined();
  });

  it('generates on WebGPU from the cache without remote access (L2-012, L2-027)', async () => {
    const lib = createFakeLibrary();
    lib.cached = true;
    const { engine } = createEngine(lib);

    const result = await engine.generate('Coach me through squats', 'AutoWebGpu');

    expect(result).toEqual({
      reply: 'Brace, breathe, and move with patience.',
      engine: 'Qwen2.5-0.5B-Instruct · WebGPU',
      device: 'webgpu',
    });
    expect(lib.calls).toEqual([{ device: 'webgpu', dtype: QWEN_DTYPE, remoteAllowed: false }]);
    expect(lib.prompts[0].remoteAllowed).toBe(false);
    expect(lib.prompts[0].options['return_full_text']).toBe(false);

    await engine.generate('And lunges?', 'AutoWebGpu');
    expect(lib.calls.length).toBe(1);
  });

  it('uses WASM CPU when WebGPU is unavailable or disabled in Settings (L2-030)', async () => {
    const noGpu = createFakeLibrary();
    noGpu.cached = true;
    const first = await createEngine(noGpu, false).engine.generate('Pace my run', 'AutoWebGpu');
    expect(first.engine).toBe('Qwen2.5-0.5B-Instruct · WASM CPU');
    expect(noGpu.calls.map((c) => c.device)).toEqual(['wasm']);

    const disabled = createFakeLibrary();
    disabled.cached = true;
    const second = await createEngine(disabled, true).engine.generate('Pace my run', 'WasmCpu');
    expect(second.device).toBe('wasm');
    expect(disabled.calls.map((c) => c.device)).toEqual(['wasm']);
  });

  it('falls back to WASM CPU automatically when the WebGPU session cannot be created (L2-030)', async () => {
    const lib = createFakeLibrary();
    lib.cached = true;
    lib.failDevices.add('webgpu');
    const { engine } = createEngine(lib);

    const result = await engine.generate('Pace my run', 'AutoWebGpu');
    expect(result.device).toBe('wasm');
    expect(lib.calls.map((c) => c.device)).toEqual(['webgpu', 'wasm']);

    await engine.generate('Again', 'AutoWebGpu');
    expect(lib.calls.length).toBe(2);
  });

  it('rejects a WebGPU session that returns garbage tokens and uses WASM CPU instead (L2-030)', async () => {
    const lib = createFakeLibrary();
    lib.cached = true;
    lib.garbageDevices.add('webgpu');
    const { engine } = createEngine(lib);

    const result = await engine.generate('Pace my run', 'AutoWebGpu');

    expect(result.engine).toBe('Qwen2.5-0.5B-Instruct · WASM CPU');
    expect(result.reply).toBe('Brace, breathe, and move with patience.');
    expect(lib.disposed).toBe(1);
    expect(lib.calls.map((c) => c.device)).toEqual(['webgpu', 'wasm']);
  });

  it('remembers a rejected WebGPU across sessions until the model is removed (L2-030)', async () => {
    let rejected = false;
    const webGpuVerdict = {
      isRejected: async () => rejected,
      setRejected: async (value: boolean) => {
        rejected = value;
      },
    };
    const newSession = (lib: FakeLibrary) =>
      createQwenEngine({
        loadLibrary: async () => lib,
        detectWebGpu: async () => true,
        baseUrl: 'https://haloop.test/worker.js',
        webGpuVerdict,
      });

    const first = createFakeLibrary();
    first.cached = true;
    first.garbageDevices.add('webgpu');
    await newSession(first).generate('Pace my run', 'AutoWebGpu');
    expect(rejected).toBe(true);

    const second = createFakeLibrary();
    second.cached = true;
    const engine = newSession(second);
    const result = await engine.generate('Pace my run', 'AutoWebGpu');
    expect(result.device).toBe('wasm');
    expect(second.calls.map((c) => c.device)).toEqual(['wasm']);

    await engine.remove();
    expect(rejected).toBe(false);
  });

  it('retries on WASM CPU when the WebGPU device is lost during generation (L2-030)', async () => {
    const lib = createFakeLibrary();
    lib.cached = true;
    lib.failRunDevices.add('webgpu');
    const { engine } = createEngine(lib);

    const result = await engine.generate('Pace my run', 'AutoWebGpu');

    expect(result.engine).toBe('Qwen2.5-0.5B-Instruct · WASM CPU');
    expect(result.reply).toContain('patience');
    expect(lib.disposed).toBe(1);
    expect(lib.calls.map((c) => c.device)).toEqual(['webgpu', 'wasm']);

    await engine.generate('Again', 'AutoWebGpu');
    expect(lib.calls.length).toBe(2);
  });

  it('reloads the pipeline when the preferred backend changes', async () => {
    const lib = createFakeLibrary();
    lib.cached = true;
    const { engine } = createEngine(lib);

    await engine.generate('One', 'AutoWebGpu');
    const result = await engine.generate('Two', 'WasmCpu');

    expect(result.device).toBe('wasm');
    expect(lib.disposed).toBe(1);
    expect(lib.calls.map((c) => c.device)).toEqual(['webgpu', 'wasm']);
  });

  it('opens remote access only while an explicit download runs and reports byte progress (L2-027)', async () => {
    const lib = createFakeLibrary();
    const { engine } = createEngine(lib);
    const progress: { loadedBytes: number; totalBytes: number }[] = [];

    const result = await engine.download('AutoWebGpu', (p) => progress.push(p));

    expect(result).toEqual({ ok: true, device: 'webgpu' });
    expect(lib.calls).toEqual([{ device: 'webgpu', dtype: QWEN_DTYPE, remoteAllowed: true }]);
    expect(lib.env.allowRemoteModels).toBe(false);
    expect(lib.fetched).toEqual(['https://huggingface.co/config.json']);
    expect((await lib.env.fetch('https://huggingface.co/config.json')).status).toBe(404);
    expect(progress.at(-1)).toEqual({ loadedBytes: 60, totalBytes: 100 });
    expect(await engine.status()).toBe(true);

    const reply = await engine.generate('Ready?', 'AutoWebGpu');
    expect(reply.device).toBe('webgpu');
    expect(lib.calls.length).toBe(1);
    expect(lib.prompts[0].remoteAllowed).toBe(false);
  });

  it('closes remote access again when a download fails and allows a later retry (L2-027)', async () => {
    const lib = createFakeLibrary();
    lib.failDevices.add('webgpu').add('wasm');
    const { engine } = createEngine(lib);

    const failed = await engine.download('AutoWebGpu', () => undefined);
    expect(failed.ok).toBe(false);
    expect(failed.reason).toContain('no wasm session');
    expect(lib.env.allowRemoteModels).toBe(false);

    lib.failDevices.clear();
    const retried = await engine.download('WasmCpu', () => undefined);
    expect(retried).toEqual({ ok: true, device: 'wasm' });
  });

  it('asks for a fresh worker when a failed WebGPU session leaves the runtime unable to load WASM CPU (L2-030)', async () => {
    const lib = createFakeLibrary();
    lib.cached = true;
    lib.failDevices.add('webgpu').add('wasm');
    let rejected = false;
    const deps = {
      loadLibrary: async () => lib,
      detectWebGpu: async () => true,
      baseUrl: 'https://haloop.test/app/worker-abc.js',
      webGpuVerdict: {
        isRejected: async () => rejected,
        setRejected: async (value: boolean) => {
          rejected = value;
        },
      },
    };

    const broken = await createQwenEngine(deps).generate('Coach me', 'AutoWebGpu');
    expect(broken.engine).toBe(DETERMINISTIC_ENGINE);
    expect(broken.restart).toBe(true);
    expect(rejected).toBe(true);

    // The replacement worker reads the remembered verdict and goes straight to WASM CPU.
    lib.failDevices.delete('wasm');
    lib.calls.length = 0;
    const recovered = await createQwenEngine(deps).generate('Coach me', 'AutoWebGpu');
    expect(recovered.engine).toBe('Qwen2.5-0.5B-Instruct · WASM CPU');
    expect(recovered.restart).toBeUndefined();
    expect(lib.calls.map((c) => c.device)).toEqual(['wasm']);
  });

  it('does not blame the GPU or ask for a restart when an uncached download fails (L2-027)', async () => {
    const lib = createFakeLibrary();
    lib.failDevices.add('webgpu').add('wasm');
    let rejected = false;
    const engine = createQwenEngine({
      loadLibrary: async () => lib,
      detectWebGpu: async () => true,
      baseUrl: 'https://haloop.test/app/worker-abc.js',
      webGpuVerdict: {
        isRejected: async () => rejected,
        setRejected: async (value: boolean) => {
          rejected = value;
        },
      },
    });

    const failed = await engine.download('AutoWebGpu', () => undefined);

    expect(failed.ok).toBe(false);
    expect(failed.restart).toBeUndefined();
    expect(rejected).toBe(false);
  });

  it('fails the download when the browser did not persist the model, instead of reporting Ready (L2-023)', async () => {
    const lib = createFakeLibrary();
    // A private window or exhausted quota: the pipeline loads from the network but nothing lands in the cache.
    lib.ModelRegistry.is_pipeline_cached = async () => false;
    const { engine } = createEngine(lib, false);

    const result = await engine.download('AutoWebGpu', () => undefined);

    expect(result).toEqual({ ok: false, reason: NOT_PERSISTED_REASON });
    expect(lib.disposed).toBe(1);
    expect(lib.env.allowRemoteModels).toBe(false);
  });

  it('queues Coach prompts behind an in-flight download so none runs with remote access open (L2-027)', async () => {
    const lib = createFakeLibrary();
    let openGate: () => void = () => undefined;
    lib.gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const { engine } = createEngine(lib);

    const download = engine.download('AutoWebGpu', () => undefined);
    const generation = engine.generate('Queued prompt', 'AutoWebGpu');
    await Promise.resolve();
    expect(lib.prompts.length).toBe(0);

    openGate();
    lib.gate = null;
    await download;
    const reply = await generation;

    expect(reply.device).toBe('webgpu');
    expect(lib.prompts).toHaveLength(1);
    expect(lib.prompts[0].remoteAllowed).toBe(false);
  });

  it('removes the cached model and releases the loaded pipeline', async () => {
    const lib = createFakeLibrary();
    const { engine } = createEngine(lib);
    await engine.download('AutoWebGpu', () => undefined);

    expect(await engine.remove()).toEqual({ ok: true });
    expect(lib.disposed).toBe(1);
    expect(await engine.status()).toBe(false);

    const reply = await engine.generate('Still there?', 'AutoWebGpu');
    expect(reply.engine).toBe(DETERMINISTIC_ENGINE);
  });

  it('retries the library import after a failed load instead of caching the failure', async () => {
    const lib = createFakeLibrary();
    lib.cached = true;
    let attempts = 0;
    const engine = createQwenEngine({
      loadLibrary: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('chunk load failed');
        }
        return lib;
      },
      detectWebGpu: async () => true,
      baseUrl: 'https://haloop.test/worker.js',
    });

    const first = await engine.generate('Hello', 'AutoWebGpu');
    expect(first.engine).toBe(DETERMINISTIC_ENGINE);
    expect(first.reason).toBe('chunk load failed');

    const second = await engine.generate('Hello', 'AutoWebGpu');
    expect(second.device).toBe('webgpu');
  });

  it('extracts replies from chat and plain text-generation outputs', () => {
    expect(extractQwenReply([{ generated_text: ' plain ' }])).toBe('plain');
    expect(extractQwenReply([{ generated_text: [{ role: 'assistant', content: ' chat ' }] }])).toBe('chat');
    expect(extractQwenReply([])).toBe('');
    expect(extractQwenReply({ model: QWEN_MODEL_ID })).toBe('');
  });
});
