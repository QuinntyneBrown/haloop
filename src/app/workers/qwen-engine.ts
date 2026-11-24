/**
 * On-device `onnx-community/Qwen2.5-0.5B-Instruct` Coach fallback engine (L2-012, L2-027, L2-030).
 *
 * Runs inside the ML Web Worker. The Transformers.js library is injected lazily so
 * that pose, search, and voice messages never pay for (or fail with) the library load.
 *
 * Network policy: remote model access is disabled at all times except while an
 * explicit, user-initiated download is running. Outside a download the library's
 * `fetch` is replaced with a guard that only lets the same-origin ONNX Runtime
 * binaries through, so a cache miss can never turn into a network request.
 * Downloads and generations share one serialized queue, so a Coach prompt can
 * never execute while remote access is open.
 */

export const QWEN_MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
export const QWEN_TASK = 'text-generation';
/** 4-bit weights with fp16 activations: the ~480 MB variant AI Lab advertises and budgets. */
export const QWEN_DTYPE = 'q4f16';
export const QWEN_REFLECTION = 'Hebrews 12:1 — run with patience the race set before you.';
export const DETERMINISTIC_ENGINE = 'Deterministic fallback';

const QWEN_SYSTEM_PROMPT =
  'You are Haloop Coach, a concise, encouraging on-device movement and devotional coach. Respond in 2-3 sentences.';
/**
 * Some GPU drivers run the fp16 graph without error but emit garbage tokens. After loading on
 * WebGPU the engine asks for this one-word answer (which the model gives deterministically under
 * greedy decoding) and only keeps the WebGPU session when it comes back intact.
 */
const WEBGPU_PROBE_PROMPT = 'Reply with exactly one word: ready';
const WEBGPU_PROBE_EXPECTED = /ready/i;
export const NOT_PERSISTED_REASON =
  'The browser did not keep the downloaded model in its cache (storage may be full or restricted).';
const ORT_WASM_BASENAME = 'ort/ort-wasm-simd-threaded.asyncify';

export type QwenDevice = 'webgpu' | 'wasm';
export type QwenPreferredBackend = 'AutoWebGpu' | 'WasmCpu';

export interface QwenProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
}

export interface QwenGenerateResult {
  readonly reply: string;
  readonly engine: string;
  readonly device: QwenDevice | null;
  readonly reason?: string;
  /** Set when this worker's ONNX Runtime is unusable and only a fresh worker can run the model. */
  readonly restart?: true;
}

export interface QwenOperationResult {
  readonly ok: boolean;
  readonly device?: QwenDevice;
  readonly reason?: string;
  readonly restart?: true;
}

interface QwenChatMessage {
  readonly role: string;
  readonly content: string;
}

export interface QwenPipeline {
  (messages: readonly QwenChatMessage[], options: Record<string, unknown>): Promise<unknown>;
  dispose?(): Promise<unknown>;
}

interface QwenModelOptions {
  readonly device: QwenDevice;
  readonly dtype: string;
  readonly progress_callback?: (info: unknown) => void;
}

export type QwenFetch = (input: string | URL, init?: unknown) => Promise<Response>;

/** The slice of `@huggingface/transformers` this engine depends on. */
export interface QwenLibrary {
  readonly env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    fetch: QwenFetch;
    readonly backends: { readonly onnx: { wasm?: { wasmPaths?: unknown } } };
  };
  pipeline(task: string, model: string, options: QwenModelOptions): Promise<QwenPipeline>;
  readonly ModelRegistry: {
    is_pipeline_cached(task: string, model: string, options: Omit<QwenModelOptions, 'progress_callback'>): Promise<boolean>;
    clear_pipeline_cache(task: string, model: string, options: Omit<QwenModelOptions, 'progress_callback'>): Promise<unknown>;
  };
}

export interface QwenEngineDeps {
  /** Lazily imports Transformers.js. */
  readonly loadLibrary: () => Promise<QwenLibrary>;
  /** Resolves true only when a WebGPU adapter able to run the fp16 model exists. */
  readonly detectWebGpu: () => Promise<boolean>;
  /** URL the same-origin ONNX Runtime WASM assets are resolved against. */
  readonly baseUrl: string;
  /**
   * Remembers across sessions that this device's WebGPU failed the output check, so later sessions
   * load straight onto WASM CPU instead of loading the model twice. Cleared when the model is removed.
   */
  readonly webGpuVerdict?: {
    isRejected(): Promise<boolean>;
    setRejected(rejected: boolean): Promise<void>;
  };
}

export interface QwenEngine {
  status(): Promise<boolean>;
  download(preferred: QwenPreferredBackend, onProgress: (progress: QwenProgress) => void): Promise<QwenOperationResult>;
  remove(): Promise<QwenOperationResult>;
  generate(prompt: string, preferred: QwenPreferredBackend): Promise<QwenGenerateResult>;
}

