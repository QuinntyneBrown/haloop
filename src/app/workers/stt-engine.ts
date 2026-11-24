/**
 * On-device `onnx-community/whisper-base` speech-to-text engine for hands-free workout commands
 * (L2-009, L2-027, L2-029, L2-030). Runs inside the ML Web Worker; audio never leaves the browser.
 */

export const WHISPER_MODEL_ID = 'onnx-community/whisper-base';
export const WHISPER_TASK = 'automatic-speech-recognition';
export const WHISPER_SAMPLE_RATE = 16000;
/** Longest clip accepted, so a stuck microphone cannot hand the worker an unbounded buffer. */
export const MAX_CLIP_SECONDS = 10;

export type SttDevice = 'webgpu' | 'wasm';
export type SttPreferredBackend = 'AutoWebGpu' | 'WasmCpu';

export interface SttResult {
  readonly text: string | null;
  readonly device: SttDevice | null;
  readonly reason?: string;
}

interface SttPipeline {
  (audio: Float32Array, options: Record<string, unknown>): Promise<{ text?: string } | { text?: string }[]>;
  dispose?(): Promise<unknown>;
}

/** The slice of `@huggingface/transformers` this engine depends on. */
export interface SttLibrary {
  readonly env: { useBrowserCache: boolean; allowRemoteModels: boolean; allowLocalModels: boolean };
  pipeline(task: string, model: string, options: { device: SttDevice; dtype: string }): Promise<SttPipeline>;
}

export interface SttEngineDeps {
  readonly loadLibrary: () => Promise<SttLibrary>;
  readonly detectWebGpu: () => Promise<boolean>;
  /** Whether the weights are already cached locally; when not, transcription is skipped without any network. */
  readonly isCached?: () => Promise<boolean>;
}

export interface SttEngine {
  transcribe(samples: Float32Array, preferred: SttPreferredBackend): Promise<SttResult>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSttEngine(deps: SttEngineDeps): SttEngine {
  let session: Promise<{ pipe: SttPipeline; device: SttDevice }> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let webGpuUnusable = false;

  function load(preferred: SttPreferredBackend): Promise<{ pipe: SttPipeline; device: SttDevice }> {
    session ??= (async () => {
      const lib = await deps.loadLibrary();
      lib.env.useBrowserCache = true;
      // Cache-only: listening must never reach the network (L2-027).
      lib.env.allowRemoteModels = false;
      lib.env.allowLocalModels = false;
      const wantGpu = preferred === 'AutoWebGpu' && !webGpuUnusable && (await deps.detectWebGpu());
      const create = (device: SttDevice) => lib.pipeline(WHISPER_TASK, WHISPER_MODEL_ID, { device, dtype: 'q8' });
      if (wantGpu) {
        try {
          return { pipe: await create('webgpu'), device: 'webgpu' as const };
        } catch {
          webGpuUnusable = true; // fall back to WASM CPU (L2-030)
        }
      }
      return { pipe: await create('wasm'), device: 'wasm' as const };
    })();
    session.catch(() => {
      session = null; // allow a retry after a failed load
    });
    return session;
  }

  return {
    transcribe(samples, preferred): Promise<SttResult> {
      const run = queue.then(async (): Promise<SttResult> => {
        try {
          if (samples.length === 0 || samples.length > MAX_CLIP_SECONDS * WHISPER_SAMPLE_RATE) {
            return { text: null, device: null, reason: 'Audio clip is empty or too long.' };
          }
          if (deps.isCached && !(await deps.isCached())) {
            return { text: null, device: null, reason: 'Whisper is not downloaded on this device.' };
          }
          const { pipe, device } = await load(preferred);
          const output = await pipe(samples, { language: 'en', task: 'transcribe' });
          const first = Array.isArray(output) ? output[0] : output;
          return { text: typeof first?.text === 'string' ? first.text.trim() : '', device };
        } catch (error) {
          return { text: null, device: null, reason: describeError(error) };
        }
      });
      queue = run;
      return run;
    },
  };
}
