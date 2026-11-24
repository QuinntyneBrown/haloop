/// <reference lib="webworker" />

import {
  QWEN_REFLECTION,
  QwenDevice,
  QwenLibrary,
  QwenPreferredBackend,
  createQwenEngine,
} from './qwen-engine';
import { KokoroLibrary, createTtsEngine } from './tts-engine';
import { createModelDownloader } from './model-downloader';
import { EmbedDevice, EmbedLibrary, EmbedPreferredBackend, VectorIndex, createEmbedEngine } from './embed-engine';
import { SttDevice, SttLibrary, SttPreferredBackend, createSttEngine } from './stt-engine';
import { PoseKeypoint, VitPoseDevice, VitPoseLibrary, VitPosePreferredBackend, createVitPoseEngine } from './vitpose-engine';

interface WebGpuLike {
  requestAdapter(): Promise<{ readonly features: { has(feature: string): boolean } } | null>;
}

export type WorkerRequest =
  | { id: string; type: 'pose-step'; currentReps: number; targetReps: number; backend: string }
  | {
      id: string;
      type: 'semantic-search';
      query: string;
      corpus: readonly { reference: string; text: string; themes: readonly string[] }[];
      preferredBackend?: EmbedPreferredBackend;
    }
  | { id: string; type: 'pose-frame'; bitmap: ImageBitmap; preferredBackend?: VitPosePreferredBackend }
  | { id: string; type: 'pose-dispose' }
  | { id: string; type: 'ping' }
  | { id: string; type: 'tts-speak'; text: string; voice?: string }
  | { id: string; type: 'stt-transcribe'; samples: Float32Array; preferredBackend?: SttPreferredBackend }
  | { id: string; type: 'qwen-generate'; prompt: string; preferredBackend?: QwenPreferredBackend; stream?: boolean }
  | { id: string; type: 'qwen-status' }
  | { id: string; type: 'qwen-download'; preferredBackend?: QwenPreferredBackend }
  | { id: string; type: 'qwen-remove' }
  | { id: string; type: 'model-status'; modelId: string }
  | { id: string; type: 'model-download'; modelId: string }
  | { id: string; type: 'model-cancel'; modelId: string }
  | { id: string; type: 'model-remove'; modelId: string }
  | { id: string; type: 'whisper-command'; transcript: string };

export type WorkerResponse =
  | { id: string; type: 'pose-step'; completedReps: number; formScorePercent: number; cue: string; backend: string }
  | {
      id: string;
      type: 'pose-frame';
      keypoints: readonly PoseKeypoint[] | null;
      device: VitPoseDevice | null;
      inferenceMs: number;
      reason?: string;
    }
  | { id: string; type: 'pose-dispose' }
  | { id: string; type: 'ping'; ok: true }
  | { id: string; type: 'tts-speak'; samples: Float32Array | null; sampleRate: number; reason?: string }
  | { id: string; type: 'stt-transcribe'; text: string | null; device: SttDevice | null; reason?: string }
  | {
      id: string;
      type: 'semantic-search';
      results: readonly { reference: string; text: string; score: number }[];
      /** `semantic` = MiniLM cosine ranking; `lexical` = keyword fallback while the model is unavailable. */
      method: 'semantic' | 'lexical';
      device: EmbedDevice | null;
      reason?: string;
    }
  | {
      id: string;
      type: 'qwen-generate';
      reply: string;
      reflection: string;
      engine: string;
      device: QwenDevice | null;
      reason?: string;
      restart?: true;
    }
  | { id: string; type: 'qwen-chunk'; chunk: string }
  | { id: string; type: 'qwen-status'; cached: boolean }
  | { id: string; type: 'qwen-progress'; loadedBytes: number; totalBytes: number }
  | { id: string; type: 'qwen-download'; ok: boolean; device?: QwenDevice; reason?: string; restart?: true }
  | { id: string; type: 'qwen-remove'; ok: boolean; reason?: string }
  | { id: string; type: 'model-status'; cached: boolean }
  | { id: string; type: 'model-download'; ok: boolean; paused?: boolean; reason?: string }
  | { id: string; type: 'model-cancel' }
  | { id: string; type: 'model-remove'; ok: boolean; reason?: string }
  | { id: string; type: 'whisper-command'; action: 'next-set' | 'pause' | 'resume' | 'finish' | 'none' };

const CUES = [
  'Chest proud, smooth descent — great knee tracking.',
  'Controlled 3-1-1 tempo — drive evenly through mid-foot.',
  'Brace your core at the bottom and stand tall.',
  'Steady breathing — strong hip stability on that rep.',
];

/** Small local-only marker store for ML runtime facts about this device (no user data). */
const ML_STATE_CACHE = 'haloop-ml-state';
const WEBGPU_REJECTED_KEY = '/haloop-ml-state/qwen-webgpu-rejected';

