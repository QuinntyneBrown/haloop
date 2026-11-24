/**
 * On-device Kokoro-82M text-to-speech engine for spoken coaching cues (L2-009, L2-024, L2-027, L2-030).
 * Runs inside the ML Web Worker; `kokoro-js` is imported lazily on the first cue so the other workloads stay light.
 */

/** ONNX Kokoro-82M weights (q8 ≈ 92 MB). */
export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const KOKORO_DTYPE = 'q8';
export const KOKORO_DEFAULT_VOICE = 'af_heart';
export const MAX_CUE_CHARACTERS = 280;

export interface TtsAudio {
  readonly audio: Float32Array;
  readonly sampling_rate: number;
}

export interface KokoroInstance {
  generate(text: string, options: { voice: string; speed?: number }): Promise<TtsAudio>;
}

/** The slice of `kokoro-js` this engine depends on. */
export interface KokoroLibrary {
  readonly KokoroTTS: {
    from_pretrained(id: string, options: { dtype: string; device: 'wasm' | 'webgpu' }): Promise<KokoroInstance>;
  };
}

export interface TtsResult {
  readonly samples: Float32Array | null;
  readonly sampleRate: number;
  readonly reason?: string;
}

export interface TtsEngineDeps {
  readonly loadLibrary: () => Promise<KokoroLibrary>;
}

export interface TtsEngine {
  synthesize(text: string, voice?: string): Promise<TtsResult>;
}

/** Strips control characters and caps length so a cue is always a short plain-text sentence. */
export function normalizeCueText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CUE_CHARACTERS);
}

export function createTtsEngine(deps: TtsEngineDeps): TtsEngine {
  let model: Promise<KokoroInstance> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function load(): Promise<KokoroInstance> {
    model ??= deps
      .loadLibrary()
      // WASM q8 is the reliable path for Kokoro: its WebGPU build only supports fp32 and is far larger.
      .then((lib) => lib.KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype: KOKORO_DTYPE, device: 'wasm' }));
    model.catch(() => {
      model = null; // a failed load (e.g. offline, not cached) can be retried on the next cue
    });
    return model;
  }

  return {
    synthesize(text, voice = KOKORO_DEFAULT_VOICE): Promise<TtsResult> {
      const clean = normalizeCueText(text);
      if (clean.length === 0) {
        return Promise.resolve({ samples: null, sampleRate: 0, reason: 'Empty cue.' });
      }
      // Cues are synthesized one at a time so they never contend for the same ONNX session.
      const run = queue.then(async (): Promise<TtsResult> => {
        try {
          const kokoro = await load();
          const { audio, sampling_rate } = await kokoro.generate(clean, { voice });
          return { samples: audio, sampleRate: sampling_rate };
        } catch (error) {
          return { samples: null, sampleRate: 0, reason: error instanceof Error ? error.message : String(error) };
        }
      });
      queue = run;
      return run;
    },
  };
}
