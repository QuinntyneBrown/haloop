import { Injectable, OnDestroy } from '@angular/core';
import type { PoseKeypoint, VitPoseDevice } from '../../workers/vitpose-engine';
import { DETERMINISTIC_ENGINE, QWEN_REFLECTION, ruleBasedCoachReply } from '../../workers/qwen-engine';

export interface PoseStepOutput {
  readonly completedReps: number;
  readonly formScorePercent: number;
  readonly cue: string;
  readonly backend: string;
}

export interface PoseFrameOutput {
  /** 17 COCO keypoints in frame pixel coordinates, or `null` when pose estimation is unavailable. */
  readonly keypoints: readonly PoseKeypoint[] | null;
  readonly device: VitPoseDevice | null;
  readonly inferenceMs: number;
  readonly reason?: string;
}

export interface SpeechOutput {
  /** Mono PCM samples, or `null` when synthesis is unavailable. */
  readonly samples: Float32Array | null;
  readonly sampleRate: number;
  readonly reason?: string;
}

export interface TranscriptionOutput {
  /** Recognized text, or `null` when speech recognition is unavailable. */
  readonly text: string | null;
  readonly reason?: string;
}

export interface WorkerSearchOutput {
  readonly reference: string;
  readonly text: string;
  readonly score: number;
}

export type QwenPreferredBackend = 'AutoWebGpu' | 'WasmCpu';

export interface QwenGenerateOutput {
  readonly reply: string;
  readonly reflection: string;
  readonly engine: string;
  /** Why the deterministic reply was used instead of on-device Qwen inference, when it was. */
  readonly reason?: string;
}

export interface QwenDownloadProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
}

export interface QwenOperationOutput {
  readonly ok: boolean;
  readonly reason?: string;
}

/** `null` means no ML worker exists in this environment, so the real cache cannot be inspected. */
export type QwenCacheStatus = boolean | null;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly fallback: () => unknown;
  readonly payload: Record<string, unknown>;
  retried: boolean;
  readonly onProgress?: (progress: QwenDownloadProgress) => void;
  readonly onChunk?: (chunk: string) => void;
}

interface WorkerMessage {
  readonly id: string;
  readonly type?: string;
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
  readonly chunk?: string;
  /** The worker's ONNX Runtime is unusable; the request must be replayed on a fresh worker. */
  readonly restart?: boolean;
}

/**
 * Typed client dispatching ML workloads (VitPose, Whisper, MiniLM, Qwen)
 * to a dedicated Web Worker so main-thread UI latency stays <= 100 ms (L2-030).
 */
@Injectable({ providedIn: 'root' })
export class MlWorkerClient implements OnDestroy {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private seq = 0;

  private ensureWorker(): Worker | null {
    if (this.worker) {
      return this.worker;
    }
    if (typeof Worker === 'undefined') {
      return null;
    }
    try {
      this.worker = new Worker(new URL('../../workers/ml-inference.worker', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        const request = this.pending.get(data.id);
        if (!request) {
          return;
        }
        if (data.type === 'qwen-progress') {
          request.onProgress?.({ loadedBytes: data.loadedBytes ?? 0, totalBytes: data.totalBytes ?? 0 });
          return;
        }
        if (data.type === 'qwen-chunk') {
          if (typeof data.chunk === 'string') request.onChunk?.(data.chunk);
          return;
        }
        if (data.restart === true && !request.retried) {
          request.retried = true;
          this.restartWorker();
          return;
        }
        this.pending.delete(data.id);
        request.resolve(data);
      };
      this.worker.onerror = () => this.failWorker();
      this.worker.onmessageerror = () => this.failWorker();
      return this.worker;
    } catch {
      return null;
    }
  }

  /** A crashed worker must not leave callers waiting forever: settle them locally and start fresh next time. */
  private failWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    const stranded = [...this.pending.values()];
    this.pending.clear();
    for (const request of stranded) {
      request.resolve(request.fallback());
    }
  }

