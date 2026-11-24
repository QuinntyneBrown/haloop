// Acceptance Test
// Traces to: L2-005, L2-022, L2-027, L2-030, L2-031
// Description: Verify AI Lab downloads core models through the worker with live byte progress, blocks downloads that
// exceed the cache budget, pauses when the connection drops and resumes later, surfaces the Back online banner, and
// removes real cached files while keeping the budget bar accurate.

import { TestBed } from '@angular/core/testing';
import { MlWorkerClient } from '../ai/ml-worker.client';
import { ModelRegistryStore } from './model-registry.store';
import { PreferencesStore } from './preferences.store';
import { SystemStatusStore } from './system-status.store';

type Progress = (p: { loadedBytes: number; totalBytes: number }) => void;

function configure(worker: Partial<MlWorkerClient>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MlWorkerClient,
        useValue: {
          workerSupported: true,
          qwenCacheStatus: async () => false,
          modelCacheStatus: async () => false,
          cancelModelDownload: async () => undefined,
          ...worker,
        },
      },
    ],
  });
  const store = TestBed.inject(ModelRegistryStore);
  const model = (id: string) => store.models().find((m) => m.id === id)!;
  return { store, model, status: TestBed.inject(SystemStatusStore), prefs: TestBed.inject(PreferencesStore) };
}

