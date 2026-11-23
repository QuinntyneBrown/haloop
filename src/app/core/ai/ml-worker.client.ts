import { Injectable, OnDestroy } from '@angular/core';

export interface PoseStepOutput {
  readonly completedReps: number;
  readonly formScorePercent: number;
  readonly cue: string;
  readonly backend: string;
}

export interface WorkerSearchOutput {
  readonly reference: string;
  readonly text: string;
  readonly score: number;
}

export interface QwenGenerateOutput {
  readonly reply: string;
  readonly reflection: string;
  readonly engine: string;
}

/**
 * Typed client dispatching ML workloads (VitPose, Whisper, MiniLM, Qwen)
 * to a dedicated Web Worker so main-thread UI latency stays <= 100 ms (L2-030).
 */
@Injectable({ providedIn: 'root' })
export class MlWorkerClient implements OnDestroy {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, (value: unknown) => void>();
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
      this.worker.onmessage = ({ data }: MessageEvent<{ id: string }>) => {
        const resolver = this.pending.get(data.id);
        if (resolver) {
          this.pending.delete(data.id);
          resolver(data);
        }
      };
      return this.worker;
    } catch {
      return null;
    }
  }

  private dispatch<T>(payload: Record<string, unknown>, fallback: () => T): Promise<T> {
    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.resolve(fallback());
    }
    const id = `w-${++this.seq}`;
    return new Promise<T>((resolve) => {
      this.pending.set(id, (res) => resolve(res as T));
      worker.postMessage({ ...payload, id });
    });
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

  generateCoachReply(prompt: string): Promise<QwenGenerateOutput> {
    return this.dispatch<QwenGenerateOutput>(
      { type: 'qwen-generate', prompt },
      () => ({
        reply:
          'Breathe in for four counts, hold two, and exhale six before your plank holds. Keep shoulders stacked over elbows and let your pace stay unhurried.',
        reflection: 'Hebrews 12:1 — run with patience the race set before you.',
        engine: 'Deterministic fallback',
      }),
    );
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
