/// <reference lib="webworker" />

import {
  QWEN_REFLECTION,
  QwenDevice,
  QwenLibrary,
  QwenPreferredBackend,
  createQwenEngine,
} from './qwen-engine';

interface WebGpuLike {
  requestAdapter(): Promise<{ readonly features: { has(feature: string): boolean } } | null>;
}

export type WorkerRequest =
  | { id: string; type: 'pose-step'; currentReps: number; targetReps: number; backend: string }
  | { id: string; type: 'semantic-search'; query: string; corpus: readonly { reference: string; text: string; themes: readonly string[] }[] }
  | { id: string; type: 'qwen-generate'; prompt: string; preferredBackend?: QwenPreferredBackend }
  | { id: string; type: 'qwen-status' }
  | { id: string; type: 'qwen-download'; preferredBackend?: QwenPreferredBackend }
  | { id: string; type: 'qwen-remove' }
  | { id: string; type: 'whisper-command'; transcript: string };

export type WorkerResponse =
  | { id: string; type: 'pose-step'; completedReps: number; formScorePercent: number; cue: string; backend: string }
  | { id: string; type: 'semantic-search'; results: readonly { reference: string; text: string; score: number }[] }
  | {
      id: string;
      type: 'qwen-generate';
      reply: string;
      reflection: string;
      engine: string;
      device: QwenDevice | null;
      reason?: string;
    }
  | { id: string; type: 'qwen-status'; cached: boolean }
  | { id: string; type: 'qwen-progress'; loadedBytes: number; totalBytes: number }
  | { id: string; type: 'qwen-download'; ok: boolean; device?: QwenDevice; reason?: string }
  | { id: string; type: 'qwen-remove'; ok: boolean; reason?: string }
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

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  switch (data.type) {
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
      const tokens = data.query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1);

      const scored = data.corpus.map((v) => {
        const hay = `${v.reference} ${v.text} ${v.themes.join(' ')}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (v.themes.includes(t)) score += 3;
          else if (hay.includes(t)) score += 1.5;
        }
        return { reference: v.reference, text: v.text, score };
      });

      const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
      const res: WorkerResponse = {
        id: data.id,
        type: 'semantic-search',
        results: matched.length > 0 ? matched.slice(0, 4) : scored.slice(0, 2),
      };
      postMessage(res);
      break;
    }

    case 'qwen-generate': {
      void qwen.generate(data.prompt, data.preferredBackend ?? 'AutoWebGpu').then((result) => {
        if (result.reason) {
          // Diagnostic only: explains why on-device Qwen was not used. Never includes the prompt.
          console.info(`[Haloop] Qwen2.5-0.5B-Instruct unavailable, using deterministic reply: ${result.reason}`);
        }
        const res: WorkerResponse = { id: data.id, type: 'qwen-generate', reflection: QWEN_REFLECTION, ...result };
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