describe('Model downloads', () => {
  beforeEach(() => localStorage.clear());

  it('reflects the real cache: nothing cached means nothing is reported Ready (L2-022)', async () => {
    const { store, model } = configure({});
    await vi.waitFor(() => expect(model('whisper').state).toBe('not-downloaded'));
    expect(store.cachedMb()).toBe(0);
    expect(model('whisper').downloadedMb).toBe(0);
  });

  it('marks models Ready that the worker finds fully cached (L2-022)', async () => {
    const { store, model, status } = configure({ modelCacheStatus: async (id: string) => id === 'minilm' });
    await vi.waitFor(() => expect(model('vitpose').state).toBe('not-downloaded'));
    expect(model('minilm').state).toBe('ready');
    expect(store.cachedMb()).toBe(23);
    expect(status.cachedModelCount()).toBe(1);
  });

  it('downloads a core model in the worker, scales live byte progress, and marks it Ready (L2-022)', async () => {
    let finish: (r: { ok: boolean }) => void = () => undefined;
    let report: Progress = () => undefined;
    const { store, model } = configure({
      downloadModel: (id: string, onProgress: Progress) => {
        expect(id).toBe('whisper');
        report = onProgress;
        return new Promise((resolve) => (finish = resolve));
      },
    });
    await vi.waitFor(() => expect(model('whisper').state).toBe('not-downloaded'));

    const download = store.downloadModel('whisper');
    expect(model('whisper').state).toBe('downloading');
    report({ loadedBytes: 0, totalBytes: 80_000_000 });
    expect(model('whisper').downloadedMb).toBe(0);
    report({ loadedBytes: 40_000_000, totalBytes: 80_000_000 });
    expect(model('whisper').downloadedMb).toBe(39);
    report({ loadedBytes: 80_000_000, totalBytes: 80_000_000 });
    expect(model('whisper').downloadedMb).toBe(77);

    finish({ ok: true });
    await download;
    expect(model('whisper').state).toBe('ready');
    expect(store.cachedMb()).toBe(77);
    expect(store.toasts().at(-1)?.severity).toBe('success');
  });

  it('blocks a download that would exceed the cache budget with a warning toast (L2-022)', async () => {
    const downloadModel = vi.fn();
    const { store, model, prefs } = configure({ downloadModel });
    prefs.preferences.update((p) => ({ ...p, cacheBudgetMb: 50 }));
    await vi.waitFor(() => expect(model('whisper').state).toBe('not-downloaded'));

    await store.downloadModel('whisper');

    expect(downloadModel).not.toHaveBeenCalled();
    expect(model('whisper').state).toBe('not-downloaded');
    expect(store.toasts().at(-1)).toMatchObject({ severity: 'warning', title: 'Cache budget would be exceeded' });
    expect(store.toasts().at(-1)?.message).toContain('Settings');
  });

  it('pauses when the connection is lost, then resumes and completes (L2-005)', async () => {
    let attempt = 0;
    const { store, model, status } = configure({
      downloadModel: async (_id: string, onProgress: Progress) => {
        attempt += 1;
        if (attempt === 1) {
          onProgress({ loadedBytes: 30_000_000, totalBytes: 80_000_000 });
          return { ok: false, paused: true, reason: 'The connection was lost.' };
        }
        onProgress({ loadedBytes: 80_000_000, totalBytes: 80_000_000 });
        return { ok: true };
      },
    });
    await vi.waitFor(() => expect(model('whisper').state).toBe('not-downloaded'));

    await store.downloadModel('whisper');

    expect(model('whisper')).toMatchObject({ state: 'paused', downloadedMb: 29 });
    expect(status.pausedDownloadCount()).toBe(1);
    expect(store.toasts().at(-1)?.severity).toBe('warning');
    expect(store.cachedMb()).toBe(0);

    await store.downloadModel('whisper');

    expect(model('whisper').state).toBe('ready');
    expect(status.pausedDownloadCount()).toBe(0);
  });

  it('keeps already-downloaded progress visible while a paused model resumes (L2-005)', async () => {
    let first = true;
    const { store, model } = configure({
      downloadModel: async (_id: string, onProgress: Progress) => {
        if (first) {
          first = false;
          onProgress({ loadedBytes: 50_000_000, totalBytes: 80_000_000 });
          return { ok: false, paused: true };
        }
        return new Promise(() => undefined);
      },
    });
    await vi.waitFor(() => expect(model('whisper').state).toBe('not-downloaded'));
    await store.downloadModel('whisper');
    const paused = model('whisper').downloadedMb;

    void store.downloadModel('whisper');

    expect(model('whisper')).toMatchObject({ state: 'downloading', downloadedMb: paused });
  });

  it('tells the worker to cancel running downloads when pausing (L2-005)', async () => {
    const cancelModelDownload = vi.fn(async () => undefined);
    const { store, model } = configure({ downloadModel: () => new Promise(() => undefined), cancelModelDownload });
    await vi.waitFor(() => expect(model('kokoro').state).toBe('not-downloaded'));
    void store.downloadModel('kokoro');

    await store.pauseDownloads();

    expect(cancelModelDownload).toHaveBeenCalledWith('kokoro');
  });

  it('returns to Download with an error toast when a download fails for a non-network reason (L2-030)', async () => {
    const { store, model, status } = configure({
      downloadModel: async () => ({ ok: false, reason: 'Hugging Face listing failed (503).' }),
    });
    await vi.waitFor(() => expect(model('minilm').state).toBe('not-downloaded'));

    await store.downloadModel('minilm');

    expect(model('minilm')).toMatchObject({ state: 'not-downloaded', downloadedMb: 0 });
    expect(status.pausedDownloadCount()).toBe(0);
    expect(store.toasts().at(-1)?.severity).toBe('danger');
  });

  it('removes real cached files, frees the budget, and keeps the model on failure (L2-022)', async () => {
    const removeModelFiles = vi.fn(async () => ({ ok: true }));
    const { store, model } = configure({ modelCacheStatus: async () => true, removeModelFiles });
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the initial cache sync finish
    const before = store.cachedMb();

    await store.removeModel('whisper');

    expect(removeModelFiles).toHaveBeenCalledWith('whisper');
    expect(model('whisper').state).toBe('not-downloaded');
    expect(store.cachedMb()).toBe(before - 77);

    const failing = configure({
      modelCacheStatus: async () => true,
      removeModelFiles: async () => ({ ok: false, reason: 'blocked' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await failing.store.removeModel('whisper');
    expect(failing.model('whisper').state).toBe('ready');
    expect(failing.store.toasts().at(-1)?.severity).toBe('danger');
  });

  it('shows the Back online banner only after a real reconnect with paused downloads (L2-005)', async () => {
    const { store, model, status } = configure({
      downloadModel: async () => ({ ok: false, paused: true }),
    });
    await vi.waitFor(() => expect(model('whisper').state).toBe('not-downloaded'));
    expect(status.activeBanner()?.id).not.toBe('back-online');

    await store.downloadModel('whisper');
    expect(status.activeBanner()?.id).not.toBe('back-online');

    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));

    expect(status.activeBanner()).toMatchObject({
      id: 'back-online',
      severity: 'success',
      actionRoute: '/lab',
      message: 'Back online — paused Hugging Face model downloads can resume.',
    });

    status.dismissBanner('back-online');
    expect(status.activeBanner()?.id).not.toBe('back-online');
  });
});