export function ruleBasedCoachReply(prompt: string): string {
  const lower = prompt.toLowerCase();
  return lower.includes('plank') || lower.includes('breath')
    ? 'Breathe in for four counts, hold two, and exhale six before your plank holds. Keep shoulders stacked over elbows and let your pace stay unhurried.'
    : lower.includes('sore') || lower.includes('tight') || lower.includes('calf')
      ? 'Keep today’s load 20% lighter, add 90 seconds of slow ankle rocks before set one, and prioritize full range of motion.'
      : 'Focus on unhurried tempo (3-1-1), clean posture, and steady breathing across every working set today.';
}

export function extractQwenReply(output: unknown): string {
  if (!Array.isArray(output) || output.length === 0) {
    return '';
  }
  const generated = (output[0] as { generated_text?: unknown }).generated_text;
  if (Array.isArray(generated)) {
    const last = generated.at(-1) as { content?: unknown } | undefined;
    return typeof last?.content === 'string' ? last.content.trim() : '';
  }
  return typeof generated === 'string' ? generated.trim() : '';
}

export function qwenEngineLabel(device: QwenDevice): string {
  return `Qwen2.5-0.5B-Instruct · ${device === 'webgpu' ? 'WebGPU' : 'WASM CPU'}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createQwenEngine(deps: QwenEngineDeps): QwenEngine {
  let library: Promise<QwenLibrary> | null = null;
  let loaded: { readonly device: QwenDevice; readonly pipe: QwenPipeline } | null = null;
  let webGpuUnusable = false;
  let remoteOpen = false;
  let needsRestart = false;
  let queue: Promise<unknown> = Promise.resolve();
  const ortBaseUrl = new URL('ort/', deps.baseUrl).href;

  /**
   * Transformers.js rejects "local and remote both disabled", so cache-only mode is expressed as
   * local-only with every non-runtime request answered 404 here instead of reaching the network.
   */
  function setRemoteAccess(lib: QwenLibrary, open: boolean): void {
    remoteOpen = open;
    lib.env.allowRemoteModels = open;
    lib.env.allowLocalModels = !open;
  }

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  }

  function getLibrary(): Promise<QwenLibrary> {
    library ??= deps.loadLibrary().then((lib) => {
      lib.env.useBrowserCache = true;
      const upstreamFetch = lib.env.fetch;
      lib.env.fetch = (input, init) =>
        remoteOpen || new URL(String(input), deps.baseUrl).href.startsWith(ortBaseUrl)
          ? upstreamFetch(input, init)
          : Promise.resolve(new Response(null, { status: 404, statusText: 'Not cached on this device' }));
      setRemoteAccess(lib, false);
      const wasm = lib.env.backends.onnx.wasm;
      if (wasm) {
        // Serve the ONNX Runtime binaries from the app origin instead of the library's CDN default.
        wasm.wasmPaths = {
          mjs: new URL(`${ORT_WASM_BASENAME}.mjs`, deps.baseUrl).href,
          wasm: new URL(`${ORT_WASM_BASENAME}.wasm`, deps.baseUrl).href,
        };
      }
      return lib;
    });
    library.catch(() => {
      library = null;
    });
    return library;
  }

  function restartFlag(): { restart?: true } {
    return needsRestart ? { restart: true } : {};
  }

  function isCached(lib: QwenLibrary): Promise<boolean> {
    return lib.ModelRegistry.is_pipeline_cached(QWEN_TASK, QWEN_MODEL_ID, { device: 'wasm', dtype: QWEN_DTYPE });
  }

  async function resolveDevice(preferred: QwenPreferredBackend): Promise<QwenDevice> {
    if (preferred === 'WasmCpu' || webGpuUnusable) {
      return 'wasm';
    }
    try {
      if (await deps.webGpuVerdict?.isRejected()) {
        webGpuUnusable = true;
        return 'wasm';
      }
      return (await deps.detectWebGpu()) ? 'webgpu' : 'wasm';
    } catch {
      return 'wasm';
    }
  }

  async function producesValidOutput(pipe: QwenPipeline): Promise<boolean> {
    try {
      const output = await pipe(
        [
          { role: 'system', content: QWEN_SYSTEM_PROMPT },
          { role: 'user', content: WEBGPU_PROBE_PROMPT },
        ],
        { max_new_tokens: 4, do_sample: false, return_full_text: false },
      );
      return WEBGPU_PROBE_EXPECTED.test(extractQwenReply(output));
    } catch {
      return false;
    }
  }

  async function release(): Promise<void> {
    const current = loaded;
    loaded = null;
    try {
      await current?.pipe.dispose?.();
    } catch {
      // Disposal is best-effort; the session is unreachable either way.
    }
  }

  async function acquire(
    lib: QwenLibrary,
    preferred: QwenPreferredBackend,
    progress?: (info: unknown) => void,
  ): Promise<{ readonly device: QwenDevice; readonly pipe: QwenPipeline }> {
    const device = await resolveDevice(preferred);
    if (loaded?.device === device) {
      return loaded;
    }
    await release();
    const load = async (target: QwenDevice): Promise<QwenPipeline> => {
      const pipe = await lib.pipeline(QWEN_TASK, QWEN_MODEL_ID, {
        device: target,
        dtype: QWEN_DTYPE,
        progress_callback: progress,
      });
      if (target === 'webgpu' && !(await producesValidOutput(pipe))) {
        await pipe.dispose?.().catch(() => undefined);
        await deps.webGpuVerdict?.setRejected(true).catch(() => undefined);
        throw new Error('WebGPU produced invalid output for the fp16 model on this device.');
      }
      return pipe;
    };
    try {
      loaded = { device, pipe: await load(device) };
    } catch (error) {
      if (device === 'wasm') {
        throw error;
      }
      // WebGPU could not create the session or failed its output check — fall back to WASM CPU (L2-030).
      // With the weights already cached the failure is a verdict on this GPU rather than on the network,
      // so remember it: later sessions then load straight onto WASM CPU.
      const gpuFault = await isCached(lib).catch(() => false);
      if (gpuFault) {
        webGpuUnusable = true;
        await deps.webGpuVerdict?.setRejected(true).catch(() => undefined);
      }
      try {
        loaded = { device: 'wasm', pipe: await load('wasm') };
      } catch (wasmError) {
        // A failed WebGPU session can leave ONNX Runtime unusable for the rest of this worker's life,
        // so even the WASM CPU load fails. Only a fresh worker recovers; ask the client for one.
        needsRestart = gpuFault;
        throw wasmError;
      }
      webGpuUnusable = true;
    }
    return loaded;
  }

  return {
    async status(): Promise<boolean> {
      try {
        return await isCached(await getLibrary());
      } catch {
        return false;
      }
    },

    download(preferred, onProgress): Promise<QwenOperationResult> {
      return enqueue(async () => {
        let lib: QwenLibrary;
        try {
          lib = await getLibrary();
        } catch (error) {
          return { ok: false, reason: describeError(error) };
        }
        const files = new Map<string, QwenProgress>();
        const track = (info: unknown): void => {
          const event = info as { status?: unknown; file?: unknown; loaded?: unknown; total?: unknown };
          if (
            event.status !== 'progress' ||
            typeof event.file !== 'string' ||
            typeof event.loaded !== 'number' ||
            typeof event.total !== 'number'
          ) {
            return;
          }
          files.set(event.file, { loadedBytes: event.loaded, totalBytes: event.total });
          let loadedBytes = 0;
          let totalBytes = 0;
          for (const file of files.values()) {
            loadedBytes += file.loadedBytes;
            totalBytes += file.totalBytes;
          }
          onProgress({ loadedBytes, totalBytes });
        };

        setRemoteAccess(lib, true);
        try {
          const { device } = await acquire(lib, preferred, track);
          // A private window or a full disk lets the model load from the network without persisting it.
          // Only report success when the weights are really in the cache, so `Ready` is never a lie.
          if (!(await isCached(lib).catch(() => false))) {
            await release();
            return { ok: false, reason: NOT_PERSISTED_REASON };
          }
          return { ok: true, device };
        } catch (error) {
          return { ok: false, reason: describeError(error), ...restartFlag() };
        } finally {
          setRemoteAccess(lib, false);
        }
      });
    },

    remove(): Promise<QwenOperationResult> {
      return enqueue(async () => {
        try {
          const lib = await getLibrary();
          await release();
          webGpuUnusable = false;
          await deps.webGpuVerdict?.setRejected(false).catch(() => undefined);
          await lib.ModelRegistry.clear_pipeline_cache(QWEN_TASK, QWEN_MODEL_ID, {
            device: 'wasm',
            dtype: QWEN_DTYPE,
          });
          return { ok: true };
        } catch (error) {
          return { ok: false, reason: describeError(error) };
        }
      });
    },

    generate(prompt, preferred): Promise<QwenGenerateResult> {
      return enqueue(async () => {
        try {
          const lib = await getLibrary();
          const messages = [
            { role: 'system', content: QWEN_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ];
          const options = { max_new_tokens: 160, do_sample: false, return_full_text: false };
          let session = await acquire(lib, preferred);
          let output: unknown;
          try {
            output = await session.pipe(messages, options);
          } catch (error) {
            if (session.device === 'wasm') {
              throw error;
            }
            // The GPU device was lost or rejected the graph mid-run — retry once on WASM CPU (L2-030).
            webGpuUnusable = true;
            session = await acquire(lib, preferred);
            output = await session.pipe(messages, options);
          }
          const reply = extractQwenReply(output);
          if (reply.length === 0) {
            throw new Error('Qwen2.5-0.5B-Instruct returned an empty reply.');
          }
          return { reply, engine: qwenEngineLabel(session.device), device: session.device };
        } catch (error) {
          return {
            reply: ruleBasedCoachReply(prompt),
            engine: DETERMINISTIC_ENGINE,
            device: null,
            reason: describeError(error),
            ...restartFlag(),
          };
        }
      });
    },
  };
}