const qwen = createQwenEngine({
  // Imported on the first Qwen message only, so pose, search, and voice stay light.
  loadLibrary: async () => (await import('@huggingface/transformers')) as unknown as QwenLibrary,
  detectWebGpu: async () => {
    const gpu = (navigator as unknown as { gpu?: WebGpuLike }).gpu;
    const adapter = await gpu?.requestAdapter();
    return adapter?.features.has('shader-f16') ?? false;
  },
  baseUrl: self.location.href,
  webGpuVerdict: {
    isRejected: async () => Boolean(await (await caches.open(ML_STATE_CACHE)).match(WEBGPU_REJECTED_KEY)),
    setRejected: async (rejected) => {
      const cache = await caches.open(ML_STATE_CACHE);
      await (rejected ? cache.put(WEBGPU_REJECTED_KEY, new Response('1')) : cache.delete(WEBGPU_REJECTED_KEY));
    },
  },
});

const modelDownloader = createModelDownloader({
  fetchImpl: (url, init) => fetch(url, init),
  openCache: (name) => caches.open(name),
});

const vitpose = createVitPoseEngine({
  loadLibrary: async () => (await import('@huggingface/transformers')) as unknown as VitPoseLibrary,
  detectWebGpu: async () => {
    const gpu = (navigator as unknown as { gpu?: WebGpuLike }).gpu;
    return (await gpu?.requestAdapter()) != null;
  },
  isCached: () => modelDownloader.status('vitpose'),
});

const tts = createTtsEngine({
  loadLibrary: async () => (await import('kokoro-js')) as unknown as KokoroLibrary,
  // Transformers.js stores downloaded weights in this Cache Storage bucket.
  isCached: async () => {
    const cache = await caches.open('transformers-cache');
    return (await cache.keys()).some((request) => request.url.includes('Kokoro-82M'));
  },
});

const stt = createSttEngine({
  loadLibrary: async () => (await import('@huggingface/transformers')) as unknown as SttLibrary,
  detectWebGpu: async () => {
    const gpu = (navigator as unknown as { gpu?: WebGpuLike }).gpu;
    return (await gpu?.requestAdapter()) != null;
  },
  // Transformers.js stores downloaded weights in this Cache Storage bucket.
  isCached: async () => {
    const cache = await caches.open('transformers-cache');
    return (await cache.keys()).some((request) => request.url.includes('whisper-base'));
  },
});

const INDEX_CACHE_PREFIX = '/haloop-ml-state/kjv-index/';

const embed = createEmbedEngine({
  loadLibrary: async () => (await import('@huggingface/transformers')) as unknown as EmbedLibrary,
  detectWebGpu: async () => {
    const gpu = (navigator as unknown as { gpu?: WebGpuLike }).gpu;
    return (await gpu?.requestAdapter()) != null;
  },
  isCached: async () => {
    const cache = await caches.open('transformers-cache');
    return (await cache.keys()).some((request) => request.url.includes('all-MiniLM-L6-v2'));
  },
  // The precomputed verse vectors live next to the model so later sessions only embed the query.
  indexStore: {
    load: async (fingerprint): Promise<VectorIndex | null> => {
      const cache = await caches.open(ML_STATE_CACHE);
      const [vectors, meta] = await Promise.all([
        cache.match(`${INDEX_CACHE_PREFIX}${fingerprint}.bin`),
        cache.match(`${INDEX_CACHE_PREFIX}${fingerprint}.json`),
      ]);
      if (!vectors || !meta) return null;
      const { dimension, references } = (await meta.json()) as { dimension: number; references: string[] };
      return { fingerprint, dimension, references, vectors: new Float32Array(await vectors.arrayBuffer()) };
    },
    save: async (index): Promise<void> => {
      const cache = await caches.open(ML_STATE_CACHE);
      await cache.put(`${INDEX_CACHE_PREFIX}${index.fingerprint}.bin`, new Response(index.vectors.slice().buffer));
      await cache.put(
        `${INDEX_CACHE_PREFIX}${index.fingerprint}.json`,
        new Response(JSON.stringify({ dimension: index.dimension, references: index.references })),
      );
    },
  },
});

