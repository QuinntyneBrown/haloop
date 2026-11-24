/**
 * On-device `onnx-community/vitpose-base-simple` pose engine (L2-009, L2-027, L2-030).
 * Runs inside the ML Web Worker. Transformers.js is imported lazily on the first frame so
 * search, voice and Qwen requests stay light.
 */

export const VITPOSE_MODEL_ID = 'onnx-community/vitpose-base-simple';
export const VITPOSE_DTYPE = 'fp32';

export type VitPoseDevice = 'webgpu' | 'wasm';
export type VitPosePreferredBackend = 'AutoWebGpu' | 'WasmCpu';

export interface PoseKeypoint {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

export interface PoseFrameInput {
  /** RGBA pixels of the downscaled camera frame. */
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface PoseFrameResult {
  readonly keypoints: readonly PoseKeypoint[] | null;
  readonly device: VitPoseDevice | null;
  readonly inferenceMs: number;
  readonly reason?: string;
}

interface TensorLike {
  tolist(): unknown;
}

interface VitPoseModel {
  (inputs: Record<string, unknown>): Promise<Record<string, TensorLike | undefined>>;
  dispose?(): Promise<unknown>;
}

interface VitPoseProcessor {
  (image: unknown): Promise<Record<string, unknown>>;
  post_process_pose_estimation(
    heatmaps: unknown,
    boxes: number[][][],
    options: { threshold?: number },
  ): readonly { keypoints: readonly (readonly [number, number])[]; scores: readonly number[]; labels: readonly number[] }[][];
}

/** The slice of `@huggingface/transformers` this engine depends on. */
export interface VitPoseLibrary {
  readonly env: { useBrowserCache: boolean; allowLocalModels: boolean; allowRemoteModels: boolean };
  readonly AutoModel: {
    from_pretrained(id: string, options: { device: VitPoseDevice; dtype: string }): Promise<VitPoseModel>;
  };
  readonly AutoProcessor: { from_pretrained(id: string): Promise<VitPoseProcessor> };
  readonly RawImage: new (data: Uint8ClampedArray, width: number, height: number, channels: number) => unknown;
}

export interface VitPoseEngineDeps {
  readonly loadLibrary: () => Promise<VitPoseLibrary>;
  readonly detectWebGpu: () => Promise<boolean>;
  readonly now?: () => number;
}

export interface VitPoseEngine {
  detect(frame: PoseFrameInput, preferred: VitPosePreferredBackend): Promise<PoseFrameResult>;
  dispose(): Promise<void>;
}

const KEYPOINT_COUNT = 17;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createVitPoseEngine(deps: VitPoseEngineDeps): VitPoseEngine {
  const now = deps.now ?? (() => performance.now());
  let loading: Promise<{ model: VitPoseModel; processor: VitPoseProcessor; device: VitPoseDevice }> | null = null;
  let webGpuUnusable = false;

  async function load(preferred: VitPosePreferredBackend) {
    const lib = await deps.loadLibrary();
    lib.env.useBrowserCache = true;
    const wantGpu = preferred === 'AutoWebGpu' && !webGpuUnusable && (await deps.detectWebGpu());
    const processor = await lib.AutoProcessor.from_pretrained(VITPOSE_MODEL_ID);
    try {
      const device: VitPoseDevice = wantGpu ? 'webgpu' : 'wasm';
      return { lib, processor, device, model: await lib.AutoModel.from_pretrained(VITPOSE_MODEL_ID, { device, dtype: VITPOSE_DTYPE }) };
    } catch (error) {
      if (!wantGpu) {
        throw error;
      }
      // WebGPU session creation failed: fall back to WASM CPU automatically (L2-030).
      webGpuUnusable = true;
      return {
        lib,
        processor,
        device: 'wasm' as const,
        model: await lib.AutoModel.from_pretrained(VITPOSE_MODEL_ID, { device: 'wasm', dtype: VITPOSE_DTYPE }),
      };
    }
  }

  let library: VitPoseLibrary | null = null;

  async function session(preferred: VitPosePreferredBackend) {
    loading ??= load(preferred).then((loaded) => {
      library = loaded.lib;
      return { model: loaded.model, processor: loaded.processor, device: loaded.device };
    });
    try {
      return await loading;
    } catch (error) {
      loading = null; // allow a later retry
      throw error;
    }
  }

  function parseKeypoints(
    processor: VitPoseProcessor,
    outputs: Record<string, TensorLike | undefined>,
    width: number,
    height: number,
  ): readonly PoseKeypoint[] {
    const heatmaps = outputs['heatmaps'] ?? Object.values(outputs)[0];
    if (!heatmaps) {
      throw new Error('VitPose returned no heatmaps.');
    }
    // A single person fills the camera frame, so the person box is the whole frame.
    const [people] = processor.post_process_pose_estimation(heatmaps, [[[0, 0, width, height]]], { threshold: 0 });
    const person = people?.[0];
    if (!person || person.keypoints.length < KEYPOINT_COUNT) {
      throw new Error('VitPose returned fewer than 17 keypoints.');
    }
    return person.keypoints.map(([x, y], i) => ({ x, y, score: person.scores[i] ?? 0 }));
  }

  return {
    async detect(frame, preferred): Promise<PoseFrameResult> {
      const started = now();
      try {
        const { model, processor, device } = await session(preferred);
        const RawImage = library?.RawImage;
        if (!RawImage) {
          throw new Error('Transformers.js is not loaded.');
        }
        const image = new RawImage(frame.data, frame.width, frame.height, 4);
        const inputs = await processor(image);
        const outputs = await model(inputs);
        const keypoints = parseKeypoints(processor, outputs, frame.width, frame.height);
        return { keypoints, device, inferenceMs: now() - started };
      } catch (error) {
        return { keypoints: null, device: null, inferenceMs: now() - started, reason: describeError(error) };
      }
    },

    async dispose(): Promise<void> {
      const current = loading;
      loading = null;
      try {
        await (await current)?.model.dispose?.();
      } catch {
        // Disposal is best-effort.
      }
    },
  };
}
