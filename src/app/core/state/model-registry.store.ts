import { Injectable, computed, inject, signal } from '@angular/core';
import { MlWorkerClient } from '../ai/ml-worker.client';
import { PreferencesStore } from './preferences.store';
import { SystemStatusStore } from './system-status.store';

export type ModelCacheState = 'not-downloaded' | 'downloading' | 'paused' | 'ready';

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

/** Qwen keeps its own engine-managed cache; every other open model uses the generic worker downloader. */
const QWEN_MODEL_ID = 'qwen';

@Injectable({ providedIn: 'root' })
export class ModelRegistryStore {
  private readonly prefs = inject(PreferencesStore);
  private readonly systemStatus = inject(SystemStatusStore);
  private readonly worker = inject(MlWorkerClient);

  readonly models = signal<readonly OpenModelEntry[]>(INITIAL_MODELS);
  readonly toasts = signal<readonly ModelToast[]>([]);
  /** False until the real cache has been inspected, so AI Lab can show its loading skeleton. */
  readonly loaded = signal<boolean>(false);
  /** Why on-device model storage could not be read (e.g. blocked OPFS in private browsing), else `null`. */
  readonly storageError = signal<string | null>(null);

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
    void this.checkStorage();
    if (typeof window !== 'undefined') {
      // Losing the connection pauses running downloads; finished files stay cached for a later resume.
      window.addEventListener('offline', () => void this.pauseDownloads());
    }
  }

  /** Probes model storage, then reflects which models are really cached; also backs `Retry check`. */
  async checkStorage(): Promise<void> {
    this.loaded.set(false);
    try {
      const probe = await this.worker.probeModelStorage();
      this.storageError.set(probe.ok ? null : (probe.reason ?? 'Storage is blocked in this window.'));
      if (probe.ok) {
        await this.syncCacheState();
      } else {
        // Nothing can be read or written, so no model can honestly be reported as cached.
        this.models.update((list) =>
          list.map((m) => (m.state === 'ready' ? { ...m, state: 'not-downloaded', downloadedMb: 0 } : m)),
        );
        this.syncSystemStatus();
      }
    } finally {
      this.loaded.set(true);
    }
  }

  /** Reflects which models are really cached in this browser, so `Ready` is truthful and survives reloads. */
  private async syncCacheState(): Promise<void> {
    const statuses = await Promise.all(
      this.models().map(async (m) => ({
        id: m.id,
        cached: m.id === QWEN_MODEL_ID ? await this.worker.qwenCacheStatus() : await this.worker.modelCacheStatus(m.id),
      })),
    );
    this.models.update((list) =>
      list.map((m) => {
        const found = statuses.find((s) => s.id === m.id);
        if (!found || found.cached === null || m.state === 'downloading' || m.state === 'paused') return m;
        return { ...m, state: found.cached ? 'ready' : 'not-downloaded', downloadedMb: found.cached ? m.sizeMb : 0 };
      }),
    );
    this.syncSystemStatus();
  }

  /** Pauses every running download (e.g. when the connection drops). */
  async pauseDownloads(): Promise<void> {
    const running = this.models().filter((m) => m.state === 'downloading' && m.id !== QWEN_MODEL_ID);
    await Promise.all(running.map((m) => this.worker.cancelModelDownload(m.id)));
  }

  async downloadModel(id: string): Promise<void> {
    const target = this.models().find((m) => m.id === id);
    if (!target || (target.state !== 'not-downloaded' && target.state !== 'paused')) return;
    const resuming = target.state === 'paused';

    if (this.cachedMb() + target.sizeMb > this.budgetMb()) {
      this.pushToast(
        'warning',
        'Cache budget would be exceeded',
        `Free space or increase your ${this.budgetMb()} MB budget in Settings before downloading ${target.title}.`,
      );
      return;
    }

    const realDownload = this.worker.workerSupported;
    this.models.update((list) =>
      list.map((m) =>
        m.id === id
          ? { ...m, state: 'downloading', downloadedMb: realDownload ? (resuming ? m.downloadedMb : 0) : Math.round(m.sizeMb * 0.44) }
          : m,
      ),
    );
    this.syncPaused();
    this.pushToast(
      'info',
      `${resuming ? 'Resuming' : 'Downloading'} ${target.title}`,
      `Fetching ${target.repoId} into local Cache Storage.`,
    );

    if (realDownload) {
      const onProgress = (progress: { loadedBytes: number; totalBytes: number }): void => {
        // Real bytes drive the bar; the label scales them onto the model's advertised size.
        const fraction = progress.totalBytes > 0 ? progress.loadedBytes / progress.totalBytes : 0;
        const downloadedMb = Math.min(target.sizeMb, Math.round(fraction * target.sizeMb));
        this.models.update((list) =>
          list.map((m) => (m.id === id && m.state === 'downloading' ? { ...m, downloadedMb } : m)),
        );
      };
      const result =
        id === QWEN_MODEL_ID
          ? await this.worker.downloadQwen(this.prefs.preferences().preferredBackend, onProgress)
          : await this.worker.downloadModel(id, onProgress);
      const paused = !result.ok && (('paused' in result && result.paused === true) || (typeof navigator !== 'undefined' && !navigator.onLine));
      if (paused) {
        this.models.update((list) => list.map((m) => (m.id === id ? { ...m, state: 'paused' } : m)));
        this.syncPaused();
        this.pushToast(
          'warning',
          `${target.title} download paused`,
          'The connection was lost. Resume from AI Lab once you are back online; finished files are kept.',
        );
        return;
      }
      if (!result.ok) {
        this.models.update((list) =>
          list.map((m) => (m.id === id ? { ...m, state: 'not-downloaded', downloadedMb: 0 } : m)),
        );
        this.syncPaused();
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
    this.syncPaused();
    this.syncSystemStatus();
    this.pushToast('success', `${target.title} ready on-device`, `${target.sizeMb} MB cached locally.`);
  }

  /** Removes a model's cached files. Resolves with the failure reason (also toasted) so the dialog can stay open. */
  async removeModel(id: string): Promise<{ ok: boolean; reason?: string }> {
    const target = this.models().find((m) => m.id === id);
    if (!target) return { ok: false, reason: 'Unknown model.' };

    if (this.worker.workerSupported) {
      const result = id === QWEN_MODEL_ID ? await this.worker.removeQwen() : await this.worker.removeModelFiles(id);
      if (!result.ok) {
        this.pushToast(
          'danger',
          `Could not remove ${target.title}`,
          `${target.repoId} is still cached on this device. Try again.`,
        );
        return { ok: false, reason: result.reason ?? `${target.repoId} is still cached on this device.` };
      }
    } else {
      await new Promise((r) => setTimeout(r, 150));
    }

    this.models.update((list) =>
      list.map((m) => (m.id === id ? { ...m, state: 'not-downloaded', downloadedMb: 0 } : m)),
    );
    this.syncSystemStatus();
    this.pushToast('success', `Removed ${target.title}`, `${target.sizeMb} MB freed from your local cache.`);
    return { ok: true };
  }

  dismissToast(id: string): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private pushToast(severity: ModelToast['severity'], title: string, message: string): void {
    const toast: ModelToast = { id: `mt-${Date.now()}-${Math.random()}`, severity, title, message };
    this.toasts.update((list) => [...list.slice(-2), toast]);
  }

  private syncPaused(): void {
    this.systemStatus.pausedDownloadCount.set(this.models().filter((m) => m.state === 'paused').length);
  }

  private syncSystemStatus(): void {
    const ready = this.models().filter((m) => m.state === 'ready');
    this.systemStatus.cachedModelCount.set(ready.length);
    this.systemStatus.cachedModelMb.set(this.cachedMb());
  }
}