function lexicalSearch(
  query: string,
  corpus: readonly { reference: string; text: string; themes: readonly string[] }[],
): { reference: string; text: string; score: number }[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
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
  return matched.length > 0 ? matched.slice(0, 4) : scored.slice(0, 2);
}

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  switch (data.type) {
    case 'stt-transcribe': {
      void stt.transcribe(data.samples, data.preferredBackend ?? 'AutoWebGpu').then((result) => {
        const res: WorkerResponse = { id: data.id, type: 'stt-transcribe', ...result };
        postMessage(res);
      });
      break;
    }

    case 'tts-speak': {
      void tts.synthesize(data.text, data.voice).then((result) => {
        const res: WorkerResponse = { id: data.id, type: 'tts-speak', ...result };
        // Transfer the PCM buffer instead of copying it.
        postMessage(res, result.samples ? [result.samples.buffer] : []);
      });
      break;
    }

    case 'pose-frame': {
      const { bitmap } = data;
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        bitmap.close();
        const res: WorkerResponse = { id: data.id, type: 'pose-frame', keypoints: null, device: null, inferenceMs: 0, reason: 'No 2D canvas context in the worker.' };
        postMessage(res);
        break;
      }
      ctx.drawImage(bitmap, 0, 0);
      const { width, height } = bitmap;
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, width, height).data;
      void vitpose.detect({ data: pixels, width, height }, data.preferredBackend ?? 'AutoWebGpu').then((result) => {
        const res: WorkerResponse = { id: data.id, type: 'pose-frame', ...result };
        postMessage(res);
      });
      break;
    }

    case 'ping': {
      const res: WorkerResponse = { id: data.id, type: 'ping', ok: true };
      postMessage(res);
      break;
    }

    case 'pose-dispose': {
      void vitpose.dispose().then(() => {
        const res: WorkerResponse = { id: data.id, type: 'pose-dispose' };
        postMessage(res);
      });
      break;
    }

    case 'pose-step': {
      const nextReps = Math.min(data.targetReps, data.currentReps + 1);
      const score = Math.min(99, Math.max(88, 93 + (nextReps % 6)));
      const cue = CUES[nextReps % CUES.length];
      const res: WorkerResponse = {
        id: data.id,
        type: 'pose-step',
        completedReps: nextReps,
        formScorePercent: score,
        cue,
        backend: data.backend,
      };
      postMessage(res);
      break;
    }

    case 'semantic-search': {
      void embed.search(data.query, data.corpus, data.preferredBackend ?? 'AutoWebGpu').then((found) => {
        const res: WorkerResponse = found.results
          ? { id: data.id, type: 'semantic-search', results: found.results, method: 'semantic', device: found.device }
          : {
              id: data.id,
              type: 'semantic-search',
              results: lexicalSearch(data.query, data.corpus),
              method: 'lexical',
              device: null,
              reason: found.reason,
            };
        postMessage(res);
      });
      break;
    }

    case 'qwen-generate': {
      const onChunk = data.stream
        ? (chunk: string): void => {
            const event: WorkerResponse = { id: data.id, type: 'qwen-chunk', chunk };
            postMessage(event);
          }
        : undefined;
      void qwen.generate(data.prompt, data.preferredBackend ?? 'AutoWebGpu', onChunk).then((result) => {
        if (result.reason) {
          // Diagnostic only: explains why on-device Qwen was not used. Never includes the prompt.
          console.info(`[Haloop] Qwen2.5-0.5B-Instruct unavailable, using deterministic reply: ${result.reason}`);
        }
        const res: WorkerResponse = { id: data.id, type: 'qwen-generate', reflection: QWEN_REFLECTION, ...result };
        postMessage(res);
      });
      break;
    }

    case 'model-status': {
      void modelDownloader.status(data.modelId).then((cached) => {
        const res: WorkerResponse = { id: data.id, type: 'model-status', cached };
        postMessage(res);
      });
      break;
    }

    case 'model-download': {
      void modelDownloader
        .download(data.modelId, (progress) => {
          const event: WorkerResponse = { id: data.id, type: 'qwen-progress', ...progress };
          postMessage(event);
        })
        .then((result) => {
          const res: WorkerResponse = { id: data.id, type: 'model-download', ...result };
          postMessage(res);
        });
      break;
    }

    case 'model-cancel': {
      modelDownloader.cancel(data.modelId);
      const res: WorkerResponse = { id: data.id, type: 'model-cancel' };
      postMessage(res);
      break;
    }

    case 'model-remove': {
      void modelDownloader.remove(data.modelId).then((result) => {
        const res: WorkerResponse = { id: data.id, type: 'model-remove', ...result };
        postMessage(res);
      });
      break;
    }

    case 'qwen-status': {
      void qwen.status().then((cached) => {
        const res: WorkerResponse = { id: data.id, type: 'qwen-status', cached };
        postMessage(res);
      });
      break;
    }

    case 'qwen-download': {
      void qwen
        .download(data.preferredBackend ?? 'AutoWebGpu', (progress) => {
          const event: WorkerResponse = { id: data.id, type: 'qwen-progress', ...progress };
          postMessage(event);
        })
        .then((result) => {
          if (!result.ok) {
            // Diagnostic only: explains why the model could not be cached on this device.
            console.info(`[Haloop] Qwen2.5-0.5B-Instruct download failed: ${result.reason ?? 'unknown reason'}`);
          }
          const res: WorkerResponse = { id: data.id, type: 'qwen-download', ...result };
          postMessage(res);
        });
      break;
    }

    case 'qwen-remove': {
      void qwen.remove().then((result) => {
        const res: WorkerResponse = { id: data.id, type: 'qwen-remove', ...result };
        postMessage(res);
      });
      break;
    }

    case 'whisper-command': {
      const t = data.transcript.toLowerCase().trim();
      const action = t.includes('pause')
        ? 'pause'
        : t.includes('resume') || t.includes('continue')
          ? 'resume'
          : t.includes('finish') || t.includes('done')
            ? 'finish'
            : t.includes('next')
              ? 'next-set'
              : 'none';
      const res: WorkerResponse = {
        id: data.id,
        type: 'whisper-command',
        action,
      };
      postMessage(res);
      break;
    }
  }
});
