import { Injectable, computed, inject, signal } from '@angular/core';
import { MlWorkerClient } from '../ai/ml-worker.client';
import { PreferencesStore } from './preferences.store';
import { SystemStatusStore } from './system-status.store';

export type ModelCacheState = 'not-downloaded' | 'downloading' | 'ready';

export interface OpenModelEntry {
  readonly id: string;
  readonly title: string;
  readonly repoId: string;
  readonly taskLabel: string;
  readonly sizeMb: number;
  readonly downloadedMb: number;
  readonly state: ModelCacheState;
}

export interface ModelToast {
  readonly id: string;
  readonly severity: 'info' | 'success' | 'warning' | 'danger';
  readonly title: string;
  readonly message: string;
}

const INITIAL_MODELS: readonly OpenModelEntry[] = [
  {
    id: 'vitpose',
    title: 'Rep counting & form',
    repoId: 'onnx-community/vitpose-base-simple',
    taskLabel: 'Pose estimation · camera',
    sizeMb: 94,
    downloadedMb: 94,
    state: 'ready',
  },
  {
    id: 'whisper',
    title: 'Voice commands',
    repoId: 'onnx-community/whisper-base',
    taskLabel: 'Speech to text',
    sizeMb: 77,
    downloadedMb: 77,
    state: 'ready',
  },
  {
    id: 'kokoro',
    title: 'Coach voice',
    repoId: 'onnx-community/Kokoro-82M-ONNX',
    taskLabel: 'Text to speech',
    sizeMb: 92,
    downloadedMb: 92,
    state: 'ready',
  },
  {
    id: 'minilm',
    title: 'Verse search',
    repoId: 'Xenova/all-MiniLM-L6-v2',
    taskLabel: 'Embeddings · KJV index',
    sizeMb: 23,
    downloadedMb: 23,
    state: 'ready',
  },
  {
    id: 'qwen',
    title: 'Coach fallback',
    repoId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    taskLabel: 'Text generation, when Nano is off',
    sizeMb: 480,
    downloadedMb: 0,
    state: 'not-downloaded',
  },
];

/** The only open model whose download, cache state, and removal are backed by the real model cache so far. */
const QWEN_MODEL_ID = 'qwen';

@Injectable({ providedIn: 'root' })
export class ModelRegistryStore {
  private readonly prefs = inject(PreferencesStore);
  private readonly systemStatus = inject(SystemStatusStore);
  private readonly worker = inject(MlWorkerClient);

  readonly models = signal<readonly OpenModelEntry[]>(INITIAL_MODELS);
  readonly toasts = signal<readonly ModelToast[]>([]);

  readonly cachedMb = computed(() =>
    this.models()
      .filter((m) => m.state === 'ready')
      .reduce((sum, m) => sum + m.sizeMb, 0),
  );

  readonly budgetMb = computed(() => this.prefs.preferences().cacheBudgetMb);

  readonly budgetPercent = computed(() =>
    Math.min(100, Number(((this.cachedMb() / Math.max(512, this.budgetMb())) * 100).toFixed(1))),
  );

  constructor() {
    void this.syncQwenCacheState();
  }

  /** Reflects whether Qwen2.5-0.5B-Instruct is really cached in this browser, so `Ready` survives reloads. */
  private async syncQwenCacheState(): Promise<void> {
    const cached = await this.worker.qwenCacheStatus();
    if (cached === null) return;
    this.models.update((list) =>
      list.map((m) =>
        m.id === QWEN_MODEL_ID && m.state !== 'downloading'
          ? { ...m, state: cached ? 'ready' : 'not-downloaded', downloadedMb: cached ? m.sizeMb : 0 }
          : m,
      ),
    );
    this.syncSystemStatus();
  }

  async downloadModel(id: string): Promise<void> {
    const target = this.models().find((m) => m.id === id);
    if (!target || target.state !== 'not-downloaded') return;

    if (this.cachedMb() + target.sizeMb > this.budgetMb()) {
      this.pushToast(
        'warning',
        'Cache budget would be exceeded',
        `Free space or increase your ${this.budgetMb()} MB budget in Settings before downloading ${target.title}.`,
      );
      return;
    }

    const realDownload = id === QWEN_MODEL_ID && this.worker.workerSupported;
    this.models.update((list) =>
      list.map((m) =>
        m.id === id
          ? { ...m, state: 'downloading', downloadedMb: realDownload ? 0 : Math.round(m.sizeMb * 0.44) }
          : m,
      ),
    );
    this.pushToast('info', `Downloading ${target.title}`, `Fetching ${target.repoId} into local Cache Storage.`);

    if (realDownload) {
      const result = await this.worker.downloadQwen(this.prefs.preferences().preferredBackend, (progress) => {
        const downloadedMb = Math.min(target.sizeMb, Math.round(progress.loadedBytes / 1_000_000));
        this.models.update((list) =>
          list.map((m) => (m.id === id && m.state === 'downloading' ? { ...m, downloadedMb } : m)),
        );
      });
      if (!result.ok) {
        this.models.update((list) =>
          list.map((m) => (m.id === id ? { ...m, state: 'not-downloaded', downloadedMb: 0 } : m)),
        );
        this.pushToast(
          'danger',
          `${target.title} download failed`,
          `Could not cache ${target.repoId}. Check your connection and free storage, then try again.`,
        );
        return;
      }
    } else {
      await new Promise((r) => setTimeout(r, 300));
    }

    this.models.update((list) =>
      list.map((m) => (m.id === id ? { ...m, state: 'ready', downloadedMb: m.sizeMb } : m)),
    );
    this.syncSystemStatus();
    this.pushToast('success', `${target.title} ready on-device`, `${target.sizeMb} MB cached locally.`);
  }

  async removeModel(id: string): Promise<void> {
    const target = this.models().find((m) => m.id === id);
    if (!target) return;

    if (id === QWEN_MODEL_ID && this.worker.workerSupported) {
      const result = await this.worker.removeQwen();
      if (!result.ok) {
        this.pushToast(
          'danger',
          `Could not remove ${target.title}`,
          `${target.repoId} is still cached on this device. Try again.`,
        );
        return;
      }
    } else {
      await new Promise((r) => setTimeout(r, 150));
    }

    this.models.update((list) =>
      list.map((m) => (m.id === id ? { ...m, state: 'not-downloaded', downloadedMb: 0 } : m)),
    );
    this.syncSystemStatus();
    this.pushToast('success', `Removed ${target.title}`, `${target.sizeMb} MB freed from your local cache.`);
  }

  dismissToast(id: string): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private pushToast(severity: ModelToast['severity'], title: string, message: string): void {
    const toast: ModelToast = { id: `mt-${Date.now()}-${Math.random()}`, severity, title, message };
    this.toasts.update((list) => [...list.slice(-2), toast]);
  }

  private syncSystemStatus(): void {
    const ready = this.models().filter((m) => m.state === 'ready');
    this.systemStatus.cachedModelCount.set(ready.length);
    this.systemStatus.cachedModelMb.set(this.cachedMb());
  }
}
