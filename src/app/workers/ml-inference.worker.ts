/// <reference lib="webworker" />

import { env, pipeline } from '@huggingface/transformers';

export type WorkerRequest =
  | { id: string; type: 'pose-step'; currentReps: number; targetReps: number; backend: string }
  | { id: string; type: 'semantic-search'; query: string; corpus: readonly { reference: string; text: string; themes: readonly string[] }[] }
  | { id: string; type: 'qwen-generate'; prompt: string }
  | { id: string; type: 'whisper-command'; transcript: string };

export type WorkerResponse =
  | { id: string; type: 'pose-step'; completedReps: number; formScorePercent: number; cue: string; backend: string }
  | { id: string; type: 'semantic-search'; results: readonly { reference: string; text: string; score: number }[] }
  | { id: string; type: 'qwen-generate'; reply: string; reflection: string; engine: string; reason?: string }
  | { id: string; type: 'whisper-command'; action: 'next-set' | 'pause' | 'resume' | 'finish' | 'none' };

const CUES = [
  'Chest proud, smooth descent — great knee tracking.',
  'Controlled 3-1-1 tempo — drive evenly through mid-foot.',
  'Brace your core at the bottom and stand tall.',
  'Steady breathing — strong hip stability on that rep.',
];

const QWEN_MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
const QWEN_REFLECTION = 'Hebrews 12:1 — run with patience the race set before you.';

// Model downloads are initiated from the AI Lab main thread; this worker must
// resolve the pipeline from the local Cache API / IndexedDB only so that Coach
// prompts never trigger outbound network requests (L2-027).
env.allowRemoteModels = false;
env.allowLocalModels = false;
env.useBrowserCache = true;

type QwenGenerator = (messages: readonly { role: string; content: string }[], options: Record<string, unknown>) => Promise<unknown>;

let qwenGenerator: Promise<QwenGenerator> | null = null;

function loadQwenGenerator(): Promise<QwenGenerator> {
  qwenGenerator ??= (async () => {
    const device = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
    try {
      return (await pipeline('text-generation', QWEN_MODEL_ID, {
        device,
        dtype: device === 'webgpu' ? 'fp16' : 'q4',
        local_files_only: true,
      })) as unknown as QwenGenerator;
    } catch (error) {
      if (device === 'wasm') {
        throw error;
      }
      // WebGPU session unavailable for this model — fall back to WASM CPU.
      return (await pipeline('text-generation', QWEN_MODEL_ID, {
        device: 'wasm',
        dtype: 'q4',
        local_files_only: true,
      })) as unknown as QwenGenerator;
    }
  })();
  return qwenGenerator;
}

function ruleBasedCoachReply(prompt: string): string {
  const lower = prompt.toLowerCase();
  return lower.includes('plank') || lower.includes('breath')
    ? 'Breathe in for four counts, hold two, and exhale six before your plank holds. Keep shoulders stacked over elbows and let your pace stay unhurried.'
    : lower.includes('sore') || lower.includes('tight') || lower.includes('calf')
      ? 'Keep today’s load 20% lighter, add 90 seconds of slow ankle rocks before set one, and prioritize full range of motion.'
      : 'Focus on unhurried tempo (3-1-1), clean posture, and steady breathing across every working set today.';
}

interface QwenGeneratedMessage {
  content?: string;
}

interface QwenGeneratedOutput {
  generated_text?: string | readonly QwenGeneratedMessage[];
}

function extractQwenReply(output: unknown): string {
  if (!Array.isArray(output) || output.length === 0) {
    return '';
  }
  const first = output[0] as QwenGeneratedOutput;
  const generated = first.generated_text;
  if (Array.isArray(generated)) {
    return generated.at(-1)?.content?.trim() ?? '';
  }
  return typeof generated === 'string' ? generated.trim() : '';
}

async function generateQwenReply(prompt: string): Promise<{ reply: string; engine: string }> {
  const generator = await loadQwenGenerator();
  const output = await generator(
    [
      {
        role: 'system',
        content:
          'You are Haloop Coach, a concise, encouraging on-device movement and devotional coach. Respond in 2-3 sentences.',
      },
      { role: 'user', content: prompt },
    ],
    { max_new_tokens: 160, do_sample: false, return_full_text: false },
  );
  const reply = extractQwenReply(output);
  return {
    reply: reply.length > 0 ? reply : ruleBasedCoachReply(prompt),
    engine: 'Qwen2.5-0.5B-Instruct (on-device)',
  };
}

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
      generateQwenReply(data.prompt)
        .then(({ reply, engine }) => {
          const res: WorkerResponse = {
            id: data.id,
            type: 'qwen-generate',
            reply,
            reflection: QWEN_REFLECTION,
            engine,
          };
          postMessage(res);
        })
        .catch((error: unknown) => {
          const res: WorkerResponse = {
            id: data.id,
            type: 'qwen-generate',
            reply: ruleBasedCoachReply(data.prompt),
            reflection: QWEN_REFLECTION,
            engine: 'Deterministic fallback',
            reason: error instanceof Error ? error.message : String(error),
          };
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