  /**
   * A failed WebGPU session can leave the worker's ONNX Runtime unusable. The worker has already recorded
   * that this device needs WASM CPU, so a fresh worker succeeds: replay everything still pending on one.
   */
  private restartWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    const worker = this.ensureWorker();
    if (!worker) {
      this.failWorker();
      return;
    }
    for (const [id, request] of this.pending) {
      worker.postMessage({ ...request.payload, id });
    }
  }

  private dispatch<T>(
    payload: Record<string, unknown>,
    fallback: () => T,
    onProgress?: (progress: QwenDownloadProgress) => void,
    onChunk?: (chunk: string) => void,
    transfer: Transferable[] = [],
  ): Promise<T> {
    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.resolve(fallback());
    }
    const id = `w-${++this.seq}`;
    return new Promise<T>((resolve) => {
      this.pending.set(id, { resolve: (res) => resolve(res as T), fallback, onProgress, onChunk, payload, retried: false });
      worker.postMessage({ ...payload, id }, transfer);
    });
  }

  /**
   * Runs VitPose on one camera frame. The bitmap is transferred (zero-copy) to the worker and never leaves
   * the browser (L2-027, L2-030). Resolves with `keypoints: null` when pose estimation is unavailable.
   */
  detectPose(bitmap: ImageBitmap, preferredBackend: QwenPreferredBackend = 'AutoWebGpu'): Promise<PoseFrameOutput> {
    return this.dispatch<PoseFrameOutput>(
      { type: 'pose-frame', bitmap, preferredBackend },
      () => {
        bitmap.close();
        return { keypoints: null, device: null, inferenceMs: 0, reason: 'The ML Web Worker is unavailable.' };
      },
      undefined,
      undefined,
      [bitmap],
    );
  }

  /** Synthesizes a spoken coaching cue locally with Kokoro-82M; resolves with `samples: null` when unavailable. */
  synthesizeCue(text: string, voice?: string): Promise<SpeechOutput> {
    return this.dispatch<SpeechOutput>({ type: 'tts-speak', text, voice }, () => ({
      samples: null,
      sampleRate: 0,
      reason: 'The ML Web Worker is unavailable.',
    }));
  }

  /** Transcribes a 16 kHz mono utterance locally with Whisper; the buffer is transferred, never uploaded. */
  transcribeAudio(samples: Float32Array, preferredBackend: QwenPreferredBackend = 'AutoWebGpu'): Promise<TranscriptionOutput> {
    return this.dispatch<TranscriptionOutput>(
      { type: 'stt-transcribe', samples, preferredBackend },
      () => ({ text: null, reason: 'The ML Web Worker is unavailable.' }),
      undefined,
      undefined,
      [samples.buffer],
    );
  }

  /** Releases the pose model's memory (e.g. when the camera stops). */
  disposePose(): Promise<void> {
    return this.dispatch<unknown>({ type: 'pose-dispose' }, () => undefined).then(() => undefined);
  }

  stepPose(currentReps: number, targetReps: number, backend: string): Promise<PoseStepOutput> {
    return this.dispatch<PoseStepOutput>(
      { type: 'pose-step', currentReps, targetReps, backend },
      () => ({
        completedReps: Math.min(targetReps, currentReps + 1),
        formScorePercent: 95,
        cue: 'Chest proud, smooth descent — great knee tracking.',
        backend,
      }),
    );
  }

  semanticSearch(
    query: string,
    corpus: readonly { reference: string; text: string; themes: readonly string[] }[],
  ): Promise<readonly WorkerSearchOutput[]> {
    return this.dispatch<{ results: readonly WorkerSearchOutput[] }>(
      { type: 'semantic-search', query, corpus },
      () => {
        const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
        const scored = corpus.map((v) => {
          const hay = `${v.reference} ${v.text} ${v.themes.join(' ')}`.toLowerCase();
          let score = 0;
          for (const t of tokens) {
            if (v.themes.includes(t)) score += 3;
            else if (hay.includes(t)) score += 1.5;
          }
          return { reference: v.reference, text: v.text, score };
        });
        const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
        return { results: matched.length > 0 ? matched.slice(0, 4) : scored.slice(0, 2) };
      },
    ).then((r) => r.results);
  }

  generateCoachReply(
    prompt: string,
    preferredBackend: QwenPreferredBackend = 'AutoWebGpu',
    onChunk?: (chunk: string) => void,
  ): Promise<QwenGenerateOutput> {
    return this.dispatch<QwenGenerateOutput>(
      { type: 'qwen-generate', prompt, preferredBackend, stream: onChunk !== undefined },
      () => ({
        reply: ruleBasedCoachReply(prompt),
        reflection: QWEN_REFLECTION,
        engine: DETERMINISTIC_ENGINE,
        reason: 'The ML Web Worker is unavailable.',
      }),
      undefined,
      onChunk,
    );
  }

  /** Whether Qwen2.5-0.5B-Instruct is really present in this browser's model cache. */
  qwenCacheStatus(): Promise<QwenCacheStatus> {
    return this.dispatch<{ cached: QwenCacheStatus }>({ type: 'qwen-status' }, () => ({ cached: null })).then(
      (r) => r.cached,
    );
  }

  /** Downloads Qwen2.5-0.5B-Instruct from Hugging Face into the local cache; the only networked ML call. */
  downloadQwen(
    preferredBackend: QwenPreferredBackend,
    onProgress: (progress: QwenDownloadProgress) => void,
  ): Promise<QwenOperationOutput> {
    return this.dispatch<QwenOperationOutput>(
      { type: 'qwen-download', preferredBackend },
      () => ({ ok: false, reason: 'The ML Web Worker is unavailable.' }),
      onProgress,
    );
  }

  removeQwen(): Promise<QwenOperationOutput> {
    return this.dispatch<QwenOperationOutput>({ type: 'qwen-remove' }, () => ({
      ok: false,
      reason: 'The ML Web Worker is unavailable.',
    }));
  }

  /** True when a dedicated ML worker can run in this environment. */
  get workerSupported(): boolean {
    return typeof Worker !== 'undefined';
  }

  parseVoiceCommand(transcript: string): Promise<'next-set' | 'pause' | 'resume' | 'finish' | 'none'> {
    return this.dispatch<{ action: 'next-set' | 'pause' | 'resume' | 'finish' | 'none' }>(
      { type: 'whisper-command', transcript },
      () => {
        const t = transcript.toLowerCase();
        if (t.includes('pause')) return { action: 'pause' };
        if (t.includes('resume')) return { action: 'resume' };
        if (t.includes('finish')) return { action: 'finish' };
        if (t.includes('next')) return { action: 'next-set' };
        return { action: 'none' };
      },
    ).then((r) => r.action);
  }

  ngOnDestroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
